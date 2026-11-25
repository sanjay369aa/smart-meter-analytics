import { useState, type FormEvent } from 'react';
import {
  Check,
  CloudUpload,
  Database,
  Download,
  FolderOpen,
  LogIn,
  LogOut,
  Pencil,
  ShieldCheck,
  Trash2,
  X,
} from 'lucide-react';
import { api, triggerTextDownload } from '../api/client';
import { AlertBanner, Panel, StatCard } from '../components/ui/Primitives';
import { formatUserFriendlyFirestoreError } from '../firebase/errors';
import { useFirebase } from '../firebase/FirebaseContext';
import {
  archiveDatasetToFirestore,
  deleteDatasetFromFirestore,
  fetchDatasetCsvFromFirestore,
  renameDatasetInFirestore,
} from '../firebase/storageService';
import type { FirebaseDatasetRecord } from '../types/smartMeter';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function StorageView({
  onDatasetMutated,
}: {
  refreshTick: number;
  onDatasetMutated: () => void;
}) {
  const {
    user,
    authReady,
    firestoreConnected,
    connectionWarning,
    datasets,
    datasetsLoading,
    datasetsError,
    authBusy,
    authError,
    projectInfo,
    signInWithGoogle,
    signOutUser,
    clearAuthError,
  } = useFirebase();

  const [uploadFilename, setUploadFilename] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{
    tone: 'success' | 'error' | 'info';
    message: string;
  } | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const lastArchive = datasets[0] ?? null;

  const handleArchiveActive = async (e: FormEvent) => {
    e.preventDefault();
    if (!user) {
      setFeedback({
        tone: 'info',
        message: 'Sign in with Google first to archive smart meter datasets to Firebase Firestore.',
      });
      return;
    }

    setBusy('archive');
    setFeedback(null);
    try {
      const active = await api.getActiveCsv();
      const saved = await archiveDatasetToFirestore(user.uid, {
        rawFilename: uploadFilename.trim() || undefined,
        csvContent: active.csv,
        recordCount: active.record_count,
        totalEnergyKwh: active.total_energy_kwh,
        dateRangeStart: active.date_range.start,
        dateRangeEnd: active.date_range.end,
      });
      setUploadFilename('');
      setFeedback({
        tone: 'success',
        message: `Archived "${saved.filename}" (${saved.recordCount.toLocaleString()} records across ${saved.chunkCount} Firestore chunk${saved.chunkCount === 1 ? '' : 's'}).`,
      });
    } catch (err) {
      setFeedback({
        tone: 'error',
        message: formatUserFriendlyFirestoreError(err),
      });
    } finally {
      setBusy(null);
    }
  };

  const handleLoadIntoApp = async (item: FirebaseDatasetRecord) => {
    if (!user) return;
    setBusy(`load-${item.id}`);
    setFeedback(null);
    try {
      const csv = await fetchDatasetCsvFromFirestore(user.uid, item.id, item.chunkCount);
      const res = await api.loadCsvText(csv, `Firebase Archive: ${item.filename}`);
      setFeedback({
        tone: 'success',
        message: `Retrieved "${item.filename}" from Firebase Firestore — ${res.message}`,
      });
      onDatasetMutated();
    } catch (err) {
      setFeedback({
        tone: 'error',
        message: formatUserFriendlyFirestoreError(err),
      });
    } finally {
      setBusy(null);
    }
  };

  const handleDownloadCsv = async (item: FirebaseDatasetRecord) => {
    if (!user) return;
    setBusy(`dl-${item.id}`);
    setFeedback(null);
    try {
      const csv = await fetchDatasetCsvFromFirestore(user.uid, item.id, item.chunkCount);
      triggerTextDownload(csv, item.filename);
    } catch (err) {
      setFeedback({
        tone: 'error',
        message: formatUserFriendlyFirestoreError(err),
      });
    } finally {
      setBusy(null);
    }
  };

  const handleSaveRename = async (item: FirebaseDatasetRecord) => {
    if (!editingName.trim()) {
      setEditingId(null);
      return;
    }
    setBusy(`rename-${item.id}`);
    setFeedback(null);
    try {
      const updatedName = await renameDatasetInFirestore(item.id, editingName.trim());
      setEditingId(null);
      setFeedback({ tone: 'success', message: `Renamed archive to "${updatedName}".` });
    } catch (err) {
      setFeedback({ tone: 'error', message: formatUserFriendlyFirestoreError(err) });
    } finally {
      setBusy(null);
    }
  };

  const handleDelete = async (item: FirebaseDatasetRecord) => {
    if (!user) return;
    setBusy(`delete-${item.id}`);
    setFeedback(null);
    try {
      await deleteDatasetFromFirestore(user.uid, item.id);
      setConfirmDeleteId(null);
      setFeedback({ tone: 'info', message: `Deleted "${item.filename}" from Firebase Firestore.` });
    } catch (err) {
      setFeedback({ tone: 'error', message: formatUserFriendlyFirestoreError(err) });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-6">
      {connectionWarning && <AlertBanner tone="error" message={connectionWarning} />}
      {authError && <AlertBanner tone="error" message={authError} onDismiss={clearAuthError} />}
      {datasetsError && <AlertBanner tone="error" message={datasetsError} />}
      {feedback && (
        <AlertBanner
          tone={feedback.tone}
          message={feedback.message}
          onDismiss={() => setFeedback(null)}
        />
      )}

      {/* Firebase Cloud Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Cloud Storage Engine"
          value="Firebase"
          detail="Cloud Firestore · Real-time Sync"
          emphasis="accent"
        />
        <StatCard
          label="Database Status"
          value={firestoreConnected ? 'Connected' : 'Offline'}
          detail={projectInfo.projectId}
          emphasis={firestoreConnected ? 'accent' : 'warning'}
        />
        <StatCard
          label="Account Access"
          value={!authReady ? 'Checking' : user ? 'Signed In' : 'Guest'}
          detail={user?.email || 'Sign in with Google to persist data'}
          emphasis={user ? 'default' : 'warning'}
        />
        <StatCard
          label="Archived Datasets"
          value={user ? String(datasets.length) : '—'}
          unit={user ? 'files' : undefined}
          detail={
            lastArchive?.createdAtIso
              ? `Last saved ${lastArchive.createdAtIso.slice(0, 10)}`
              : user
                ? 'No datasets archived yet'
                : 'Sign in to view archives'
          }
        />
      </div>

      {/* Firebase Connection + Archive Active Dataset */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <Panel
          title="Firebase Firestore & Authentication"
          subtitle="Owner-isolated cloud dataset persistence protected by deployed Firestore security rules"
          className="lg:col-span-7"
        >
          <div className="mb-5 p-3.5 rounded-md bg-slate-50 border border-slate-200 text-xs text-slate-700 flex items-start gap-2.5 leading-relaxed">
            <ShieldCheck className="w-4 h-4 text-blue-700 shrink-0 mt-0.5" aria-hidden="true" />
            <div>
              <span className="font-semibold text-slate-900">Verified owner isolation:</span>{' '}
              Every smart meter dataset and CSV chunk stored in Firestore is strictly scoped to your authenticated Google UID via deployed{' '}
              <span className="font-mono text-slate-900">firestore.rules</span> with atomic batched writes and immutable CSV chunks.
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs mb-5">
            <div className="p-3.5 rounded-md border border-slate-200 bg-white">
              <div className="text-slate-500">Firebase Project ID</div>
              <div className="font-mono font-semibold text-slate-900 mt-1 break-all">
                {projectInfo.projectId}
              </div>
            </div>
            <div className="p-3.5 rounded-md border border-slate-200 bg-white">
              <div className="text-slate-500">Firestore Database ID</div>
              <div className="font-mono font-semibold text-slate-900 mt-1 break-all">
                {projectInfo.firestoreDatabaseId}
              </div>
            </div>
          </div>

          <div className="pt-4 border-t border-slate-100 flex flex-wrap items-center justify-between gap-3">
            {user ? (
              <>
                <div className="text-xs text-slate-600">
                  Signed in as <strong className="text-slate-900">{user.email}</strong>
                </div>
                <button
                  type="button"
                  onClick={signOutUser}
                  disabled={authBusy}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 disabled:opacity-50 transition-colors whitespace-nowrap"
                >
                  <LogOut className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Sign Out</span>
                </button>
              </>
            ) : (
              <>
                <div className="text-xs text-slate-600">
                  Authenticate with Google to upload, retrieve, and manage archived smart meter CSV snapshots.
                </div>
                <button
                  type="button"
                  onClick={signInWithGoogle}
                  disabled={authBusy || !authReady}
                  className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-[#0B172A] rounded-md hover:bg-[#162A4A] disabled:opacity-50 transition-colors whitespace-nowrap"
                >
                  <LogIn className="w-4 h-4" aria-hidden="true" />
                  <span>{authBusy ? 'Signing In...' : 'Sign in with Google'}</span>
                </button>
              </>
            )}
          </div>
        </Panel>

        <Panel
          title="Archive Processed Dataset"
          subtitle="Save the currently cleaned smart meter dataset to Firebase Firestore"
          className="lg:col-span-5"
        >
          <form onSubmit={handleArchiveActive} className="space-y-4">
            <div>
              <label htmlFor="archive-filename" className="block text-xs font-medium text-slate-700 mb-1.5">
                Archive File Name (optional)
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
                Leave blank to generate a UTC timestamped CSV filename automatically.
              </p>
            </div>

            <div className="p-3.5 rounded-md bg-slate-50 border border-slate-200 text-xs text-slate-600 space-y-1">
              <div className="flex justify-between gap-2">
                <span>Firestore Collection</span>
                <span className="font-mono text-slate-900">datasets/&#123;id&#125;/chunks</span>
              </div>
              <div className="flex justify-between gap-2">
                <span>Storage Strategy</span>
                <span className="font-mono text-slate-900">Atomic UTF-8 CSV Chunks</span>
              </div>
            </div>

            {user ? (
              <button
                type="submit"
                disabled={busy !== null || !firestoreConnected}
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-white bg-blue-700 rounded-md hover:bg-blue-800 disabled:opacity-50 transition-colors whitespace-nowrap"
              >
                <CloudUpload className="w-4 h-4" aria-hidden="true" />
                <span>
                  {busy === 'archive' ? 'Archiving to Firestore...' : 'Archive Active Dataset to Firebase'}
                </span>
              </button>
            ) : (
              <button
                type="button"
                onClick={signInWithGoogle}
                disabled={authBusy || !authReady}
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-white bg-[#0B172A] rounded-md hover:bg-[#162A4A] disabled:opacity-50 transition-colors whitespace-nowrap"
              >
                <LogIn className="w-4 h-4" aria-hidden="true" />
                <span>{authBusy ? 'Signing In...' : 'Sign in with Google to Archive'}</span>
              </button>
            )}
          </form>
        </Panel>
      </div>

      {/* Stored Datasets Registry (Real-time onSnapshot) */}
      <Panel
        title="Firebase Cloud Archive Registry"
        subtitle="Real-time synchronized CSV snapshots stored in Cloud Firestore"
      >
        {!authReady ? (
          <div className="py-8 text-center text-sm text-slate-500">Checking Firebase authentication...</div>
        ) : !user ? (
          <div className="py-10 text-center text-sm text-slate-600 flex flex-col items-center gap-3">
            <Database className="w-6 h-6 text-slate-400" aria-hidden="true" />
            <p className="max-w-md">
              Sign in with Google to view, load, download, rename, or delete your archived smart meter datasets in Firebase Firestore.
            </p>
            <button
              type="button"
              onClick={signInWithGoogle}
              disabled={authBusy}
              className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-white bg-blue-700 rounded-md hover:bg-blue-800 disabled:opacity-50"
            >
              <LogIn className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Sign in with Google</span>
            </button>
          </div>
        ) : datasetsLoading ? (
          <div className="py-8 text-center text-sm text-slate-500">Syncing datasets from Cloud Firestore...</div>
        ) : datasets.length === 0 ? (
          <div className="py-10 text-center text-sm text-slate-500 flex flex-col items-center gap-2">
            <Database className="w-6 h-6 text-slate-400" aria-hidden="true" />
            <p>No datasets archived in Firebase yet. Use the archive form above to save the active cleaned dataset.</p>
          </div>
        ) : (
          <div className="overflow-x-auto -mx-5">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="border-y border-slate-200 bg-slate-50/80 text-xs font-medium text-slate-500">
                  <th className="py-2.5 px-5">File Name</th>
                  <th className="py-2.5 px-4 text-right">Records</th>
                  <th className="py-2.5 px-4 text-right">Total Load (kWh)</th>
                  <th className="py-2.5 px-4 text-right">Size</th>
                  <th className="py-2.5 px-4">Archived (UTC)</th>
                  <th className="py-2.5 px-5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {datasets.map((item) => (
                  <tr key={item.id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="py-3 px-5 font-mono text-xs font-medium text-slate-900">
                      {editingId === item.id ? (
                        <div className="flex items-center gap-1.5">
                          <input
                            type="text"
                            value={editingName}
                            onChange={(e) => setEditingName(e.target.value)}
                            aria-label="New dataset filename"
                            className="px-2 py-1 text-xs font-mono border border-blue-500 rounded bg-white text-slate-900 w-56"
                          />
                          <button
                            type="button"
                            onClick={() => handleSaveRename(item)}
                            disabled={busy !== null}
                            aria-label="Save filename"
                            className="p-1 text-emerald-700 hover:bg-emerald-50 rounded"
                          >
                            <Check className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingId(null)}
                            aria-label="Cancel rename"
                            className="p-1 text-slate-500 hover:bg-slate-100 rounded"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ) : (
                        <div>
                          <div>{item.filename}</div>
                          {item.dateRangeStart && item.dateRangeEnd && (
                            <div className="text-[11px] text-slate-400 font-normal mt-0.5">
                              {item.dateRangeStart} to {item.dateRangeEnd}
                            </div>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="py-3 px-4 text-right font-mono text-xs text-slate-700 tabular-nums">
                      {item.recordCount.toLocaleString()}
                    </td>
                    <td className="py-3 px-4 text-right font-mono text-xs text-slate-700 tabular-nums">
                      {item.totalEnergyKwh.toLocaleString(undefined, { maximumFractionDigits: 1 })}
                    </td>
                    <td className="py-3 px-4 text-right font-mono text-xs text-slate-600 tabular-nums">
                      {formatBytes(item.sizeBytes)}
                      <span className="text-slate-400 ml-1">({item.chunkCount}c)</span>
                    </td>
                    <td className="py-3 px-4 font-mono text-xs text-slate-600 tabular-nums">
                      {item.createdAtIso ? item.createdAtIso.replace('T', ' ').slice(0, 19) : 'Pending...'}
                    </td>
                    <td className="py-3 px-5 text-right">
                      {confirmDeleteId === item.id ? (
                        <div className="inline-flex items-center gap-2">
                          <span className="text-xs text-red-700 font-medium">Delete?</span>
                          <button
                            type="button"
                            disabled={busy !== null}
                            onClick={() => handleDelete(item)}
                            className="px-2 py-1 text-xs font-medium text-white bg-red-600 rounded hover:bg-red-700 disabled:opacity-50"
                          >
                            {busy === `delete-${item.id}` ? 'Deleting...' : 'Confirm'}
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteId(null)}
                            className="px-2 py-1 text-xs font-medium text-slate-600 bg-slate-100 rounded hover:bg-slate-200"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <div className="inline-flex items-center gap-3">
                          <button
                            type="button"
                            disabled={busy !== null}
                            onClick={() => handleLoadIntoApp(item)}
                            className="inline-flex items-center gap-1 text-xs font-medium text-blue-700 hover:text-blue-900 disabled:opacity-50 whitespace-nowrap"
                          >
                            <FolderOpen className="w-3.5 h-3.5" aria-hidden="true" />
                            <span>{busy === `load-${item.id}` ? 'Loading...' : 'Load into App'}</span>
                          </button>
                          <button
                            type="button"
                            disabled={busy !== null}
                            onClick={() => handleDownloadCsv(item)}
                            className="inline-flex items-center gap-1 text-xs font-medium text-slate-700 hover:text-slate-950 disabled:opacity-50 whitespace-nowrap"
                          >
                            <Download className="w-3.5 h-3.5" aria-hidden="true" />
                            <span>{busy === `dl-${item.id}` ? 'Exporting...' : 'CSV'}</span>
                          </button>
                          <button
                            type="button"
                            disabled={busy !== null}
                            onClick={() => {
                              setEditingId(item.id);
                              setEditingName(item.filename);
                            }}
                            aria-label={`Rename ${item.filename}`}
                            className="text-slate-500 hover:text-slate-900 disabled:opacity-50"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            disabled={busy !== null}
                            onClick={() => setConfirmDeleteId(item.id)}
                            aria-label={`Delete ${item.filename}`}
                            className="text-slate-400 hover:text-red-700 disabled:opacity-50"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      )}
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
