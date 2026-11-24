import { useEffect, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Download, FileDown, FileText } from 'lucide-react';
import { api, triggerFileDownload } from '../api/client';
import type { ReportPayload } from '../types/smartMeter';
import { exportReportPdf } from '../utils/pdfReport';
import {
  AlertBanner,
  EmptyDatasetState,
  LoadingGrid,
  Panel,
  StatCard,
} from '../components/ui/Primitives';

const REPORT_TYPES = [
  { id: 'daily', label: 'Daily Report' },
  { id: 'weekly', label: 'Weekly Report' },
  { id: 'monthly', label: 'Monthly Report' },
  { id: 'forecast', label: 'Forecast Export' },
] as const;

export function ReportsView({
  refreshTick,
  onLoadSample,
}: {
  refreshTick: number;
  onLoadSample: () => Promise<void>;
}) {
  const [reportType, setReportType] = useState<'daily' | 'weekly' | 'monthly' | 'forecast'>('daily');
  const [consumerType, setConsumerType] = useState('All');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  const [report, setReport] = useState<ReportPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState<{ tone: 'success' | 'error' | 'info'; message: string } | null>(null);

  const generateReport = async (
    nextType = reportType,
    nextConsumer = consumerType,
    nextStart = startDate,
    nextEnd = endDate
  ) => {
    setLoading(true);
    setFeedback(null);
    try {
      const res = await api.getReport({
        type: nextType,
        consumer_type: nextConsumer,
        start_date: nextStart || undefined,
        end_date: nextEnd || undefined,
      });
      setReport(res);
    } catch (err) {
      setFeedback({
        tone: 'error',
        message: err instanceof Error ? err.message : 'Failed to generate report.',
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    generateReport();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshTick, reportType, consumerType]);

  const handleDownloadCsv = () => {
    const qs = new URLSearchParams({ type: reportType });
    if (consumerType !== 'All') qs.set('consumer_type', consumerType);
    if (startDate) qs.set('start_date', startDate);
    if (endDate) qs.set('end_date', endDate);
    triggerFileDownload(`/api/reports/export?${qs.toString()}`, `smart_meter_${reportType}_report.csv`);
    setFeedback({ tone: 'success', message: `Downloaded ${reportType} report in CSV format.` });
  };

  const handleDownloadPdf = () => {
    if (!report) return;
    try {
      exportReportPdf(report);
      setFeedback({ tone: 'success', message: `Generated and downloaded ${reportType} report as PDF.` });
    } catch (err) {
      setFeedback({
        tone: 'error',
        message: err instanceof Error ? err.message : 'Failed to generate PDF report.',
      });
    }
  };

  const hasRows =
    report &&
    (report.report_type === 'forecast' ? report.forecast_rows.length > 0 : report.rows.length > 0);

  return (
    <div className="space-y-6">
      {feedback && (
        <AlertBanner
          tone={feedback.tone}
          message={feedback.message}
          onDismiss={() => setFeedback(null)}
        />
      )}

      {/* Report Builder Controls */}
      <Panel
        title="Electricity Consumption & Forecast Report Builder"
        subtitle="Generate structured daily, weekly, monthly, or ARIMA forecast reports with charts and export to CSV or PDF"
      >
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="inline-flex flex-wrap items-center p-1 bg-slate-100 rounded-md self-start" role="group" aria-label="Report type">
            {REPORT_TYPES.map((rt) => (
              <button
                key={rt.id}
                type="button"
                onClick={() => setReportType(rt.id)}
                className={`px-3 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap ${
                  reportType === rt.id
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {rt.label}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2.5 text-xs">
            {reportType !== 'forecast' && (
              <>
                <select
                  aria-label="Filter report by consumer type"
                  value={consumerType}
                  onChange={(e) => setConsumerType(e.target.value)}
                  className="px-2.5 py-1.5 border border-slate-300 rounded-md bg-white text-slate-900"
                >
                  <option value="All">All Sectors</option>
                  <option value="Residential">Residential</option>
                  <option value="Commercial">Commercial</option>
                  <option value="Industrial">Industrial</option>
                </select>
                <input
                  type="date"
                  aria-label="Report start date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="px-2.5 py-1.5 border border-slate-300 rounded-md font-mono bg-white text-slate-900"
                />
                <input
                  type="date"
                  aria-label="Report end date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="px-2.5 py-1.5 border border-slate-300 rounded-md font-mono bg-white text-slate-900"
                />
              </>
            )}

            <button
              type="button"
              onClick={() => generateReport()}
              disabled={loading}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 font-medium text-white bg-blue-700 rounded-md hover:bg-blue-800 disabled:opacity-50 whitespace-nowrap"
            >
              <FileText className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Generate Report</span>
            </button>

            <button
              type="button"
              onClick={handleDownloadCsv}
              disabled={!hasRows}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 font-medium text-slate-800 bg-white border border-slate-300 rounded-md hover:bg-slate-50 disabled:opacity-40 whitespace-nowrap"
            >
              <Download className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Download CSV</span>
            </button>

            <button
              type="button"
              onClick={handleDownloadPdf}
              disabled={!hasRows}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 font-medium text-white bg-[#0B172A] rounded-md hover:bg-[#162A4A] disabled:opacity-40 whitespace-nowrap"
            >
              <FileDown className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Download PDF</span>
            </button>
          </div>
        </div>
      </Panel>

      {loading && !report ? (
        <LoadingGrid cards={4} />
      ) : !hasRows ? (
        <EmptyDatasetState
          title="No Records Available for This Report"
          description="Load the 35-day sample dataset or adjust date filters to generate consumption and forecast reports."
          onLoadSample={onLoadSample}
        />
      ) : (
        <>
          {/* Summary KPI Strip */}
          {report.report_type === 'forecast' ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <StatCard
                label="24h Forecast Total"
                value={report.forecast_rows
                  .reduce((acc, r) => acc + r.predicted_kwh, 0)
                  .toLocaleString(undefined, { maximumFractionDigits: 1 })}
                unit="kWh"
                detail={`${report.forecast_rows.length} hourly predictions`}
                emphasis="accent"
              />
              <StatCard
                label="Model MAE"
                value={report.forecast_metrics ? report.forecast_metrics.mae.toFixed(3) : '—'}
                unit="kWh"
                detail="Validation Mean Absolute Error"
              />
              <StatCard
                label="Model RMSE"
                value={report.forecast_metrics ? report.forecast_metrics.rmse.toFixed(3) : '—'}
                unit="kWh"
                detail="Validation Root Mean Squared Error"
              />
              <StatCard
                label="Model MAPE"
                value={report.forecast_metrics ? report.forecast_metrics.mape.toFixed(2) : '—'}
                unit="%"
                detail="Validation Mean Absolute % Error"
              />
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <StatCard
                label="Total Reported Consumption"
                value={report.summary.total_energy_kwh.toLocaleString(undefined, { maximumFractionDigits: 1 })}
                unit="kWh"
                detail={`${report.summary.total_records.toLocaleString()} records included`}
              />
              <StatCard
                label="Average Per Period"
                value={report.summary.average_period_kwh.toLocaleString(undefined, { maximumFractionDigits: 1 })}
                unit="kWh"
                detail={`Across ${report.rows.length} ${report.report_type} period(s)`}
              />
              <StatCard
                label="Peak Period Consumption"
                value={report.summary.peak_period_kwh.toLocaleString(undefined, { maximumFractionDigits: 1 })}
                unit="kWh"
                detail={`Peak period: ${report.summary.peak_period_label}`}
                emphasis="warning"
              />
              <StatCard
                label="Meters Covered"
                value={String(report.summary.total_meters)}
                unit="meters"
                detail={
                  report.date_range.start && report.date_range.end
                    ? `${report.date_range.start} to ${report.date_range.end}`
                    : undefined
                }
              />
            </div>
          )}

          {/* Embedded Report Chart */}
          <Panel
            title={
              report.report_type === 'forecast'
                ? 'Forecast Report Visualization'
                : `${report.report_type.charAt(0).toUpperCase() + report.report_type.slice(1)} Consumption Summary Chart`
            }
            subtitle={`Generated ${new Date(report.generated_at).toUTCString()}`}
          >
            <div className="h-[260px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                {report.report_type === 'forecast' ? (
                  <LineChart data={report.forecast_rows} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
                    <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#64748B' }} tickLine={false} minTickGap={20} />
                    <YAxis tick={{ fontSize: 11, fill: '#64748B' }} tickLine={false} axisLine={false} width={52} />
                    <Tooltip
                      contentStyle={{ backgroundColor: '#0B172A', border: 'none', borderRadius: '6px', color: '#FFFFFF', fontSize: '12px' }}
                    />
                    <Line type="monotone" dataKey="predicted_kwh" name="Predicted (kWh)" stroke="#1D4ED8" strokeWidth={2.2} dot={false} isAnimationActive={false} />
                  </LineChart>
                ) : (
                  <BarChart data={report.rows} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
                    <XAxis dataKey="period" tick={{ fontSize: 11, fill: '#64748B' }} tickLine={false} minTickGap={16} />
                    <YAxis tick={{ fontSize: 11, fill: '#64748B' }} tickLine={false} axisLine={false} width={54} />
                    <Tooltip
                      contentStyle={{ backgroundColor: '#0B172A', border: 'none', borderRadius: '6px', color: '#FFFFFF', fontSize: '12px' }}
                    />
                    <Bar dataKey="total_kwh" name="Total Consumption (kWh)" fill="#0B172A" radius={[4, 4, 0, 0]} isAnimationActive={false} />
                  </BarChart>
                )}
              </ResponsiveContainer>
            </div>
          </Panel>

          {/* Report Table */}
          <Panel
            title="Report Data Breakdown"
            subtitle="Complete tabular data included in CSV and PDF downloads"
          >
            <div className="overflow-x-auto -mx-5">
              {report.report_type === 'forecast' ? (
                <table className="w-full text-left border-collapse text-sm">
                  <thead>
                    <tr className="border-y border-slate-200 bg-slate-50/80 text-xs font-medium text-slate-500">
                      <th className="py-2.5 px-5">Timestamp (UTC)</th>
                      <th className="py-2.5 px-4 text-right">Predicted Load (kWh)</th>
                      <th className="py-2.5 px-4 text-right">Lower 95% CI (kWh)</th>
                      <th className="py-2.5 px-5 text-right">Upper 95% CI (kWh)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {report.forecast_rows.map((r) => (
                      <tr key={r.timestamp} className="hover:bg-slate-50/80">
                        <td className="py-2.5 px-5 font-mono text-xs text-slate-900 tabular-nums">
                          {r.timestamp.replace('T', ' ').replace('Z', '')}
                        </td>
                        <td className="py-2.5 px-4 text-right font-mono text-xs font-semibold text-blue-700 tabular-nums">
                          {r.predicted_kwh.toFixed(2)}
                        </td>
                        <td className="py-2.5 px-4 text-right font-mono text-xs text-slate-600 tabular-nums">
                          {r.lower_bound.toFixed(2)}
                        </td>
                        <td className="py-2.5 px-5 text-right font-mono text-xs text-slate-600 tabular-nums">
                          {r.upper_bound.toFixed(2)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <table className="w-full text-left border-collapse text-sm">
                  <thead>
                    <tr className="border-y border-slate-200 bg-slate-50/80 text-xs font-medium text-slate-500">
                      <th className="py-2.5 px-5">Period</th>
                      <th className="py-2.5 px-4 text-right">Total (kWh)</th>
                      <th className="py-2.5 px-4 text-right">Avg Hourly (kWh)</th>
                      <th className="py-2.5 px-4 text-right">Peak Hourly (kWh)</th>
                      <th className="py-2.5 px-4 text-right">Residential</th>
                      <th className="py-2.5 px-4 text-right">Commercial</th>
                      <th className="py-2.5 px-4 text-right">Industrial</th>
                      <th className="py-2.5 px-5 text-right">Records</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {report.rows.map((r) => (
                      <tr key={r.period} className="hover:bg-slate-50/80">
                        <td className="py-2.5 px-5 font-mono text-xs font-medium text-slate-900">{r.period}</td>
                        <td className="py-2.5 px-4 text-right font-mono text-xs font-semibold text-slate-900 tabular-nums">
                          {r.total_kwh.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                        </td>
                        <td className="py-2.5 px-4 text-right font-mono text-xs text-slate-600 tabular-nums">
                          {r.average_kwh.toFixed(2)}
                        </td>
                        <td className="py-2.5 px-4 text-right font-mono text-xs text-amber-700 tabular-nums">
                          {r.peak_kwh.toFixed(2)}
                        </td>
                        <td className="py-2.5 px-4 text-right font-mono text-xs text-slate-600 tabular-nums">
                          {r.residential_kwh.toFixed(1)}
                        </td>
                        <td className="py-2.5 px-4 text-right font-mono text-xs text-slate-600 tabular-nums">
                          {r.commercial_kwh.toFixed(1)}
                        </td>
                        <td className="py-2.5 px-4 text-right font-mono text-xs text-slate-600 tabular-nums">
                          {r.industrial_kwh.toFixed(1)}
                        </td>
                        <td className="py-2.5 px-5 text-right font-mono text-xs text-slate-500 tabular-nums">
                          {r.record_count.toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </Panel>
        </>
      )}
    </div>
  );
}
