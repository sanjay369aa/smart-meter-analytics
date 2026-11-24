import 'dotenv/config';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import multer from 'multer';
import { createServer as createViteServer } from 'vite';
import type {
  CleaningReport,
  DashboardPayload,
  ForecastResult,
  MeterReading,
} from './src/types/smartMeter';
import {
  buildReport,
  computeAnalytics,
  computePeakLoad,
  filterReadings,
  formatTimestampShort,
  getDateRange,
  parseAndCleanCsv,
  reportToCsv,
} from './src/server/analytics';
import { runArimaForecast } from './src/server/arima';
import {
  ensureSampleCsvOnDisk,
  generateSampleDataset,
  readingsToCsv,
  simulateNextHourReadings,
} from './src/server/sampleData';
import { CloudStorageService } from './src/server/storage';

const PORT = Number(process.env.PORT) || 3000;
const DATA_DIR = path.resolve(process.cwd(), 'data');

// Upload handler: in-memory buffer capped at 10MB
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

class SmartMeterState {
  public readings: MeterReading[] = [];
  public lastCleaningReport: CleaningReport | null = null;
  public lastForecast: ForecastResult;
  public datasetSource: string = '35-Day Sample Dataset';
  public readonly storage: CloudStorageService;
  public readonly sampleCsvPath: string;

  constructor() {
    this.sampleCsvPath = ensureSampleCsvOnDisk(DATA_DIR);
    this.storage = new CloudStorageService(DATA_DIR);
    this.readings = generateSampleDataset(35);
    this.lastForecast = runArimaForecast(this.readings, { p: 3, d: 1, q: 1, horizon: 24 });
    this.seedInitialLocalArchive();
  }

  private seedInitialLocalArchive(): void {
    // Seed one baseline snapshot in local simulation archive if empty so Cloud Storage view shows a real retrievable artifact
    this.storage
      .listFiles()
      .then((files) => {
        if (files.length === 0 && !this.storage.hasAwsCredentials()) {
          const csv = readingsToCsv(this.readings);
          return this.storage.uploadCsv('baseline_35day_smart_meters.csv', csv, this.readings.length);
        }
      })
      .catch(() => {
        // Non-fatal during startup
      });
  }

  public setReadings(next: MeterReading[], source: string, report: CleaningReport | null = null): void {
    this.readings = next;
    this.datasetSource = source;
    this.lastCleaningReport = report;
    // Automatically evaluate/refresh forecast when dataset changes
    this.lastForecast = runArimaForecast(this.readings, {
      p: this.lastForecast?.order.p ?? 3,
      d: this.lastForecast?.order.d ?? 1,
      q: this.lastForecast?.order.q ?? 1,
      horizon: 24,
    });
  }
}

