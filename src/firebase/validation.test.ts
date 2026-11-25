import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FILENAME_PATTERN,
  generateDatasetId,
  ID_PATTERN,
  MAX_CHUNK_CHARS,
  reassembleCsvChunks,
  sanitizeDatasetFilename,
  splitCsvIntoChunks,
  validateDatasetWrite,
  validateUserSettingsWrite,
} from './validation';

test('sanitizeDatasetFilename strips path traversal, enforces .csv extension, and matches rules regex', () => {
  const cleaned = sanitizeDatasetFilename('../../evil<script>alert(1)</script> meters');
  assert.ok(FILENAME_PATTERN.test(cleaned), `Expected valid filename, got ${cleaned}`);
  assert.ok(cleaned.endsWith('.csv'));
  assert.equal(cleaned.includes('..'), false);
  assert.equal(cleaned.includes('/'), false);

  const generated = sanitizeDatasetFilename('');
  assert.ok(FILENAME_PATTERN.test(generated));
  assert.ok(generated.startsWith('smart_meter_snapshot_'));
});

test('generateDatasetId conforms to Firestore ID regex constraints', () => {
  const id = generateDatasetId(1730000000000);
  assert.ok(ID_PATTERN.test(id));
  assert.ok(id.length <= 128);
});

test('splitCsvIntoChunks and reassembleCsvChunks round-trip multi-chunk CSV losslessly', () => {
  const header = 'meter_id,timestamp,consumer_type,energy_kwh,voltage,current,power_factor\n';
  const row = 'SM-RES-001,2026-11-01T00:00:00Z,Residential,1.850,231.2,8.12,0.960\n';
  const bigCsv = header + row.repeat(6000); // ~396 KB -> splits into 2 chunks

  const chunks = splitCsvIntoChunks(bigCsv);
  assert.equal(chunks.length, 2);
  assert.ok(chunks.every((c) => c.length >= 1 && c.length <= MAX_CHUNK_CHARS));

  // Reassemble even when returned out-of-order from Firestore
  const restored = reassembleCsvChunks(
    [
      { chunkIndex: 1, csvContent: chunks[1] },
      { chunkIndex: 0, csvContent: chunks[0] },
    ],
    chunks.length
  );
  assert.equal(restored, bigCsv);
});

test('reassembleCsvChunks detects missing or corrupted chunks', () => {
  assert.throws(() => reassembleCsvChunks([{ chunkIndex: 0, csvContent: 'a' }], 2), /Incomplete/);
  assert.throws(() => reassembleCsvChunks([{ chunkIndex: 1, csvContent: 'a' }]), /Corrupted/);
});

test('validateDatasetWrite enforces numeric, ownerId, and filename bounds from firebase-blueprint.json', () => {
  const ok = validateDatasetWrite({
    ownerId: 'user_abc123',
    filename: 'nov_2026_meters.csv',
    recordCount: 5040,
    sizeBytes: 310000,
    chunkCount: 2,
    totalEnergyKwh: 96412.567,
    dateRangeStart: '2026-10-22',
    dateRangeEnd: '2026-11-25',
  });
  assert.equal(ok.totalEnergyKwh, 96412.57);

  assert.throws(
    () =>
      validateDatasetWrite({
        ...ok,
        ownerId: '../admin',
      }),
    /ownerId/
  );
  assert.throws(
    () =>
      validateDatasetWrite({
        ...ok,
        recordCount: 0,
      }),
    /recordCount/
  );
  assert.throws(
    () =>
      validateDatasetWrite({
        ...ok,
        totalEnergyKwh: -5,
      }),
    /totalEnergyKwh/
  );
});

test('validateUserSettingsWrite enforces ARIMA parameter and horizon invariants', () => {
  const valid = validateUserSettingsWrite({
    ownerId: 'uid_operator_1',
    arimaP: 3,
    arimaD: 1,
    arimaQ: 1,
    defaultHorizon: 24,
  });
  assert.equal(valid.defaultHorizon, 24);

  assert.throws(
    () =>
      validateUserSettingsWrite({
        ownerId: 'uid_operator_1',
        arimaP: 20,
        arimaD: 1,
        arimaQ: 1,
        defaultHorizon: 24,
      }),
    /AR order/
  );
  assert.throws(
    () =>
      validateUserSettingsWrite({
        ownerId: 'uid_operator_1',
        arimaP: 3,
        arimaD: 1,
        arimaQ: 1,
        defaultHorizon: 36,
      }),
    /horizon/
  );
});
