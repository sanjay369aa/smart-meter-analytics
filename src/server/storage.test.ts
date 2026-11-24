import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CloudStorageService, resolveConfinedPath, sanitizeFilename } from './storage';

test('sanitizeFilename and resolveConfinedPath prevent path traversal', () => {
  const base = path.join(os.tmpdir(), 'smart-meter-path-test');
  const safe = resolveConfinedPath(base, '../../etc/passwd');
  assert.ok(safe.startsWith(path.resolve(base) + path.sep));
  assert.equal(sanitizeFilename('my report 2026'), 'my_report_2026.csv');
});

test('CloudStorageService refuses to activate live AWS S3 mode without backend credentials', () => {
  const origKey = process.env.AWS_ACCESS_KEY_ID;
  const origSecret = process.env.AWS_SECRET_ACCESS_KEY;
  delete process.env.AWS_ACCESS_KEY_ID;
  delete process.env.AWS_SECRET_ACCESS_KEY;

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'smart-meter-sim-'));
  try {
    const storage = new CloudStorageService(tmpDir);
    assert.throws(
      () => storage.configure({ mode: 'aws_s3', bucket: 'my-test-bucket', region: 'us-east-1' }),
      /AWS_ACCESS_KEY_ID/
    );
  } finally {
    if (origKey !== undefined) process.env.AWS_ACCESS_KEY_ID = origKey;
    if (origSecret !== undefined) process.env.AWS_SECRET_ACCESS_KEY = origSecret;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('CloudStorageService Local Simulation Mode persists, lists, and retrieves CSV datasets', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'smart-meter-sim-'));
  try {
    const storage = new CloudStorageService(tmpDir);
    const sampleCsv = 'meter_id,timestamp,consumer_type,energy_kwh,voltage,current,power_factor\nRES-101,2026-11-01T00:00:00Z,Residential,2.1,230,9.6,0.95\n';

    const uploaded = await storage.uploadCsv('test_archive.csv', sampleCsv, 1);
    assert.equal(uploaded.filename, 'test_archive.csv');
    assert.equal(uploaded.storage_mode, 'local_simulation');
    assert.ok(uploaded.size_bytes > 0);

    const files = await storage.listFiles();
    assert.equal(files.length, 1);
    assert.equal(files[0].filename, 'test_archive.csv');

    const retrieved = await storage.retrieveCsv('test_archive.csv');
    assert.equal(retrieved.content, sampleCsv);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
