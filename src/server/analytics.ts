import type {
  AnalyticsPayload,
  CleaningReport,
  ConsumerType,
  MeterReading,
  PeakLoadAnomaly,
  PeakLoadPayload,
  ReportPayload,
  ReportRow,
  ForecastResult,
} from '../types/smartMeter.js';

const VALID_CONSUMERS: Record<string, ConsumerType> = {
  residential: 'Residential',
  commercial: 'Commercial',
  industrial: 'Industrial',
};

const DEFAULT_VOLTAGE: Record<ConsumerType, number> = {
  Residential: 230,
  Commercial: 240,
  Industrial: 415,
};

const DEFAULT_PF: Record<ConsumerType, number> = {
  Residential: 0.94,
  Commercial: 0.91,
  Industrial: 0.86,
};

const REQUIRED_COLUMNS = [
  'meter_id',
  'timestamp',
  'consumer_type',
  'energy_kwh',
  'voltage',
  'current',
  'power_factor',
] as const;

function round(val: number, decimals = 2): number {
  const f = 10 ** decimals;
  return Math.round(val * f) / f;
}

function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      result.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

/**
 * Validates, parses, deduplicates, and imputes missing numeric values from an uploaded CSV string.
 */
export function parseAndCleanCsv(csvText: string): {
  readings: MeterReading[];
  report: CleaningReport;
} {
  const cleanedText = csvText.replace(/^\uFEFF/, '').trim();
  if (!cleanedText) {
    throw new Error('The uploaded CSV file is empty.');
  }

  const rawLines = cleanedText.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (rawLines.length < 2) {
    throw new Error('CSV file must include a header row and at least one data record.');
  }

  const headers = parseCsvLine(rawLines[0]).map((h) => h.toLowerCase().trim());
  const missingCols = REQUIRED_COLUMNS.filter((col) => !headers.includes(col));
  if (missingCols.length > 0) {
    throw new Error(
      `Missing required CSV column(s): ${missingCols.join(', ')}. Expected columns: ${REQUIRED_COLUMNS.join(', ')}.`
    );
  }

  const colIdx = Object.fromEntries(REQUIRED_COLUMNS.map((c) => [c, headers.indexOf(c)])) as Record<
    (typeof REQUIRED_COLUMNS)[number],
    number
  >;

  interface DraftRow {
    meter_id: string;
    timestamp: string;
    consumer_type: ConsumerType;
    energy_kwh: number | null;
    voltage: number | null;
    current: number | null;
    power_factor: number | null;
  }

  const drafts: DraftRow[] = [];
  const seenKeys = new Set<string>();
  let duplicatesRemoved = 0;
  let invalidRowsRejected = 0;
  let missingValuesImputed = 0;
  const warnings: string[] = [];

  for (let i = 1; i < rawLines.length; i++) {
    const cells = parseCsvLine(rawLines[i]);
    const meterId = (cells[colIdx.meter_id] ?? '').replace(/^'/, '').trim();
    const rawTs = (cells[colIdx.timestamp] ?? '').replace(/^'/, '').trim();
    const rawType = (cells[colIdx.consumer_type] ?? '').replace(/^'/, '').trim().toLowerCase();

    if (!meterId || !rawTs) {
      invalidRowsRejected++;
      continue;
    }

    const parsedDate = Date.parse(rawTs);
    if (Number.isNaN(parsedDate)) {
      invalidRowsRejected++;
      continue;
    }
    const isoTs = new Date(parsedDate).toISOString().replace('.000Z', 'Z');

    const consumerType = VALID_CONSUMERS[rawType];
    if (!consumerType) {
      invalidRowsRejected++;
      continue;
    }

    const dedupKey = `${meterId}::${isoTs}`;
    if (seenKeys.has(dedupKey)) {
      duplicatesRemoved++;
      continue;
    }
    seenKeys.add(dedupKey);

    const parseOptionalNum = (raw: string | undefined, min: number, max: number): number | null => {
      if (raw === undefined || raw === '' || raw.toLowerCase() === 'null' || raw.toLowerCase() === 'nan') {
        return null;
      }
      const n = Number(raw);
      if (!Number.isFinite(n) || n < min || n > max) {
        return null;
      }
      return n;
    };

    const energy = parseOptionalNum(cells[colIdx.energy_kwh], 0, 100000);
    const voltage = parseOptionalNum(cells[colIdx.voltage], 50, 1000);
    const current = parseOptionalNum(cells[colIdx.current], 0, 10000);
    const pf = parseOptionalNum(cells[colIdx.power_factor], 0.1, 1.0);

    drafts.push({
      meter_id: meterId,
      timestamp: isoTs,
      consumer_type: consumerType,
      energy_kwh: energy,
      voltage,
      current,
      power_factor: pf,
    });
  }

  if (drafts.length === 0) {
    throw new Error('No valid smart meter records were found after validation.');
  }

  // Compute consumer-type means for missing value imputation
  const energySums: Record<ConsumerType, { sum: number; count: number }> = {
    Residential: { sum: 0, count: 0 },
    Commercial: { sum: 0, count: 0 },
    Industrial: { sum: 0, count: 0 },
  };
  let globalSum = 0;
  let globalCount = 0;

  for (const d of drafts) {
    if (d.energy_kwh !== null) {
      energySums[d.consumer_type].sum += d.energy_kwh;
      energySums[d.consumer_type].count++;
      globalSum += d.energy_kwh;
      globalCount++;
    }
  }

  const globalMeanEnergy = globalCount > 0 ? globalSum / globalCount : 5.0;

  const readings: MeterReading[] = drafts.map((d) => {
    let energy = d.energy_kwh;
    if (energy === null) {
      const bucket = energySums[d.consumer_type];
      energy = round(bucket.count > 0 ? bucket.sum / bucket.count : globalMeanEnergy, 3);
      missingValuesImputed++;
    }

    let voltage = d.voltage;
    if (voltage === null) {
      voltage = DEFAULT_VOLTAGE[d.consumer_type];
      missingValuesImputed++;
    }

    let pf = d.power_factor;
    if (pf === null) {
      pf = DEFAULT_PF[d.consumer_type];
      missingValuesImputed++;
    }

    let current = d.current;
    if (current === null) {
      const phase = d.consumer_type === 'Industrial' ? Math.sqrt(3) : 1;
      current = round((energy * 1000) / (phase * voltage * pf), 2);
      missingValuesImputed++;
    }

    return {
      meter_id: d.meter_id,
      timestamp: d.timestamp,
      consumer_type: d.consumer_type,
      energy_kwh: round(energy, 3),
      voltage: round(voltage, 2),
      current: round(current, 2),
      power_factor: round(pf, 3),
    };
  });

  readings.sort((a, b) => a.timestamp.localeCompare(b.timestamp) || a.meter_id.localeCompare(b.meter_id));

  if (duplicatesRemoved > 0) {
    warnings.push(`Removed ${duplicatesRemoved} duplicate (meter_id, timestamp) record(s).`);
  }
  if (missingValuesImputed > 0) {
    warnings.push(`Imputed ${missingValuesImputed} missing or out-of-range numeric field(s) using category means.`);
  }
  if (invalidRowsRejected > 0) {
    warnings.push(`Rejected ${invalidRowsRejected} malformed row(s) with invalid timestamps or consumer types.`);
  }

  return {
    readings,
    report: {
      total_rows_received: rawLines.length - 1,
      valid_records_loaded: readings.length,
      duplicates_removed: duplicatesRemoved,
      missing_values_imputed: missingValuesImputed,
      invalid_rows_rejected: invalidRowsRejected,
      warnings,
    },
  };
}

export function filterReadings(
  readings: MeterReading[],
  options: {
    startDate?: string | null;
    endDate?: string | null;
    consumerType?: string | null;
    search?: string | null;
  }
): MeterReading[] {
  const { startDate, endDate, consumerType, search } = options;
  const normalizedConsumer = consumerType && consumerType !== 'All' ? consumerType.toLowerCase() : null;
  const q = search ? search.trim().toLowerCase() : null;

  return readings.filter((r) => {
    const datePart = r.timestamp.slice(0, 10);
    if (startDate && datePart < startDate) return false;
    if (endDate && datePart > endDate) return false;
    if (normalizedConsumer && r.consumer_type.toLowerCase() !== normalizedConsumer) return false;
    if (
      q &&
      !r.meter_id.toLowerCase().includes(q) &&
      !r.consumer_type.toLowerCase().includes(q) &&
      !r.timestamp.toLowerCase().includes(q)
    ) {
      return false;
    }
    return true;
  });
}

export function getDateRange(readings: MeterReading[]): { start: string | null; end: string | null } {
  if (readings.length === 0) return { start: null, end: null };
  let start = readings[0].timestamp.slice(0, 10);
  let end = start;
  for (const r of readings) {
    const d = r.timestamp.slice(0, 10);
    if (d < start) start = d;
    if (d > end) end = d;
  }
  return { start, end };
}

function getIsoWeekKey(dateStr: string): string {
  const date = new Date(`${dateStr}T00:00:00Z`);
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((date.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

export function formatShortDate(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

export function formatShortMonth(monthStr: string): string {
  const d = new Date(`${monthStr}-01T00:00:00Z`);
  return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
}

export function formatHourLabel(hour: number): string {
  return `${String(hour).padStart(2, '0')}:00`;
}

export function formatTimestampShort(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'UTC',
  });
}

/**
 * Computes complete Module 2 consumption analytics from the active (optionally filtered) dataset.
 */
export function computeAnalytics(
  allReadings: MeterReading[],
  filters: { startDate?: string | null; endDate?: string | null; consumerType?: string | null } = {}
): AnalyticsPayload {
  const availableRange = getDateRange(allReadings);
  const filtered = filterReadings(allReadings, filters);
  const consumerTypeLabel = filters.consumerType && filters.consumerType !== 'All' ? filters.consumerType : 'All';

  const metersSet = new Set<string>();
  const hourlyTotals = new Map<string, number>();

  // Hourly profile buckets (0..23)
  const hourBuckets = Array.from({ length: 24 }, (_, hour) => ({
    hour,
    total: 0,
    uniqueTimestamps: new Set<string>(),
    residential: 0,
    commercial: 0,
    industrial: 0,
  }));

  const dailyMap = new Map<
    string,
    { total: number; count: number; residential: number; commercial: number; industrial: number }
  >();
  const monthlyMap = new Map<
    string,
    { total: number; residential: number; commercial: number; industrial: number }
  >();
  const consumerStats: Record<
    ConsumerType,
    { total: number; count: number; peak: number; meters: Set<string>; pfSum: number }
  > = {
    Residential: { total: 0, count: 0, peak: 0, meters: new Set(), pfSum: 0 },
    Commercial: { total: 0, count: 0, peak: 0, meters: new Set(), pfSum: 0 },
    Industrial: { total: 0, count: 0, peak: 0, meters: new Set(), pfSum: 0 },
  };

  let totalEnergy = 0;

  for (const r of filtered) {
    totalEnergy += r.energy_kwh;
    metersSet.add(r.meter_id);

    const hourKey = r.timestamp.slice(0, 13);
    hourlyTotals.set(hourKey, (hourlyTotals.get(hourKey) ?? 0) + r.energy_kwh);

    const hourNum = Number(r.timestamp.slice(11, 13));
    const hb = hourBuckets[hourNum];
    if (hb) {
      hb.total += r.energy_kwh;
      hb.uniqueTimestamps.add(hourKey);
      if (r.consumer_type === 'Residential') hb.residential += r.energy_kwh;
      else if (r.consumer_type === 'Commercial') hb.commercial += r.energy_kwh;
      else hb.industrial += r.energy_kwh;
    }

    const dayKey = r.timestamp.slice(0, 10);
    const dayEntry = dailyMap.get(dayKey) ?? { total: 0, count: 0, residential: 0, commercial: 0, industrial: 0 };
    dayEntry.total += r.energy_kwh;
    dayEntry.count++;
    if (r.consumer_type === 'Residential') dayEntry.residential += r.energy_kwh;
    else if (r.consumer_type === 'Commercial') dayEntry.commercial += r.energy_kwh;
    else dayEntry.industrial += r.energy_kwh;
    dailyMap.set(dayKey, dayEntry);

    const monthKey = r.timestamp.slice(0, 7);
    const mEntry = monthlyMap.get(monthKey) ?? { total: 0, residential: 0, commercial: 0, industrial: 0 };
    mEntry.total += r.energy_kwh;
    if (r.consumer_type === 'Residential') mEntry.residential += r.energy_kwh;
    else if (r.consumer_type === 'Commercial') mEntry.commercial += r.energy_kwh;
    else mEntry.industrial += r.energy_kwh;
    monthlyMap.set(monthKey, mEntry);

    const cs = consumerStats[r.consumer_type];
    cs.total += r.energy_kwh;
    cs.count++;
    if (r.energy_kwh > cs.peak) cs.peak = r.energy_kwh;
    cs.meters.add(r.meter_id);
    cs.pfSum += r.power_factor;
  }

  const dailyEntries = Array.from(dailyMap.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  const weeklyMap = new Map<string, { total: number; days: number }>();
  for (const [dateStr, val] of dailyEntries) {
    const wk = getIsoWeekKey(dateStr);
    const wEntry = weeklyMap.get(wk) ?? { total: 0, days: 0 };
    wEntry.total += val.total;
    wEntry.days++;
    weeklyMap.set(wk, wEntry);
  }

  const hourly_profile = hourBuckets.map((hb) => {
    const denom = Math.max(1, hb.uniqueTimestamps.size);
    return {
      hour: hb.hour,
      label: formatHourLabel(hb.hour),
      average_kwh: round(hb.total / denom, 2),
      total_kwh: round(hb.total, 2),
      residential_kwh: round(hb.residential / denom, 2),
      commercial_kwh: round(hb.commercial / denom, 2),
      industrial_kwh: round(hb.industrial / denom, 2),
    };
  });

  const daily_consumption = dailyEntries.map(([date, val]) => ({
    date,
    label: formatShortDate(date),
    total_kwh: round(val.total, 2),
    average_kwh: round(val.total / Math.max(1, val.count), 2),
    residential_kwh: round(val.residential, 2),
    commercial_kwh: round(val.commercial, 2),
    industrial_kwh: round(val.industrial, 2),
  }));

  const weekly_consumption = Array.from(weeklyMap.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([week, val]) => ({
      week,
      label: week,
      total_kwh: round(val.total, 2),
      average_daily_kwh: round(val.total / Math.max(1, val.days), 2),
    }));

  const monthly_consumption = Array.from(monthlyMap.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([month, val]) => ({
      month,
      label: formatShortMonth(month),
      total_kwh: round(val.total, 2),
      residential_kwh: round(val.residential, 2),
      commercial_kwh: round(val.commercial, 2),
      industrial_kwh: round(val.industrial, 2),
    }));

  const consumer_breakdown = (['Residential', 'Commercial', 'Industrial'] as ConsumerType[]).map((ct) => {
    const cs = consumerStats[ct];
    return {
      consumer_type: ct,
      total_kwh: round(cs.total, 2),
      average_kwh: cs.count > 0 ? round(cs.total / cs.count, 2) : 0,
      peak_kwh: round(cs.peak, 2),
      share_percent: totalEnergy > 0 ? round((cs.total / totalEnergy) * 100, 1) : 0,
      meter_count: cs.meters.size,
      avg_power_factor: cs.count > 0 ? round(cs.pfSum / cs.count, 3) : 0,
    };
  });

  const uniqueHoursCount = hourlyTotals.size;

  return {
    filters: {
      start_date: filters.startDate ?? null,
      end_date: filters.endDate ?? null,
      consumer_type: consumerTypeLabel,
    },
    available_date_range: availableRange,
    summary: {
      total_energy_kwh: round(totalEnergy, 2),
      average_reading_kwh: filtered.length > 0 ? round(totalEnergy / filtered.length, 2) : 0,
      average_daily_kwh: dailyEntries.length > 0 ? round(totalEnergy / dailyEntries.length, 2) : 0,
      average_hourly_kwh: uniqueHoursCount > 0 ? round(totalEnergy / uniqueHoursCount, 2) : 0,
      total_records: filtered.length,
      active_meters: metersSet.size,
    },
    hourly_profile,
    daily_consumption,
    weekly_consumption,
    monthly_consumption,
    consumer_breakdown,
  };
}

/**
 * Computes Peak Load Detection, Off-Peak Windows, and Z-Score Anomaly Detection.
 */
export function computePeakLoad(
  allReadings: MeterReading[],
  filters: { startDate?: string | null; endDate?: string | null; consumerType?: string | null } = {}
): PeakLoadPayload {
  const filtered = filterReadings(allReadings, filters);

  if (filtered.length === 0) {
    return {
      peak_hour: null,
      peak_event: null,
      lowest_hour: null,
      off_peak_hours: [],
      peak_hours: [],
      period_split: {
        peak_total_kwh: 0,
        off_peak_total_kwh: 0,
        peak_share_percent: 0,
        off_peak_share_percent: 0,
        threshold_kwh: 0,
      },
      hourly_load_curve: [],
      anomalies: [],
    };
  }

  // Aggregate grid load per exact UTC hour
  const hourlyMap = new Map<
    string,
    { total: number; hour: number; byConsumer: Record<ConsumerType, number> }
  >();

  for (const r of filtered) {
    const key = `${r.timestamp.slice(0, 13)}:00:00Z`;
    const hour = Number(r.timestamp.slice(11, 13));
    const entry = hourlyMap.get(key) ?? {
      total: 0,
      hour,
      byConsumer: { Residential: 0, Commercial: 0, Industrial: 0 },
    };
    entry.total += r.energy_kwh;
    entry.byConsumer[r.consumer_type] += r.energy_kwh;
    hourlyMap.set(key, entry);
  }

  const hourlySeries = Array.from(hourlyMap.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([timestamp, val]) => ({ timestamp, ...val }));

  // Per hour-of-day statistics (mean & std for anomaly detection + peak classification)
  const hourValues: number[][] = Array.from({ length: 24 }, () => []);
  let peakEvent = hourlySeries[0];
  for (const pt of hourlySeries) {
    hourValues[pt.hour].push(pt.total);
    if (pt.total > peakEvent.total) {
      peakEvent = pt;
    }
  }

  const hourStats = hourValues.map((vals, hour) => {
    if (vals.length === 0) {
      return { hour, mean: 0, std: 0, median: 0, madScale: 0, max: 0 };
    }
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    const variance = vals.reduce((acc, v) => acc + (v - mean) ** 2, 0) / vals.length;
    const std = Math.sqrt(variance);
    const sorted = [...vals].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    const median =
      sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
    const absDevs = sorted.map((v) => Math.abs(v - median)).sort((a, b) => a - b);
    const mad =
      absDevs.length % 2 === 0
        ? (absDevs[mid - 1] + absDevs[mid]) / 2
        : absDevs[mid];
    const madScale = mad > 0.001 ? 1.4826 * mad : std;
    const max = sorted[sorted.length - 1];
    return { hour, mean, std, median, madScale, max };
  });

  const activeHourStats = hourStats.filter((h) => hourValues[h.hour].length > 0);
  const sortedByMean = [...activeHourStats].sort((a, b) => b.mean - a.mean);
  const peakHourStat = sortedByMean[0];
  const lowestHourStat = sortedByMean[sortedByMean.length - 1];

  // Dynamic peak / off-peak thresholds using 72nd and 28th percentile of hourly means
  const meansAsc = activeHourStats.map((h) => h.mean).sort((a, b) => a - b);
  const p75 = meansAsc[Math.floor(meansAsc.length * 0.72)] ?? peakHourStat.mean;
  const p25 = meansAsc[Math.floor(meansAsc.length * 0.28)] ?? lowestHourStat.mean;

  const hourly_load_curve = hourStats.map((h) => {
    let classification: 'Peak' | 'Standard' | 'Off-Peak' = 'Standard';
    if (h.mean >= p75 && h.mean > 0) classification = 'Peak';
    else if (h.mean <= p25) classification = 'Off-Peak';
    return {
      hour: h.hour,
      label: formatHourLabel(h.hour),
      average_kwh: round(h.mean, 2),
      max_kwh: round(h.max, 2),
      classification,
    };
  });

  const peakHourSet = new Set(
    hourly_load_curve.filter((h) => h.classification === 'Peak').map((h) => h.hour)
  );

  let peakTotal = 0;
  let offPeakTotal = 0;
  for (const pt of hourlySeries) {
    if (peakHourSet.has(pt.hour)) peakTotal += pt.total;
    else offPeakTotal += pt.total;
  }
  const grandTotal = peakTotal + offPeakTotal;

  // Detect anomalous hourly spikes relative to that hour-of-day's robust median baseline (Modified Z >= 2.5)
  const anomalies: PeakLoadAnomaly[] = [];
  for (const pt of hourlySeries) {
    const stat = hourStats[pt.hour];
    if (stat.madScale <= 0.001) continue;
    const z = (pt.total - stat.median) / stat.madScale;
    if (z >= 2.5) {
      let dominant: ConsumerType = 'Industrial';
      let maxShare = -1;
      for (const ct of ['Residential', 'Commercial', 'Industrial'] as ConsumerType[]) {
        if (pt.byConsumer[ct] > maxShare) {
          maxShare = pt.byConsumer[ct];
          dominant = ct;
        }
      }
      const deviationPercent = ((pt.total - stat.median) / Math.max(0.01, stat.median)) * 100;
      anomalies.push({
        timestamp: pt.timestamp,
        label: formatTimestampShort(pt.timestamp),
        total_kwh: round(pt.total, 2),
        expected_kwh: round(stat.median, 2),
        z_score: round(z, 2),
        deviation_percent: round(deviationPercent, 1),
        dominant_consumer: dominant,
        severity: z >= 3.5 ? 'High' : 'Elevated',
      });
    }
  }

  anomalies.sort((a, b) => b.z_score - a.z_score);

  return {
    peak_hour: {
      hour: peakHourStat.hour,
      label: formatHourLabel(peakHourStat.hour),
      average_kwh: round(peakHourStat.mean, 2),
    },
    peak_event: {
      timestamp: peakEvent.timestamp,
      label: formatTimestampShort(peakEvent.timestamp),
      energy_kwh: round(peakEvent.total, 2),
    },
    lowest_hour: {
      hour: lowestHourStat.hour,
      label: formatHourLabel(lowestHourStat.hour),
      average_kwh: round(lowestHourStat.mean, 2),
    },
    peak_hours: hourly_load_curve
      .filter((h) => h.classification === 'Peak')
      .map((h) => ({ hour: h.hour, label: h.label, average_kwh: h.average_kwh })),
    off_peak_hours: hourly_load_curve
      .filter((h) => h.classification === 'Off-Peak')
      .map((h) => ({ hour: h.hour, label: h.label, average_kwh: h.average_kwh })),
    period_split: {
      peak_total_kwh: round(peakTotal, 2),
      off_peak_total_kwh: round(offPeakTotal, 2),
      peak_share_percent: grandTotal > 0 ? round((peakTotal / grandTotal) * 100, 1) : 0,
      off_peak_share_percent: grandTotal > 0 ? round((offPeakTotal / grandTotal) * 100, 1) : 0,
      threshold_kwh: round(p75, 2),
    },
    hourly_load_curve,
    anomalies: anomalies.slice(0, 20),
  };
}

/**
 * Generates structured daily, weekly, monthly, or forecast reports from real loaded data.
 */
export function buildReport(
  readings: MeterReading[],
  reportType: 'daily' | 'weekly' | 'monthly' | 'forecast',
  forecast: ForecastResult,
  filters: { startDate?: string | null; endDate?: string | null; consumerType?: string | null } = {}
): ReportPayload {
  const filtered = filterReadings(readings, filters);
  const range = getDateRange(filtered);
  const metersSet = new Set(filtered.map((r) => r.meter_id));

  // First aggregate into exact UTC hours so peak_kwh is the real peak hourly grid load per period
  const hourlyMap = new Map<
    string,
    {
      periodKey: string;
      total: number;
      residential: number;
      commercial: number;
      industrial: number;
      records: number;
    }
  >();

  for (const r of filtered) {
    const hourKey = r.timestamp.slice(0, 13);
    const datePart = r.timestamp.slice(0, 10);
    const periodKey =
      reportType === 'monthly'
        ? datePart.slice(0, 7)
        : reportType === 'weekly'
          ? getIsoWeekKey(datePart)
          : datePart;

    const hEntry = hourlyMap.get(hourKey) ?? {
      periodKey,
      total: 0,
      residential: 0,
      commercial: 0,
      industrial: 0,
      records: 0,
    };
    hEntry.total += r.energy_kwh;
    hEntry.records++;
    if (r.consumer_type === 'Residential') hEntry.residential += r.energy_kwh;
    else if (r.consumer_type === 'Commercial') hEntry.commercial += r.energy_kwh;
    else hEntry.industrial += r.energy_kwh;
    hourlyMap.set(hourKey, hEntry);
  }

  const periodMap = new Map<
    string,
    {
      total: number;
      hours: number;
      peak: number;
      residential: number;
      commercial: number;
      industrial: number;
      records: number;
    }
  >();

  for (const h of hourlyMap.values()) {
    const p = periodMap.get(h.periodKey) ?? {
      total: 0,
      hours: 0,
      peak: 0,
      residential: 0,
      commercial: 0,
      industrial: 0,
      records: 0,
    };
    p.total += h.total;
    p.hours++;
    if (h.total > p.peak) p.peak = h.total;
    p.residential += h.residential;
    p.commercial += h.commercial;
    p.industrial += h.industrial;
    p.records += h.records;
    periodMap.set(h.periodKey, p);
  }

  const rows: ReportRow[] = Array.from(periodMap.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([period, p]) => ({
      period,
      total_kwh: round(p.total, 2),
      average_kwh: round(p.total / Math.max(1, p.hours), 2),
      peak_kwh: round(p.peak, 2),
      residential_kwh: round(p.residential, 2),
      commercial_kwh: round(p.commercial, 2),
      industrial_kwh: round(p.industrial, 2),
      record_count: p.records,
    }));

  const totalEnergy = rows.reduce((acc, r) => acc + r.total_kwh, 0);
  let peakRow = rows[0] ?? null;
  for (const r of rows) {
    if (peakRow && r.total_kwh > peakRow.total_kwh) peakRow = r;
  }

  return {
    report_type: reportType,
    generated_at: new Date().toISOString(),
    date_range: range,
    summary: {
      total_energy_kwh: round(totalEnergy, 2),
      average_period_kwh: rows.length > 0 ? round(totalEnergy / rows.length, 2) : 0,
      peak_period_kwh: peakRow ? peakRow.total_kwh : 0,
      peak_period_label: peakRow ? peakRow.period : '—',
      total_meters: metersSet.size,
      total_records: filtered.length,
    },
    rows,
    forecast_rows: forecast.status === 'trained' ? forecast.next_24h_forecast : [],
    forecast_metrics: forecast.metrics,
  };
}

export function reportToCsv(report: ReportPayload): string {
  if (report.report_type === 'forecast') {
    const header = 'timestamp,label,predicted_kwh,lower_bound_kwh,upper_bound_kwh';
    const lines = report.forecast_rows.map(
      (r) => `${r.timestamp},"${r.label}",${r.predicted_kwh},${r.lower_bound},${r.upper_bound}`
    );
    return `${header}\n${lines.join('\n')}\n`;
  }

  const header =
    'period,total_kwh,avg_hourly_kwh,peak_hourly_kwh,residential_kwh,commercial_kwh,industrial_kwh,record_count';
  const lines = report.rows.map(
    (r) =>
      `${r.period},${r.total_kwh},${r.average_kwh},${r.peak_kwh},${r.residential_kwh},${r.commercial_kwh},${r.industrial_kwh},${r.record_count}`
  );
  return `${header}\n${lines.join('\n')}\n`;
}
