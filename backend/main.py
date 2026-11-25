from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Optional

import pandas as pd
from dotenv import load_dotenv
from fastapi import FastAPI, File, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from .analytics import compute_analytics, compute_peak_load, filter_dataframe, parse_and_clean_csv
from .forecasting import run_arima_forecast

load_dotenv()

ROOT_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT_DIR / "data"
SAMPLE_CSV = DATA_DIR / "sample_smart_meter_data.csv"

app = FastAPI(
    title="Smart Meter Electricity Consumption Forecasting & Load Analytics API",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:5173"],
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)


class ForecastRequest(BaseModel):
    p: int = 3
    d: int = 1
    q: int = 1
    horizon: int = 24
    consumer_type: Optional[str] = None


class AppState:
    def __init__(self) -> None:
        self.df = pd.DataFrame()
        self.dataset_source = "Empty Dataset"
        self.cleaning_report: Optional[Dict[str, Any]] = None
        self.last_forecast: Dict[str, Any] = run_arima_forecast(self.df)
        if SAMPLE_CSV.exists():
            self.load_sample()

    def set_dataframe(self, df: pd.DataFrame, source: str, report: Optional[Dict[str, Any]] = None) -> None:
        self.df = df
        self.dataset_source = source
        self.cleaning_report = report
        self.last_forecast = run_arima_forecast(self.df)

    def load_sample(self) -> Dict[str, Any]:
        if not SAMPLE_CSV.exists():
            raise FileNotFoundError("Sample dataset data/sample_smart_meter_data.csv not found.")
        df, report = parse_and_clean_csv(SAMPLE_CSV.read_bytes())
        self.set_dataframe(df, "35-Day Sample Dataset", report)
        return report


state = AppState()


def df_to_records(df: pd.DataFrame) -> list[dict[str, Any]]:
    if df.empty:
        return []
    out = df.copy()
    out["timestamp"] = out["timestamp"].dt.strftime("%Y-%m-%dT%H:%M:%SZ")
    return out.to_dict(orient="records")


@app.get("/api/health")
def health() -> Dict[str, Any]:
    return {"status": "ok", "cloud_storage": "firebase_firestore", "records": len(state.df)}


@app.get("/api/dashboard")
def get_dashboard() -> Dict[str, Any]:
    analytics = compute_analytics(state.df)
    peak = compute_peak_load(state.df)

    consumption_over_time = []
    daily_usage = []
    if not state.df.empty:
        hourly = state.df.assign(h=state.df["timestamp"].dt.floor("h")).groupby("h")["energy_kwh"].sum().sort_index()
        for ts, val in hourly.iloc[-120:].items():
            consumption_over_time.append(
                {"timestamp": ts.strftime("%Y-%m-%dT%H:%M:%SZ"), "label": ts.strftime("%b %d, %H:%M"), "energy_kwh": round(float(val), 2)}
            )
        daily_peaks = hourly.groupby(hourly.index.strftime("%Y-%m-%d")).max()
        for d in analytics["daily_consumption"][-14:]:
            daily_usage.append(
                {
                    "date": d["date"],
                    "label": d["label"],
                    "total_kwh": d["total_kwh"],
                    "peak_kwh": round(float(daily_peaks.get(d["date"], 0.0)), 2),
                }
            )

    recent = state.df.sort_values(["timestamp", "meter_id"], ascending=[False, True]).head(12)

    return {
        "summary": {
            "total_energy_kwh": analytics["summary"]["total_energy_kwh"],
            "total_meters": analytics["summary"]["active_meters"],
            "average_consumption_kwh": analytics["summary"]["average_hourly_kwh"],
            "peak_load_kwh": peak["peak_event"]["energy_kwh"] if peak["peak_event"] else 0.0,
            "peak_load_timestamp": peak["peak_event"]["label"] if peak["peak_event"] else None,
            "next_hour_forecast_kwh": state.last_forecast.get("next_hour_forecast_kwh"),
            "total_records": len(state.df),
            "date_range": analytics["available_date_range"],
        },
        "consumption_over_time": consumption_over_time,
        "consumer_comparison": analytics["consumer_breakdown"],
        "daily_usage": daily_usage,
        "actual_vs_predicted": state.last_forecast.get("actual_vs_predicted", [])[-48:],
        "recent_readings": df_to_records(recent),
        "forecast_status": {
            "status": state.last_forecast["status"],
            "model_name": state.last_forecast["model_name"],
            "trained_at": state.last_forecast["trained_at"],
            "mape": state.last_forecast["metrics"]["mape"] if state.last_forecast.get("metrics") else None,
            "next_hour_forecast_kwh": state.last_forecast.get("next_hour_forecast_kwh"),
        },
    }


