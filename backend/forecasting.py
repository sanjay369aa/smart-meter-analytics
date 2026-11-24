from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict

import numpy as np
import pandas as pd
from sklearn.metrics import mean_absolute_error, mean_squared_error
from statsmodels.tsa.arima.model import ARIMA

MIN_HOURS_FOR_ARIMA = 48


def run_arima_forecast(
    df: pd.DataFrame,
    p: int = 3,
    d: int = 1,
    q: int = 1,
    horizon: int = 24,
) -> Dict[str, Any]:
    """Prepare hourly time series, handle missing timestamps, train ARIMA(p,d,q), and evaluate with scikit-learn."""
    p = max(1, min(12, int(p)))
    d = max(0, min(2, int(d)))
    q = max(0, min(4, int(q)))
    horizon = max(1, min(72, int(horizon)))

    if df.empty:
        return {
            "status": "insufficient_data",
            "model_name": f"ARIMA({p},{d},{q})",
            "order": {"p": p, "d": d, "q": q},
            "trained_at": None,
            "training_samples": 0,
            "validation_samples": 0,
            "missing_hours_interpolated": 0,
            "next_hour_forecast_kwh": None,
            "next_24h_total_kwh": None,
            "next_24h_peak_kwh": None,
            "next_24h_peak_timestamp": None,
            "metrics": None,
            "actual_vs_predicted": [],
            "next_24h_forecast": [],
            "historical_trend": [],
            "message": "No historical data loaded. Load the sample dataset or upload a CSV file.",
        }

    hourly = (
        df.assign(hour_ts=df["timestamp"].dt.floor("h"))
        .groupby("hour_ts")["energy_kwh"]
        .sum()
        .sort_index()
    )

    full_index = pd.date_range(start=hourly.index.min(), end=hourly.index.max(), freq="h", tz="UTC")
    reindexed = hourly.reindex(full_index)
    missing_count = int(reindexed.isna().sum())
    series = reindexed.interpolate(method="linear").bfill().ffill()

    if len(series) < MIN_HOURS_FOR_ARIMA:
        return {
            "status": "insufficient_data",
            "model_name": f"ARIMA({p},{d},{q})",
            "order": {"p": p, "d": d, "q": q},
            "trained_at": None,
            "training_samples": len(series),
            "validation_samples": 0,
            "missing_hours_interpolated": missing_count,
            "next_hour_forecast_kwh": None,
            "next_24h_total_kwh": None,
            "next_24h_peak_kwh": None,
            "next_24h_peak_timestamp": None,
            "metrics": None,
            "actual_vs_predicted": [],
            "next_24h_forecast": [],
            "historical_trend": [
                {"timestamp": ts.strftime("%Y-%m-%dT%H:%M:%SZ"), "label": ts.strftime("%b %d, %H:%M"), "actual_kwh": round(float(val), 2)}
                for ts, val in series.items()
            ],
            "message": f"Insufficient historical data ({len(series)} hours). At least {MIN_HOURS_FOR_ARIMA} hourly intervals are required.",
        }

    # Chronological 80/20 split
    val_size = min(168, max(12, int(len(series) * 0.2)))
    train_series = series.iloc[:-val_size]
    val_series = series.iloc[-val_size:]

    # 24-hour diurnal seasonal profile estimated strictly on training split
    train_hourly_means = train_series.groupby(train_series.index.hour).mean()
    train_deseas = train_series - train_series.index.hour.map(train_hourly_means).values
    val_deseas = val_series - val_series.index.hour.map(train_hourly_means).values

    eval_fit = ARIMA(train_deseas.values, order=(p, d, q)).fit()
    extended = eval_fit.append(val_deseas.values, refit=False)
    val_preds_deseas = extended.predict(start=len(train_deseas), end=len(train_deseas) + len(val_deseas) - 1)
    val_preds = np.maximum(0.1, val_preds_deseas + val_series.index.hour.map(train_hourly_means).values)

    mae = float(mean_absolute_error(val_series.values, val_preds))
    rmse = float(np.sqrt(mean_squared_error(val_series.values, val_preds)))
    non_zero = val_series.values > 0.01
    mape = float(np.mean(np.abs((val_series.values[non_zero] - val_preds[non_zero]) / val_series.values[non_zero])) * 100.0) if non_zero.any() else 0.0

    # Refit on 100% of available history for next-24h forecasting
    full_hourly_means = series.groupby(series.index.hour).mean()
    full_deseas = series - series.index.hour.map(full_hourly_means).values
    final_fit = ARIMA(full_deseas.values, order=(p, d, q)).fit()
    fc_res = final_fit.get_forecast(steps=horizon)
    fc_mean_deseas = fc_res.predicted_mean
    fc_ci = fc_res.conf_int(alpha=0.05)

    future_index = pd.date_range(start=series.index[-1] + pd.Timedelta(hours=1), periods=horizon, freq="h", tz="UTC")
    next_24h_forecast = []
    for i, ts in enumerate(future_index):
        seasonal = float(full_hourly_means.get(ts.hour, series.mean()))
        pred_val = max(0.1, float(fc_mean_deseas[i]) + seasonal)
        lower_val = max(0.0, float(fc_ci[i, 0]) + seasonal)
        upper_val = max(pred_val, float(fc_ci[i, 1]) + seasonal)
        next_24h_forecast.append(
            {
                "timestamp": ts.strftime("%Y-%m-%dT%H:%M:%SZ"),
                "label": ts.strftime("%b %d, %H:%M"),
                "predicted_kwh": round(pred_val, 2),
                "lower_bound": round(lower_val, 2),
                "upper_bound": round(upper_val, 2),
            }
        )

    peak_fc = max(next_24h_forecast, key=lambda x: x["predicted_kwh"])

    return {
        "status": "trained",
        "model_name": f"Statsmodels ARIMA({p},{d},{q}) + 24h Seasonal Profile",
        "order": {"p": p, "d": d, "q": q},
        "trained_at": datetime.now(timezone.utc).isoformat(),
        "training_samples": len(train_series),
        "validation_samples": len(val_series),
        "missing_hours_interpolated": missing_count,
        "next_hour_forecast_kwh": next_24h_forecast[0]["predicted_kwh"],
        "next_24h_total_kwh": round(sum(x["predicted_kwh"] for x in next_24h_forecast), 2),
        "next_24h_peak_kwh": peak_fc["predicted_kwh"],
        "next_24h_peak_timestamp": peak_fc["timestamp"],
        "metrics": {"mae": round(mae, 3), "rmse": round(rmse, 3), "mape": round(mape, 2)},
        "actual_vs_predicted": [
            {
                "timestamp": ts.strftime("%Y-%m-%dT%H:%M:%SZ"),
                "label": ts.strftime("%b %d, %H:%M"),
                "actual_kwh": round(float(act), 2),
                "predicted_kwh": round(float(pred), 2),
            }
            for ts, act, pred in zip(val_series.index[-96:], val_series.values[-96:], val_preds[-96:])
        ],
        "next_24h_forecast": next_24h_forecast,
        "historical_trend": [
            {"timestamp": ts.strftime("%Y-%m-%dT%H:%M:%SZ"), "label": ts.strftime("%b %d, %H:%M"), "actual_kwh": round(float(val), 2)}
            for ts, val in series.iloc[-168:].items()
        ],
    }
