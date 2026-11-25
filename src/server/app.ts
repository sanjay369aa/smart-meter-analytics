import 'dotenv/config';
import express, { type Express } from 'express';
import os from 'node:os';
import path from 'node:path';
import multer from 'multer';
import type {
  CleaningReport,
  DashboardPayload,
  ForecastResult,
  MeterReading,
} from '../types/smartMeter';
import {
  buildReport,
  computeAnalytics,
  computePeakLoad,
  filterReadings,
  formatTimestampShort,
  getDateRange,
  parseAndCleanCsv,
  reportToCsv,
} from './analytics';
import { runArimaForecast } from './arima';
import {
  ensureSampleCsvOnDisk,
  generateSampleDataset,
  readingsToCsv,
  simulateNextHourReadings,
} from './sampleData';

/**
 * Returns a writable directory across local Node and Vercel Serverless (where /var/task is read-only).
 */
export function resolveWritableDataDir(): string {
  if (process.env.VERCEL || process.cwd().startsWith('/var/task')) {
    return path.join(os.tmpdir(), 'smart-meter-data');
  }
  return path.resolve(process.cwd(), 'data');
}

// Upload handler: in-memory buffer capped at 4.5MB on Vercel serverless (10MB locally)
const MAX_UPLOAD_BYTES = process.env.VERCEL ? 4.5 * 1024 * 1024 : 10 * 1024 * 1024;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES },
});

class SmartMeterState {
  public readings: MeterReading[] = [];
  public lastCleaningReport: CleaningReport | null = null;
  public lastForecast: ForecastResult;
  public datasetSource: string = '35-Day Sample Dataset';
  public readonly sampleCsvContent: string;

  constructor(dataDir: string) {
    this.readings = generateSampleDataset(35);
    this.sampleCsvContent = readingsToCsv(this.readings);
    this.lastForecast = runArimaForecast(this.readings, { p: 3, d: 1, q: 1, horizon: 24 });

    // Persist sample CSV locally when not on ephemeral Vercel serverless
    if (!process.env.VERCEL) {
      try {
        ensureSampleCsvOnDisk(dataDir);
      } catch {
        // Safe fallback: /api/sample-csv always serves from memory
      }
    }
  }

  public setReadings(next: MeterReading[], source: string, report: CleaningReport | null = null): void {
    this.readings = next;
    this.datasetSource = source;
    this.lastCleaningReport = report;
    this.lastForecast = runArimaForecast(this.readings, {
      p: this.lastForecast?.order.p ?? 3,
      d: this.lastForecast?.order.d ?? 1,
      q: this.lastForecast?.order.q ?? 1,
      horizon: 24,
    });
  }
}

export interface CreateApiAppOptions {
  /** Also mount API routes at `/` in case a serverless rewrite strips the `/api` prefix. */
  mountRootFallback?: boolean;
  dataDir?: string;
}

