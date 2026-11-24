import test from 'node:test';
import assert from 'node:assert/strict';
import { generateSampleDataset, readingsToCsv } from './sampleData';
import {
  buildReport,
  computeAnalytics,
  computePeakLoad,
  parseAndCleanCsv,
} from './analytics';
import { runArimaForecast } from './arima';

test('sample dataset covers >= 30 days of hourly readings across all three consumer categories', () => {
  const sample = generateSampleDataset(35);
  assert.equal(sample.length, 35 * 24 * 6);

  const types = new Set(sample.map((r) => r.consumer_type));
  assert.deepEqual([...types].sort(), ['Commercial', 'Industrial', 'Residential']);

  // Verify physical plausibility
  for (const r of sample.slice(0, 50)) {
    assert.ok(r.energy_kwh > 0);
    assert.ok(r.voltage > 200 && r.voltage < 450);
    assert.ok(r.power_factor >= 0.7 && r.power_factor <= 1.0);
    assert.ok(r.current > 0);
  }
});

test('CSV cleaner removes duplicate records, imputes missing numeric values, and rejects malformed rows', () => {
  const csv = [
    'meter_id,timestamp,consumer_type,energy_kwh,voltage,current,power_factor',
    'RES-101,2026-11-01T00:00:00Z,Residential,2.5,230.1,11.5,0.94',
    'RES-101,2026-11-01T00:00:00Z,Residential,2.5,230.1,11.5,0.94', // exact duplicate
    'RES-101,2026-11-01T01:00:00Z,Residential,,230.0,,0.95', // missing energy & current
    'COM-201,invalid-date,Commercial,10.0,240.0,45.0,0.91', // malformed timestamp
    'IND-301,2026-11-01T00:00:00Z,UnknownType,40.0,415.0,60.0,0.86', // invalid consumer type
    'IND-301,2026-11-01T00:00:00Z,Industrial,44.0,,70.0,', // missing voltage & pf
  ].join('\n');

  const { readings, report } = parseAndCleanCsv(csv);
  assert.equal(report.total_rows_received, 6);
  assert.equal(report.duplicates_removed, 1);
  assert.equal(report.invalid_rows_rejected, 2);
  assert.equal(report.valid_records_loaded, 3);
  assert.equal(report.missing_values_imputed, 4);

  const imputedRes = readings.find((r) => r.meter_id === 'RES-101' && r.timestamp === '2026-11-01T01:00:00Z');
  assert.ok(imputedRes);
  assert.equal(imputedRes.energy_kwh, 2.5); // imputed from Residential mean
  assert.ok(imputedRes.current > 0);
});

test('CSV parser rejects missing required columns', () => {
  assert.throws(() => parseAndCleanCsv('meter_id,timestamp\nM1,2026-11-01T00:00:00Z'), /Missing required CSV/);
});

test('analytics accurately aggregates total, hourly, daily, weekly, monthly, and filtered subsets', () => {
  const sample = generateSampleDataset(35);
  const full = computeAnalytics(sample);
  const industrialOnly = computeAnalytics(sample, { consumerType: 'Industrial' });

  assert.equal(full.summary.active_meters, 6);
  assert.equal(industrialOnly.summary.active_meters, 2);
  assert.equal(full.hourly_profile.length, 24);
  assert.equal(full.daily_consumption.length, 36); // spans 35*24h ending 18:00 UTC across 36 calendar dates
  assert.ok(full.weekly_consumption.length >= 5);
  assert.ok(full.monthly_consumption.length >= 2);
  assert.ok(full.summary.total_energy_kwh > industrialOnly.summary.total_energy_kwh);

  const shareSum = full.consumer_breakdown.reduce((acc, c) => acc + c.share_percent, 0);
  assert.ok(Math.abs(shareSum - 100) < 0.3);
});

test('peak load detection identifies peak hour, off-peak hours, and injected grid spike anomalies', () => {
  const sample = generateSampleDataset(35);
  const peak = computePeakLoad(sample);

  assert.ok(peak.peak_hour !== null);
  assert.ok(peak.peak_event !== null);
  assert.ok(peak.lowest_hour !== null);
  assert.ok(peak.peak_hour.average_kwh > peak.lowest_hour.average_kwh);
  assert.ok(peak.peak_hours.length > 0);
  assert.ok(peak.off_peak_hours.length > 0);
  assert.ok(peak.anomalies.length >= 3, `Expected >= 3 anomalies, got ${peak.anomalies.length}`);
  assert.ok(peak.anomalies[0].z_score >= 2.15);
});

test('report builder generates daily, weekly, monthly, and forecast reports and serializes to CSV', () => {
  const sample = generateSampleDataset(10);
  const forecast = runArimaForecast(sample);
  const daily = buildReport(sample, 'daily', forecast);
  const weekly = buildReport(sample, 'weekly', forecast);
  const csv = readingsToCsv(sample.slice(0, 5));

  assert.ok(daily.rows.length >= 10);
  assert.ok(weekly.rows.length >= 2);
  assert.ok(daily.summary.total_energy_kwh > 0);
  assert.ok(csv.startsWith('meter_id,timestamp,consumer_type,energy_kwh,voltage,current,power_factor'));
});
