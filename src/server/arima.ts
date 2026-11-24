import type {
  ForecastPoint,
  ForecastResult,
  HistoricalTrendPoint,
  MeterReading,
  ValidationPoint,
} from '../types/smartMeter';
import { formatTimestampShort } from './analytics';

export const MIN_HOURS_FOR_ARIMA = 48;

interface HourlyPoint {
  timestamp: string;
  ms: number;
  hourOfDay: number;
  value: number;
}

function round(v: number, d = 2): number {
  const f = 10 ** d;
  return Math.round(v * f) / f;
}

/**
 * Aggregates smart meter readings to hourly grid consumption, detects missing hourly
 * timestamps, and fills gaps via linear interpolation.
 */
export function prepareHourlyTimeSeries(readings: MeterReading[]): {
  series: HourlyPoint[];
  missingHoursInterpolated: number;
} {
  if (readings.length === 0) {
    return { series: [], missingHoursInterpolated: 0 };
  }

  const hourTotals = new Map<number, number>();
  let minMs = Infinity;
  let maxMs = -Infinity;

  for (const r of readings) {
    const d = new Date(r.timestamp);
    d.setUTCMinutes(0, 0, 0);
    const ms = d.getTime();
    if (Number.isNaN(ms)) continue;
    hourTotals.set(ms, (hourTotals.get(ms) ?? 0) + r.energy_kwh);
    if (ms < minMs) minMs = ms;
    if (ms > maxMs) maxMs = ms;
  }

  if (!Number.isFinite(minMs) || !Number.isFinite(maxMs)) {
    return { series: [], missingHoursInterpolated: 0 };
  }

  const hourMs = 3600 * 1000;
  const totalSteps = Math.floor((maxMs - minMs) / hourMs) + 1;
  // Cap extreme sparse spans to last 2160 hours (90 days) so memory remains bounded
  const cappedSteps = Math.min(totalSteps, 2160);
  const startMs = maxMs - (cappedSteps - 1) * hourMs;

  const rawValues: Array<number | null> = [];
  const timestamps: number[] = [];

  for (let i = 0; i < cappedSteps; i++) {
    const ms = startMs + i * hourMs;
    timestamps.push(ms);
    rawValues.push(hourTotals.has(ms) ? hourTotals.get(ms)! : null);
  }

  let missingCount = 0;
  const filled: number[] = new Array(cappedSteps);

  // Find first and last non-null indices
  let firstValid = rawValues.findIndex((v) => v !== null);
  if (firstValid === -1) return { series: [], missingHoursInterpolated: 0 };

  for (let i = 0; i < cappedSteps; i++) {
    if (rawValues[i] !== null) {
      filled[i] = rawValues[i]!;
    } else {
      missingCount++;
      // Locate nearest left and right known values for linear interpolation
      let left = i - 1;
      while (left >= 0 && rawValues[left] === null) left--;
      let right = i + 1;
      while (right < cappedSteps && rawValues[right] === null) right++;

      if (left >= 0 && right < cappedSteps) {
        const leftVal = rawValues[left]!;
        const rightVal = rawValues[right]!;
        const ratio = (i - left) / (right - left);
        filled[i] = leftVal + ratio * (rightVal - leftVal);
      } else if (left >= 0) {
        filled[i] = rawValues[left]!;
      } else if (right < cappedSteps) {
        filled[i] = rawValues[right]!;
      } else {
        filled[i] = rawValues[firstValid]!;
      }
    }
  }

  const series: HourlyPoint[] = timestamps.map((ms, idx) => {
    const dt = new Date(ms);
    return {
      timestamp: dt.toISOString().replace('.000Z', 'Z'),
      ms,
      hourOfDay: dt.getUTCHours(),
      value: round(filled[idx], 4),
    };
  });

  return { series, missingHoursInterpolated: missingCount };
}

/**
 * Solves linear system (A + ridge*I) x = b via Gaussian elimination with partial pivoting.
 */