export function createApiApp(options: CreateApiAppOptions = {}): Express {
  const app = express();
  const dataDir = options.dataDir ?? resolveWritableDataDir();
  const state = new SmartMeterState(dataDir);

  app.disable('x-powered-by');
  app.use(express.json({ limit: '4.5mb' }));

  const router = express.Router();

  router.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    next();
  });

  // Health check
  router.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      runtime: process.env.VERCEL ? 'vercel_serverless' : 'node_server',
      cloud_storage: 'firebase_firestore',
      records: state.readings.length,
    });
  });

  // GET /api/dashboard
  router.get('/dashboard', (_req, res) => {
    try {
      const readings = state.readings;
      const analytics = computeAnalytics(readings);
      const peakLoad = computePeakLoad(readings);

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

      const dailyPeakMap = new Map<string, number>();
      for (const [ts, val] of hourlyMap.entries()) {
        const dateKey = ts.slice(0, 10);
        const cur = dailyPeakMap.get(dateKey) ?? 0;
        if (val > cur) dailyPeakMap.set(dateKey, val);
      }

      const daily_usage = analytics.daily_consumption.slice(-14).map((d) => ({
        date: d.date,
        label: d.label,
        total_kwh: d.total_kwh,
        peak_kwh: Math.round((dailyPeakMap.get(d.date) ?? 0) * 100) / 100,
      }));

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

  // GET /api/meters
  router.get('/meters', (req, res) => {
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

  // GET /api/meters/export
  router.get('/meters/export', (req, res) => {
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

  // GET /api/dataset/active-csv — returns active cleaned dataset CSV + summary for Firebase Firestore archiving
  router.get('/dataset/active-csv', (_req, res) => {
    if (state.readings.length === 0) {
      res.status(400).json({
        error: 'Cannot archive an empty dataset. Load sample data or upload a CSV first.',
      });
      return;
    }
    const analytics = computeAnalytics(state.readings);
    const csv = readingsToCsv(state.readings);
    res.json({
      csv,
      record_count: state.readings.length,
      total_energy_kwh: analytics.summary.total_energy_kwh,
      date_range: getDateRange(state.readings),
      dataset_source: state.datasetSource,
    });
  });

  // GET /api/sample-csv — streamed directly from memory (safe on read-only Vercel serverless)
  router.get('/sample-csv', (_req, res) => {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="sample_smart_meter_35days.csv"');
    res.send(state.sampleCsvContent);
  });

  // POST /api/meters/simulate
  router.post('/meters/simulate', (_req, res) => {
    const simulated = simulateNextHourReadings(state.readings);
    const next = [...state.readings, ...simulated];
    state.setReadings(next, `${state.datasetSource} (+ live simulation)`, state.lastCleaningReport);
    res.json({
      added_count: simulated.length,
      total_records: state.readings.length,
      readings: simulated,
    });
  });

  // POST /api/dataset/load-sample
  router.post('/dataset/load-sample', (_req, res) => {
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

  // POST /api/dataset/clear
  router.post('/dataset/clear', (_req, res) => {
    state.setReadings([], 'Empty Dataset', null);
    res.json({ message: 'Active dataset cleared.', total_records: 0 });
  });

  // POST /api/upload — accepts multipart CSV file upload or JSON { csv, filename } (e.g. from Firebase Firestore archive)
  router.post('/upload', upload.single('file'), (req, res) => {
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
  router.get('/analytics', (req, res) => {
    const startDate = typeof req.query.start_date === 'string' && req.query.start_date ? req.query.start_date : null;
    const endDate = typeof req.query.end_date === 'string' && req.query.end_date ? req.query.end_date : null;
    const consumerType =
      typeof req.query.consumer_type === 'string' && req.query.consumer_type ? req.query.consumer_type : 'All';

    res.json(computeAnalytics(state.readings, { startDate, endDate, consumerType }));
  });

  // GET /api/peak-load
  router.get('/peak-load', (req, res) => {
    const startDate = typeof req.query.start_date === 'string' && req.query.start_date ? req.query.start_date : null;
    const endDate = typeof req.query.end_date === 'string' && req.query.end_date ? req.query.end_date : null;
    const consumerType =
      typeof req.query.consumer_type === 'string' && req.query.consumer_type ? req.query.consumer_type : 'All';

    res.json(computePeakLoad(state.readings, { startDate, endDate, consumerType }));
  });

  // GET /api/forecast
  router.get('/forecast', (_req, res) => {
    res.json(state.lastForecast);
  });

  // POST /api/forecast
  router.post('/forecast', (req, res) => {
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
  router.get('/reports', (req, res) => {
    const rawType = typeof req.query.type === 'string' ? req.query.type : 'daily';
    const reportType: 'daily' | 'weekly' | 'monthly' | 'forecast' =
      rawType === 'weekly' || rawType === 'monthly' || rawType === 'forecast' ? rawType : 'daily';
    const startDate = typeof req.query.start_date === 'string' && req.query.start_date ? req.query.start_date : null;
    const endDate = typeof req.query.end_date === 'string' && req.query.end_date ? req.query.end_date : null;
    const consumerType =
      typeof req.query.consumer_type === 'string' && req.query.consumer_type ? req.query.consumer_type : 'All';

    res.json(
      buildReport(state.readings, reportType, state.lastForecast, {
        startDate,
        endDate,
        consumerType,
      })
    );
  });

  // GET /api/reports/export
  router.get('/reports/export', (req, res) => {
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

  app.use('/api', router);
  if (options.mountRootFallback) {
    app.use('/', router);
  }

  return app;
}
