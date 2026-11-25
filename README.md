# Smart Meter Electricity Consumption Forecasting and Load Analytics on Cloud

A unified, Vercel-ready smart electricity monitoring, consumption analytics, peak load detection, ARIMA short-term load forecasting, and reporting web application.

## Vercel Deployment Structure

This repository is structured natively for **Vercel** deployment:

- `vercel.json` — Configures Vite SPA output (`dist/`), Node.js serverless function routing (`/api/(.*)` -> `/api/index`), SPA fallback (`/((?!api/).*)` -> `/index.html`), and security/cache headers.
- `api/index.ts` — Standalone Vercel Serverless Function entry point exporting the Express API app (zero Vite dev dependencies, automatic writable `/tmp` handling on Vercel's read-only filesystem).
- `src/server/app.ts` — Shared Express API router powering both Vercel Serverless (`api/index.ts`) and local development (`server.ts`).
- `.vercelignore` — Excludes tests, local artifacts, and optional Python reference files from Vercel builds.

### Deploy to Vercel

**Option A — Git Integration (Recommended)**
1. Push this repository to GitHub, GitLab, or Bitbucket.
2. Import the repository in the [Vercel Dashboard](https://vercel.com/new).
3. Vercel automatically detects `vercel.json` (`framework: vite`, build command `npm run build`, output directory `dist`, API function `api/index.ts`).
4. *(Optional for live AWS S3)* Add environment variables under **Project Settings → Environment Variables**:
   - `AWS_ACCESS_KEY_ID`
   - `AWS_SECRET_ACCESS_KEY`
   - `AWS_REGION` (e.g. `us-east-1`)
   - `AWS_S3_BUCKET`
   - `AWS_S3_PREFIX` (e.g. `smart-meter-datasets/`)
5. Click **Deploy**.

**Option B — Vercel CLI**
```bash
npm install -g vercel
vercel --prod
```

> **Note on Storage on Vercel**: Without AWS S3 credentials configured, the app runs transparently in **Local Simulation Mode** using Vercel's ephemeral `/tmp` storage. Configure the AWS S3 environment variables in Vercel Project Settings for durable cross-invocation cloud storage.

## Integrated Modules

1. **Module 1 — Smart Meter Data Collection & Cloud Storage**
   - Simulates hourly smart meter telemetry (`meter_id`, `timestamp`, `consumer_type`, `energy_kwh`, `voltage`, `current`, `power_factor`) across Residential, Commercial, and Industrial meters.
   - CSV upload with schema validation, duplicate `(meter_id, timestamp)` removal, missing value imputation, live search/filtering, and CSV export.
   - Secure **AWS S3** integration configured strictly via backend environment variables with transparent **Local Simulation Mode** fallback.
2. **Module 2 — Electricity Consumption Pattern Analysis & Peak Load Detection**
   - Interactive hourly, daily, weekly, monthly, and consumer-category analytics with date-range and sector filters.
   - Peak/off-peak hour classification and robust Median/MAD Z-score spike anomaly detection.
3. **Module 3 — Short-Term Electricity Load Forecasting (ARIMA)**
   - Hourly timestamp reindexing with linear interpolation for missing hours.
   - Configurable seasonal **ARIMA(p, d, q)** trained on an 80/20 chronological split with **MAE**, **RMSE**, **MAPE**, and 24-hour predictions + 95% confidence band.
4. **Reports & Export**
   - Daily, Weekly, Monthly, and Forecast summary reports with embedded charts, **CSV**, and **PDF** downloads.

## Local Development

```bash
npm install
npm run dev
```

Open `http://localhost:3000`. For a local production build:

```bash
npm run build
npm start
```

## Optional Standalone Python FastAPI Backend

The `/backend` directory contains a matching Python implementation (**FastAPI**, **Pandas**, **NumPy**, **Statsmodels**, **Scikit-learn**, **Boto3**) excluded from Vercel bundles via `.vercelignore`:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r backend/requirements.txt
uvicorn backend.main:app --host 0.0.0.0 --port 8000 --reload
```

## Unit Tests

```bash
npx tsx --test src/server/analytics.test.ts src/server/arima.test.ts src/server/storage.test.ts src/server/vercel.test.ts
```
