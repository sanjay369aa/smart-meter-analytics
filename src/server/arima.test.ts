import test from 'node:test';
import assert from 'node:assert/strict';
import { generateSampleDataset } from './sampleData';
import { MIN_HOURS_FOR_ARIMA, prepareHourlyTimeSeries, runArimaForecast } from './arima';
import type { MeterReading } from '../types/smartMeter';

test('prepareHourlyTimeSeries detects and linearly interpolates missing hourly timestamps', () => {
  const readings: MeterReading[] = [
    { meter_id: 'M1', timestamp: '2026-11-01T00:00:00Z', consumer_type: 'Residential', energy_kwh: 10, voltage: 230, current: 43, power_factor: 0.95 },
    // 01:00 and 02:00 intentionally missing
    { meter_id: 'M1', timestamp: '2026-11-01T03:00:00Z', consumer_type: 'Residential', energy_kwh: 40, voltage: 230, current: 170, power_factor: 0.95 },
  ];

  const { series, missingHoursInterpolated } = prepareHourlyTimeSeries(readings);
  assert.equal(series.length, 4);
  assert.equal(missingHoursInterpolated, 2);
  assert.equal(series[1].value, 20);
  assert.equal(series[2].value, 30);
});

test('runArimaForecast returns clear insufficient_data status when fewer than 48 hourly points exist', () => {
  const smallSample = generateSampleDataset(1); // 24 hours < 48
  const result = runArimaForecast(smallSample);

  assert.equal(result.status, 'insufficient_data');
  assert.equal(result.next_hour_forecast_kwh, null);
  assert.equal(result.metrics, null);
  assert.ok(result.message && result.message.includes(String(MIN_HOURS_FOR_ARIMA)));
});

test('runArimaForecast trains on 35-day dataset, produces accurate MAE/RMSE/MAPE and 24-hour forecast', () => {
  const sample = generateSampleDataset(35);
  const result = runArimaForecast(sample, { p: 3, d: 1, q: 1, horizon: 24 });

  assert.equal(result.status, 'trained');
  assert.ok(result.metrics !== null);
  assert.ok(result.metrics.mae > 0 && Number.isFinite(result.metrics.mae));
  assert.ok(result.metrics.rmse >= result.metrics.mae);
  assert.ok(result.metrics.mape > 0 && result.metrics.mape < 18, `Expected realistic MAPE < 18%, got ${result.metrics.mape}%`);
  assert.equal(result.next_24h_forecast.length, 24);
  assert.ok(result.next_hour_forecast_kwh !== null && result.next_hour_forecast_kwh > 0);
  assert.ok(result.actual_vs_predicted.length >= 24);
  assert.ok(result.historical_trend.length >= 48);

  // Verify forecasts follow diurnal pattern (not constant or random noise)
  const values = result.next_24h_forecast.map((pt) => pt.predicted_kwh);
  const minVal = Math.min(...values);
  const maxVal = Math.max(...values);
  assert.ok(maxVal > minVal * 1.15, 'Forecast should capture diurnal peak-to-trough spread');

  // Verify determinism across repeated runs on the exact same dataset
  const repeat = runArimaForecast(sample, { p: 3, d: 1, q: 1, horizon: 24 });
  assert.equal(result.next_hour_forecast_kwh, repeat.next_hour_forecast_kwh);
  assert.equal(result.metrics.mape, repeat.metrics?.mape);
});
