import { useEffect, useState, type FormEvent } from 'react';
import { Database, Download, Shield, Trash2 } from 'lucide-react';
import { api, triggerFileDownload } from '../api/client';
import type { StorageStatus } from '../types/smartMeter';
import { AlertBanner, Panel } from '../components/ui/Primitives';

export function SettingsView({
  refreshTick,
  defaultOrder,
  onUpdateDefaultOrder,
  onDatasetMutated,
}: {
  refreshTick: number;
  defaultOrder: { p: number; d: number; q: number };
  onUpdateDefaultOrder: (order: { p: number; d: number; q: number }) => void;
  onDatasetMutated: () => void;
}) {
  const [storageStatus, setStorageStatus] = useState<StorageStatus | null>(null);
  const [p, setP] = useState(defaultOrder.p);
  const [d, setD] = useState(defaultOrder.d);
  const [q, setQ] = useState(defaultOrder.q);
  const [busy, setBusy] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ tone: 'success' | 'error' | 'info'; message: string } | null>(null);

  useEffect(() => {
    api
      .getAwsStatus()
      .then(setStorageStatus)
      .catch(() => {
        // Handled cleanly
      });
  }, [refreshTick]);

  const handleSaveArimaDefaults = (e: FormEvent) => {
    e.preventDefault();
    const safeP = Math.min(12, Math.max(1, Math.round(p)));
    const safeD = Math.min(2, Math.max(0, Math.round(d)));
    const safeQ = Math.min(4, Math.max(0, Math.round(q)));
    onUpdateDefaultOrder({ p: safeP, d: safeD, q: safeQ });
    setFeedback({
      tone: 'success',
      message: `Saved default ARIMA(${safeP}, ${safeD}, ${safeQ}) order for forecasting sessions.`,
    });
  };

  const handleReloadSample = async () => {
    setBusy('sample');
    setFeedback(null);
    try {
      const res = await api.loadSampleDataset();
      setFeedback({ tone: 'success', message: res.message });
      onDatasetMutated();
    } catch (err) {
      setFeedback({
        tone: 'error',
        message: err instanceof Error ? err.message : 'Failed to reload sample dataset.',
      });
    } finally {
      setBusy(null);
    }
  };

  const handleClearDataset = async () => {
    setBusy('clear');
    setFeedback(null);
    try {
      const res = await api.clearDataset();
      setFeedback({
        tone: 'info',
        message: `${res.message} You can now inspect empty states or upload a custom CSV file.`,
      });
      onDatasetMutated();
    } catch (err) {
      setFeedback({
        tone: 'error',
        message: err instanceof Error ? err.message : 'Failed to clear dataset.',
      });
    } finally {
      setBusy(null);
    }
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

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Default ARIMA Configuration */}
        <Panel
          title="Default ARIMA Model Parameters"
          subtitle="Set default (p, d, q) time-series order used when opening Load Forecasting"
        >
          <form onSubmit={handleSaveArimaDefaults} className="space-y-4">
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label htmlFor="settings-p" className="block text-xs font-medium text-slate-700 mb-1.5">
                  AR (p)
                </label>
                <input
                  id="settings-p"
                  type="number"
                  min={1}
                  max={12}
                  value={p}
                  onChange={(e) => setP(Number(e.target.value))}
                  className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-md bg-white text-slate-900"
                />
              </div>
              <div>
                <label htmlFor="settings-d" className="block text-xs font-medium text-slate-700 mb-1.5">
                  Diff (d)
                </label>
                <input
                  id="settings-d"
                  type="number"
                  min={0}
                  max={2}
                  value={d}
                  onChange={(e) => setD(Number(e.target.value))}
                  className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-md bg-white text-slate-900"
                />
              </div>
              <div>
                <label htmlFor="settings-q" className="block text-xs font-medium text-slate-700 mb-1.5">
                  MA (q)
                </label>
                <input
                  id="settings-q"
                  type="number"
                  min={0}
                  max={4}
                  value={q}
                  onChange={(e) => setQ(Number(e.target.value))}
                  className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-md bg-white text-slate-900"
                />
              </div>
            </div>

            <div className="pt-1 flex justify-end">
              <button
                type="submit"
                className="px-4 py-2 text-sm font-medium text-white bg-[#0B172A] rounded-md hover:bg-[#162A4A] transition-colors whitespace-nowrap"
              >
                Save Model Defaults
              </button>
            </div>
          </form>
        </Panel>

        {/* Dataset Lifecycle Controls */}
        <Panel
          title="Dataset Management"
          subtitle="Reset to the built-in 35-day dataset, download CSV template, or clear active records"
        >
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={handleReloadSample}
                disabled={busy !== null}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-700 rounded-md hover:bg-blue-800 disabled:opacity-50 whitespace-nowrap"
              >
                <Database className="w-4 h-4" aria-hidden="true" />
                <span>{busy === 'sample' ? 'Loading...' : 'Reload 35-Day Sample Dataset'}</span>
              </button>

              <button
                type="button"
                onClick={() => triggerFileDownload('/api/sample-csv', 'sample_smart_meter_35days.csv')}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-slate-800 bg-white border border-slate-300 rounded-md hover:bg-slate-50 whitespace-nowrap"
              >
                <Download className="w-4 h-4" aria-hidden="true" />
                <span>Download Sample CSV</span>
              </button>
            </div>

            <div className="pt-3 border-t border-slate-100 flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs text-slate-600 max-w-sm">
                Clearing the active dataset empties in-memory telemetry so you can test insufficient-data handling or upload a fresh CSV.
              </p>
              <button
                type="button"
                onClick={handleClearDataset}
                disabled={busy !== null}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-red-700 bg-red-50 border border-red-200 rounded-md hover:bg-red-100 disabled:opacity-50 whitespace-nowrap"
              >
                <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                <span>{busy === 'clear' ? 'Clearing...' : 'Clear Active Dataset'}</span>
              </button>
            </div>
          </div>
        </Panel>
      </div>

      {/* Security & Backend Environment Guide */}
      <Panel
        title="Backend AWS S3 Security & Environment Variables"
        subtitle="Credentials are never collected or stored in frontend code"
      >
        <div className="flex items-start gap-3 text-sm text-slate-700 mb-4">
          <Shield className="w-5 h-5 text-blue-700 shrink-0 mt-0.5" aria-hidden="true" />
          <p className="leading-relaxed">
            Current server storage mode:{' '}
            <strong className="text-slate-900">
              {storageStatus?.mode === 'aws_s3' ? 'Live AWS S3' : 'Local Simulation Mode'}
            </strong>
            . To enable direct AWS S3 uploads in production, configure the following environment variables on the backend server (or in your FastAPI deployment) and restart the server:
          </p>
        </div>

        <pre className="p-4 rounded-md bg-[#0B172A] text-slate-100 text-xs font-mono overflow-x-auto leading-relaxed">
{`AWS_ACCESS_KEY_ID=your_iam_access_key_id
AWS_SECRET_ACCESS_KEY=your_iam_secret_access_key
AWS_REGION=us-east-1
AWS_S3_BUCKET=your-smart-meter-bucket
AWS_S3_PREFIX=smart-meter-datasets/`}
        </pre>
      </Panel>
    </div>
  );
}
