import { useEffect, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { api } from '../api/client';
import type { AnalyticsPayload } from '../types/smartMeter';
import {
  AlertBanner,
  EmptyDatasetState,
  LoadingGrid,
  Panel,
  StatCard,
} from '../components/ui/Primitives';

const SECTOR_COLORS: Record<string, string> = {
  Residential: '#0284C7',
  Commercial: '#0D9488',
  Industrial: '#0B172A',
};

const CONSUMER_OPTIONS = ['All', 'Residential', 'Commercial', 'Industrial'] as const;

export function AnalyticsView({
  refreshTick,
  onLoadSample,
}: {
  refreshTick: number;
  onLoadSample: () => Promise<void>;
}) {
  const [data, setData] = useState<AnalyticsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [consumerType, setConsumerType] = useState<string>('All');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [periodChartMode, setPeriodChartMode] = useState<'monthly' | 'weekly'>('monthly');
  const [hourlyView, setHourlyView] = useState<'aggregate' | 'by_sector'>('aggregate');

  const fetchAnalytics = async (overrides?: {
    start?: string;
    end?: string;
    consumer?: string;
  }) => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getAnalytics({
        start_date: (overrides?.start ?? startDate) || undefined,
        end_date: (overrides?.end ?? endDate) || undefined,
        consumer_type: overrides?.consumer ?? consumerType,
      });
      setData(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to calculate analytics.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAnalytics();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshTick, consumerType]);

  const handleApplyDateFilter = () => {
    fetchAnalytics();
  };

  const handleResetFilters = () => {
    setStartDate('');
    setEndDate('');
    setConsumerType('All');
    fetchAnalytics({ start: '', end: '', consumer: 'All' });
  };

  if (loading && !data) return <LoadingGrid cards={4} />;
  if (error) return <AlertBanner tone="error" message={error} />;
  if (!data) return null;

  const isEmpty = data.summary.total_records === 0;
  const pieData = data.consumer_breakdown.filter((c) => c.total_kwh > 0);

  return (
    <div className="space-y-6">
      {/* Filter Bar */}
      <div className="bg-white border border-slate-200 rounded-lg p-4 flex flex-wrap items-center justify-between gap-4">
        <div className="inline-flex items-center p-1 bg-slate-100 rounded-md" role="group" aria-label="Consumer category filter">
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

        <div className="flex flex-wrap items-center gap-2.5 text-xs">
          <label htmlFor="analytics-start" className="text-slate-600">
            From
          </label>
          <input
            id="analytics-start"
            type="date"
            value={startDate}
            min={data.available_date_range.start ?? undefined}
            max={data.available_date_range.end ?? undefined}
            onChange={(e) => setStartDate(e.target.value)}
            className="px-2.5 py-1.5 border border-slate-300 rounded-md font-mono text-slate-900 bg-white"
          />
          <label htmlFor="analytics-end" className="text-slate-600">
            To
          </label>
          <input
            id="analytics-end"
            type="date"
            value={endDate}
            min={data.available_date_range.start ?? undefined}
            max={data.available_date_range.end ?? undefined}
            onChange={(e) => setEndDate(e.target.value)}
            className="px-2.5 py-1.5 border border-slate-300 rounded-md font-mono text-slate-900 bg-white"
          />
          <button
            type="button"
            onClick={handleApplyDateFilter}
            className="px-3.5 py-1.5 font-medium text-white bg-blue-700 rounded-md hover:bg-blue-800 whitespace-nowrap"
          >
            Apply Date Filter
          </button>
          <button
            type="button"
            onClick={handleResetFilters}
            className="px-3 py-1.5 font-medium text-slate-600 hover:text-slate-900 whitespace-nowrap"
          >
            Reset
          </button>
        </div>
      </div>

      {/* Summary KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        <StatCard
          label="Total Consumption"
          value={data.summary.total_energy_kwh.toLocaleString(undefined, { maximumFractionDigits: 1 })}
          unit="kWh"
          detail={`${data.summary.total_records.toLocaleString()} records analyzed`}
        />
        <StatCard
          label="Average Hourly Load"
          value={data.summary.average_hourly_kwh.toLocaleString(undefined, { maximumFractionDigits: 2 })}
          unit="kWh/h"
          detail="Aggregate grid average per hour"
        />
        <StatCard
          label="Average Daily Usage"
          value={data.summary.average_daily_kwh.toLocaleString(undefined, { maximumFractionDigits: 1 })}
          unit="kWh/day"
          detail={`${data.daily_consumption.length} calendar day(s)`}
        />
        <StatCard
          label="Average Meter Reading"
          value={data.summary.average_reading_kwh.toLocaleString(undefined, { maximumFractionDigits: 2 })}
          unit="kWh"
          detail="Mean per individual meter-hour"
        />
        <StatCard
          label="Active Smart Meters"
          value={String(data.summary.active_meters)}
          unit="meters"
          detail={`Scope: ${data.filters.consumer_type}`}
        />
      </div>

      {isEmpty ? (
        <EmptyDatasetState
          title="No Data Matches Current Filters"
          description="Clear the active date/consumer filters or load the 35-day sample dataset to view consumption patterns."
          onLoadSample={onLoadSample}
        />
      ) : (
        <>
          {/* Chart 1: Hourly Consumption Line Chart + Chart 5: Usage Distribution Pie Chart */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <Panel
              title="Hourly Electricity Usage Profile"
              subtitle="Mean hourly consumption across 24-hour diurnal cycle (UTC)"
              className="lg:col-span-8"
              action={
                <div className="inline-flex items-center p-0.5 bg-slate-100 rounded-md">
                  <button
                    type="button"
                    onClick={() => setHourlyView('aggregate')}
                    className={`px-2.5 py-1 text-xs font-medium rounded whitespace-nowrap ${
                      hourlyView === 'aggregate' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
                    }`}
                  >
                    Aggregate
                  </button>
                  <button
                    type="button"
                    onClick={() => setHourlyView('by_sector')}
                    className={`px-2.5 py-1 text-xs font-medium rounded whitespace-nowrap ${
                      hourlyView === 'by_sector' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
                    }`}
                  >
                    By Sector
                  </button>
                </div>
              }
            >
              <div className="h-[290px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={data.hourly_profile} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
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
                    />
                    <Legend wrapperStyle={{ fontSize: '12px' }} />
                    {hourlyView === 'aggregate' ? (
                      <Line
                        type="monotone"
                        dataKey="average_kwh"
                        name="Mean Hourly Grid Load (kWh)"
                        stroke="#1D4ED8"
                        strokeWidth={2.5}
                        dot={{ r: 2.5 }}
                        isAnimationActive={false}
                      />
                    ) : (
                      <>
                        <Line type="monotone" dataKey="industrial_kwh" name="Industrial" stroke="#0B172A" strokeWidth={2} dot={false} isAnimationActive={false} />
                        <Line type="monotone" dataKey="commercial_kwh" name="Commercial" stroke="#0D9488" strokeWidth={2} dot={false} isAnimationActive={false} />
                        <Line type="monotone" dataKey="residential_kwh" name="Residential" stroke="#0284C7" strokeWidth={2} dot={false} isAnimationActive={false} />
                      </>
                    )}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </Panel>

            <Panel
              title="Electricity Usage Distribution"
              subtitle="Percentage share across consumer categories"
              className="lg:col-span-4"
            >
              <div className="h-[210px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={pieData}
                      dataKey="total_kwh"
                      nameKey="consumer_type"
                      cx="50%"
                      cy="50%"
                      innerRadius={52}
                      outerRadius={82}
                      paddingAngle={2}
                      isAnimationActive={false}
                    >
                      {pieData.map((entry) => (
                        <Cell key={entry.consumer_type} fill={SECTOR_COLORS[entry.consumer_type] ?? '#334155'} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{
                        backgroundColor: '#0B172A',
                        border: 'none',
                        borderRadius: '6px',
                        color: '#FFFFFF',
                        fontSize: '12px',
                      }}
                      formatter={(val) => [`${Number(val ?? 0).toLocaleString()} kWh`, 'Total']}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="mt-3 space-y-2 border-t border-slate-100 pt-3 text-xs">
                {data.consumer_breakdown.map((row) => (
                  <div key={row.consumer_type} className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span
                        className="w-2.5 h-2.5 rounded-xs shrink-0"
                        style={{ backgroundColor: SECTOR_COLORS[row.consumer_type] }}
                        aria-hidden="true"
                      />
                      <span className="text-slate-700 font-medium">{row.consumer_type}</span>
                    </div>
                    <span className="font-mono text-slate-900 tabular-nums">
                      {row.share_percent.toFixed(1)}% · {row.total_kwh.toLocaleString()} kWh
                    </span>
                  </div>
                ))}
              </div>
            </Panel>
          </div>

          {/* Chart 2: Daily Consumption Bar Chart */}
          <Panel
            title="Daily Electricity Consumption"
            subtitle="Stacked daily consumption across Residential, Commercial, and Industrial meters (kWh)"
          >
            <div className="h-[290px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.daily_consumption} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 11, fill: '#64748B' }}
                    tickLine={false}
                    axisLine={{ stroke: '#E2E8F0' }}
                    minTickGap={16}
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
                  />
                  <Legend wrapperStyle={{ fontSize: '12px' }} />
                  <Bar dataKey="industrial_kwh" name="Industrial" stackId="a" fill="#0B172A" isAnimationActive={false} />
                  <Bar dataKey="commercial_kwh" name="Commercial" stackId="a" fill="#0D9488" isAnimationActive={false} />
                  <Bar dataKey="residential_kwh" name="Residential" stackId="a" fill="#0284C7" radius={[3, 3, 0, 0]} isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Panel>

          {/* Chart 3: Monthly / Weekly Chart + Chart 4: Consumer Category Comparison */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Panel
              title={periodChartMode === 'monthly' ? 'Monthly Electricity Consumption' : 'Weekly Electricity Consumption'}
              subtitle={
                periodChartMode === 'monthly'
                  ? 'Total consumption grouped by calendar month (kWh)'
                  : 'Total consumption grouped by ISO week (kWh)'
              }
              action={
                <div className="inline-flex items-center p-0.5 bg-slate-100 rounded-md">
                  <button
                    type="button"
                    onClick={() => setPeriodChartMode('monthly')}
                    className={`px-2.5 py-1 text-xs font-medium rounded whitespace-nowrap ${
                      periodChartMode === 'monthly' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
                    }`}
                  >
                    Monthly
                  </button>
                  <button
                    type="button"
                    onClick={() => setPeriodChartMode('weekly')}
                    className={`px-2.5 py-1 text-xs font-medium rounded whitespace-nowrap ${
                      periodChartMode === 'weekly' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
                    }`}
                  >
                    Weekly
                  </button>
                </div>
              }
            >
              <div className="h-[270px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  {periodChartMode === 'monthly' ? (
                    <BarChart data={data.monthly_consumption} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
                      <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#64748B' }} tickLine={false} axisLine={{ stroke: '#E2E8F0' }} />
                      <YAxis
                        tick={{ fontSize: 11, fill: '#64748B' }}
                        tickLine={false}
                        axisLine={false}
                        width={48}
                        tickFormatter={(v: number) => (v >= 1000 ? `${Math.round(v / 1000)}k` : String(v))}
                      />
                      <Tooltip
                        contentStyle={{ backgroundColor: '#0B172A', border: 'none', borderRadius: '6px', color: '#FFFFFF', fontSize: '12px' }}
                      />
                      <Legend wrapperStyle={{ fontSize: '12px' }} />
                      <Bar dataKey="industrial_kwh" name="Industrial" fill="#0B172A" radius={[3, 3, 0, 0]} isAnimationActive={false} />
                      <Bar dataKey="commercial_kwh" name="Commercial" fill="#0D9488" radius={[3, 3, 0, 0]} isAnimationActive={false} />
                      <Bar dataKey="residential_kwh" name="Residential" fill="#0284C7" radius={[3, 3, 0, 0]} isAnimationActive={false} />
                    </BarChart>
                  ) : (
                    <BarChart data={data.weekly_consumption} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
                      <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#64748B' }} tickLine={false} axisLine={{ stroke: '#E2E8F0' }} />
                      <YAxis
                        tick={{ fontSize: 11, fill: '#64748B' }}
                        tickLine={false}
                        axisLine={false}
                        width={48}
                        tickFormatter={(v: number) => (v >= 1000 ? `${Math.round(v / 1000)}k` : String(v))}
                      />
                      <Tooltip
                        contentStyle={{ backgroundColor: '#0B172A', border: 'none', borderRadius: '6px', color: '#FFFFFF', fontSize: '12px' }}
                        formatter={(val) => [`${Number(val ?? 0).toLocaleString()} kWh`, 'Weekly Total']}
                      />
                      <Bar dataKey="total_kwh" name="Weekly Total (kWh)" fill="#1D4ED8" radius={[4, 4, 0, 0]} isAnimationActive={false} />
                    </BarChart>
                  )}
                </ResponsiveContainer>
              </div>
            </Panel>

            <Panel
              title="Consumer Sector Comparison"
              subtitle="Total, mean meter-hour, peak reading, and average power factor by sector"
            >
              <div className="overflow-x-auto -mx-5">
                <table className="w-full text-left border-collapse text-sm">
                  <thead>
                    <tr className="border-y border-slate-200 bg-slate-50/80 text-xs font-medium text-slate-500">
                      <th className="py-2.5 px-5">Sector</th>
                      <th className="py-2.5 px-3 text-right">Meters</th>
                      <th className="py-2.5 px-3 text-right">Total (kWh)</th>
                      <th className="py-2.5 px-3 text-right">Avg (kWh)</th>
                      <th className="py-2.5 px-3 text-right">Peak (kWh)</th>
                      <th className="py-2.5 px-5 text-right">Avg PF</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {data.consumer_breakdown.map((c) => (
                      <tr key={c.consumer_type} className="hover:bg-slate-50/80">
                        <td className="py-3 px-5 font-medium text-slate-900">{c.consumer_type}</td>
                        <td className="py-3 px-3 text-right font-mono text-xs text-slate-600 tabular-nums">
                          {c.meter_count}
                        </td>
                        <td className="py-3 px-3 text-right font-mono text-xs font-semibold text-slate-900 tabular-nums">
                          {c.total_kwh.toLocaleString()}
                        </td>
                        <td className="py-3 px-3 text-right font-mono text-xs text-slate-700 tabular-nums">
                          {c.average_kwh.toFixed(2)}
                        </td>
                        <td className="py-3 px-3 text-right font-mono text-xs text-slate-700 tabular-nums">
                          {c.peak_kwh.toFixed(2)}
                        </td>
                        <td className="py-3 px-5 text-right font-mono text-xs text-slate-700 tabular-nums">
                          {c.avg_power_factor.toFixed(3)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mt-4 pt-3 border-t border-slate-100 text-xs text-slate-500 leading-relaxed">
                Industrial meters exhibit steady three-shift baseload demand with lower power factor, Commercial facilities peak during 10:00–17:00 business hours, and Residential load peaks during 18:00–21:00 evening occupancy.
              </div>
            </Panel>
          </div>
        </>
      )}
    </div>
  );
}
