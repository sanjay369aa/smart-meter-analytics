import { useCallback, useEffect, useState } from 'react';
import { api } from './api/client';
import { Layout } from './components/Layout';
import { AlertBanner } from './components/ui/Primitives';
import { useFirebase } from './firebase/FirebaseContext';
import { loadUserSettingsFromFirestore } from './firebase/storageService';
import type { NavPage } from './types/smartMeter';
import { AnalyticsView } from './views/AnalyticsView';
import { DashboardView } from './views/DashboardView';
import { ForecastingView } from './views/ForecastingView';
import { MetersView } from './views/MetersView';
import { PeakLoadView } from './views/PeakLoadView';
import { ReportsView } from './views/ReportsView';
import { SettingsView } from './views/SettingsView';
import { StorageView } from './views/StorageView';

export default function App() {
  const { user, authReady } = useFirebase();
  const [activePage, setActivePage] = useState<NavPage>('dashboard');
  const [refreshTick, setRefreshTick] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [globalNotice, setGlobalNotice] = useState<{
    tone: 'success' | 'error' | 'info';
    message: string;
  } | null>(null);
  const [defaultOrder, setDefaultOrder] = useState({ p: 3, d: 1, q: 1 });
  const [defaultHorizon, setDefaultHorizon] = useState<12 | 24 | 48>(24);

  useEffect(() => {
    if (!authReady || !user) return;
    let cancelled = false;
    loadUserSettingsFromFirestore(user.uid)
      .then((saved) => {
        if (!cancelled && saved) {
          setDefaultOrder({ p: saved.arimaP, d: saved.arimaD, q: saved.arimaQ });
          setDefaultHorizon(saved.defaultHorizon);
        }
      })
      .catch(() => {
        // Non-fatal on initial sync; Settings view displays explicit feedback if saving fails
      });
    return () => {
      cancelled = true;
    };
  }, [authReady, user]);

  const triggerRefresh = useCallback(() => {
    setRefreshing(true);
    setRefreshTick((t) => t + 1);
    setTimeout(() => setRefreshing(false), 300);
  }, []);

  const handleLoadSample = useCallback(async () => {
    setRefreshing(true);
    setGlobalNotice(null);
    try {
      const res = await api.loadSampleDataset();
      setGlobalNotice({ tone: 'success', message: res.message });
      setRefreshTick((t) => t + 1);
    } catch (err) {
      setGlobalNotice({
        tone: 'error',
        message: err instanceof Error ? err.message : 'Failed to load sample dataset.',
      });
    } finally {
      setRefreshing(false);
    }
  }, []);

  const handleDatasetMutated = useCallback(() => {
    setRefreshTick((t) => t + 1);
  }, []);

  return (
    <Layout
      activePage={activePage}
      onNavigate={(page) => {
        setActivePage(page);
        setGlobalNotice(null);
      }}
      onRefresh={triggerRefresh}
      onLoadSample={handleLoadSample}
      refreshing={refreshing}
    >
      {globalNotice && (
        <div className="mb-6">
          <AlertBanner
            tone={globalNotice.tone}
            message={globalNotice.message}
            onDismiss={() => setGlobalNotice(null)}
          />
        </div>
      )}

      {activePage === 'dashboard' && (
        <DashboardView
          refreshTick={refreshTick}
          onNavigate={setActivePage}
          onLoadSample={handleLoadSample}
        />
      )}

      {activePage === 'meters' && (
        <MetersView refreshTick={refreshTick} onDatasetMutated={handleDatasetMutated} />
      )}

      {activePage === 'storage' && (
        <StorageView refreshTick={refreshTick} onDatasetMutated={handleDatasetMutated} />
      )}

      {activePage === 'analytics' && (
        <AnalyticsView refreshTick={refreshTick} onLoadSample={handleLoadSample} />
      )}

      {activePage === 'peak-load' && (
        <PeakLoadView refreshTick={refreshTick} onLoadSample={handleLoadSample} />
      )}

      {activePage === 'forecasting' && (
        <ForecastingView
          refreshTick={refreshTick}
          defaultOrder={defaultOrder}
          onLoadSample={handleLoadSample}
          onForecastTrained={handleDatasetMutated}
        />
      )}

      {activePage === 'reports' && (
        <ReportsView refreshTick={refreshTick} onLoadSample={handleLoadSample} />
      )}

      {activePage === 'settings' && (
        <SettingsView
          defaultOrder={defaultOrder}
          defaultHorizon={defaultHorizon}
          onUpdateDefaults={(order, horizon) => {
            setDefaultOrder(order);
            setDefaultHorizon(horizon);
          }}
          onDatasetMutated={handleDatasetMutated}
        />
      )}
    </Layout>
  );
}
