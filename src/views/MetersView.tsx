import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { Download, Plus, Search, Upload } from 'lucide-react';
import { api, triggerFileDownload, type MetersResponse } from '../api/client';
import { AlertBanner, EmptyDatasetState, Panel } from '../components/ui/Primitives';

const CONSUMER_FILTERS = ['All', 'Residential', 'Commercial', 'Industrial'] as const;

export function MetersView({
  refreshTick,
  onDatasetMutated,
}: {
  refreshTick: number;
  onDatasetMutated: () => void;
}) {
  const [res, setRes] = useState<MetersResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ tone: 'success' | 'error' | 'info'; message: string } | null>(null);

  const [search, setSearch] = useState('');
  const [consumerType, setConsumerType] = useState<string>('All');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [page, setPage] = useState(1);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const fetchMeters = async (targetPage = page) => {
    setLoading(true);
    try {
      const data = await api.getMeters({
        search: search.trim() || undefined,
        consumer_type: consumerType,
        start_date: startDate || undefined,
        end_date: endDate || undefined,
        page: targetPage,
        page_size: 25,
      });
      setRes(data);
    } catch (err) {
      setFeedback({
        tone: 'error',
        message: err instanceof Error ? err.message : 'Failed to load meter records.',
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMeters(page);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshTick, consumerType, page, startDate, endDate]);

  // Debounce live search
  useEffect(() => {
    const t = setTimeout(() => {
      setPage(1);
      fetchMeters(1);
    }, 200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const handleSimulate = async () => {
    setBusyAction('simulate');
    setFeedback(null);
    try {
      const result = await api.simulateMeterReading();
      setFeedback({
        tone: 'success',
        message: `Simulated ${result.added_count} new smart meter readings for the next hourly interval (total: ${result.total_records.toLocaleString()} records).`,
      });
      setPage(1);
      await fetchMeters(1);
      onDatasetMutated();
    } catch (err) {
      setFeedback({
        tone: 'error',
        message: err instanceof Error ? err.message : 'Simulation failed.',
      });
    } finally {
      setBusyAction(null);
    }
  };

  const handleFileSelected = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusyAction('upload');
    setFeedback(null);
    try {
      const result = await api.uploadCsv(file);
      const r = result.cleaning_report;
      setFeedback({
        tone: 'success',
        message: `${result.message} Removed ${r.duplicates_removed} duplicate(s), imputed ${r.missing_values_imputed} missing value(s), rejected ${r.invalid_rows_rejected} invalid row(s).`,
      });
      setPage(1);
      await fetchMeters(1);
      onDatasetMutated();
    } catch (err) {
      setFeedback({
        tone: 'error',
        message: err instanceof Error ? err.message : 'CSV upload failed.',
      });
    } finally {
      setBusyAction(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleLoadSample = async () => {
    setBusyAction('sample');
    setFeedback(null);
    try {
      const result = await api.loadSampleDataset();
      setFeedback({ tone: 'success', message: result.message });
      setSearch('');
      setConsumerType('All');
      setStartDate('');
      setEndDate('');
      setPage(1);
      await fetchMeters(1);
      onDatasetMutated();
    } catch (err) {
      setFeedback({
        tone: 'error',
        message: err instanceof Error ? err.message : 'Failed to load sample dataset.',
      });
    } finally {
      setBusyAction(null);
    }
  };

  const handleDownloadCsv = () => {
    const qs = new URLSearchParams();
    if (search.trim()) qs.set('search', search.trim());
    if (consumerType !== 'All') qs.set('consumer_type', consumerType);
    if (startDate) qs.set('start_date', startDate);
    if (endDate) qs.set('end_date', endDate);
    triggerFileDownload(`/api/meters/export?${qs.toString()}`, 'smart_meter_cleaned_data.csv');
  };

  const handleResetFilters = () => {
    setSearch('');
    setConsumerType('All');
    setStartDate('');
    setEndDate('');
    setPage(1);
  };

  return (
    <div className="space-y-6">
      {feedback && (
        <AlertBanner
          tone={feedback.tone}
          message={feedback.message}
          onDismiss={() => setFeedback(null)}
        />
      )}

      {/* Action Toolbar */}
      <Panel
        title="Smart Meter Data Ingestion & Cleaning"
        subtitle={
          res
            ? `Active source: ${res.dataset_source} · ${res.total.toLocaleString()} matching records`
            : 'Collect, validate, deduplicate, and inspect smart meter readings'
        }
      >
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={handleSimulate}
            disabled={busyAction !== null}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-700 rounded-md hover:bg-blue-800 disabled:opacity-50 transition-colors whitespace-nowrap"
          >
            <Plus className="w-4 h-4" aria-hidden="true" />
            <span>{busyAction === 'simulate' ? 'Simulating...' : 'Simulate Reading'}</span>
          </button>

          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            onChange={handleFileSelected}
            className="hidden"
            aria-label="Upload smart meter CSV file"
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={busyAction !== null}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-slate-800 bg-white border border-slate-300 rounded-md hover:bg-slate-50 disabled:opacity-50 transition-colors whitespace-nowrap"
          >
            <Upload className="w-4 h-4" aria-hidden="true" />
            <span>{busyAction === 'upload' ? 'Validating CSV...' : 'Upload CSV Dataset'}</span>
          </button>

          <button
            type="button"
            onClick={handleLoadSample}
            disabled={busyAction !== null}
            className="inline-flex items-center px-4 py-2 text-sm font-medium text-slate-800 bg-white border border-slate-300 rounded-md hover:bg-slate-50 disabled:opacity-50 transition-colors whitespace-nowrap"
          >
            {busyAction === 'sample' ? 'Loading...' : 'Load 35-Day Sample'}
          </button>

          <button
            type="button"
            onClick={handleDownloadCsv}
            disabled={!res || res.total === 0}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-slate-800 bg-white border border-slate-300 rounded-md hover:bg-slate-50 disabled:opacity-50 transition-colors whitespace-nowrap"
          >
            <Download className="w-4 h-4" aria-hidden="true" />
            <span>Download Cleaned CSV</span>
          </button>

          <button
            type="button"
            onClick={() => triggerFileDownload('/api/sample-csv', 'sample_smart_meter_35days.csv')}
            className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium text-blue-700 hover:text-blue-900 whitespace-nowrap"
          >
            Download Sample CSV Template
          </button>
        </div>

        {/* Validation & Cleaning Audit Summary */}
        {res?.cleaning_report && (
          <div className="mt-4 pt-4 border-t border-slate-100 grid grid-cols-2 sm:grid-cols-5 gap-4 text-xs">
            <div>
              <div className="text-slate-500">Rows Received</div>
              <div className="font-mono font-semibold text-slate-900 mt-0.5 tabular-nums">
                {res.cleaning_report.total_rows_received.toLocaleString()}
              </div>
            </div>
            <div>
              <div className="text-slate-500">Cleaned Loaded</div>
              <div className="font-mono font-semibold text-emerald-700 mt-0.5 tabular-nums">
                {res.cleaning_report.valid_records_loaded.toLocaleString()}
              </div>
            </div>
            <div>
              <div className="text-slate-500">Duplicates Removed</div>
              <div className="font-mono font-semibold text-slate-900 mt-0.5 tabular-nums">
                {res.cleaning_report.duplicates_removed.toLocaleString()}
              </div>
            </div>
            <div>
              <div className="text-slate-500">Missing Imputed</div>
              <div className="font-mono font-semibold text-slate-900 mt-0.5 tabular-nums">
                {res.cleaning_report.missing_values_imputed.toLocaleString()}
              </div>
            </div>
            <div>
              <div className="text-slate-500">Invalid Rejected</div>
              <div className="font-mono font-semibold text-slate-900 mt-0.5 tabular-nums">
                {res.cleaning_report.invalid_rows_rejected.toLocaleString()}
              </div>
            </div>
          </div>
        )}
      </Panel>

      {/* Search & Filter Bar + Data Table */}
      <Panel
        title="Cleaned Smart Meter Readings"
        subtitle="Filter by consumer sector, meter identifier, or date range"
        action={
          <button
            type="button"
            onClick={handleResetFilters}
            className="text-xs font-medium text-slate-600 hover:text-slate-900 whitespace-nowrap"
          >
            Reset Filters
          </button>
        }
      >
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 mb-5">
          {/* Segmented Consumer Filter */}
          <div className="inline-flex items-center p-1 bg-slate-100 rounded-md self-start" role="group" aria-label="Filter by consumer type">
            {CONSUMER_FILTERS.map((ct) => (
              <button
                key={ct}
                type="button"
                onClick={() => {
                  setConsumerType(ct);
                  setPage(1);
                }}
                className={`px-3 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap ${
                  consumerType === ct
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {ct}
              </button>
            ))}
          </div>

          {/* Search + Date Inputs */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" aria-hidden="true" />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search meter ID (e.g. IND-301)"
                aria-label="Search by meter ID or timestamp"
                className="pl-9 pr-3 py-1.5 text-sm border border-slate-300 rounded-md bg-white text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-blue-700 w-56"
              />
            </div>

            <div className="flex items-center gap-2 text-xs text-slate-600">
              <label htmlFor="meters-start-date" className="sr-only">Start date</label>
              <input
                id="meters-start-date"
                type="date"
                value={startDate}
                onChange={(e) => {
                  setStartDate(e.target.value);
                  setPage(1);
                }}
                className="px-2.5 py-1.5 text-xs border border-slate-300 rounded-md bg-white text-slate-900 font-mono"
              />
              <span aria-hidden="true">to</span>
              <label htmlFor="meters-end-date" className="sr-only">End date</label>
              <input
                id="meters-end-date"
                type="date"
                value={endDate}
                onChange={(e) => {
                  setEndDate(e.target.value);
                  setPage(1);
                }}
                className="px-2.5 py-1.5 text-xs border border-slate-300 rounded-md bg-white text-slate-900 font-mono"
              />
            </div>
          </div>
        </div>

        {!loading && res && res.items.length === 0 ? (
          <EmptyDatasetState
            title="No Matching Meter Readings"
            description="Adjust your search query or filters, or load the 35-day sample dataset."
            onLoadSample={handleLoadSample}
            loading={busyAction === 'sample'}
          />
        ) : (
          <>
            <div className="overflow-x-auto -mx-5">
              <table className="w-full text-left border-collapse text-sm">
                <thead>
                  <tr className="border-y border-slate-200 bg-slate-50/80 text-xs font-medium text-slate-500">
                    <th className="py-2.5 px-5">Meter ID</th>
                    <th className="py-2.5 px-4">Timestamp (UTC)</th>
                    <th className="py-2.5 px-4">Consumer Type</th>
                    <th className="py-2.5 px-4 text-right">Energy (kWh)</th>
                    <th className="py-2.5 px-4 text-right">Voltage (V)</th>
                    <th className="py-2.5 px-4 text-right">Current (A)</th>
                    <th className="py-2.5 px-5 text-right">Power Factor</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {(res?.items ?? []).map((row) => (
                    <tr key={`${row.meter_id}-${row.timestamp}`} className="hover:bg-slate-50/80 transition-colors">
                      <td className="py-2.5 px-5 font-mono text-xs font-medium text-slate-900">
                        {row.meter_id}
                      </td>
                      <td className="py-2.5 px-4 font-mono text-xs text-slate-600 tabular-nums">
                        {row.timestamp.replace('T', ' ').replace('Z', '')}
                      </td>
                      <td className="py-2.5 px-4 text-xs text-slate-700">{row.consumer_type}</td>
                      <td className="py-2.5 px-4 text-right font-mono text-xs font-semibold text-slate-900 tabular-nums">
                        {row.energy_kwh.toFixed(3)}
                      </td>
                      <td className="py-2.5 px-4 text-right font-mono text-xs text-slate-600 tabular-nums">
                        {row.voltage.toFixed(2)}
                      </td>
                      <td className="py-2.5 px-4 text-right font-mono text-xs text-slate-600 tabular-nums">
                        {row.current.toFixed(2)}
                      </td>
                      <td className="py-2.5 px-5 text-right font-mono text-xs text-slate-600 tabular-nums">
                        {row.power_factor.toFixed(3)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {res && (
              <div className="mt-4 pt-4 border-t border-slate-100 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-600">
                <div className="font-mono tabular-nums">
                  Showing page {res.page} of {res.total_pages} · {res.total.toLocaleString()} total records
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={res.page <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    className="px-3 py-1.5 border border-slate-300 rounded-md bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-40 whitespace-nowrap"
                  >
                    Previous
                  </button>
                  <button
                    type="button"
                    disabled={res.page >= res.total_pages}
                    onClick={() => setPage((p) => Math.min(res.total_pages, p + 1))}
                    className="px-3 py-1.5 border border-slate-300 rounded-md bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-40 whitespace-nowrap"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </Panel>
    </div>
  );
}