@app.get("/api/meters")
def get_meters(
    search: Optional[str] = None,
    consumer_type: Optional[str] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=10, le=200),
) -> Dict[str, Any]:
    sub = filter_dataframe(state.df, start_date=start_date, end_date=end_date, consumer_type=consumer_type, search=search)
    sub = sub.sort_values(["timestamp", "meter_id"], ascending=[False, True]) if not sub.empty else sub
    total = len(sub)
    total_pages = max(1, (total + page_size - 1) // page_size)
    safe_page = min(page, total_pages)
    start = (safe_page - 1) * page_size
    return {
        "items": df_to_records(sub.iloc[start : start + page_size]),
        "total": total,
        "page": safe_page,
        "page_size": page_size,
        "total_pages": total_pages,
        "dataset_source": state.dataset_source,
        "cleaning_report": state.cleaning_report,
    }


@app.get("/api/dataset/active-csv")
def get_active_csv() -> Dict[str, Any]:
    if state.df.empty:
        raise HTTPException(status_code=400, detail="Cannot archive an empty dataset.")
    analytics = compute_analytics(state.df)
    out = state.df.copy()
    out["timestamp"] = out["timestamp"].dt.strftime("%Y-%m-%dT%H:%M:%SZ")
    return {
        "csv": out.to_csv(index=False),
        "record_count": len(out),
        "total_energy_kwh": analytics["summary"]["total_energy_kwh"],
        "date_range": analytics["available_date_range"],
        "dataset_source": state.dataset_source,
    }


@app.post("/api/upload")
async def upload_csv(file: UploadFile = File(...)) -> Dict[str, Any]:
    raw = await file.read()
    if len(raw) > 10 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="CSV file exceeds 10MB limit.")
    try:
        df, report = parse_and_clean_csv(raw)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    state.set_dataframe(df, file.filename or "Uploaded CSV", report)
    return {
        "message": f"Validated and loaded {len(df):,} cleaned smart meter records.",
        "dataset_source": state.dataset_source,
        "cleaning_report": report,
    }


@app.post("/api/dataset/load-sample")
def load_sample_dataset() -> Dict[str, Any]:
    try:
        report = state.load_sample()
        return {"message": f"Loaded {len(state.df):,} sample records.", "total_records": len(state.df), "cleaning_report": report}
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.get("/api/analytics")
def get_analytics(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    consumer_type: Optional[str] = "All",
) -> Dict[str, Any]:
    return compute_analytics(state.df, start_date=start_date, end_date=end_date, consumer_type=consumer_type)


@app.get("/api/peak-load")
def get_peak_load(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    consumer_type: Optional[str] = "All",
) -> Dict[str, Any]:
    return compute_peak_load(state.df, start_date=start_date, end_date=end_date, consumer_type=consumer_type)


@app.post("/api/forecast")
def post_forecast(req: ForecastRequest) -> Dict[str, Any]:
    sub = filter_dataframe(state.df, consumer_type=req.consumer_type) if req.consumer_type and req.consumer_type != "All" else state.df
    result = run_arima_forecast(sub, p=req.p, d=req.d, q=req.q, horizon=req.horizon)
    if not req.consumer_type or req.consumer_type == "All":
        state.last_forecast = result
    return result


@app.get("/api/reports")
def get_reports(
    type: str = Query("daily", pattern="^(daily|weekly|monthly|forecast)$"),
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    consumer_type: Optional[str] = "All",
) -> Dict[str, Any]:
    analytics = compute_analytics(state.df, start_date=start_date, end_date=end_date, consumer_type=consumer_type)
    if type == "monthly":
        rows = [
            {
                "period": m["month"],
                "total_kwh": m["total_kwh"],
                "average_kwh": round(m["total_kwh"] / 720.0, 2),
                "peak_kwh": m["total_kwh"],
                "residential_kwh": m["residential_kwh"],
                "commercial_kwh": m["commercial_kwh"],
                "industrial_kwh": m["industrial_kwh"],
                "record_count": analytics["summary"]["total_records"],
            }
            for m in analytics["monthly_consumption"]
        ]
    elif type == "weekly":
        rows = [
            {
                "period": w["week"],
                "total_kwh": w["total_kwh"],
                "average_kwh": round(w["average_daily_kwh"] / 24.0, 2),
                "peak_kwh": w["average_daily_kwh"],
                "residential_kwh": 0.0,
                "commercial_kwh": 0.0,
                "industrial_kwh": 0.0,
                "record_count": analytics["summary"]["total_records"],
            }
            for w in analytics["weekly_consumption"]
        ]
    else:
        rows = [
            {
                "period": d["date"],
                "total_kwh": d["total_kwh"],
                "average_kwh": d["average_kwh"],
                "peak_kwh": d["total_kwh"],
                "residential_kwh": d["residential_kwh"],
                "commercial_kwh": d["commercial_kwh"],
                "industrial_kwh": d["industrial_kwh"],
                "record_count": 144,
            }
            for d in analytics["daily_consumption"]
        ]

    total_e = sum(r["total_kwh"] for r in rows)
    peak_row = max(rows, key=lambda r: r["total_kwh"]) if rows else None
    return {
        "report_type": type,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "date_range": analytics["available_date_range"],
        "summary": {
            "total_energy_kwh": round(total_e, 2),
            "average_period_kwh": round(total_e / max(1, len(rows)), 2),
            "peak_period_kwh": peak_row["total_kwh"] if peak_row else 0.0,
            "peak_period_label": peak_row["period"] if peak_row else "—",
            "total_meters": analytics["summary"]["active_meters"],
            "total_records": analytics["summary"]["total_records"],
        },
        "rows": rows,
        "forecast_rows": state.last_forecast.get("next_24h_forecast", []),
        "forecast_metrics": state.last_forecast.get("metrics"),
    }
