import type { ReactNode } from 'react';
import { AlertCircle, CheckCircle2, Info, Database } from 'lucide-react';

export function StatCard({
  label,
  value,
  unit,
  detail,
  emphasis = 'default',
}: {
  label: string;
  value: string;
  unit?: string;
  detail?: string;
  emphasis?: 'default' | 'accent' | 'warning';
}) {
  const valueTone =
    emphasis === 'accent'
      ? 'text-blue-700'
      : emphasis === 'warning'
        ? 'text-amber-700'
        : 'text-slate-900';

  return (
    <div className="bg-white border border-slate-200 rounded-lg p-5 flex flex-col justify-between min-h-[116px]">
      <div className="text-xs font-medium text-slate-500">{label}</div>
      <div className="mt-2 flex items-baseline gap-1.5">
        <span className={`text-2xl font-semibold tracking-tight font-mono tabular-nums ${valueTone}`}>
          {value}
        </span>
        {unit && <span className="text-xs font-medium text-slate-500">{unit}</span>}
      </div>
      {detail && <div className="mt-2 text-xs text-slate-500 leading-snug">{detail}</div>}
    </div>
  );
}

export function Panel({
  title,
  subtitle,
  action,
  children,
  className = '',
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`bg-white border border-slate-200 rounded-lg ${className}`}>
      <div className="px-5 py-4 border-b border-slate-100 flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
          {subtitle && <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>}
        </div>
        {action && <div className="flex items-center gap-2 shrink-0">{action}</div>}
      </div>
      <div className="p-5">{children}</div>
    </section>
  );
}

export function AlertBanner({
  tone,
  message,
  onDismiss,
}: {
  tone: 'success' | 'error' | 'info';
  message: string;
  onDismiss?: () => void;
}) {
  const styles = {
    success: 'bg-emerald-50 border-emerald-200 text-emerald-900',
    error: 'bg-red-50 border-red-200 text-red-900',
    info: 'bg-blue-50 border-blue-200 text-blue-900',
  }[tone];

  const Icon = tone === 'success' ? CheckCircle2 : tone === 'error' ? AlertCircle : Info;
  const iconColor =
    tone === 'success' ? 'text-emerald-600' : tone === 'error' ? 'text-red-600' : 'text-blue-600';

  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={`border rounded-lg px-4 py-3 flex items-start justify-between gap-3 text-sm ${styles}`}
    >
      <div className="flex items-start gap-2.5 min-w-0">
        <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${iconColor}`} aria-hidden="true" />
        <p className="leading-snug">{message}</p>
      </div>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          className="text-xs font-medium underline underline-offset-2 shrink-0 hover:opacity-75 focus-visible:outline-2 focus-visible:outline-blue-700"
        >
          Dismiss
        </button>
      )}
    </div>
  );
}

export function EmptyDatasetState({
  title,
  description,
  onLoadSample,
  loading,
}: {
  title: string;
  description: string;
  onLoadSample?: () => void;
  loading?: boolean;
}) {
  return (
    <div className="bg-white border border-slate-200 rounded-lg px-6 py-12 text-center">
      <div className="w-10 h-10 rounded-lg bg-slate-100 text-slate-600 flex items-center justify-center mx-auto mb-3">
        <Database className="w-5 h-5" aria-hidden="true" />
      </div>
      <h3 className="text-base font-semibold text-slate-900">{title}</h3>
      <p className="text-sm text-slate-600 max-w-md mx-auto mt-1.5 leading-relaxed">{description}</p>
      {onLoadSample && (
        <button
          type="button"
          disabled={loading}
          onClick={onLoadSample}
          className="mt-5 inline-flex items-center justify-center px-4 py-2 text-sm font-medium text-white bg-blue-700 rounded-md hover:bg-blue-800 disabled:opacity-60 transition-colors whitespace-nowrap"
        >
          {loading ? 'Loading Sample Data...' : 'Load 35-Day Sample Dataset'}
        </button>
      )}
    </div>
  );
}

export function LoadingGrid({ cards = 4 }: { cards?: number }) {
  return (
    <div className="space-y-6 animate-pulse" aria-label="Loading data">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {Array.from({ length: cards }).map((_, idx) => (
          <div key={idx} className="bg-white border border-slate-200 rounded-lg p-5 h-[116px]">
            <div className="h-3 w-24 bg-slate-200 rounded" />
            <div className="h-7 w-32 bg-slate-200 rounded mt-4" />
            <div className="h-2.5 w-28 bg-slate-100 rounded mt-3" />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white border border-slate-200 rounded-lg h-72" />
        <div className="bg-white border border-slate-200 rounded-lg h-72" />
      </div>
    </div>
  );
}
