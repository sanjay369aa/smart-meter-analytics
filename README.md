# Smart Meter Electricity Consumption Forecasting and Load Analytics on Cloud

A unified, Vercel-ready smart electricity monitoring, consumption analytics, peak load detection, ARIMA short-term load forecasting, Firebase Cloud Firestore dataset archiving, and reporting web application.

## Cloud & Vercel Deployment Architecture

This repository combines **Vercel** deployment with **Firebase (Cloud Firestore + Google Authentication)**:

- `vercel.json` — Configures Vite SPA output (`dist/`), Node.js serverless function routing (`/api/(.*)` -> `/api/index`), SPA fallback (`/((?!api/).*)` -> `/index.html`), and security/cache headers.
- `api/index.ts` — Standalone Vercel Serverless Function entry point exporting the Express analytics and ARIMA forecasting API.
- `src/server/app.ts` — Shared Express API router powering both Vercel Serverless (`api/index.ts`) and local development (`server.ts`).
- `firebase-applet-config.json` — Provisioned Firebase web configuration bound to the project's Cloud Firestore database.
- `firestore.rules` & `firebase-blueprint.json` — Deployed Firestore security rules and schema blueprint enforcing verified Google Auth owner isolation, atomic batched CSV chunk storage (`/datasets/{datasetId}/chunks/{chunkId}`), and per-user ARIMA defaults (`/userSettings/{userId}`).

### Deploy to Vercel

**Option A — Git Integration (Recommended)**
1. Push this repository to GitHub, GitLab, or Bitbucket.
2. Import the repository in the [Vercel Dashboard](https://vercel.com/new).
3. Vercel automatically detects `vercel.json` (`framework: vite`, build command `npm run build`, output directory `dist`, API function `api/index.ts`).
4. Add your production Vercel domain to **Firebase Console → Authentication → Settings → Authorized domains** so Google Sign-In popups work on your custom Vercel URL.
5. Click **Deploy**.

**Option B — Vercel CLI**
```bash
npm install -g vercel
vercel --prod
```

## Integrated Modules

1. **Module 1 — Smart Meter Data Collection & Firebase Cloud Storage**
   - Simulates hourly smart meter telemetry (`meter_id`, `timestamp`, `consumer_type`, `energy_kwh`, `voltage`, `current`, `power_factor`) across Residential, Commercial, and Industrial meters.
   - CSV upload with schema validation, duplicate `(meter_id, timestamp)` removal, missing value imputation, live search/filtering, and CSV export.
   - **Firebase Cloud Firestore** archive with Google Authentication, atomic chunked CSV storage, real-time `onSnapshot` listing, one-click dataset reload, CSV export, inline rename, and deletion.
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

The `/backend` directory contains a matching Python implementation (**FastAPI**, **Pandas**, **NumPy**, **Statsmodels**, **Scikit-learn**) excluded from Vercel bundles via `.vercelignore`:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r backend/requirements.txt
uvicorn backend.main:app --host 0.0.0.0 --port 8000 --reload
```

## Unit Tests & Security Rules Linting

```bash
npx tsx --test src/server/analytics.test.ts src/server/arima.test.ts src/server/vercel.test.ts src/firebase/validation.test.ts firestore.rules.test.ts
./node_modules/.bin/eslint firestore.rules
```
