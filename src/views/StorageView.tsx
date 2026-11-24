import { useEffect, useState, type FormEvent } from 'react';
import { CloudUpload, Download, FolderOpen, HardDrive, ShieldCheck } from 'lucide-react';
import { api, triggerFileDownload } from '../api/client';
import type { StorageStatus, StoredDatasetFile } from '../types/smartMeter';
import { AlertBanner, Panel, StatCard } from '../components/ui/Primitives';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function StorageView({
  refreshTick,
  onDatasetMutated,
}: {
  refreshTick: number;
  onDatasetMutated: () => void;
}) {
  const [status, setStatus] = useState<StorageStatus | null>(null);
  const [files, setFiles] = useState<StoredDatasetFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ tone: 'success' | 'error' | 'info'; message: string } | null>(null);

  const [mode, setMode] = useState<'aws_s3' | 'local_simulation'>('local_simulation');
  const [bucket, setBucket] = useState('smart-meter-local-sim-bucket');
  const [region, setRegion] = useState('us-east-1');
  const [prefix, setPrefix] = useState('smart-meter-datasets/');
  const [uploadFilename, setUploadFilename] = useState('');

  const loadStorage = async () => {
    setLoading(true);
    try {
      const res = await api.getAwsFiles();
      setFiles(res.files);
      setStatus(res.status);
      setMode(res.status.mode);
      setBucket(res.status.bucket);
      setRegion(res.status.region);
      setPrefix(res.status.prefix);
    } catch (err) {
      setFeedback({
        tone: 'error',
        message: err instanceof Error ? err.message : 'Failed to fetch cloud storage status.',
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadStorage();
  }, [refreshTick]);

  const handleSaveConfig = async (e: FormEvent) => {
    e.preventDefault();
    setBusy('config');
    setFeedback(null);
    try {
      const next = await api.configureAws({ mode, bucket, region, prefix });
      setStatus(next);
      setFeedback({
        tone: 'success',
        message:
          next.mode === 'aws_s3'
            ? `AWS S3 connection configured for bucket "${next.bucket}" (${next.region}).`
            : `Updated Local Simulation bucket settings ("${next.bucket}").`,
      });
      await loadStorage();
    } catch (err) {
      setFeedback({
        tone: 'error',
        message: err instanceof Error ? err.message : 'Configuration update failed.',
      });
    } finally {
      setBusy(null);
    }
  };

  const handleUploadActive = async (e: FormEvent) => {
    e.preventDefault();
    setBusy('upload');
    setFeedback(null);
    try {
      const res = await api.uploadToAws(uploadFilename.trim() || undefined);
      setStatus(res.status);
      setUploadFilename('');
      setFeedback({ tone: 'success', message: res.message });
      await loadStorage();
      onDatasetMutated();
    } catch (err) {
      setFeedback({
        tone: 'error',
        message: err instanceof Error ? err.message : 'Upload failed.',
      });
    } finally {
      setBusy(null);
    }
  };

  const handleLoadIntoApp = async (key: string) => {
    setBusy(`load-${key}`);
    setFeedback(null);
    try {
      const res = await api.loadFromAws(key);
      setFeedback({ tone: 'success', message: res.message });
      onDatasetMutated();
    } catch (err) {
      setFeedback({
        tone: 'error',
        message: err instanceof Error ? err.message : 'Failed to load stored dataset.',
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

      {/* Honest Storage Mode Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Active Storage Mode"
          value={status?.mode === 'aws_s3' ? 'AWS S3' : 'Local Sim'}
          detail={
            status?.mode === 'aws_s3'
              ? `Live S3 (${status.region})`
              : 'Persisted locally in data/cloud_sim/'
          }
          emphasis={status?.mode === 'aws_s3' ? 'accent' : 'default'}
        />
        <StatCard
          label="Backend AWS Credentials"
          value={status?.aws_credentials_configured ? 'Configured' : 'Not Set'}
          detail="Read from server environment variables only"
          emphasis={status?.aws_credentials_configured ? 'accent' : 'warning'}
        />
        <StatCard
          label="Stored CSV Datasets"
          value={String(files.length)}
          unit="files"
          detail={status?.bucket || '—'}
        />
        <StatCard
          label="Last Archive Upload"
          value={
            status?.last_upload_at
              ? new Date(status.last_upload_at).toLocaleTimeString('en-US', {
                  hour: '2-digit',
                  minute: '2-digit',
                  hour12: false,
                  timeZone: 'UTC',
                })
              : '—'
          }
          unit={status?.last_upload_at ? 'UTC' : undefined}
          detail={
            status?.last_upload_at
              ? status.last_upload_at.slice(0, 10)
              : 'No dataset uploaded yet'
          }
        />
      </div>

      {/* Security Notice + Configuration + Upload */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <Panel
          title="AWS S3 Backend Bucket Configuration"
          subtitle="Configure target bucket and storage mode without exposing secret keys in browser code"
          className="lg:col-span-7"
        >
          <div className="mb-5 p-3.5 rounded-md bg-slate-50 border border-slate-200 text-xs text-slate-700 flex items-start gap-2.5 leading-relaxed">
            <ShieldCheck className="w-4 h-4 text-blue-700 shrink-0 mt-0.5" aria-hidden="true" />
            <div>
              <span className="font-semibold text-slate-900">Server-side credential boundary:</span>{' '}
              {status?.message ||
                'AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY are read exclusively from backend environment variables. When unavailable, the app operates transparently in Local Simulation Mode and never reports fake S3 uploads.'}
            </div>
          </div>

          <form onSubmit={handleSaveConfig} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="storage-mode" className="block text-xs font-medium text-slate-700 mb-1.5">
                  Storage Mode
                </label>
                <select
                  id="storage-mode"
                  value={mode}
                  onChange={(e) => setMode(e.target.value as 'aws_s3' | 'local_simulation')}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md bg-white text-slate-900 focus:outline-none focus:border-blue-700"
                >
                  <option value="local_simulation">Local Simulation Mode (No AWS Keys Required)</option>
                  <option value="aws_s3">AWS S3 Live Mode (Requires Backend Env Keys)</option>
                </select>
              </div>

              <div>
                <label htmlFor="s3-region" className="block text-xs font-medium text-slate-700 mb-1.5">
                  AWS Region
                </label>
                <input
                  id="s3-region"
                  type="text"
                  value={region}
                  onChange={(e) => setRegion(e.target.value)}
                  placeholder="us-east-1"
                  required
                  className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-md bg-white text-slate-900 focus:outline-none focus:border-blue-700"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="s3-bucket" className="block text-xs font-medium text-slate-700 mb-1.5">
                  S3 Bucket Name
                </label>
                <input
                  id="s3-bucket"
                  type="text"
                  value={bucket}
                  onChange={(e) => setBucket(e.target.value)}
                  placeholder="smart-meter-datasets-prod"
                  required
                  className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-md bg-white text-slate-900 focus:outline-none focus:border-blue-700"
                />
              </div>

              <div>
                <label htmlFor="s3-prefix" className="block text-xs font-medium text-slate-700 mb-1.5">
                  Object Key Prefix
                </label>
                <input
                  id="s3-prefix"
                  type="text"
                  value={prefix}
                  onChange={(e) => setPrefix(e.target.value)}
                  placeholder="smart-meter-datasets/"
                  className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-md bg-white text-slate-900 focus:outline-none focus:border-blue-700"
                />
              </div>
            </div>

            <div className="pt-1 flex items-center justify-between gap-3">
              <span className="text-xs text-slate-500">
                Credentials status:{' '}
                <strong className="text-slate-800">
                  {status?.aws_credentials_configured ? 'AWS env vars detected' : 'AWS env vars unset'}
                </strong>
              </span>
              <button
                type="submit"
                disabled={busy !== null}
                className="px-4 py-2 text-sm font-medium text-white bg-[#0B172A] rounded-md hover:bg-[#162A4A] disabled:opacity-50 transition-colors whitespace-nowrap"
              >
                {busy === 'config' ? 'Saving...' : 'Save Configuration'}
              </button>
            </div>
          </form>
        </Panel>

        <Panel
          title="Upload Processed Dataset"
          subtitle="Archive the currently cleaned active smart meter dataset as CSV"
          className="lg:col-span-5"
        >
          <form onSubmit={handleUploadActive} className="space-y-4">
            <div>
              <label htmlFor="archive-filename" className="block text-xs font-medium text-slate-700 mb-1.5">
                Target File Name (optional)
              </label>
              <input
                id="archive-filename"
                type="text"
                value={uploadFilename}
                onChange={(e) => setUploadFilename(e.target.value)}
                placeholder="e.g. nov_2026_cleaned_meters.csv"
                className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-md bg-white text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-blue-700"
              />
              <p className="text-xs text-slate-500 mt-1.5">
                Leave blank to generate a UTC timestamped filename automatically.
              </p>
            </div>

            <div className="p-3.5 rounded-md bg-slate-50 border border-slate-200 text-xs text-slate-600 space-y-1">
              <div className="flex justify-between">
                <span>Destination</span>
                <span className="font-mono text-slate-900">
                  {status?.mode === 'aws_s3' ? `s3://${status.bucket}/${status.prefix}` : `data/cloud_sim/`}
                </span>
              </div>
              <div className="flex justify-between">
                <span>Format</span>
                <span className="font-mono text-slate-900">UTF-8 CSV (7 columns)</span>
              </div>
            </div>

            <button
              type="submit"
              disabled={busy !== null}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-white bg-blue-700 rounded-md hover:bg-blue-800 disabled:opacity-50 transition-colors whitespace-nowrap"
            >
              <CloudUpload className="w-4 h-4" aria-hidden="true" />
              <span>
                {busy === 'upload'
                  ? 'Uploading Dataset...'
                  : status?.mode === 'aws_s3'
                    ? 'Upload Active Dataset to AWS S3'
                    : 'Upload Active Dataset (Local Sim)'}
              </span>
            </button>
          </form>
        </Panel>
      </div>

      {/* Stored Datasets Table */}
      <Panel
        title="Stored Datasets Registry"
        subtitle="Retrieve archived CSV datasets or reload any snapshot into the analytics workspace"
      >
        {loading ? (
          <div className="py-8 text-center text-sm text-slate-500">Loading stored files...</div>
        ) : files.length === 0 ? (
          <div className="py-10 text-center text-sm text-slate-500 flex flex-col items-center gap-2">
            <HardDrive className="w-6 h-6 text-slate-400" aria-hidden="true" />
            <p>No datasets have been archived yet. Use the upload panel above to store the active dataset.</p>
          </div>
        ) : (
          <div className="overflow-x-auto -mx-5">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="border-y border-slate-200 bg-slate-50/80 text-xs font-medium text-slate-500">
                  <th className="py-2.5 px-5">File Name</th>
                  <th className="py-2.5 px-4">Storage Mode</th>
                  <th className="py-2.5 px-4">Bucket</th>
                  <th className="py-2.5 px-4 text-right">Size</th>
                  <th className="py-2.5 px-4">Upload Timestamp (UTC)</th>
                  <th className="py-2.5 px-5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {files.map((file) => (
                  <tr key={file.key} className="hover:bg-slate-50/80 transition-colors">
                    <td className="py-3 px-5 font-mono text-xs font-medium text-slate-900">
                      {file.filename}
                    </td>
                    <td className="py-3 px-4 text-xs text-slate-700">
                      {file.storage_mode === 'aws_s3' ? 'AWS S3' : 'Local Simulation'}
                    </td>
                    <td className="py-3 px-4 font-mono text-xs text-slate-600">{file.bucket}</td>
                    <td className="py-3 px-4 text-right font-mono text-xs text-slate-600 tabular-nums">
                      {formatBytes(file.size_bytes)}
                    </td>
                    <td className="py-3 px-4 font-mono text-xs text-slate-600 tabular-nums">
                      {file.uploaded_at.replace('T', ' ').slice(0, 19)}
                    </td>
                    <td className="py-3 px-5 text-right">
                      <div className="inline-flex items-center gap-3">
                        <button
                          type="button"
                          disabled={busy !== null}
                          onClick={() => handleLoadIntoApp(file.key)}
                          className="inline-flex items-center gap-1 text-xs font-medium text-blue-700 hover:text-blue-900 disabled:opacity-50 whitespace-nowrap"
                        >
                          <FolderOpen className="w-3.5 h-3.5" aria-hidden="true" />
                          <span>{busy === `load-${file.key}` ? 'Loading...' : 'Load into App'}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            triggerFileDownload(`/api/aws/files/${encodeURIComponent(file.key)}`, file.filename)
                          }
                          className="inline-flex items-center gap-1 text-xs font-medium text-slate-700 hover:text-slate-950 whitespace-nowrap"
                        >
                          <Download className="w-3.5 h-3.5" aria-hidden="true" />
                          <span>Download</span>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
