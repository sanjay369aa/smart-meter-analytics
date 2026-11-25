import { useEffect, useState } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Cloud, TrendingUp } from 'lucide-react';
import { api } from '../api/client';
import { useFirebase } from '../firebase/FirebaseContext';
import type { DashboardPayload, NavPage } from '../types/smartMeter';
import {
  AlertBanner,
  EmptyDatasetState,
  LoadingGrid,
  Panel,
  StatCard,
} from '../components/ui/Primitives';

export function DashboardView({
  refreshTick,
  onNavigate,
  onLoadSample,
}: {
  refreshTick: number;
  onNavigate: (page: NavPage) => void;
  onLoadSample: () => Promise<void>;
}) {
  const { user, firestoreConnected, datasets } = useFirebase();
  const [data, setData] = useState<DashboardPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .getDashboard()
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load dashboard.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [refreshTick]);

  if (loading && !data) return <LoadingGrid cards={5} />;
  if (error) return <AlertBanner tone="error" message={error} />;
  if (!data) return null;

  const isEmpty = data.summary.total_records === 0;

  return (
    <div className="space-y-6">
      {/* Status Strip: Firebase Cloud Storage + Forecasting Model */}
      <div className="bg-white border border-slate-200 rounded-lg px-4 sm:px-5 py-3.5 flex flex-col lg:flex-row lg:items-center justify-between gap-3 text-xs">
        <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-x-5 gap-y-2">
          <button
            type="button"
            onClick={() => onNavigate('storage')}
            className="flex items-start sm:items-center gap-2 text-left text-slate-700 hover:text-blue-700 transition-colors"
          >
            <Cloud className="w-4 h-4 text-blue-700 shrink-0 mt-0.5 sm:mt-0" aria-hidden="true" />
            <span>
              <span className="font-medium text-slate-900">Cloud Storage:</span>{' '}
              <span
                className={
                  !firestoreConnected
                    ? 'text-amber-700 font-medium'
                    : user
                      ? 'text-emerald-700 font-medium'
                      : 'text-slate-600'
                }
              >
                {!firestoreConnected
                  ? 'Firebase Firestore Offline'
                  : user
                    ? `Firebase Firestore Connected · ${datasets.length} archived dataset(s)`
                    : 'Firebase Firestore Ready · Sign in to archive'}
              </span>
            </span>
          </button>

          <span className="hidden sm:inline text-slate-300" aria-hidden="true">
            |
          </span>

          <button
            type="button"
            onClick={() => onNavigate('forecasting')}
            className="flex items-start sm:items-center gap-2 text-left text-slate-700 hover:text-blue-700 transition-colors"
          >
            <TrendingUp className="w-4 h-4 text-blue-700 shrink-0 mt-0.5 sm:mt-0" aria-hidden="true" />
            <span>
              <span className="font-medium text-slate-900">Forecasting Model:</span>{' '}
              <span
                className={
                  data.forecast_status.status === 'trained'
                    ? 'text-emerald-700 font-medium'
                    : 'text-amber-700 font-medium'
                }
              >
                {data.forecast_status.status === 'trained'
                  ? `${data.forecast_status.model_name} · MAPE ${data.forecast_status.mape?.toFixed(2)}%`
                  : 'Insufficient Data — Load Sample Dataset'}
              </span>
            </span>
          </button>
        </div>

        <div className="text-slate-500 font-mono tabular-nums">
          {data.summary.date_range.start && data.summary.date_range.end
            ? `${data.summary.date_range.start} to ${data.summary.date_range.end} · ${data.summary.total_records.toLocaleString()} readings`
            : 'No records loaded'}
        </div>
      </div>

      {/* Top 5 KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        <StatCard
          label="Total Energy Consumption"
          value={data.summary.total_energy_kwh.toLocaleString(undefined, { maximumFractionDigits: 1 })}
          unit="kWh"
          detail={`${data.summary.total_records.toLocaleString()} validated records`}
        />
        <StatCard
          label="Total Smart Meters"
          value={String(data.summary.total_meters)}
          unit="meters"
          detail="Residential · Commercial · Industrial"
        />
        <StatCard
          label="Average Hourly Load"
          value={data.summary.average_consumption_kwh.toLocaleString(undefined, { maximumFractionDigits: 2 })}
          unit="kWh/h"
          detail="Mean aggregate grid load"
        />
        <StatCard
          label="Peak Recorded Load"
          value={data.summary.peak_load_kwh.toLocaleString(undefined, { maximumFractionDigits: 2 })}
          unit="kWh/h"
          detail={data.summary.peak_load_timestamp ? `${data.summary.peak_load_timestamp} UTC` : 'No peak recorded'}
          emphasis="warning"
        />
        <StatCard
          label="Next Hour Forecast"
          value={
            data.summary.next_hour_forecast_kwh !== null
              ? data.summary.next_hour_forecast_kwh.toLocaleString(undefined, { maximumFractionDigits: 2 })
              : '—'
          }
          unit={data.summary.next_hour_forecast_kwh !== null ? 'kWh' : undefined}
          detail={
            data.forecast_status.status === 'trained'
              ? 'ARIMA next-hour prediction'
              : 'Requires >= 48h history'
          }
          emphasis="accent"
        />
      </div>

      {isEmpty ? (
        <EmptyDatasetState
          title="No Smart Meter Readings Loaded"
          description="Upload a smart meter CSV dataset or load the 35-day sample dataset to populate consumption analytics, peak load alerts, and ARIMA forecasts."
          onLoadSample={onLoadSample}
        />
      ) : (
        <>
          {/* Row 1 Charts: Consumption Over Time + Consumer Comparison */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <Panel
              title="Electricity Consumption Over Time"
              subtitle="Aggregate hourly grid demand across recent 120 hours (UTC)"
              className="lg:col-span-8"
              action={
                <button
                  type="button"
                  onClick={() => onNavigate('analytics')}
                  className="text-xs font-medium text-blue-700 hover:text-blue-900 whitespace-nowrap"
                >
                  Open Analytics
                </button>
              }
            >
              <div className="h-[280px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={data.consumption_over_time} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="navyLoadFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#1D4ED8" stopOpacity={0.22} />
                        <stop offset="95%" stopColor="#1D4ED8" stopOpacity={0.0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
                    <XAxis
                      dataKey="label"
                      tick={{ fontSize: 11, fill: '#64748B' }}
                      tickLine={false}
                      axisLine={{ stroke: '#E2E8F0' }}
                      minTickGap={28}
                    />
                    <YAxis
                      tick={{ fontSize: 11, fill: '#64748B' }}
                      tickLine={false}
                      axisLine={false}
                      width={52}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: '#0B172A',
                        border: 'none',
                        borderRadius: '6px',
                        color: '#FFFFFF',
                        fontSize: '12px',
                      }}
                      formatter={(val) => [`${Number(val ?? 0).toFixed(2)} kWh`, 'Grid Load']}
                    />
                    <Area
                      type="monotone"
                      dataKey="energy_kwh"
                      stroke="#1D4ED8"
                      strokeWidth={2}
                      fill="url(#navyLoadFill)"
                      isAnimationActive={false}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </Panel>

            <Panel
              title="Consumer Category Comparison"
              subtitle="Total electricity consumption by sector (kWh)"
              className="lg:col-span-4"
            >
              <div className="h-[280px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data.consumer_comparison} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
                    <XAxis
                      dataKey="consumer_type"
                      tick={{ fontSize: 11, fill: '#475569' }}
                      tickLine={false}
                      axisLine={{ stroke: '#E2E8F0' }}
                    />
                    <YAxis
                      tick={{ fontSize: 11, fill: '#64748B' }}
                      tickLine={false}
                      axisLine={false}
                      width={48}
                      tickFormatter={(v: number) => (v >= 1000 ? `${Math.round(v / 1000)}k` : String(v))}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: '#0B172A',
                        border: 'none',
                        borderRadius: '6px',
                        color: '#FFFFFF',
                        fontSize: '12px',
                      }}
                      formatter={(val) => [`${Number(val ?? 0).toLocaleString()} kWh`, 'Total Consumption']}
                    />
                    <Bar dataKey="total_kwh" fill="#0B172A" radius={[4, 4, 0, 0]} isAnimationActive={false} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Panel>
          </div>

          {/* Row 2 Charts: Daily Electricity Usage + Actual vs Predicted Load */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Panel
              title="Daily Electricity Usage"
              subtitle="Recent 14 days total daily demand (kWh)"
            >
              <div className="h-[270px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data.daily_usage} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
                    <XAxis
                      dataKey="label"
                      tick={{ fontSize: 11, fill: '#64748B' }}
                      tickLine={false}
                      axisLine={{ stroke: '#E2E8F0' }}
                    />
                    <YAxis
                      tick={{ fontSize: 11, fill: '#64748B' }}
                      tickLine={false}
                      axisLine={false}
                      width={54}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: '#0B172A',
                        border: 'none',
                        borderRadius: '6px',
                        color: '#FFFFFF',
                        fontSize: '12px',
                      }}
                      formatter={(val) => [`${Number(val ?? 0).toLocaleString()} kWh`, 'Daily Total']}
                    />
                    <Bar dataKey="total_kwh" fill="#1D4ED8" radius={[4, 4, 0, 0]} isAnimationActive={false} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Panel>

            <Panel
              title="Actual vs Predicted Electricity Load"
              subtitle="ARIMA holdout validation across recent 48 hours"
              action={
                <button
                  type="button"
                  onClick={() => onNavigate('forecasting')}
                  className="text-xs font-medium text-blue-700 hover:text-blue-900 whitespace-nowrap"
                >
                  Open Forecasting
                </button>
              }
            >
              {data.actual_vs_predicted.length > 0 ? (
                <div className="h-[270px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={data.actual_vs_predicted} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
                      <XAxis
                        dataKey="label"
                        tick={{ fontSize: 11, fill: '#64748B' }}
                        tickLine={false}
                        axisLine={{ stroke: '#E2E8F0' }}
                        minTickGap={24}
                      />
                      <YAxis
                        tick={{ fontSize: 11, fill: '#64748B' }}
                        tickLine={false}
                        axisLine={false}
                        width={52}
                      />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: '#0B172A',
                          border: 'none',
                          borderRadius: '6px',
                          color: '#FFFFFF',
                          fontSize: '12px',
                        }}
                      />
                      <Legend wrapperStyle={{ fontSize: '12px' }} />
                      <Line
                        type="monotone"
                        dataKey="actual_kwh"
                        name="Actual (kWh)"
                        stroke="#0B172A"
                        strokeWidth={2}
                        dot={false}
                        isAnimationActive={false}
                      />
                      <Line
                        type="monotone"
                        dataKey="predicted_kwh"
                        name="ARIMA Predicted (kWh)"
                        stroke="#0D9488"
                        strokeWidth={2}
                        strokeDasharray="5 3"
                        dot={false}
                        isAnimationActive={false}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="h-[270px] flex items-center justify-center text-sm text-slate-500">
                  Forecast model requires at least 48 hourly intervals to display validation results.
                </div>
              )}
            </Panel>
          </div>

          {/* Recent Meter Readings Table */}
          <Panel
            title="Recent Smart Meter Readings"
            subtitle="Latest validated telemetry entries across connected meters"
            action={
              <button
                type="button"
                onClick={() => onNavigate('meters')}
                className="text-xs font-medium text-blue-700 hover:text-blue-900 whitespace-nowrap"
              >
                View All Readings
              </button>
            }
          >
            <div className="overflow-x-auto -mx-5">
              <table className="w-full text-left border-collapse text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/70 text-xs font-medium text-slate-500">
                    <th className="py-2.5 px-5">Meter ID</th>
                    <th className="py-2.5 px-4">Timestamp (UTC)</th>
                    <th className="py-2.5 px-4">Consumer Type</th>
                    <th className="py-2.5 px-4 text-right">Consumption (kWh)</th>
                    <th className="py-2.5 px-4 text-right">Voltage (V)</th>
                    <th className="py-2.5 px-4 text-right">Current (A)</th>
                    <th className="py-2.5 px-5 text-right">Power Factor</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.recent_readings.map((row) => (
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
                        {row.voltage.toFixed(1)}
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
          </Panel>
        </>
      )}
    </div>
  );
}