function solveLinearSystem(A: number[][], b: number[], ridge = 1e-4): number[] {
  const n = b.length;
  const M = A.map((row, i) => [...row.map((v, j) => (i === j ? v + ridge : v)), b[i]]);

  for (let col = 0; col < n; col++) {
    let pivotRow = col;
    let maxAbs = Math.abs(M[col][col]);
    for (let row = col + 1; row < n; row++) {
      const val = Math.abs(M[row][col]);
      if (val > maxAbs) {
        maxAbs = val;
        pivotRow = row;
      }
    }

    if (pivotRow !== col) {
      const tmp = M[col];
      M[col] = M[pivotRow];
      M[pivotRow] = tmp;
    }

    const pivot = M[col][col];
    if (Math.abs(pivot) < 1e-12) continue;

    for (let row = col + 1; row < n; row++) {
      const factor = M[row][col] / pivot;
      for (let k = col; k <= n; k++) {
        M[row][k] -= factor * M[col][k];
      }
    }
  }

  const x = new Array<number>(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let sum = M[i][n];
    for (let j = i + 1; j < n; j++) {
      sum -= M[i][j] * x[j];
    }
    x[i] = Math.abs(M[i][i]) > 1e-12 ? sum / M[i][i] : 0;
  }
  return x;
}

function fitRegularizedOls(X: number[][], y: number[], ridge = 1e-3): number[] {
  const m = X.length;
  const k = X[0].length;
  const XtX: number[][] = Array.from({ length: k }, () => new Array<number>(k).fill(0));
  const Xty = new Array<number>(k).fill(0);

  for (let i = 0; i < m; i++) {
    const xi = X[i];
    const yi = y[i];
    for (let a = 0; a < k; a++) {
      Xty[a] += xi[a] * yi;
      for (let b = a; b < k; b++) {
        XtX[a][b] += xi[a] * xi[b];
      }
    }
  }
  for (let a = 0; a < k; a++) {
    for (let b = 0; b < a; b++) {
      XtX[a][b] = XtX[b][a];
    }
  }
  return solveLinearSystem(XtX, Xty, ridge);
}

function differenceSeries(values: number[], d: number): { diffed: number[]; anchors: number[][] } {
  const anchors: number[][] = [];
  let current = [...values];
  for (let step = 0; step < d; step++) {
    anchors.push([...current]);
    const next: number[] = [];
    for (let i = 1; i < current.length; i++) {
      next.push(current[i] - current[i - 1]);
    }
    current = next;
  }
  return { diffed: current, anchors };
}

function integrateForecasts(diffForecasts: number[], d: number, anchors: number[][]): number[] {
  let current = [...diffForecasts];
  for (let step = d - 1; step >= 0; step--) {
    const baseSeries = anchors[step];
    let lastVal = baseSeries[baseSeries.length - 1];
    const integrated: number[] = [];
    for (const delta of current) {
      lastVal = lastVal + delta;
      integrated.push(lastVal);
    }
    current = integrated;
  }
  return current;
}

interface FittedArimaModel {
  p: number;
  d: number;
  q: number;
  seasonalMeans: number[]; // 24-hour diurnal baseline learned strictly from training slice
  intercept: number;
  arCoeffs: number[];
  maCoeffs: number[];
  residualStd: number;
  diffedHistory: number[];
  residualHistory: number[];
  diffAnchors: number[][];
}

/**
 * Fits an ARIMA(p, d, q) model with 24-hour diurnal seasonal adjustment (standard for hourly electricity load)
 * using Hannan-Rissanen two-stage estimation (high-order AR innovation proxy -> OLS ARMA(p, q)).
 */
