import { useEffect, useState, type FormEvent } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Download, Play } from 'lucide-react';
import { api, triggerFileDownload } from '../api/client';
import type { ForecastResult } from '../types/smartMeter';
import {
  AlertBanner,
  EmptyDatasetState,
  LoadingGrid,
  Panel,
  StatCard,
} from '../components/ui/Primitives';

export function ForecastingView({
  refreshTick,
  defaultOrder,
  onLoadSample,
  onForecastTrained,
}: {
  refreshTick: number;
  defaultOrder: { p: number; d: number; q: number };
  onLoadSample: () => Promise<void>;
  onForecastTrained: () => void;
}) {
  const [result, setResult] = useState<ForecastResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [feedback, setFeedback] = useState<{ tone: 'success' | 'error' | 'info'; message: string } | null>(null);

  const [p, setP] = useState(defaultOrder.p);
  const [d, setD] = useState(defaultOrder.d);
  const [q, setQ] = useState(defaultOrder.q);
  const [horizon, setHorizon] = useState(24);
  const [consumerType, setConsumerType] = useState('All');

  useEffect(() => {
    setP(defaultOrder.p);
    setD(defaultOrder.d);
    setQ(defaultOrder.q);
  }, [defaultOrder.p, defaultOrder.d, defaultOrder.q]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .getForecast()
      .then((res) => {
        if (!cancelled) setResult(res);
      })
      .catch((err) => {
        if (!cancelled) {
          setFeedback({
            tone: 'error',
            message: err instanceof Error ? err.message : 'Failed to fetch forecast status.',
          });
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [refreshTick]);

  const handleRunForecast = async (e: FormEvent) => {
    e.preventDefault();
    setRunning(true);
    setFeedback(null);
    try {
      const res = await api.runForecast({ p, d, q, horizon, consumer_type: consumerType });
      setResult(res);
      if (res.status === 'trained') {
        setFeedback({
          tone: 'success',
          message: `Trained ${res.model_name} on ${res.training_samples} hourly intervals (MAPE: ${res.metrics?.mape.toFixed(2)}%, next hour: ${res.next_hour_forecast_kwh?.toFixed(2)} kWh).`,
        });
        onForecastTrained();
      } else {
        setFeedback({
          tone: 'info',
          message: res.message || 'Insufficient historical data to train ARIMA.',
        });
      }
    } catch (err) {
      setFeedback({
        tone: 'error',
        message: err instanceof Error ? err.message : 'ARIMA training failed.',
      });
    } finally {
      setRunning(false);
    }
  };

  if (loading && !result) return <LoadingGrid cards={4} />;

  return (
    <div className="space-y-6">
      {feedback && (
        <AlertBanner
          tone={feedback.tone}
          message={feedback.message}
          onDismiss={() => setFeedback(null)}
        />
      )}

      {/* ARIMA Model Training Controls */}
      <Panel
        title="ARIMA Short-Term Load Forecasting Engine"
        subtitle="Configure ARIMA(p, d, q) hyperparameters, handle missing hourly timestamps via interpolation, and train on loaded historical data"
      >
        <form onSubmit={handleRunForecast} className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4 items-end">
          <div>
            <label htmlFor="arima-p" className="block text-xs font-medium text-slate-700 mb-1.5">
              AR Order (p)
            </label>
            <input
              id="arima-p"
              type="number"
              min={1}
              max={12}
              value={p}
              onChange={(e) => setP(Number(e.target.value))}
              className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-md bg-white text-slate-900"
            />
          </div>
          <div>
            <label htmlFor="arima-d" className="block text-xs font-medium text-slate-700 mb-1.5">
              Differencing (d)
            </label>
            <input
              id="arima-d"
              type="number"
              min={0}
              max={2}
              value={d}
              onChange={(e) => setD(Number(e.target.value))}
              className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-md bg-white text-slate-900"
            />
          </div>
          <div>
            <label htmlFor="arima-q" className="block text-xs font-medium text-slate-700 mb-1.5">
              MA Order (q)
            </label>
            <input
              id="arima-q"
              type="number"
              min={0}
              max={4}
              value={q}
              onChange={(e) => setQ(Number(e.target.value))}
              className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-md bg-white text-slate-900"
            />
          </div>
          <div>
            <label htmlFor="arima-horizon" className="block text-xs font-medium text-slate-700 mb-1.5">
              Horizon (Hours)
            </label>
            <select
              id="arima-horizon"
              value={horizon}
              onChange={(e) => setHorizon(Number(e.target.value))}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md bg-white text-slate-900"
            >
              <option value={12}>Next 12 Hours</option>
              <option value={24}>Next 24 Hours</option>
              <option value={48}>Next 48 Hours</option>
            </select>
          </div>
          <div>
            <label htmlFor="arima-sector" className="block text-xs font-medium text-slate-700 mb-1.5">
              Consumer Scope
            </label>
            <select
              id="arima-sector"
              value={consumerType}
              onChange={(e) => setConsumerType(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md bg-white text-slate-900"
            >
              <option value="All">All Sectors (Grid)</option>
              <option value="Residential">Residential</option>
              <option value="Commercial">Commercial</option>
              <option value="Industrial">Industrial</option>
            </select>
          </div>
          <button
            type="submit"
            disabled={running}
            className="inline-flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-700 rounded-md hover:bg-blue-800 disabled:opacity-50 transition-colors whitespace-nowrap"
          >
            <Play className="w-4 h-4" aria-hidden="true" />
            <span>{running ? 'Training...' : 'Run Forecasting'}</span>
          </button>
        </form>
      </Panel>

      {!result || result.status !== 'trained' ? (
        <EmptyDatasetState
          title="Insufficient Historical Data for ARIMA Forecasting"
          description={
            result?.message ||
            'At least 48 consecutive hourly smart meter readings are required to fit the ARIMA time-series model and evaluate validation accuracy.'
          }
          onLoadSample={onLoadSample}
        />
      ) : (
        <>
          {/* Forecast Summary + Model Evaluation Metric Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard
              label="Next Hour Prediction"
              value={result.next_hour_forecast_kwh?.toFixed(2) ?? '—'}
              unit="kWh"
              detail={result.next_24h_forecast[0]?.label ? `For ${result.next_24h_forecast[0].label} UTC` : undefined}
              emphasis="accent"
            />
            <StatCard
              label={`Next ${result.next_24h_forecast.length}h Total Forecast`}
              value={result.next_24h_total_kwh?.toLocaleString(undefined, { maximumFractionDigits: 1 }) ?? '—'}
              unit="kWh"
              detail={`Peak forecast ${result.next_24h_peak_kwh?.toFixed(2) ?? '—'} kWh`}
            />
            <StatCard
              label="Training & Validation Split"
              value={`${result.training_samples} / ${result.validation_samples}`}
              unit="hours"
              detail={`${result.missing_hours_interpolated} missing hour(s) interpolated`}
            />
            <StatCard
              label="Active Model"
              value={`(${result.order.p},${result.order.d},${result.order.q})`}
              unit="ARIMA"
              detail={result.trained_at ? `Trained ${result.trained_at.slice(11, 19)} UTC` : undefined}
            />
          </div>

          {/* Model Evaluation Cards: MAE, RMSE, MAPE */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <StatCard
              label="Mean Absolute Error (MAE)"
              value={result.metrics ? result.metrics.mae.toFixed(3) : '—'}
              unit="kWh"
              detail="Holdout validation average absolute deviation"
            />
            <StatCard
              label="Root Mean Squared Error (RMSE)"
              value={result.metrics ? result.metrics.rmse.toFixed(3) : '—'}
              unit="kWh"
              detail="Penalizes large peak-hour forecasting errors"
            />
            <StatCard
              label="Mean Absolute Percentage Error (MAPE)"
              value={result.metrics ? result.metrics.mape.toFixed(2) : '—'}
              unit="%"
              detail="Relative forecast accuracy on 20% holdout split"
              emphasis="accent"
            />
          </div>

          {/* Graph 1: Actual vs Predicted Electricity Consumption */}
          <Panel
            title="1. Actual vs Predicted Electricity Consumption"
            subtitle={`Rolling one-step-ahead ARIMA(${result.order.p},${result.order.d},${result.order.q}) validation across recent ${result.actual_vs_predicted.length} holdout hours`}
          >
            <div className="h-[290px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={result.actual_vs_predicted} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 11, fill: '#64748B' }}
                    tickLine={false}
                    axisLine={{ stroke: '#E2E8F0' }}
                    minTickGap={26}
                  />
                  <YAxis tick={{ fontSize: 11, fill: '#64748B' }} tickLine={false} axisLine={false} width={52} />
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
                    name="Actual Load (kWh)"
                    stroke="#0B172A"
                    strokeWidth={2.2}
                    dot={false}
                    isAnimationActive={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="predicted_kwh"
                    name="ARIMA Predicted (kWh)"
                    stroke="#0D9488"
                    strokeWidth={2.2}
                    strokeDasharray="5 3"
                    dot={false}
                    isAnimationActive={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </Panel>

          {/* Graph 2 & Graph 3 */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Panel
              title={`2. Next ${result.next_24h_forecast.length} Hours Forecast`}
              subtitle="Multi-step ARIMA prediction with 95% confidence interval"
              action={
                <button
                  type="button"
                  onClick={() =>
                    triggerFileDownload('/api/reports/export?type=forecast', 'smart_meter_forecast_24h.csv')
                  }
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-700 hover:text-blue-900 whitespace-nowrap"
                >
                  <Download className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Export CSV</span>
                </button>
              }
            >
              <div className="h-[280px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart
                    data={result.next_24h_forecast.map((pt) => ({
                      ...pt,
                      ci_spread: Math.max(0, Number((pt.upper_bound - pt.lower_bound).toFixed(2))),
                    }))}
                    margin={{ top: 8, right: 12, left: 0, bottom: 0 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
                    <XAxis
                      dataKey="label"
                      tick={{ fontSize: 11, fill: '#64748B' }}
                      tickLine={false}
                      axisLine={{ stroke: '#E2E8F0' }}
                      minTickGap={22}
                    />
                    <YAxis tick={{ fontSize: 11, fill: '#64748B' }} tickLine={false} axisLine={false} width={52} />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: '#0B172A',
                        border: 'none',
                        borderRadius: '6px',
                        color: '#FFFFFF',
                        fontSize: '12px',
                      }}
                      formatter={(val, name, item) => {
                        if (name === 'ci_base') return null;
                        if (name === '95% Confidence Band') {
                          const p = item?.payload as { lower_bound?: number; upper_bound?: number } | undefined;
                          return [`${p?.lower_bound ?? 0} – ${p?.upper_bound ?? 0} kWh`, '95% CI Range'];
                        }
                        return [`${Number(val ?? 0).toFixed(2)} kWh`, String(name ?? '')];
                      }}
                    />
                    <Legend
                      wrapperStyle={{ fontSize: '12px' }}
                      formatter={(val) => (val === 'ci_base' ? '' : val)}
                    />
                    <Area
                      type="monotone"
                      dataKey="lower_bound"
                      name="ci_base"
                      stackId="ci"
                      stroke="none"
                      fill="transparent"
                      legendType="none"
                      isAnimationActive={false}
                    />
                    <Area
                      type="monotone"
                      dataKey="ci_spread"
                      name="95% Confidence Band"
                      stackId="ci"
                      stroke="none"
                      fill="#1D4ED8"
                      fillOpacity={0.16}
                      isAnimationActive={false}
                    />
                    <Line
                      type="monotone"
                      dataKey="predicted_kwh"
                      name="Predicted Load (kWh)"
                      stroke="#1D4ED8"
                      strokeWidth={2.5}
                      dot={{ r: 2.5 }}
                      isAnimationActive={false}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </Panel>

            <Panel
              title="3. Historical Consumption Trend"
              subtitle="Recent 7 days (168 hours) continuous hourly grid load used for training"
            >
              <div className="h-[280px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={result.historical_trend} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="histTrendFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#0B172A" stopOpacity={0.2} />
                        <stop offset="95%" stopColor="#0B172A" stopOpacity={0.0} />
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
                    <YAxis tick={{ fontSize: 11, fill: '#64748B' }} tickLine={false} axisLine={false} width={52} />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: '#0B172A',
                        border: 'none',
                        borderRadius: '6px',
                        color: '#FFFFFF',
                        fontSize: '12px',
                      }}
                      formatter={(val) => [`${Number(val ?? 0).toFixed(2)} kWh`, 'Historical Load']}
                    />
                    <Area
                      type="monotone"
                      dataKey="actual_kwh"
                      stroke="#0B172A"
                      strokeWidth={2}
                      fill="url(#histTrendFill)"
                      isAnimationActive={false}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </Panel>
          </div>

          {/* Forecast Table */}
          <Panel
            title="Hourly Forecast Schedule"
            subtitle="Detailed predicted electricity consumption (kWh) and 95% prediction intervals"
          >
            <div className="overflow-x-auto -mx-5">
              <table className="w-full text-left border-collapse text-sm">
                <thead>
                  <tr className="border-y border-slate-200 bg-slate-50/80 text-xs font-medium text-slate-500">
                    <th className="py-2.5 px-5">Horizon</th>
                    <th className="py-2.5 px-4">Timestamp (UTC)</th>
                    <th className="py-2.5 px-4 text-right">Predicted Load (kWh)</th>
                    <th className="py-2.5 px-4 text-right">Lower 95% CI (kWh)</th>
                    <th className="py-2.5 px-5 text-right">Upper 95% CI (kWh)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {result.next_24h_forecast.map((pt, idx) => (
                    <tr key={pt.timestamp} className="hover:bg-slate-50/80">
                      <td className="py-2.5 px-5 font-mono text-xs text-slate-500">+{idx + 1}h</td>
                      <td className="py-2.5 px-4 font-mono text-xs text-slate-900 tabular-nums">
                        {pt.timestamp.replace('T', ' ').replace('Z', '')}
                      </td>
                      <td className="py-2.5 px-4 text-right font-mono text-xs font-semibold text-blue-700 tabular-nums">
                        {pt.predicted_kwh.toFixed(2)}
                      </td>
                      <td className="py-2.5 px-4 text-right font-mono text-xs text-slate-600 tabular-nums">
                        {pt.lower_bound.toFixed(2)}
                      </td>
                      <td className="py-2.5 px-5 text-right font-mono text-xs text-slate-600 tabular-nums">
                        {pt.upper_bound.toFixed(2)}
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
