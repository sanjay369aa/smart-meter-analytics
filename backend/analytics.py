from __future__ import annotations

import io
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
import pandas as pd

REQUIRED_COLUMNS = [
    "meter_id",
    "timestamp",
    "consumer_type",
    "energy_kwh",
    "voltage",
    "current",
    "power_factor",
]

VALID_CONSUMERS = {
    "residential": "Residential",
    "commercial": "Commercial",
    "industrial": "Industrial",
}

DEFAULT_VOLTAGE = {"Residential": 230.0, "Commercial": 240.0, "Industrial": 415.0}
DEFAULT_PF = {"Residential": 0.94, "Commercial": 0.91, "Industrial": 0.86}


def parse_and_clean_csv(csv_bytes: bytes) -> Tuple[pd.DataFrame, Dict[str, Any]]:
    """Validate uploaded CSV, remove duplicate (meter_id, timestamp) rows, and impute missing values."""
    text = csv_bytes.decode("utf-8-sig").strip()
    if not text:
        raise ValueError("Uploaded CSV file is empty.")

    df = pd.read_csv(io.StringIO(text))
    df.columns = [str(c).strip().lower() for c in df.columns]

    missing_cols = [c for c in REQUIRED_COLUMNS if c not in df.columns]
    if missing_cols:
        raise ValueError(
            f"Missing required CSV column(s): {', '.join(missing_cols)}. "
            f"Expected: {', '.join(REQUIRED_COLUMNS)}."
        )

    total_received = len(df)
    if total_received == 0:
        raise ValueError("CSV file contains headers but no data rows.")

    df = df[REQUIRED_COLUMNS].copy()
    df["meter_id"] = df["meter_id"].astype(str).str.strip()
    df["consumer_type"] = df["consumer_type"].astype(str).str.strip().str.lower().map(VALID_CONSUMERS)
    df["timestamp"] = pd.to_datetime(df["timestamp"], utc=True, errors="coerce")

    valid_mask = df["meter_id"].ne("") & df["consumer_type"].notna() & df["timestamp"].notna()
    invalid_rejected = int((~valid_mask).sum())
    df = df[valid_mask].copy()

    before_dedup = len(df)
    df = df.drop_duplicates(subset=["meter_id", "timestamp"], keep="first")
    duplicates_removed = before_dedup - len(df)

    if df.empty:
        raise ValueError("No valid smart meter records remained after validation.")

    missing_imputed = 0
    for col in ["energy_kwh", "voltage", "current", "power_factor"]:
        df[col] = pd.to_numeric(df[col], errors="coerce")

    # Impute energy_kwh by consumer_type mean, falling back to global mean
    energy_na = df["energy_kwh"].isna()
    if energy_na.any():
        missing_imputed += int(energy_na.sum())
        group_means = df.groupby("consumer_type")["energy_kwh"].transform("mean")
        global_mean = float(df["energy_kwh"].mean()) if df["energy_kwh"].notna().any() else 5.0
        df["energy_kwh"] = df["energy_kwh"].fillna(group_means).fillna(global_mean)

    # Impute voltage & power_factor by consumer defaults
    v_na = df["voltage"].isna()
    if v_na.any():
        missing_imputed += int(v_na.sum())
        df.loc[v_na, "voltage"] = df.loc[v_na, "consumer_type"].map(DEFAULT_VOLTAGE)

    pf_na = df["power_factor"].isna()
    if pf_na.any():
        missing_imputed += int(pf_na.sum())
        df.loc[pf_na, "power_factor"] = df.loc[pf_na, "consumer_type"].map(DEFAULT_PF)

    # Compute missing current from P = V * I * pf (sqrt(3) for 3-phase industrial)
    c_na = df["current"].isna()
    if c_na.any():
        missing_imputed += int(c_na.sum())
        phase = np.where(df.loc[c_na, "consumer_type"] == "Industrial", np.sqrt(3), 1.0)
        df.loc[c_na, "current"] = (df.loc[c_na, "energy_kwh"] * 1000.0) / (
            phase * df.loc[c_na, "voltage"] * df.loc[c_na, "power_factor"]
        )

    df["energy_kwh"] = df["energy_kwh"].clip(lower=0.0).round(3)
    df["voltage"] = df["voltage"].clip(lower=50.0, upper=1000.0).round(2)
    df["current"] = df["current"].clip(lower=0.0).round(2)
    df["power_factor"] = df["power_factor"].clip(lower=0.1, upper=1.0).round(3)
    df = df.sort_values(["timestamp", "meter_id"]).reset_index(drop=True)

    warnings: List[str] = []
    if duplicates_removed:
        warnings.append(f"Removed {duplicates_removed} duplicate (meter_id, timestamp) record(s).")
    if missing_imputed:
        warnings.append(f"Imputed {missing_imputed} missing numeric value(s) using category means.")
    if invalid_rejected:
        warnings.append(f"Rejected {invalid_rejected} invalid row(s).")

    report = {
        "total_rows_received": total_received,
        "valid_records_loaded": len(df),
        "duplicates_removed": duplicates_removed,
        "missing_values_imputed": missing_imputed,
        "invalid_rows_rejected": invalid_rejected,
        "warnings": warnings,
    }
    return df, report