function fitSeasonalArima(
  trainSeries: HourlyPoint[],
  p: number,
  d: number,
  q: number
): FittedArimaModel {
  // 1. Estimate 24-hour diurnal load profile from training data only (no data leakage)
  const hourSums = new Array<number>(24).fill(0);
  const hourCounts = new Array<number>(24).fill(0);
  for (const pt of trainSeries) {
    hourSums[pt.hourOfDay] += pt.value;
    hourCounts[pt.hourOfDay]++;
  }
  const overallMean =
    trainSeries.reduce((acc, pt) => acc + pt.value, 0) / Math.max(1, trainSeries.length);
  const seasonalMeans = hourSums.map((s, h) => (hourCounts[h] > 0 ? s / hourCounts[h] : overallMean));

  // Deseasonalized series z_t = y_t - S_{hour(t)}
  const deseasonalized = trainSeries.map((pt) => pt.value - seasonalMeans[pt.hourOfDay]);

  // 2. Apply differencing I(d)
  const { diffed, anchors } = differenceSeries(deseasonalized, d);
  const n = diffed.length;

  // 3. Stage 1 (Hannan-Rissanen): Fit long AR(k_long) to estimate unobserved innovations e_t
  const kLong = Math.min(Math.max(p + q + 4, 8), Math.floor(n / 4));
  const Xlong: number[][] = [];
  const ylong: number[] = [];
  for (let t = kLong; t < n; t++) {
    const row = [1];
    for (let j = 1; j <= kLong; j++) {
      row.push(diffed[t - j]);
    }
    Xlong.push(row);
    ylong.push(diffed[t]);
  }
  const longWeights = Xlong.length > kLong + 2 ? fitRegularizedOls(Xlong, ylong, 0.05) : [0];
  const innovations = new Array<number>(n).fill(0);
  for (let t = kLong; t < n; t++) {
    let pred = longWeights[0] ?? 0;
    for (let j = 1; j <= kLong && j < longWeights.length; j++) {
      pred += longWeights[j] * diffed[t - j];
    }
    innovations[t] = diffed[t] - pred;
  }

  // 4. Stage 2: Fit ARMA(p, q) on differenced series with estimated innovations
  const startIdx = Math.max(p, q, kLong);
  const X: number[][] = [];
  const y: number[] = [];
  for (let t = startIdx; t < n; t++) {
    const row = [1];
    for (let i = 1; i <= p; i++) row.push(diffed[t - i]);
    for (let j = 1; j <= q; j++) row.push(innovations[t - j]);
    X.push(row);
    y.push(diffed[t]);
  }

  const weights =
    X.length > p + q + 2
      ? fitRegularizedOls(X, y, 0.08)
      : [0, ...new Array<number>(p).fill(0.1), ...new Array<number>(q).fill(0)];

  const intercept = weights[0] ?? 0;
  let arCoeffs = weights.slice(1, 1 + p);
  let maCoeffs = weights.slice(1 + p, 1 + p + q);

  // Stability dampening guard: keep sum of |arCoeffs| < 0.98 so multi-step forecasts never diverge
  const arAbsSum = arCoeffs.reduce((acc, c) => acc + Math.abs(c), 0);
  if (arAbsSum > 0.96) {
    const scale = 0.95 / arAbsSum;
    arCoeffs = arCoeffs.map((c) => c * scale);
  }
  const maAbsSum = maCoeffs.reduce((acc, c) => acc + Math.abs(c), 0);
  if (maAbsSum > 0.9) {
    const scale = 0.85 / maAbsSum;
    maCoeffs = maCoeffs.map((c) => c * scale);
  }

  // Compute in-sample residuals for standard error estimation
  const residuals: number[] = new Array<number>(n).fill(0);
  let sqErr = 0;
  let countErr = 0;
  for (let t = Math.max(p, q); t < n; t++) {
    let pred = intercept;
    for (let i = 1; i <= p; i++) pred += arCoeffs[i - 1] * diffed[t - i];
    for (let j = 1; j <= q; j++) pred += maCoeffs[j - 1] * residuals[t - j];
    const err = diffed[t] - pred;
    residuals[t] = err;
    sqErr += err * err;
    countErr++;
  }

  const residualStd = countErr > 1 ? Math.sqrt(sqErr / Math.max(1, countErr - (p + q + 1))) : 1.0;

  return {
    p,
    d,
    q,
    seasonalMeans,
    intercept,
    arCoeffs,
    maCoeffs,
    residualStd,
    diffedHistory: diffed,
    residualHistory: residuals,
    diffAnchors: anchors,
  };
}

/**
 * Generates multi-step ahead forecasts from a fitted ARIMA model starting at `startMs + 1 hour`.
 */
