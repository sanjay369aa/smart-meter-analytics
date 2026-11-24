import { useState, type ReactNode } from 'react';
import {
  Activity,
  BarChart3,
  Cloud,
  Database,
  FileSpreadsheet,
  LayoutDashboard,
  Menu,
  RefreshCw,
  Settings,
  TrendingUp,
  X,
  Zap,
} from 'lucide-react';
import type { NavPage } from '../types/smartMeter';

interface NavItem {
  id: NavPage;
  label: string;
  module: string;
  icon: typeof LayoutDashboard;
}

export const NAV_ITEMS: NavItem[] = [
  { id: 'dashboard', label: 'Dashboard', module: 'Overview', icon: LayoutDashboard },
  { id: 'meters', label: 'Smart Meter Data', module: 'Module 1', icon: Database },
  { id: 'storage', label: 'Cloud Storage', module: 'Module 1', icon: Cloud },
  { id: 'analytics', label: 'Consumption Analytics', module: 'Module 2', icon: BarChart3 },
  { id: 'peak-load', label: 'Peak Load Detection', module: 'Module 2', icon: Activity },
  { id: 'forecasting', label: 'Load Forecasting', module: 'Module 3', icon: TrendingUp },
  { id: 'reports', label: 'Reports', module: 'Export', icon: FileSpreadsheet },
  { id: 'settings', label: 'Settings', module: 'System', icon: Settings },
];

export function Layout({
  activePage,
  onNavigate,
  onRefresh,
  onLoadSample,
  refreshing,
  children,
}: {
  activePage: NavPage;
  onNavigate: (page: NavPage) => void;
  onRefresh: () => void;
  onLoadSample: () => void;
  refreshing: boolean;
  children: ReactNode;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const currentNav = NAV_ITEMS.find((n) => n.id === activePage) ?? NAV_ITEMS[0];

  const handleSelect = (page: NavPage) => {
    onNavigate(page);
    setMobileOpen(false);
  };

  return (
    <div className="min-h-screen flex bg-slate-50 text-slate-900">
      {/* Mobile backdrop */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-slate-950/50 lg:hidden"
          onClick={() => setMobileOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Dark Navy Sidebar */}
      <aside
        aria-label="Primary navigation"
        className={`fixed inset-y-0 left-0 z-50 w-[260px] bg-[#0B172A] text-white flex flex-col border-r border-slate-800/80 transition-transform duration-200 ease-out lg:sticky lg:top-0 lg:h-screen lg:shrink-0 lg:translate-x-0 ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="h-16 px-5 flex items-center justify-between border-b border-white/10 shrink-0">
          <button
            type="button"
            onClick={() => handleSelect('dashboard')}
            className="flex items-center gap-2.5 text-left focus-visible:outline-2 focus-visible:outline-blue-400 rounded"
          >
            <span className="w-8 h-8 rounded-md bg-blue-600 flex items-center justify-center shrink-0">
              <Zap className="w-4 h-4 text-white" aria-hidden="true" />
            </span>
            <span className="text-[15px] font-semibold tracking-tight text-white whitespace-nowrap">
              Smart Meter Analytics
            </span>
          </button>
          <button
            type="button"
            onClick={() => setMobileOpen(false)}
            aria-label="Close navigation menu"
            className="lg:hidden p-1.5 text-slate-400 hover:text-white rounded"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = item.id === activePage;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => handleSelect(item.id)}
                aria-current={isActive ? 'page' : undefined}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors text-left whitespace-nowrap ${
                  isActive
                    ? 'bg-[#162A4A] text-white'
                    : 'text-slate-300 hover:text-white hover:bg-white/5'
                }`}
              >
                <Icon
                  className={`w-4 h-4 shrink-0 ${isActive ? 'text-blue-400' : 'text-slate-400'}`}
                  aria-hidden="true"
                />
                <span className="truncate">{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="px-5 py-4 border-t border-white/10 text-xs text-slate-400 leading-relaxed">
          <div className="font-medium text-slate-200">Grid Load Intelligence</div>
          <div className="mt-0.5">Cloud Monitoring &amp; ARIMA Forecasting</div>
        </div>
      </aside>

      {/* Main Content Workspace */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Clean SaaS Top Bar: Breadcrumb Left — Primary Actions Right */}
        <header className="h-16 bg-white border-b border-slate-200 px-4 sm:px-6 flex items-center justify-between gap-4 sticky top-0 z-30">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              aria-label="Open navigation menu"
              className="lg:hidden p-2 -ml-1 text-slate-600 hover:text-slate-900 rounded-md hover:bg-slate-100"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-2 text-sm min-w-0">
              <span className="hidden sm:inline text-slate-400 whitespace-nowrap">
                {currentNav.module}
              </span>
              <span className="hidden sm:inline text-slate-300" aria-hidden="true">
                /
              </span>
              <h1 className="text-base font-semibold text-slate-900 truncate">
                {currentNav.label}
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={onLoadSample}
              disabled={refreshing}
              className="hidden sm:inline-flex items-center px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
            >
              Load Sample Dataset
            </button>
            <button
              type="button"
              onClick={onRefresh}
              disabled={refreshing}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-white bg-[#0B172A] rounded-md hover:bg-[#162A4A] disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} aria-hidden="true" />
              <span>Refresh</span>
            </button>
          </div>
        </header>

        <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-[1440px] w-full mx-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
