import type {
  ActiveDatasetCsvPayload,
  AnalyticsPayload,
  CleaningReport,
  DashboardPayload,
  ForecastResult,
  MeterReading,
  PeakLoadPayload,
  ReportPayload,
} from '../types/smartMeter';

async function requestJson<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, options);
  const contentType = res.headers.get('content-type') ?? '';
  const body = contentType.includes('application/json') ? await res.json() : null;

  if (!res.ok) {
    const message =
      (body && typeof body.error === 'string' && body.error) ||
      (body && typeof body.detail === 'string' && body.detail) ||
      `Request failed (${res.status})`;
    throw new Error(message);
  }
  return body as T;
}

export interface MetersResponse {
  items: MeterReading[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
  dataset_source: string;
  date_range: { start: string | null; end: string | null };
  cleaning_report: CleaningReport | null;
}

export const api = {
  getDashboard: () => requestJson<DashboardPayload>('/api/dashboard'),

  getMeters: (params: {
    search?: string;
    consumer_type?: string;
    start_date?: string;
    end_date?: string;
    page?: number;
    page_size?: number;
  }) => {
    const qs = new URLSearchParams();
    if (params.search) qs.set('search', params.search);
    if (params.consumer_type && params.consumer_type !== 'All') qs.set('consumer_type', params.consumer_type);
    if (params.start_date) qs.set('start_date', params.start_date);
    if (params.end_date) qs.set('end_date', params.end_date);
    if (params.page) qs.set('page', String(params.page));
    if (params.page_size) qs.set('page_size', String(params.page_size));
    return requestJson<MetersResponse>(`/api/meters?${qs.toString()}`);
  },

  getActiveCsv: () => requestJson<ActiveDatasetCsvPayload>('/api/dataset/active-csv'),

  simulateMeterReading: () =>
    requestJson<{ added_count: number; total_records: number; readings: MeterReading[] }>(
      '/api/meters/simulate',
      { method: 'POST' }
    ),

  uploadCsv: (file: File) => {
    const form = new FormData();
    form.append('file', file);
    return requestJson<{ message: string; dataset_source: string; cleaning_report: CleaningReport }>(
      '/api/upload',
      { method: 'POST', body: form }
    );
  },

  loadCsvText: (csv: string, filename: string) =>
    requestJson<{ message: string; dataset_source: string; cleaning_report: CleaningReport }>(
      '/api/upload',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ csv, filename }),
      }
    ),

  loadSampleDataset: () =>
    requestJson<{ message: string; total_records: number; cleaning_report: CleaningReport }>(
      '/api/dataset/load-sample',
      { method: 'POST' }
    ),

  clearDataset: () =>
    requestJson<{ message: string; total_records: number }>('/api/dataset/clear', {
      method: 'POST',
    }),

  getAnalytics: (params: { start_date?: string; end_date?: string; consumer_type?: string }) => {
    const qs = new URLSearchParams();
    if (params.start_date) qs.set('start_date', params.start_date);
    if (params.end_date) qs.set('end_date', params.end_date);
    if (params.consumer_type && params.consumer_type !== 'All') qs.set('consumer_type', params.consumer_type);
    return requestJson<AnalyticsPayload>(`/api/analytics?${qs.toString()}`);
  },

  getPeakLoad: (params: { start_date?: string; end_date?: string; consumer_type?: string }) => {
    const qs = new URLSearchParams();
    if (params.start_date) qs.set('start_date', params.start_date);
    if (params.end_date) qs.set('end_date', params.end_date);
    if (params.consumer_type && params.consumer_type !== 'All') qs.set('consumer_type', params.consumer_type);
    return requestJson<PeakLoadPayload>(`/api/peak-load?${qs.toString()}`);
  },

  getForecast: () => requestJson<ForecastResult>('/api/forecast'),

  runForecast: (payload: { p: number; d: number; q: number; horizon: number; consumer_type?: string }) =>
    requestJson<ForecastResult>('/api/forecast', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),

  getReport: (params: {
    type: 'daily' | 'weekly' | 'monthly' | 'forecast';
    start_date?: string;
    end_date?: string;
    consumer_type?: string;
  }) => {
    const qs = new URLSearchParams({ type: params.type });
    if (params.start_date) qs.set('start_date', params.start_date);
    if (params.end_date) qs.set('end_date', params.end_date);
    if (params.consumer_type && params.consumer_type !== 'All') qs.set('consumer_type', params.consumer_type);
    return requestJson<ReportPayload>(`/api/reports?${qs.toString()}`);
  },
};

export function triggerFileDownload(url: string, fallbackName: string): void {
  const link = document.createElement('a');
  link.href = url;
  link.download = fallbackName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

export function triggerTextDownload(content: string, filename: string, mimeType = 'text/csv;charset=utf-8'): void {
  const blob = new Blob([content], { type: mimeType });
  const objectUrl = URL.createObjectURL(blob);
  triggerFileDownload(objectUrl, filename);
  setTimeout(() => URL.revokeObjectURL(objectUrl), 1500);
}
