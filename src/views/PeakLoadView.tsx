import { useEffect, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { AlertTriangle } from 'lucide-react';
import { api } from '../api/client';
import type { PeakLoadPayload } from '../types/smartMeter';
import {
  AlertBanner,
  EmptyDatasetState,
  LoadingGrid,
  Panel,
  StatCard,
} from '../components/ui/Primitives';

const CONSUMER_OPTIONS = ['All', 'Residential', 'Commercial', 'Industrial'] as const;

export function PeakLoadView({
  refreshTick,
  onLoadSample,
}: {
  refreshTick: number;
  onLoadSample: () => Promise<void>;
}) {
  const [data, setData] = useState<PeakLoadPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [consumerType, setConsumerType] = useState<string>('All');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .getPeakLoad({ consumer_type: consumerType })
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to detect peak loads.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [refreshTick, consumerType]);

  if (loading && !data) return <LoadingGrid cards={4} />;
  if (error) return <AlertBanner tone="error" message={error} />;
  if (!data) return null;

  const isEmpty = !data.peak_hour;

  const barColor = (cls: 'Peak' | 'Standard' | 'Off-Peak') => {
    if (cls === 'Peak') return '#D97706';
    if (cls === 'Off-Peak') return '#0D9488';
    return '#1D4ED8';
  };

  return (
    <div className="space-y-6">
      {/* Consumer Filter */}
      <div className="bg-white border border-slate-200 rounded-lg p-4 flex flex-wrap items-center justify-between gap-4">
        <div className="inline-flex items-center p-1 bg-slate-100 rounded-md" role="group" aria-label="Filter peak load by consumer type">
          {CONSUMER_OPTIONS.map((ct) => (
            <button
              key={ct}
              type="button"
              onClick={() => setConsumerType(ct)}
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

        <div className="flex flex-wrap items-center gap-4 text-xs text-slate-600">
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-xs bg-amber-600" aria-hidden="true" /> Peak Hours
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-xs bg-blue-700" aria-hidden="true" /> Standard Hours
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-xs bg-teal-600" aria-hidden="true" /> Off-Peak Hours
          </span>
        </div>
      </div>

      {isEmpty ? (
        <EmptyDatasetState
          title="No Data Available for Peak Load Detection"
          description="Load the 35-day sample dataset or upload smart meter CSV readings to identify peak hours, off-peak periods, and abnormal load spikes."
          onLoadSample={onLoadSample}
        />
      ) : (
        <>
          {/* Peak KPI Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard
              label="Highest Consumption Hour"
              value={data.peak_hour!.label}
              unit="UTC"
              detail={`Mean load ${data.peak_hour!.average_kwh.toLocaleString()} kWh/h`}
              emphasis="warning"
            />
            <StatCard
              label="Peak Single-Hour Load"
              value={data.peak_event!.energy_kwh.toLocaleString(undefined, { maximumFractionDigits: 2 })}
              unit="kWh"
              detail={`Recorded ${data.peak_event!.label} UTC`}
              emphasis="warning"
            />
            <StatCard
              label="Lowest Consumption Hour"
              value={data.lowest_hour!.label}
              unit="UTC"
              detail={`Mean load ${data.lowest_hour!.average_kwh.toLocaleString()} kWh/h`}
            />
            <StatCard
              label="Detected Load Anomalies"
              value={String(data.anomalies.length)}
              unit="events"
              detail={`Modified Z-score >= 2.5 vs hour median`}
              emphasis={data.anomalies.length > 0 ? 'accent' : 'default'}
            />
          </div>

          {/* 24-Hour Peak vs Off-Peak Classification Chart */}
          <Panel
            title="Hourly Peak & Off-Peak Load Classification"
            subtitle={`Peak threshold: ${data.period_split.threshold_kwh.toLocaleString()} kWh/h (72nd percentile of hourly mean load)`}
          >
            <div className="h-[300px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.hourly_load_curve} margin={{ top: 12, right: 16, left: 0, bottom: 0 }}>
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
                    formatter={(val, _name, props) => [
                      `${Number(val ?? 0).toFixed(2)} kWh/h (${(props?.payload as { classification?: string } | undefined)?.classification ?? ''})`,
                      'Mean Hourly Load',
                    ]}
                  />
                  <ReferenceLine
                    y={data.period_split.threshold_kwh}
                    stroke="#D97706"
                    strokeDasharray="4 4"
                    label={{
                      value: 'Peak Threshold',
                      position: 'insideTopRight',
                      fill: '#B45309',
                      fontSize: 11,
                    }}
                  />
                  <Bar dataKey="average_kwh" radius={[3, 3, 0, 0]} isAnimationActive={false}>
                    {data.hourly_load_curve.map((entry) => (
                      <Cell key={entry.hour} fill={barColor(entry.classification)} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Peak vs Off-Peak Summary Strip */}
            <div className="mt-5 pt-4 border-t border-slate-100 grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
              <div>
                <div className="text-slate-500 font-medium">Peak Demand Hours</div>
                <div className="mt-1 font-mono text-slate-900">
                  {data.peak_hours.map((h) => h.label).join(' · ') || '—'}
                </div>
                <div className="mt-1 text-slate-500 font-mono tabular-nums">
                  {data.period_split.peak_total_kwh.toLocaleString()} kWh ({data.period_split.peak_share_percent}% of total)
                </div>
              </div>
              <div>
                <div className="text-slate-500 font-medium">Low-Consumption Off-Peak Hours</div>
                <div className="mt-1 font-mono text-slate-900">
                  {data.off_peak_hours.map((h) => h.label).join(' · ') || '—'}
                </div>
                <div className="mt-1 text-slate-500">Optimal window for load shifting &amp; EV charging</div>
              </div>
              <div>
                <div className="text-slate-500 font-medium">Non-Peak Energy Share</div>
                <div className="mt-1 font-mono text-slate-900 tabular-nums">
                  {data.period_split.off_peak_total_kwh.toLocaleString()} kWh ({data.period_split.off_peak_share_percent}%)
                </div>
                <div className="mt-1 text-slate-500">Standard + Off-Peak intervals combined</div>
              </div>
            </div>
          </Panel>

          {/* Unusual Electricity Usage (Anomalies) Table */}
          <Panel
            title="Unusual Electricity Usage & Spike Anomalies"
            subtitle="Hourly intervals exceeding expected median demand for the same hour of day (Modified Z-score >= 2.5)"
          >
            {data.anomalies.length === 0 ? (
              <div className="py-8 text-center text-sm text-slate-500">
                No unusual electricity consumption spikes exceeded the anomaly threshold for this filter scope.
              </div>
            ) : (
              <div className="overflow-x-auto -mx-5">
                <table className="w-full text-left border-collapse text-sm">
                  <thead>
                    <tr className="border-y border-slate-200 bg-slate-50/80 text-xs font-medium text-slate-500">
                      <th className="py-2.5 px-5">Timestamp (UTC)</th>
                      <th className="py-2.5 px-4 text-right">Observed (kWh)</th>
                      <th className="py-2.5 px-4 text-right">Expected Median (kWh)</th>
                      <th className="py-2.5 px-4 text-right">Deviation</th>
                      <th className="py-2.5 px-4 text-right">Z-Score</th>
                      <th className="py-2.5 px-4">Dominant Sector</th>
                      <th className="py-2.5 px-5">Severity</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {data.anomalies.map((a) => (
                      <tr key={a.timestamp} className="hover:bg-slate-50/80 transition-colors">
                        <td className="py-2.5 px-5 font-mono text-xs font-medium text-slate-900 tabular-nums">
                          {a.label}
                        </td>
                        <td className="py-2.5 px-4 text-right font-mono text-xs font-semibold text-slate-900 tabular-nums">
                          {a.total_kwh.toFixed(2)}
                        </td>
                        <td className="py-2.5 px-4 text-right font-mono text-xs text-slate-600 tabular-nums">
                          {a.expected_kwh.toFixed(2)}
                        </td>
                        <td className="py-2.5 px-4 text-right font-mono text-xs font-medium text-amber-700 tabular-nums">
                          +{a.deviation_percent.toFixed(1)}%
                        </td>
                        <td className="py-2.5 px-4 text-right font-mono text-xs text-slate-700 tabular-nums">
                          {a.z_score.toFixed(2)}σ
                        </td>
                        <td className="py-2.5 px-4 text-xs text-slate-700">{a.dominant_consumer}</td>
                        <td className="py-2.5 px-5 text-xs font-medium">
                          <span
                            className={`inline-flex items-center gap-1 ${
                              a.severity === 'High' ? 'text-red-700' : 'text-amber-700'
                            }`}
                          >
                            <AlertTriangle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                            <span>{a.severity}</span>
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        </>
      )}
    </div>
  );
}
