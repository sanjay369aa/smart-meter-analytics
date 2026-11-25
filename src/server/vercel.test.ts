import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import vercelApp from '../../api/index';
import { resolveWritableDataDir } from './app';

test('vercel.json configures Vite output, api/index.ts function, and SPA/API rewrites', () => {
  const raw = fs.readFileSync(path.resolve(process.cwd(), 'vercel.json'), 'utf-8');
  const config = JSON.parse(raw);

  assert.equal(config.framework, 'vite');
  assert.equal(config.buildCommand, 'npm run build');
  assert.equal(config.outputDirectory, 'dist');
  assert.ok(config.functions['api/index.ts']);
  assert.ok(
    config.rewrites.some(
      (r: { source: string; destination: string }) =>
        r.source === '/api/(.*)' && r.destination === '/api/index'
    )
  );
  assert.ok(
    config.rewrites.some(
      (r: { source: string; destination: string }) =>
        r.source === '/((?!api/).*)' && r.destination === '/index.html'
    )
  );
});

test('resolveWritableDataDir uses os.tmpdir() on Vercel serverless runtime', () => {
  const prev = process.env.VERCEL;
  try {
    process.env.VERCEL = '1';
    const dir = resolveWritableDataDir();
    assert.ok(dir.startsWith(os.tmpdir()), `Expected dir in tmpdir, got ${dir}`);
  } finally {
    if (prev === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = prev;
  }
});

test('api/index.ts does not import vite dev server dependencies', () => {
  const apiEntry = fs.readFileSync(path.resolve(process.cwd(), 'api/index.ts'), 'utf-8');
  const appModule = fs.readFileSync(path.resolve(process.cwd(), 'src/server/app.ts'), 'utf-8');
  assert.equal(apiEntry.includes("'vite'"), false);
  assert.equal(appModule.includes("'vite'"), false);
});

test('Vercel serverless handler (api/index.ts) serves all core /api/* endpoints cleanly', async () => {
  const server = vercelApp.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  try {
    const { port } = server.address() as AddressInfo;
    const base = `http://127.0.0.1:${port}`;

    const healthRes = await fetch(`${base}/api/health`);
    assert.equal(healthRes.status, 200);
    const health = await healthRes.json();
    assert.equal(health.status, 'ok');
    assert.ok(health.records >= 5040);

    // Also verify root fallback if Vercel rewrite strips /api prefix
    const fallbackHealth = await fetch(`${base}/health`);
    assert.equal(fallbackHealth.status, 200);

    const dashRes = await fetch(`${base}/api/dashboard`);
    assert.equal(dashRes.status, 200);
    const dash = await dashRes.json();
    assert.ok(dash.summary.total_energy_kwh > 0);
    assert.equal(dash.forecast_status.status, 'trained');

    const analyticsRes = await fetch(`${base}/api/analytics`);
    assert.equal(analyticsRes.status, 200);

    const peakRes = await fetch(`${base}/api/peak-load`);
    assert.equal(peakRes.status, 200);

    const forecastRes = await fetch(`${base}/api/forecast`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ p: 3, d: 1, q: 1, horizon: 24 }),
    });
    assert.equal(forecastRes.status, 200);
    const fc = await forecastRes.json();
    assert.equal(fc.status, 'trained');
    assert.equal(fc.next_24h_forecast.length, 24);

    const sampleCsvRes = await fetch(`${base}/api/sample-csv`);
    assert.equal(sampleCsvRes.status, 200);
    const csvText = await sampleCsvRes.text();
    assert.ok(csvText.startsWith('meter_id,timestamp,consumer_type,energy_kwh,voltage,current,power_factor'));

    const activeCsvRes = await fetch(`${base}/api/dataset/active-csv`);
    assert.equal(activeCsvRes.status, 200);
    const activeCsv = await activeCsvRes.json();
    assert.ok(activeCsv.record_count >= 5040);
    assert.ok(activeCsv.csv.startsWith('meter_id,timestamp,consumer_type'));

    const removedAwsRes = await fetch(`${base}/api/aws/status`);
    assert.equal(removedAwsRes.status, 404);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('api/index.ts and src/server/*.ts execute cleanly under native Node.js ESM (Vercel runtime simulation)', async () => {
  const { execFileSync } = await import('node:child_process');
  const esbuild = await import('esbuild');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vercel-esm-test-'));
  try {
    fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({ type: 'module' }));
    fs.symlinkSync(path.resolve(process.cwd(), 'node_modules'), path.join(tmpDir, 'node_modules'));

    esbuild.buildSync({
      entryPoints: [
        'api/index.ts',
        'src/server/app.ts',
        'src/server/analytics.ts',
        'src/server/arima.ts',
        'src/server/sampleData.ts',
      ],
      outdir: tmpDir,
      outbase: '.',
      format: 'esm',
      platform: 'node',
      target: 'node22',
      bundle: false,
    });

    const out = execFileSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `
          process.env.VERCEL = "1";
          const { default: app } = await import(${JSON.stringify(path.join(tmpDir, 'api/index.js'))});
          const srv = app.listen(0, "127.0.0.1");
          await new Promise((r) => srv.once("listening", r));
          const { port } = srv.address();
          const res = await fetch(\`http://127.0.0.1:\${port}/api/dashboard\`);
          const data = await res.json();
          console.log(JSON.stringify({ status: res.status, records: data.summary.total_records }));
          await new Promise((r) => srv.close(r));
        `,
      ],
      { encoding: 'utf-8' }
    );
    const parsed = JSON.parse(out.trim());
    assert.equal(parsed.status, 200);
    assert.ok(parsed.records >= 5040);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
