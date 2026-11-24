export type ConsumerType = 'Residential' | 'Commercial' | 'Industrial';

export interface MeterReading {
  meter_id: string;
  timestamp: string; // ISO-8601 UTC hourly string e.g. 2026-10-22T00:00:00Z
  consumer_type: ConsumerType;
  energy_kwh: number;
  voltage: number;
  current: number;
  power_factor: number;
}

export interface CleaningReport {
  total_rows_received: number;
  valid_records_loaded: number;
  duplicates_removed: number;
  missing_values_imputed: number;
  invalid_rows_rejected: number;
  warnings: string[];
}

export interface StorageStatus {
  mode: 'aws_s3' | 'local_simulation';
  aws_credentials_configured: boolean;
  bucket: string;
  region: string;
  prefix: string;
  connected: boolean;
  stored_files_count: number;
  last_upload_at: string | null;
  message: string;
}

export interface StoredDatasetFile {
  key: string;
  filename: string;
  size_bytes: number;
  uploaded_at: string;
  storage_mode: 'aws_s3' | 'local_simulation';
  record_count?: number;
  bucket: string;
}

export interface ForecastPoint {
  timestamp: string;
  label: string;
  predicted_kwh: number;
  lower_bound: number;
  upper_bound: number;
}

export interface ValidationPoint {
  timestamp: string;
  label: string;
  actual_kwh: number;
  predicted_kwh: number;
}

export interface HistoricalTrendPoint {
  timestamp: string;
  label: string;
  actual_kwh: number;
}

export interface ModelMetrics {
  mae: number;
  rmse: number;
  mape: number;
}

export interface ForecastResult {
  status: 'trained' | 'insufficient_data' | 'not_trained';
  model_name: string;
  order: { p: number; d: number; q: number };
  trained_at: string | null;
  training_samples: number;
  validation_samples: number;
  missing_hours_interpolated: number;
  next_hour_forecast_kwh: number | null;
  next_24h_total_kwh: number | null;
  next_24h_peak_kwh: number | null;
  next_24h_peak_timestamp: string | null;
  metrics: ModelMetrics | null;
  actual_vs_predicted: ValidationPoint[];
  next_24h_forecast: ForecastPoint[];
  historical_trend: HistoricalTrendPoint[];
  message?: string;
}

export interface DashboardPayload {
  summary: {
    total_energy_kwh: number;
    total_meters: number;
    average_consumption_kwh: number;
    peak_load_kwh: number;
    peak_load_timestamp: string | null;
    next_hour_forecast_kwh: number | null;
    total_records: number;
    date_range: { start: string | null; end: string | null };
  };
  consumption_over_time: Array<{ timestamp: string; label: string; energy_kwh: number }>;
  consumer_comparison: Array<{
    consumer_type: ConsumerType;
    total_kwh: number;
    average_kwh: number;
    share_percent: number;
    meter_count: number;
  }>;
  daily_usage: Array<{ date: string; label: string; total_kwh: number; peak_kwh: number }>;
  actual_vs_predicted: ValidationPoint[];
  recent_readings: MeterReading[];
  storage_status: StorageStatus;
  forecast_status: {
    status: 'trained' | 'insufficient_data' | 'not_trained';
    model_name: string;
    trained_at: string | null;
    mape: number | null;
    next_hour_forecast_kwh: number | null;
  };
}

export interface AnalyticsPayload {
  filters: {
    start_date: string | null;
    end_date: string | null;
    consumer_type: string;
  };
  available_date_range: { start: string | null; end: string | null };
  summary: {
    total_energy_kwh: number;
    average_reading_kwh: number;
    average_daily_kwh: number;
    average_hourly_kwh: number;
    total_records: number;
    active_meters: number;
  };
  hourly_profile: Array<{
    hour: number;
    label: string;
    average_kwh: number;
    total_kwh: number;
    residential_kwh: number;
    commercial_kwh: number;
    industrial_kwh: number;
  }>;
  daily_consumption: Array<{
    date: string;
    label: string;
    total_kwh: number;
    average_kwh: number;
    residential_kwh: number;
    commercial_kwh: number;
    industrial_kwh: number;
  }>;
  weekly_consumption: Array<{
    week: string;
    label: string;
    total_kwh: number;
    average_daily_kwh: number;
  }>;
  monthly_consumption: Array<{
    month: string;
    label: string;
    total_kwh: number;
    residential_kwh: number;
    commercial_kwh: number;
    industrial_kwh: number;
  }>;
  consumer_breakdown: Array<{
    consumer_type: ConsumerType;
    total_kwh: number;
    average_kwh: number;
    peak_kwh: number;
    share_percent: number;
    meter_count: number;
    avg_power_factor: number;
  }>;
}

export interface PeakLoadAnomaly {
  timestamp: string;
  label: string;
  total_kwh: number;
  expected_kwh: number;
  z_score: number;
  deviation_percent: number;
  dominant_consumer: ConsumerType;
  severity: 'High' | 'Elevated';
}

export interface PeakLoadPayload {
  peak_hour: {
    hour: number;
    label: string;
    average_kwh: number;
  } | null;
  peak_event: {
    timestamp: string;
    label: string;
    energy_kwh: number;
  } | null;
  lowest_hour: {
    hour: number;
    label: string;
    average_kwh: number;
  } | null;
  off_peak_hours: Array<{ hour: number; label: string; average_kwh: number }>;
  peak_hours: Array<{ hour: number; label: string; average_kwh: number }>;
  period_split: {
    peak_total_kwh: number;
    off_peak_total_kwh: number;
    peak_share_percent: number;
    off_peak_share_percent: number;
    threshold_kwh: number;
  };
  hourly_load_curve: Array<{
    hour: number;
    label: string;
    average_kwh: number;
    max_kwh: number;
    classification: 'Peak' | 'Standard' | 'Off-Peak';
  }>;
  anomalies: PeakLoadAnomaly[];
}

export interface ReportRow {
  period: string;
  total_kwh: number;
  average_kwh: number;
  peak_kwh: number;
  residential_kwh: number;
  commercial_kwh: number;
  industrial_kwh: number;
  record_count: number;
}

export interface ReportPayload {
  report_type: 'daily' | 'weekly' | 'monthly' | 'forecast';
  generated_at: string;
  date_range: { start: string | null; end: string | null };
  summary: {
    total_energy_kwh: number;
    average_period_kwh: number;
    peak_period_kwh: number;
    peak_period_label: string;
    total_meters: number;
    total_records: number;
  };
  rows: ReportRow[];
  forecast_rows: ForecastPoint[];
  forecast_metrics: ModelMetrics | null;
}

export type NavPage =
  | 'dashboard'
  | 'meters'
  | 'storage'
  | 'analytics'
  | 'peak-load'
  | 'forecasting'
  | 'reports'
  | 'settings';
