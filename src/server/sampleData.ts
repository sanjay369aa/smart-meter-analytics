import fs from 'node:fs';
import path from 'node:path';
import type { ConsumerType, MeterReading } from '../types/smartMeter';

interface MeterSpec {
  meter_id: string;
  consumer_type: ConsumerType;
  base_kwh: number;
  nominal_voltage: number;
  nominal_pf: number;
  phase_seed: number;
}

export const SAMPLE_METERS: MeterSpec[] = [
  { meter_id: 'RES-101', consumer_type: 'Residential', base_kwh: 1.8, nominal_voltage: 230.0, nominal_pf: 0.94, phase_seed: 11 },
  { meter_id: 'RES-102', consumer_type: 'Residential', base_kwh: 2.3, nominal_voltage: 231.5, nominal_pf: 0.93, phase_seed: 23 },
  { meter_id: 'COM-201', consumer_type: 'Commercial', base_kwh: 11.5, nominal_voltage: 240.0, nominal_pf: 0.91, phase_seed: 37 },
  { meter_id: 'COM-202', consumer_type: 'Commercial', base_kwh: 15.2, nominal_voltage: 239.0, nominal_pf: 0.90, phase_seed: 53 },
  { meter_id: 'IND-301', consumer_type: 'Industrial', base_kwh: 42.0, nominal_voltage: 415.0, nominal_pf: 0.86, phase_seed: 71 },
  { meter_id: 'IND-302', consumer_type: 'Industrial', base_kwh: 54.0, nominal_voltage: 416.0, nominal_pf: 0.85, phase_seed: 89 },
];

// Deterministic PRNG (Mulberry32) so sample dataset and unit tests are reproducible
function createPrng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function diurnalFactor(consumerType: ConsumerType, hour: number, isWeekend: boolean): number {
  if (consumerType === 'Residential') {
    // Low overnight, morning peak (7-9h), moderate midday, pronounced evening peak (18-22h)
    const curve = [
      0.48, 0.42, 0.38, 0.36, 0.38, 0.48,
      0.72, 1.08, 1.15, 0.92, 0.82, 0.80,
      0.86, 0.84, 0.82, 0.88, 1.05, 1.32,
      1.68, 1.85, 1.76, 1.52, 1.12, 0.72,
    ];
    return curve[hour] * (isWeekend ? 1.14 : 1.0);
  }

  if (consumerType === 'Commercial') {
    // Office/retail profile: ramps 8-10h, high 10-18h, steep drop after 19h, lower on weekends
    const curve = [
      0.32, 0.30, 0.29, 0.29, 0.31, 0.38,
      0.55, 0.88, 1.28, 1.55, 1.68, 1.74,
      1.78, 1.82, 1.80, 1.72, 1.58, 1.34,
      0.95, 0.68, 0.52, 0.42, 0.36, 0.33,
    ];
    return curve[hour] * (isWeekend ? 0.56 : 1.0);
  }

  // Industrial: strong continuous base load, higher during daytime production shifts (7-20h)
  const curve = [
    0.78, 0.76, 0.75, 0.75, 0.77, 0.84,
    0.96, 1.12, 1.24, 1.30, 1.34, 1.35,
    1.32, 1.36, 1.38, 1.34, 1.26, 1.16,
    1.04, 0.94, 0.88, 0.84, 0.81, 0.79,
  ];
  return curve[hour] * (isWeekend ? 0.82 : 1.0);
}

/**
 * Generates a realistic multi-day hourly smart meter dataset spanning `days` days (default 35 days)
 * across Residential, Commercial, and Industrial meters, including realistic anomalies.
 */
