# Smart Meter Electricity Consumption Forecasting and Load Analytics on Cloud

A unified, cloud-ready smart electricity monitoring, consumption analytics, peak load detection, ARIMA short-term load forecasting, and reporting platform.

## Integrated Modules

1. **Module 1 — Smart Meter Data Collection & Cloud Storage**
   - Simulates hourly smart meter telemetry (`meter_id`, `timestamp`, `consumer_type`, `energy_kwh`, `voltage`, `current`, `power_factor`) across Residential, Commercial, and Industrial meters.
   - CSV upload with schema validation, duplicate `(meter_id, timestamp)` removal, missing value imputation, live search/filtering, and CSV export.
   - Secure **AWS S3** integration configured strictly through backend environment variables (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, `AWS_S3_BUCKET`) with an honest, fully functional **Local Simulation Mode** (`data/cloud_sim/`) when AWS credentials are not configured.
2. **Module 2 — Electricity Consumption Pattern Analysis & Peak Load Detection**
   - Interactive hourly, daily, weekly, monthly, and consumer-category (Residential, Commercial, Industrial) analytics with live date-range and consumer filtering.
   - Automatic peak hour identification, off-peak window classification, peak vs. off-peak share breakdown, and Z-score anomaly detection for unusual load spikes.
3. **Module 3 — Short-Term Electricity Load Forecasting (ARIMA)**
   - Prepares continuous hourly time series with linear interpolation for missing timestamps.
   - Trains a configurable seasonal **ARIMA(p, d, q)** model on an 80/20 chronological split and reports real **MAE**, **RMSE**, and **MAPE** evaluation metrics.
   - Predicts next-hour consumption and the next 24 hours with 95% confidence bounds, accompanied by Actual vs. Predicted, Next 24 Hours Forecast, and Historical Trend graphs.
4. **Reports & Export**
   - Generates Daily, Weekly, Monthly, and Forecast summary reports with one-click **CSV** and formatted **PDF** downloads.

## Running the Integrated Full-Stack App (React + Express + Vite)

```bash
npm install
npm run dev
```

Open `http://localhost:3000`. The application automatically loads the 35-day sample smart meter dataset (`data/sample_smart_meter_data.csv`, 5,040 hourly readings across 6 meters) and trains the ARIMA forecasting model on startup.

For production builds:

```bash
npm run build
npm start
```

## Running the Python FastAPI Backend (Optional Standalone API)

The `/backend` directory provides a full Python implementation using **FastAPI**, **Pandas**, **NumPy**, **Statsmodels (ARIMA)**, **Scikit-learn**, and **Boto3 (AWS S3)** matching the exact `/api/*` contract:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r backend/requirements.txt
uvicorn backend.main:app --host 0.0.0.0 --port 8000 --reload
```

## AWS S3 Configuration (Backend Only)

Never place AWS access keys in frontend code. Configure the following server environment variables (see `.env.example`):

```env
AWS_ACCESS_KEY_ID=your_access_key_id
AWS_SECRET_ACCESS_KEY=your_secret_access_key
AWS_REGION=us-east-1
AWS_S3_BUCKET=your-smart-meter-bucket
AWS_S3_PREFIX=smart-meter-datasets/
```

When `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` are unset, the platform operates transparently in **Local Simulation Mode** and persists uploaded CSV datasets to `data/cloud_sim/`.

## Sample Dataset Format

Required CSV columns:

```csv
meter_id,timestamp,consumer_type,energy_kwh,voltage,current,power_factor
RES-101,2026-10-16T19:00:00Z,Residential,3.214,228.42,15.04,0.935
```

## Verification & Unit Tests

```bash
npx tsx --test src/server/analytics.test.ts src/server/arima.test.ts src/server/storage.test.ts
```