export function createApp() {
  const app = express();
  const state = new SmartMeterState();

  app.use(express.json({ limit: '5mb' }));

  // Health check
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', records: state.readings.length });
  });

  // GET /api/dashboard
  app.get('/api/dashboard', async (_req, res) => {
    try {
      const readings = state.readings;
      const analytics = computeAnalytics(readings);
      const peakLoad = computePeakLoad(readings);
      const storageStatus = await state.storage.getStatus();

      // Build hourly grid consumption over time (last 120 hours for responsive dashboard line chart)
      const hourlyMap = new Map<string, number>();
      for (const r of readings) {
        const key = `${r.timestamp.slice(0, 13)}:00:00Z`;
        hourlyMap.set(key, (hourlyMap.get(key) ?? 0) + r.energy_kwh);
      }
      const consumption_over_time = Array.from(hourlyMap.entries())
        .sort((a, b) => a[0].localeCompare(b[0]))
        .slice(-120)
        .map(([timestamp, energy]) => ({
          timestamp,
          label: formatTimestampShort(timestamp),
          energy_kwh: Math.round(energy * 100) / 100,
        }));

      const daily_usage = analytics.daily_consumption.slice(-14).map((d) => ({
        date: d.date,
        label: d.label,
        total_kwh: d.total_kwh,
        peak_kwh: Math.round((d.total_kwh / 24) * 1.45 * 100) / 100,
      }));

      // Compute exact daily peak hourly load for daily_usage
      const dailyPeakMap = new Map<string, number>();
      for (const [ts, val] of hourlyMap.entries()) {
        const dateKey = ts.slice(0, 10);
        const cur = dailyPeakMap.get(dateKey) ?? 0;
        if (val > cur) dailyPeakMap.set(dateKey, val);
      }
      for (const d of daily_usage) {
        d.peak_kwh = Math.round((dailyPeakMap.get(d.date) ?? 0) * 100) / 100;
      }

      const recent_readings = [...readings]
        .sort((a, b) => b.timestamp.localeCompare(a.timestamp) || a.meter_id.localeCompare(b.meter_id))
        .slice(0, 12);

      const payload: DashboardPayload = {
        summary: {
          total_energy_kwh: analytics.summary.total_energy_kwh,
          total_meters: analytics.summary.active_meters,
          average_consumption_kwh: analytics.summary.average_hourly_kwh,
          peak_load_kwh: peakLoad.peak_event?.energy_kwh ?? 0,
          peak_load_timestamp: peakLoad.peak_event?.label ?? null,
          next_hour_forecast_kwh: state.lastForecast.next_hour_forecast_kwh,
          total_records: readings.length,
          date_range: getDateRange(readings),
        },
        consumption_over_time,
        consumer_comparison: analytics.consumer_breakdown.map((c) => ({
          consumer_type: c.consumer_type,
          total_kwh: c.total_kwh,
          average_kwh: c.average_kwh,
          share_percent: c.share_percent,
          meter_count: c.meter_count,
        })),
        daily_usage,
        actual_vs_predicted: state.lastForecast.actual_vs_predicted.slice(-48),
        recent_readings,
        storage_status: storageStatus,
        forecast_status: {
          status: state.lastForecast.status,
          model_name: state.lastForecast.model_name,
          trained_at: state.lastForecast.trained_at,
          mape: state.lastForecast.metrics?.mape ?? null,
          next_hour_forecast_kwh: state.lastForecast.next_hour_forecast_kwh,
        },
      };

      res.json(payload);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to build dashboard payload.';
      res.status(500).json({ error: message });
    }
  });

  // GET /api/meters — searchable, filterable, paginated smart meter readings
  app.get('/api/meters', (req, res) => {
    const search = typeof req.query.search === 'string' ? req.query.search : null;
    const consumerType = typeof req.query.consumer_type === 'string' ? req.query.consumer_type : null;
    const startDate = typeof req.query.start_date === 'string' ? req.query.start_date : null;
    const endDate = typeof req.query.end_date === 'string' ? req.query.end_date : null;
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(200, Math.max(10, Number(req.query.page_size) || 50));

    const filtered = filterReadings(state.readings, {
      search,
      consumerType,
      startDate,
      endDate,
    }).sort((a, b) => b.timestamp.localeCompare(a.timestamp) || a.meter_id.localeCompare(b.meter_id));

    const total = filtered.length;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const safePage = Math.min(page, totalPages);
    const startIdx = (safePage - 1) * pageSize;
    const items = filtered.slice(startIdx, startIdx + pageSize);

    res.json({
      items,
      total,
      page: safePage,
      page_size: pageSize,
      total_pages: totalPages,
      dataset_source: state.datasetSource,
      date_range: getDateRange(state.readings),
      cleaning_report: state.lastCleaningReport,
    });
  });

  // GET /api/meters/export — download filtered or full cleaned readings as CSV
  app.get('/api/meters/export', (req, res) => {
    const search = typeof req.query.search === 'string' ? req.query.search : null;
    const consumerType = typeof req.query.consumer_type === 'string' ? req.query.consumer_type : null;
    const startDate = typeof req.query.start_date === 'string' ? req.query.start_date : null;
    const endDate = typeof req.query.end_date === 'string' ? req.query.end_date : null;

    const filtered = filterReadings(state.readings, {
      search,
      consumerType,
      startDate,
      endDate,
    });

    const csv = readingsToCsv(filtered);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="smart_meter_cleaned_data.csv"');
    res.send(csv);
  });

  // GET /api/sample-csv — download the realistic 35-day sample dataset
  app.get('/api/sample-csv', (_req, res) => {
    if (!fs.existsSync(state.sampleCsvPath)) {
      ensureSampleCsvOnDisk(DATA_DIR);
    }
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="sample_smart_meter_35days.csv"');
    res.sendFile(state.sampleCsvPath);
  });

  // POST /api/meters/simulate — simulate one new hourly batch of smart meter readings
  app.post('/api/meters/simulate', (_req, res) => {
    const simulated = simulateNextHourReadings(state.readings);
    const next = [...state.readings, ...simulated];
    state.setReadings(next, `${state.datasetSource} (+ live simulation)`, state.lastCleaningReport);
    res.json({
      added_count: simulated.length,
      total_records: state.readings.length,
      readings: simulated,
    });
  });

  // POST /api/dataset/load-sample — reset/load the full 35-day sample dataset
  app.post('/api/dataset/load-sample', (_req, res) => {
    const sample = generateSampleDataset(35);
    const report: CleaningReport = {
      total_rows_received: sample.length,
      valid_records_loaded: sample.length,
      duplicates_removed: 0,
      missing_values_imputed: 0,
      invalid_rows_rejected: 0,
      warnings: [],
    };
    state.setReadings(sample, '35-Day Sample Dataset', report);
    res.json({
      message: `Loaded ${sample.length.toLocaleString()} hourly readings across 35 days and 6 smart meters.`,
      total_records: sample.length,
      cleaning_report: report,
    });
  });

  // POST /api/dataset/clear — clear active dataset (useful for testing empty/insufficient data states)
  app.post('/api/dataset/clear', (_req, res) => {
    state.setReadings([], 'Empty Dataset', null);
    res.json({ message: 'Active dataset cleared.', total_records: 0 });
  });

  // POST /api/upload — validate, deduplicate, impute, and load uploaded CSV file
  app.post('/api/upload', upload.single('file'), (req, res) => {
    try {
      let csvText = '';
      let sourceName = 'Uploaded CSV';

      if (req.file) {
        csvText = req.file.buffer.toString('utf-8');
        sourceName = req.file.originalname || 'Uploaded CSV';
      } else if (typeof req.body?.csv === 'string') {
        csvText = req.body.csv;
        sourceName = typeof req.body.filename === 'string' ? req.body.filename : 'Uploaded CSV';
      } else {
        res.status(400).json({ error: 'Please provide a CSV file in the "file" field.' });
        return;
      }

      const { readings, report } = parseAndCleanCsv(csvText);
      state.setReadings(readings, sourceName, report);

      res.json({
        message: `Validated and loaded ${readings.length.toLocaleString()} cleaned smart meter records.`,
        dataset_source: sourceName,
        cleaning_report: report,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to parse CSV file.';
      res.status(400).json({ error: message });
    }
  });

  // GET /api/analytics
  app.get('/api/analytics', (req, res) => {
    const startDate = typeof req.query.start_date === 'string' && req.query.start_date ? req.query.start_date : null;
    const endDate = typeof req.query.end_date === 'string' && req.query.end_date ? req.query.end_date : null;
    const consumerType =
      typeof req.query.consumer_type === 'string' && req.query.consumer_type ? req.query.consumer_type : 'All';

    const payload = computeAnalytics(state.readings, { startDate, endDate, consumerType });
    res.json(payload);
  });

  // GET /api/peak-load
  app.get('/api/peak-load', (req, res) => {
    const startDate = typeof req.query.start_date === 'string' && req.query.start_date ? req.query.start_date : null;
    const endDate = typeof req.query.end_date === 'string' && req.query.end_date ? req.query.end_date : null;
    const consumerType =
      typeof req.query.consumer_type === 'string' && req.query.consumer_type ? req.query.consumer_type : 'All';

    const payload = computePeakLoad(state.readings, { startDate, endDate, consumerType });
    res.json(payload);
  });

  // GET /api/forecast — return latest trained ARIMA forecast
  app.get('/api/forecast', (_req, res) => {
    res.json(state.lastForecast);
  });

  // POST /api/forecast — train ARIMA(p, d, q) on current dataset and return metrics + predictions
  app.post('/api/forecast', (req, res) => {
    try {
      const p = Number(req.body?.p ?? 3);
      const d = Number(req.body?.d ?? 1);
      const q = Number(req.body?.q ?? 1);
      const horizon = Number(req.body?.horizon ?? 24);
      const consumerType =
        typeof req.body?.consumer_type === 'string' && req.body.consumer_type !== 'All'
          ? req.body.consumer_type
          : null;

      if (!Number.isFinite(p) || !Number.isFinite(d) || !Number.isFinite(q) || !Number.isFinite(horizon)) {
        res.status(400).json({ error: 'ARIMA parameters p, d, q and horizon must be finite numbers.' });
        return;
      }

      const targetReadings = consumerType
        ? filterReadings(state.readings, { consumerType })
        : state.readings;

      const result = runArimaForecast(targetReadings, { p, d, q, horizon });
      if (!consumerType) {
        state.lastForecast = result;
      }
      res.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Forecasting failed.';
      res.status(500).json({ error: message });
    }
  });

  // GET /api/reports
  app.get('/api/reports', (req, res) => {
    const rawType = typeof req.query.type === 'string' ? req.query.type : 'daily';
    const reportType: 'daily' | 'weekly' | 'monthly' | 'forecast' =
      rawType === 'weekly' || rawType === 'monthly' || rawType === 'forecast' ? rawType : 'daily';
    const startDate = typeof req.query.start_date === 'string' && req.query.start_date ? req.query.start_date : null;
    const endDate = typeof req.query.end_date === 'string' && req.query.end_date ? req.query.end_date : null;
    const consumerType =
      typeof req.query.consumer_type === 'string' && req.query.consumer_type ? req.query.consumer_type : 'All';

    const report = buildReport(state.readings, reportType, state.lastForecast, {
      startDate,
      endDate,
      consumerType,
    });
    res.json(report);
  });

  // GET /api/reports/export — CSV download for selected report type
  app.get('/api/reports/export', (req, res) => {
    const rawType = typeof req.query.type === 'string' ? req.query.type : 'daily';
    const reportType: 'daily' | 'weekly' | 'monthly' | 'forecast' =
      rawType === 'weekly' || rawType === 'monthly' || rawType === 'forecast' ? rawType : 'daily';
    const startDate = typeof req.query.start_date === 'string' && req.query.start_date ? req.query.start_date : null;
    const endDate = typeof req.query.end_date === 'string' && req.query.end_date ? req.query.end_date : null;
    const consumerType =
      typeof req.query.consumer_type === 'string' && req.query.consumer_type ? req.query.consumer_type : 'All';

    const report = buildReport(state.readings, reportType, state.lastForecast, {
      startDate,
      endDate,
      consumerType,
    });
    const csv = reportToCsv(report);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="smart_meter_${reportType}_report.csv"`);
    res.send(csv);
  });

  // GET /api/aws/status
  app.get('/api/aws/status', async (_req, res) => {
    const status = await state.storage.getStatus();
    res.json(status);
  });

  // POST /api/aws/configure (non-secret bucket/region/prefix/mode only — never accepts AWS keys from client)
  app.post('/api/aws/configure', async (req, res) => {
    try {
      const { mode, bucket, region, prefix } = req.body ?? {};
      state.storage.configure({
        mode: mode === 'aws_s3' ? 'aws_s3' : mode === 'local_simulation' ? 'local_simulation' : undefined,
        bucket: typeof bucket === 'string' ? bucket : undefined,
        region: typeof region === 'string' ? region : undefined,
        prefix: typeof prefix === 'string' ? prefix : undefined,
      });
      const status = await state.storage.getStatus();
      res.json(status);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update storage configuration.';
      res.status(400).json({ error: message });
    }
  });

  // POST /api/aws/upload — upload current cleaned dataset to AWS S3 or Local Simulation store
  app.post('/api/aws/upload', async (req, res) => {
    try {
      if (state.readings.length === 0) {
        res.status(400).json({ error: 'Cannot upload an empty dataset. Load sample data or upload a CSV first.' });
        return;
      }
      const rawName =
        typeof req.body?.filename === 'string' && req.body.filename.trim()
          ? req.body.filename.trim()
          : `smart_meter_snapshot_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.csv`;

      const csvContent = readingsToCsv(state.readings);
      const uploaded = await state.storage.uploadCsv(rawName, csvContent, state.readings.length);
      const status = await state.storage.getStatus();
      res.json({
        message:
          uploaded.storage_mode === 'aws_s3'
            ? `Uploaded "${uploaded.filename}" to AWS S3 bucket "${uploaded.bucket}".`
            : `Saved "${uploaded.filename}" in Local Simulation Mode (data/cloud_sim/).`,
        file: uploaded,
        status,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Cloud upload failed.';
      res.status(400).json({ error: message });
    }
  });

  // GET /api/aws/files
  app.get('/api/aws/files', async (_req, res) => {
    try {
      const files = await state.storage.listFiles();
      const status = await state.storage.getStatus();
      res.json({ files, status });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to list stored files.';
      res.status(500).json({ error: message });
    }
  });

  // GET /api/aws/files/:key — download stored CSV file
  app.get('/api/aws/files/:key', async (req, res) => {
    try {
      const { filename, content } = await state.storage.retrieveCsv(req.params.key);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(content);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to retrieve stored file.';
      res.status(404).json({ error: message });
    }
  });

  // POST /api/aws/load/:key — retrieve a stored CSV dataset and load it into active memory
  app.post('/api/aws/load/:key', async (req, res) => {
    try {
      const { filename, content } = await state.storage.retrieveCsv(req.params.key);
      const { readings, report } = parseAndCleanCsv(content);
      state.setReadings(readings, `Cloud Archive: ${filename}`, report);
      res.json({
        message: `Retrieved "${filename}" and loaded ${readings.length.toLocaleString()} records into the active workspace.`,
        cleaning_report: report,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load stored dataset.';
      res.status(400).json({ error: message });
    }
  });

  return app;
}

async function startServer() {
  const app = createApp();
  const isProd = process.env.NODE_ENV === 'production';

  if (!isProd) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Smart Meter Analytics server running on http://0.0.0.0:${PORT}`);
  });
}

// Only start listening when executed directly (allows importing createApp in tests)
const isDirectRun =
  process.argv[1] &&
  (process.argv[1].endsWith('server.ts') || process.argv[1].endsWith('server.js'));
if (isDirectRun) {
  startServer().catch((err) => {
    console.error('Failed to start server:', err);
    process.exit(1);
  });
}