function predictMultiStep(
  model: FittedArimaModel,
  lastTimestampMs: number,
  horizon: number
): ForecastPoint[] {
  const diffBuffer = [...model.diffedHistory];
  const errBuffer = [...model.residualHistory];
  const diffForecasts: number[] = [];

  for (let step = 0; step < horizon; step++) {
    let nextDiff = model.intercept;
    for (let i = 1; i <= model.p; i++) {
      nextDiff += model.arCoeffs[i - 1] * (diffBuffer[diffBuffer.length - i] ?? 0);
    }
    for (let j = 1; j <= model.q; j++) {
      nextDiff += model.maCoeffs[j - 1] * (errBuffer[errBuffer.length - j] ?? 0);
    }
    diffForecasts.push(nextDiff);
    diffBuffer.push(nextDiff);
    // Expected future innovation is 0
    errBuffer.push(0);
  }

  const deseasonalizedPreds = integrateForecasts(diffForecasts, model.d, model.diffAnchors);
  const points: ForecastPoint[] = [];

  for (let h = 0; h < horizon; h++) {
    const ms = lastTimestampMs + (h + 1) * 3600 * 1000;
    const dt = new Date(ms);
    const iso = dt.toISOString().replace('.000Z', 'Z');
    const hourOfDay = dt.getUTCHours();

    const predicted = Math.max(0.1, deseasonalizedPreds[h] + model.seasonalMeans[hourOfDay]);
    // Confidence interval widens smoothly with sqrt(horizon step)
    const margin = 1.96 * model.residualStd * Math.sqrt(1 + 0.14 * h);
    const lower = Math.max(0, predicted - margin);
    const upper = predicted + margin;

    points.push({
      timestamp: iso,
      label: formatTimestampShort(iso),
      predicted_kwh: round(predicted, 2),
      lower_bound: round(lower, 2),
      upper_bound: round(upper, 2),
    });
  }

  return points;
}

/**
 * Runs one-step-ahead rolling evaluation on the validation split (using model trained strictly on train split)
 * to compute honest MAE, RMSE, and MAPE.
 */
function evaluateOnValidation(
  trainSeries: HourlyPoint[],
  valSeries: HourlyPoint[],
  model: FittedArimaModel
): {
  validationPoints: ValidationPoint[];
  mae: number;
  rmse: number;
  mape: number;
} {
  const fullDeseasonalized = [
    ...trainSeries.map((pt) => pt.value - model.seasonalMeans[pt.hourOfDay]),
  ];
  const diffBuf = [...model.diffedHistory];
  const errBuf = [...model.residualHistory];

  const validationPoints: ValidationPoint[] = [];
  let sumAbsErr = 0;
  let sumSqErr = 0;
  let sumApe = 0;
  let apeCount = 0;

  for (const pt of valSeries) {
    // 1-step ahead forecast in differenced space
    let nextDiff = model.intercept;
    for (let i = 1; i <= model.p; i++) {
      nextDiff += model.arCoeffs[i - 1] * (diffBuf[diffBuf.length - i] ?? 0);
    }
    for (let j = 1; j <= model.q; j++) {
      nextDiff += model.maCoeffs[j - 1] * (errBuf[errBuf.length - j] ?? 0);
    }

    // Reconstruct deseasonalized value for d = 0, 1, or 2
    const lastZ = fullDeseasonalized[fullDeseasonalized.length - 1] ?? 0;
    const prevZ = fullDeseasonalized[fullDeseasonalized.length - 2] ?? lastZ;
    let predZ: number;
    if (model.d === 0) {
      predZ = nextDiff;
    } else if (model.d === 1) {
      predZ = lastZ + nextDiff;
    } else {
      predZ = 2 * lastZ - prevZ + nextDiff;
    }

    const predicted = Math.max(0.1, predZ + model.seasonalMeans[pt.hourOfDay]);
    const actual = pt.value;
    const err = actual - predicted;

    sumAbsErr += Math.abs(err);
    sumSqErr += err * err;
    if (actual > 0.01) {
      sumApe += Math.abs(err / actual) * 100;
      apeCount++;
    }

    validationPoints.push({
      timestamp: pt.timestamp,
      label: formatTimestampShort(pt.timestamp),
      actual_kwh: round(actual, 2),
      predicted_kwh: round(predicted, 2),
    });

    // Update buffers with actual observed value (rolling 1-step forecast without refitting weights)
    const actualZ = actual - model.seasonalMeans[pt.hourOfDay];
    let actualDiff: number;
    if (model.d === 0) {
      actualDiff = actualZ;
    } else if (model.d === 1) {
      actualDiff = actualZ - lastZ;
    } else {
      actualDiff = actualZ - 2 * lastZ + prevZ;
    }
    fullDeseasonalized.push(actualZ);
    diffBuf.push(actualDiff);
    errBuf.push(actualDiff - nextDiff);
  }

  const n = Math.max(1, valSeries.length);
  return {
    validationPoints,
    mae: round(sumAbsErr / n, 3),
    rmse: round(Math.sqrt(sumSqErr / n), 3),
    mape: apeCount > 0 ? round(sumApe / apeCount, 2) : 0,
  };
}