def filter_dataframe(
    df: pd.DataFrame,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    consumer_type: Optional[str] = None,
    search: Optional[str] = None,
) -> pd.DataFrame:
    if df.empty:
        return df.copy()
    sub = df.copy()
    if start_date:
        sub = sub[sub["timestamp"].dt.strftime("%Y-%m-%d") >= start_date]
    if end_date:
        sub = sub[sub["timestamp"].dt.strftime("%Y-%m-%d") <= end_date]
    if consumer_type and consumer_type != "All":
        sub = sub[sub["consumer_type"].str.lower() == consumer_type.lower()]
    if search:
        q = search.strip().lower()
        mask = (
            sub["meter_id"].str.lower().str.contains(q, regex=False)
            | sub["consumer_type"].str.lower().str.contains(q, regex=False)
        )
        sub = sub[mask]
    return sub


def compute_analytics(
    df: pd.DataFrame,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    consumer_type: Optional[str] = None,
) -> Dict[str, Any]:
    avail_start = df["timestamp"].min().strftime("%Y-%m-%d") if not df.empty else None
    avail_end = df["timestamp"].max().strftime("%Y-%m-%d") if not df.empty else None

    sub = filter_dataframe(df, start_date=start_date, end_date=end_date, consumer_type=consumer_type)
    total_energy = float(sub["energy_kwh"].sum()) if not sub.empty else 0.0

    sub = sub.copy()
    if not sub.empty:
        sub["hour"] = sub["timestamp"].dt.hour
        sub["date"] = sub["timestamp"].dt.strftime("%Y-%m-%d")
        sub["month"] = sub["timestamp"].dt.strftime("%Y-%m")
        sub["week"] = sub["timestamp"].dt.strftime("%G-W%V")
        sub["hour_bucket"] = sub["timestamp"].dt.floor("h")

    # Hourly profile 0..23
    hourly_profile = []
    for h in range(24):
        h_df = sub[sub["hour"] == h] if not sub.empty else pd.DataFrame()
        n_buckets = max(1, int(h_df["hour_bucket"].nunique())) if not h_df.empty else 1
        hourly_profile.append(
            {
                "hour": h,
                "label": f"{h:02d}:00",
                "average_kwh": round(float(h_df["energy_kwh"].sum()) / n_buckets, 2) if not h_df.empty else 0.0,
                "total_kwh": round(float(h_df["energy_kwh"].sum()), 2) if not h_df.empty else 0.0,
                "residential_kwh": round(float(h_df[h_df["consumer_type"] == "Residential"]["energy_kwh"].sum()) / n_buckets, 2) if not h_df.empty else 0.0,
                "commercial_kwh": round(float(h_df[h_df["consumer_type"] == "Commercial"]["energy_kwh"].sum()) / n_buckets, 2) if not h_df.empty else 0.0,
                "industrial_kwh": round(float(h_df[h_df["consumer_type"] == "Industrial"]["energy_kwh"].sum()) / n_buckets, 2) if not h_df.empty else 0.0,
            }
        )

    daily_consumption = []
    if not sub.empty:
        for date_str, grp in sub.groupby("date"):
            daily_consumption.append(
                {
                    "date": str(date_str),
                    "label": pd.to_datetime(date_str).strftime("%b %d"),
                    "total_kwh": round(float(grp["energy_kwh"].sum()), 2),
                    "average_kwh": round(float(grp["energy_kwh"].mean()), 2),
                    "residential_kwh": round(float(grp[grp["consumer_type"] == "Residential"]["energy_kwh"].sum()), 2),
                    "commercial_kwh": round(float(grp[grp["consumer_type"] == "Commercial"]["energy_kwh"].sum()), 2),
                    "industrial_kwh": round(float(grp[grp["consumer_type"] == "Industrial"]["energy_kwh"].sum()), 2),
                }
            )

    weekly_consumption = []
    if not sub.empty:
        for wk, grp in sub.groupby("week"):
            n_days = max(1, int(grp["date"].nunique()))
            weekly_consumption.append(
                {
                    "week": str(wk),
                    "label": str(wk),
                    "total_kwh": round(float(grp["energy_kwh"].sum()), 2),
                    "average_daily_kwh": round(float(grp["energy_kwh"].sum()) / n_days, 2),
                }
            )

    monthly_consumption = []
    if not sub.empty:
        for m, grp in sub.groupby("month"):
            monthly_consumption.append(
                {
                    "month": str(m),
                    "label": pd.to_datetime(f"{m}-01").strftime("%b %Y"),
                    "total_kwh": round(float(grp["energy_kwh"].sum()), 2),
                    "residential_kwh": round(float(grp[grp["consumer_type"] == "Residential"]["energy_kwh"].sum()), 2),
                    "commercial_kwh": round(float(grp[grp["consumer_type"] == "Commercial"]["energy_kwh"].sum()), 2),
                    "industrial_kwh": round(float(grp[grp["consumer_type"] == "Industrial"]["energy_kwh"].sum()), 2),
                }
            )

    consumer_breakdown = []
    for ct in ["Residential", "Commercial", "Industrial"]:
        c_df = sub[sub["consumer_type"] == ct] if not sub.empty else pd.DataFrame()
        c_total = float(c_df["energy_kwh"].sum()) if not c_df.empty else 0.0
        consumer_breakdown.append(
            {
                "consumer_type": ct,
                "total_kwh": round(c_total, 2),
                "average_kwh": round(float(c_df["energy_kwh"].mean()), 2) if not c_df.empty else 0.0,
                "peak_kwh": round(float(c_df["energy_kwh"].max()), 2) if not c_df.empty else 0.0,
                "share_percent": round((c_total / total_energy) * 100.0, 1) if total_energy > 0 else 0.0,
                "meter_count": int(c_df["meter_id"].nunique()) if not c_df.empty else 0,
                "avg_power_factor": round(float(c_df["power_factor"].mean()), 3) if not c_df.empty else 0.0,
            }
        )

    unique_hours = int(sub["hour_bucket"].nunique()) if not sub.empty else 0
    unique_days = int(sub["date"].nunique()) if not sub.empty else 0

    return {
        "filters": {
            "start_date": start_date,
            "end_date": end_date,
            "consumer_type": consumer_type or "All",
        },
        "available_date_range": {"start": avail_start, "end": avail_end},
        "summary": {
            "total_energy_kwh": round(total_energy, 2),
            "average_reading_kwh": round(float(sub["energy_kwh"].mean()), 2) if not sub.empty else 0.0,
            "average_daily_kwh": round(total_energy / max(1, unique_days), 2) if unique_days else 0.0,
            "average_hourly_kwh": round(total_energy / max(1, unique_hours), 2) if unique_hours else 0.0,
            "total_records": len(sub),
            "active_meters": int(sub["meter_id"].nunique()) if not sub.empty else 0,
        },
        "hourly_profile": hourly_profile,
        "daily_consumption": daily_consumption,
        "weekly_consumption": weekly_consumption,
        "monthly_consumption": monthly_consumption,
        "consumer_breakdown": consumer_breakdown,
    }