export function generateSampleDataset(days = 35, referenceEndIso = '2026-11-20T18:00:00Z'): MeterReading[] {
  const rand = createPrng(20261120);
  const endDate = new Date(referenceEndIso);
  endDate.setUTCMinutes(0, 0, 0);

  const totalHours = days * 24;
  const startMs = endDate.getTime() - (totalHours - 1) * 3600 * 1000;
  const readings: MeterReading[] = [];

  // Pre-selected realistic grid spike events (dayOffset, hour) for peak anomaly detection
  const anomalyWindows = new Set<string>([
    '6-19',
    '14-14',
    '21-19',
    '28-15',
    '32-19',
  ]);

  for (let h = 0; h < totalHours; h++) {
    const ts = new Date(startMs + h * 3600 * 1000);
    const iso = ts.toISOString().replace('.000Z', 'Z');
    const hour = ts.getUTCHours();
    const dayOfWeek = ts.getUTCDay();
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
    const dayIndex = Math.floor(h / 24);

    // Gentle weather / seasonal temperature wave + mild upward drift over the period
    const weatherWave = 1 + 0.09 * Math.sin((2 * Math.PI * dayIndex) / 9.5) + 0.04 * (h / totalHours);
    const isSpike = anomalyWindows.has(`${dayIndex}-${hour}`);

    for (const meter of SAMPLE_METERS) {
      const diurnal = diurnalFactor(meter.consumer_type, hour, isWeekend);
      const noise = 1 + (rand() - 0.5) * 0.09;
      const spikeMultiplier = isSpike
        ? (meter.consumer_type === 'Industrial' ? 1.52 : meter.consumer_type === 'Commercial' ? 1.44 : 1.38)
        : 1.0;

      const energy_kwh = round(
        Math.max(0.15, meter.base_kwh * diurnal * weatherWave * noise * spikeMultiplier),
        3
      );

      // Voltage sags slightly during heavy load
      const loadStress = Math.min(1, energy_kwh / (meter.base_kwh * 2.2));
      const voltage = round(
        meter.nominal_voltage - loadStress * 2.6 + (rand() - 0.5) * 2.4,
        2
      );

      const power_factor = round(
        Math.min(0.99, Math.max(0.75, meter.nominal_pf - loadStress * 0.025 + (rand() - 0.5) * 0.03)),
        3
      );

      // Physically consistent current: P(W) = V * I * pf (single-phase) or sqrt(3)*V*I*pf (3-phase industrial)
      const phaseFactor = meter.consumer_type === 'Industrial' ? Math.sqrt(3) : 1;
      const current = round((energy_kwh * 1000) / (phaseFactor * voltage * power_factor), 2);

      readings.push({
        meter_id: meter.meter_id,
        timestamp: iso,
        consumer_type: meter.consumer_type,
        energy_kwh,
        voltage,
        current,
        power_factor,
      });
    }
  }

  return readings;
}

/**
 * Generates one fresh simulated reading per meter at the next consecutive hour after `latestTimestamp`.
 */
export function simulateNextHourReadings(existing: MeterReading[]): MeterReading[] {
  let nextMs: number;
  if (existing.length > 0) {
    let maxMs = 0;
    for (const r of existing) {
      const ms = Date.parse(r.timestamp);
      if (ms > maxMs) maxMs = ms;
    }
    nextMs = maxMs + 3600 * 1000;
  } else {
    const now = new Date();
    now.setUTCMinutes(0, 0, 0);
    nextMs = now.getTime();
  }

  const ts = new Date(nextMs);
  const iso = ts.toISOString().replace('.000Z', 'Z');
  const hour = ts.getUTCHours();
  const isWeekend = ts.getUTCDay() === 0 || ts.getUTCDay() === 6;

  return SAMPLE_METERS.map((meter) => {
    const diurnal = diurnalFactor(meter.consumer_type, hour, isWeekend);
    const jitter = 0.94 + Math.random() * 0.14;
    const energy_kwh = round(Math.max(0.2, meter.base_kwh * diurnal * jitter), 3);
    const voltage = round(meter.nominal_voltage + (Math.random() - 0.5) * 3.0, 2);
    const power_factor = round(Math.min(0.99, Math.max(0.78, meter.nominal_pf + (Math.random() - 0.5) * 0.03)), 3);
    const phaseFactor = meter.consumer_type === 'Industrial' ? Math.sqrt(3) : 1;
    const current = round((energy_kwh * 1000) / (phaseFactor * voltage * power_factor), 2);

    return {
      meter_id: meter.meter_id,
      timestamp: iso,
      consumer_type: meter.consumer_type,
      energy_kwh,
      voltage,
      current,
      power_factor,
    };
  });
}

export function readingsToCsv(readings: MeterReading[]): string {
  const header = 'meter_id,timestamp,consumer_type,energy_kwh,voltage,current,power_factor';
  const sanitizeCell = (val: string): string => {
    const trimmed = val.trim();
    const safe = /^[=+\-@\t\r]/.test(trimmed) ? `'${trimmed}` : trimmed;
    if (/[,"\n]/.test(safe)) {
      return `"${safe.replace(/"/g, '""')}"`;
    }
    return safe;
  };
  const lines = readings.map(
    (r) =>
      `${sanitizeCell(r.meter_id)},${sanitizeCell(r.timestamp)},${sanitizeCell(r.consumer_type)},${r.energy_kwh},${r.voltage},${r.current},${r.power_factor}`
  );
  return `${header}\n${lines.join('\n')}\n`;
}

export function ensureSampleCsvOnDisk(dataDir: string): string {
  fs.mkdirSync(dataDir, { recursive: true });
  const csvPath = path.join(dataDir, 'sample_smart_meter_data.csv');
  if (!fs.existsSync(csvPath)) {
    const sample = generateSampleDataset(35);
    fs.writeFileSync(csvPath, readingsToCsv(sample), 'utf-8');
  }
  return csvPath;
}
