import { useEffect, useState, type FormEvent } from 'react';
import { Database, Download, LogIn, Shield, Trash2 } from 'lucide-react';
import { api, triggerFileDownload } from '../api/client';
import { AlertBanner, Panel } from '../components/ui/Primitives';
import { formatUserFriendlyFirestoreError } from '../firebase/errors';
import { useFirebase } from '../firebase/FirebaseContext';
import { saveUserSettingsToFirestore } from '../firebase/storageService';

export function SettingsView({
  defaultOrder,
  defaultHorizon,
  onUpdateDefaults,
  onDatasetMutated,
}: {
  defaultOrder: { p: number; d: number; q: number };
  defaultHorizon: 12 | 24 | 48;
  onUpdateDefaults: (order: { p: number; d: number; q: number }, horizon: 12 | 24 | 48) => void;
  onDatasetMutated: () => void;
}) {
  const { user, firestoreConnected, projectInfo, signInWithGoogle, authBusy } = useFirebase();
  const [p, setP] = useState(defaultOrder.p);
  const [d, setD] = useState(defaultOrder.d);
  const [q, setQ] = useState(defaultOrder.q);
  const [horizon, setHorizon] = useState<12 | 24 | 48>(defaultHorizon);
  const [busy, setBusy] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ tone: 'success' | 'error' | 'info'; message: string } | null>(null);

  useEffect(() => {
    setP(defaultOrder.p);
    setD(defaultOrder.d);
    setQ(defaultOrder.q);
    setHorizon(defaultHorizon);
  }, [defaultOrder, defaultHorizon]);

  const handleSaveArimaDefaults = async (e: FormEvent) => {
    e.preventDefault();
    const safeP = Math.min(12, Math.max(1, Math.round(p)));
    const safeD = Math.min(2, Math.max(0, Math.round(d)));
    const safeQ = Math.min(4, Math.max(0, Math.round(q)));
    onUpdateDefaults({ p: safeP, d: safeD, q: safeQ }, horizon);

    if (user && firestoreConnected) {
      setBusy('arima');
      setFeedback(null);
      try {
        await saveUserSettingsToFirestore(user.uid, {
          arimaP: safeP,
          arimaD: safeD,
          arimaQ: safeQ,
          defaultHorizon: horizon,
        });
        setFeedback({
          tone: 'success',
          message: `Saved ARIMA(${safeP}, ${safeD}, ${safeQ}) · ${horizon}h defaults and synced to Firebase Firestore.`,
        });
      } catch (err) {
        setFeedback({
          tone: 'error',
          message: formatUserFriendlyFirestoreError(err),
        });
      } finally {
        setBusy(null);
      }
      return;
    }

    setFeedback({
      tone: 'success',
      message: `Saved default ARIMA(${safeP}, ${safeD}, ${safeQ}) order for this session. Sign in with Google to persist defaults in Firebase.`,
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
          subtitle={
            user
              ? 'Changes automatically sync to your Firebase Firestore userSettings profile'
              : 'Set default (p, d, q) order used when opening Load Forecasting'
          }
        >
          <form onSubmit={handleSaveArimaDefaults} className="space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
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
              <div>
                <label htmlFor="settings-horizon" className="block text-xs font-medium text-slate-700 mb-1.5">
                  Horizon
                </label>
                <select
                  id="settings-horizon"
                  value={horizon}
                  onChange={(e) => setHorizon(Number(e.target.value) as 12 | 24 | 48)}
                  className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-md bg-white text-slate-900"
                >
                  <option value={12}>12h</option>
                  <option value={24}>24h</option>
                  <option value={48}>48h</option>
                </select>
              </div>
            </div>

            <div className="pt-1 flex items-center justify-between gap-3">
              <span className="text-xs text-slate-500">
                {user ? 'Synced to Firestore' : 'Local session only until signed in'}
              </span>
              <button
                type="submit"
                disabled={busy !== null}
                className="px-4 py-2 text-sm font-medium text-white bg-[#0B172A] rounded-md hover:bg-[#162A4A] disabled:opacity-50 transition-colors whitespace-nowrap"
              >
                {busy === 'arima' ? 'Syncing...' : 'Save Model Defaults'}
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

      {/* Firebase & Vercel Deployment Summary */}
      <Panel
        title="Firebase Cloud & Vercel Architecture"
        subtitle="Zero-secret client Firebase SDK paired with Vercel serverless analytics & ARIMA forecasting"
      >
        <div className="flex items-start gap-3 text-sm text-slate-700 mb-4">
          <Shield className="w-5 h-5 text-blue-700 shrink-0 mt-0.5" aria-hidden="true" />
          <p className="leading-relaxed">
            Cloud storage is powered by <strong>Firebase Cloud Firestore</strong> and <strong>Google Authentication</strong>. All access control, owner isolation, and schema constraints are enforced directly in deployed <span className="font-mono text-xs text-slate-900">firestore.rules</span> — no cloud secret keys are required in server environment variables when deploying to <strong>Vercel</strong>.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
          <div className="p-3.5 rounded-md bg-slate-50 border border-slate-200">
            <div className="text-slate-500">Firebase Project</div>
            <div className="font-mono font-semibold text-slate-900 mt-1 break-all">
              {projectInfo.projectId}
            </div>
          </div>
          <div className="p-3.5 rounded-md bg-slate-50 border border-slate-200">
            <div className="text-slate-500">Firestore Database</div>
            <div className="font-mono font-semibold text-slate-900 mt-1 break-all">
              {projectInfo.firestoreDatabaseId}
            </div>
          </div>
          <div className="p-3.5 rounded-md bg-slate-50 border border-slate-200 flex items-center justify-between gap-2">
            <div>
              <div className="text-slate-500">Auth Session</div>
              <div className="font-medium text-slate-900 mt-1">
                {user ? user.email : 'Not signed in'}
              </div>
            </div>
            {!user && (
              <button
                type="button"
                onClick={signInWithGoogle}
                disabled={authBusy}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-white bg-[#0B172A] rounded hover:bg-[#162A4A] shrink-0"
              >
                <LogIn className="w-3 h-3" aria-hidden="true" />
                <span>Sign In</span>
              </button>
            )}
          </div>
        </div>
      </Panel>
    </div>
  );
}