def compute_peak_load(
    df: pd.DataFrame,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    consumer_type: Optional[str] = None,
) -> Dict[str, Any]:
    sub = filter_dataframe(df, start_date=start_date, end_date=end_date, consumer_type=consumer_type)
    if sub.empty:
        return {
            "peak_hour": None,
            "peak_event": None,
            "lowest_hour": None,
            "off_peak_hours": [],
            "peak_hours": [],
            "period_split": {
                "peak_total_kwh": 0,
                "off_peak_total_kwh": 0,
                "peak_share_percent": 0,
                "off_peak_share_percent": 0,
                "threshold_kwh": 0,
            },
            "hourly_load_curve": [],
            "anomalies": [],
        }

    sub = sub.copy()
    sub["hour_ts"] = sub["timestamp"].dt.floor("h")
    hourly = sub.groupby("hour_ts")["energy_kwh"].sum().reset_index()
    hourly["hour"] = hourly["hour_ts"].dt.hour

    stats = hourly.groupby("hour")["energy_kwh"].agg(["mean", "std", "max"]).fillna(0.0)
    p75 = float(np.percentile(stats["mean"].values, 72))
    p25 = float(np.percentile(stats["mean"].values, 28))

    curve = []
    peak_hour_set = set()
    for h in range(24):
        mean_val = float(stats.loc[h, "mean"]) if h in stats.index else 0.0
        max_val = float(stats.loc[h, "max"]) if h in stats.index else 0.0
        classification = "Standard"
        if mean_val >= p75 and mean_val > 0:
            classification = "Peak"
            peak_hour_set.add(h)
        elif mean_val <= p25:
            classification = "Off-Peak"
        curve.append(
            {
                "hour": h,
                "label": f"{h:02d}:00",
                "average_kwh": round(mean_val, 2),
                "max_kwh": round(max_val, 2),
                "classification": classification,
            }
        )

    peak_h_idx = int(stats["mean"].idxmax())
    low_h_idx = int(stats["mean"].idxmin())
    peak_row = hourly.loc[hourly["energy_kwh"].idxmax()]

    peak_total = float(hourly[hourly["hour"].isin(peak_hour_set)]["energy_kwh"].sum())
    off_peak_total = float(hourly[~hourly["hour"].isin(peak_hour_set)]["energy_kwh"].sum())
    grand_total = peak_total + off_peak_total

    # Robust Median/MAD anomaly detection relative to hour-of-day baseline
    anomalies = []
    hour_medians = hourly.groupby("hour")["energy_kwh"].median()
    hour_mads = hourly.groupby("hour")["energy_kwh"].apply(lambda s: float(np.median(np.abs(s - np.median(s)))))
    consumer_by_hour = sub.groupby(["hour_ts", "consumer_type"])["energy_kwh"].sum().unstack(fill_value=0.0)
    for _, row in hourly.iterrows():
        h = int(row["hour"])
        med_val = float(hour_medians.loc[h])
        mad_val = float(hour_mads.loc[h])
        scale = 1.4826 * mad_val if mad_val > 1e-4 else float(stats.loc[h, "std"])
        if scale <= 1e-4:
            continue
        z = (float(row["energy_kwh"]) - med_val) / scale
        if z >= 2.5:
            ts = row["hour_ts"]
            dominant = str(consumer_by_hour.loc[ts].idxmax()) if ts in consumer_by_hour.index else "Industrial"
            anomalies.append(
                {
                    "timestamp": ts.strftime("%Y-%m-%dT%H:%M:%SZ"),
                    "label": ts.strftime("%b %d, %H:%M"),
                    "total_kwh": round(float(row["energy_kwh"]), 2),
                    "expected_kwh": round(med_val, 2),
                    "z_score": round(z, 2),
                    "deviation_percent": round(((float(row["energy_kwh"]) - med_val) / max(0.01, med_val)) * 100.0, 1),
                    "dominant_consumer": dominant,
                    "severity": "High" if z >= 3.5 else "Elevated",
                }
            )
    anomalies.sort(key=lambda item: item["z_score"], reverse=True)

    return {
        "peak_hour": {"hour": peak_h_idx, "label": f"{peak_h_idx:02d}:00", "average_kwh": round(float(stats.loc[peak_h_idx, "mean"]), 2)},
        "peak_event": {
            "timestamp": peak_row["hour_ts"].strftime("%Y-%m-%dT%H:%M:%SZ"),
            "label": peak_row["hour_ts"].strftime("%b %d, %H:%M"),
            "energy_kwh": round(float(peak_row["energy_kwh"]), 2),
        },
        "lowest_hour": {"hour": low_h_idx, "label": f"{low_h_idx:02d}:00", "average_kwh": round(float(stats.loc[low_h_idx, "mean"]), 2)},
        "peak_hours": [{"hour": c["hour"], "label": c["label"], "average_kwh": c["average_kwh"]} for c in curve if c["classification"] == "Peak"],
        "off_peak_hours": [{"hour": c["hour"], "label": c["label"], "average_kwh": c["average_kwh"]} for c in curve if c["classification"] == "Off-Peak"],
        "period_split": {
            "peak_total_kwh": round(peak_total, 2),
            "off_peak_total_kwh": round(off_peak_total, 2),
            "peak_share_percent": round((peak_total / grand_total) * 100.0, 1) if grand_total else 0.0,
            "off_peak_share_percent": round((off_peak_total / grand_total) * 100.0, 1) if grand_total else 0.0,
            "threshold_kwh": round(p75, 2),
        },
        "hourly_load_curve": curve,
        "anomalies": anomalies[:20],
    }