/**
 * Main entry point: prepares hourly time series, validates sufficiency, trains & evaluates ARIMA(p, d, q),
 * and produces 1-hour & 24-hour forecasts plus validation metrics.
 */
export function runArimaForecast(
  readings: MeterReading[],
  options: { p?: number; d?: number; q?: number; horizon?: number } = {}
): ForecastResult {
  const p = Math.min(12, Math.max(1, Math.round(options.p ?? 3)));
  const d = Math.min(2, Math.max(0, Math.round(options.d ?? 1)));
  const q = Math.min(4, Math.max(0, Math.round(options.q ?? 1)));
  const horizon = Math.min(72, Math.max(1, Math.round(options.horizon ?? 24)));

  const { series, missingHoursInterpolated } = prepareHourlyTimeSeries(readings);

  if (series.length < MIN_HOURS_FOR_ARIMA) {
    return {
      status: 'insufficient_data',
      model_name: `SARIMA(${p},${d},${q})x(24h)`,
      order: { p, d, q },
      trained_at: null,
      training_samples: series.length,
      validation_samples: 0,
      missing_hours_interpolated: missingHoursInterpolated,
      next_hour_forecast_kwh: null,
      next_24h_total_kwh: null,
      next_24h_peak_kwh: null,
      next_24h_peak_timestamp: null,
      metrics: null,
      actual_vs_predicted: [],
      next_24h_forecast: [],
      historical_trend: series.map((s) => ({
        timestamp: s.timestamp,
        label: formatTimestampShort(s.timestamp),
        actual_kwh: round(s.value, 2),
      })),
      message: `Insufficient historical data to train ARIMA(${p},${d},${q}). At least ${MIN_HOURS_FOR_ARIMA} hourly intervals are required (currently ${series.length} available). Load the 30-day sample dataset or upload a larger CSV file.`,
    };
  }

  // Chronological 80/20 train-validation split (at least 12 validation hours, up to 168 hours = 7 days)
  const valSize = Math.min(168, Math.max(12, Math.floor(series.length * 0.2)));
  const trainSize = series.length - valSize;
  const trainSlice = series.slice(0, trainSize);
  const valSlice = series.slice(trainSize);

  // Train on 80% slice and evaluate on holdout 20%
  const evalModel = fitSeasonalArima(trainSlice, p, d, q);
  const { validationPoints, mae, rmse, mape } = evaluateOnValidation(trainSlice, valSlice, evalModel);

  // Refit on 100% of historical series to forecast future next 24 hours
  const finalModel = fitSeasonalArima(series, p, d, q);
  const lastPoint = series[series.length - 1];
  const next24h = predictMultiStep(finalModel, lastPoint.ms, horizon);

  const nextHour = next24h[0]?.predicted_kwh ?? null;
  const total24h = round(next24h.reduce((acc, pt) => acc + pt.predicted_kwh, 0), 2);
  let peakPoint = next24h[0];
  for (const pt of next24h) {
    if (pt.predicted_kwh > peakPoint.predicted_kwh) peakPoint = pt;
  }

  // Last 168 hours (7 days) of historical consumption for clean trend plotting
  const historicalSlice = series.slice(-168);
  const historical_trend: HistoricalTrendPoint[] = historicalSlice.map((s) => ({
    timestamp: s.timestamp,
    label: formatTimestampShort(s.timestamp),
    actual_kwh: round(s.value, 2),
  }));

  return {
    status: 'trained',
    model_name: `ARIMA(${p},${d},${q}) + 24h Seasonal Profile`,
    order: { p, d, q },
    trained_at: new Date().toISOString(),
    training_samples: trainSize,
    validation_samples: valSize,
    missing_hours_interpolated: missingHoursInterpolated,
    next_hour_forecast_kwh: nextHour,
    next_24h_total_kwh: total24h,
    next_24h_peak_kwh: peakPoint?.predicted_kwh ?? null,
    next_24h_peak_timestamp: peakPoint?.timestamp ?? null,
    metrics: { mae, rmse, mape },
    actual_vs_predicted: validationPoints.slice(-96),
    next_24h_forecast: next24h,
    historical_trend,
  };
}
