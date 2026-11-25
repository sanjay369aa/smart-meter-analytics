/**
 * Pure validation & CSV chunking helpers synchronized with firebase-blueprint.json and firestore.rules.
 */

export const ID_PATTERN = /^[a-zA-Z0-9_-]{1,128}$/;
export const FILENAME_PATTERN = /^[a-zA-Z0-9._-]{1,160}$/;
export const MAX_RECORD_COUNT = 200_000;
export const MAX_SIZE_BYTES = 50_000_000;
export const MAX_CHUNK_CHARS = 240_000; // Strict safety margin below 250,000 rule limit
export const MAX_CHUNKS = 50;
export const MAX_TOTAL_ENERGY_KWH = 1_000_000_000;
export const ALLOWED_HORIZONS = [12, 24, 48] as const;

export function sanitizeDatasetFilename(rawName?: string): string {
  const fallback = `smart_meter_snapshot_${new Date()
    .toISOString()
    .slice(0, 19)
    .replace(/[:T]/g, '-')}.csv`;

  const base = (rawName ?? '').trim().split(/[\\/]/).pop() ?? '';
  let cleaned = base.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/^\.+/, '');
  if (!cleaned) {
    cleaned = fallback;
  }
  if (!cleaned.toLowerCase().endsWith('.csv')) {
    cleaned = `${cleaned}.csv`;
  }
  if (cleaned.length > 160) {
    cleaned = `${cleaned.slice(0, 156)}.csv`;
  }
  if (!FILENAME_PATTERN.test(cleaned)) {
    return fallback;
  }
  return cleaned;
}

export function generateDatasetId(nowMs: number = Date.now()): string {
  const randomSuffix = Math.random().toString(36).slice(2, 10);
  const id = `ds_${nowMs}_${randomSuffix}`;
  if (!ID_PATTERN.test(id)) {
    throw new Error('Generated dataset ID violates schema constraints.');
  }
  return id;
}

export function splitCsvIntoChunks(csvContent: string, maxChunkChars: number = MAX_CHUNK_CHARS): string[] {
  if (!csvContent || csvContent.length === 0) {
    throw new Error('Cannot archive an empty CSV dataset.');
  }
  if (maxChunkChars < 1 || maxChunkChars > 250_000) {
    throw new Error('Invalid chunk size bound.');
  }

  const chunks: string[] = [];
  for (let offset = 0; offset < csvContent.length; offset += maxChunkChars) {
    chunks.push(csvContent.slice(offset, offset + maxChunkChars));
  }

  if (chunks.length > MAX_CHUNKS) {
    throw new Error(
      `Dataset exceeds maximum Firestore archive capacity (${MAX_CHUNKS} chunks / ~${Math.round(
        (MAX_CHUNKS * maxChunkChars) / (1024 * 1024)
      )} MB).`
    );
  }
  return chunks;
}

export function reassembleCsvChunks(
  chunks: Array<{ chunkIndex: number; csvContent: string }>,
  expectedChunkCount?: number
): string {
  if (chunks.length === 0) {
    throw new Error('Archived dataset contains no CSV chunks.');
  }
  const sorted = [...chunks].sort((a, b) => a.chunkIndex - b.chunkIndex);
  if (expectedChunkCount !== undefined && sorted.length !== expectedChunkCount) {
    throw new Error(
      `Incomplete dataset archive: expected ${expectedChunkCount} chunks, retrieved ${sorted.length}.`
    );
  }
  for (let i = 0; i < sorted.length; i += 1) {
    if (sorted[i].chunkIndex !== i) {
      throw new Error(`Corrupted archive sequence: missing chunk index ${i}.`);
    }
  }
  return sorted.map((c) => c.csvContent).join('');
}

export interface ValidatedDatasetWrite {
  ownerId: string;
  filename: string;
  recordCount: number;
  sizeBytes: number;
  chunkCount: number;
  totalEnergyKwh: number;
  dateRangeStart: string;
  dateRangeEnd: string;
}

export function validateDatasetWrite(input: ValidatedDatasetWrite): ValidatedDatasetWrite {
  if (!ID_PATTERN.test(input.ownerId)) {
    throw new Error('Invalid ownerId.');
  }
  if (!FILENAME_PATTERN.test(input.filename)) {
    throw new Error('Invalid dataset filename. Use letters, numbers, dots, underscores, or hyphens.');
  }
  const recordCount = Math.round(input.recordCount);
  if (!Number.isInteger(recordCount) || recordCount < 1 || recordCount > MAX_RECORD_COUNT) {
    throw new Error(`recordCount must be an integer between 1 and ${MAX_RECORD_COUNT}.`);
  }
  const sizeBytes = Math.round(input.sizeBytes);
  if (!Number.isInteger(sizeBytes) || sizeBytes < 1 || sizeBytes > MAX_SIZE_BYTES) {
    throw new Error(`sizeBytes must be between 1 and ${MAX_SIZE_BYTES}.`);
  }
  const chunkCount = Math.round(input.chunkCount);
  if (!Number.isInteger(chunkCount) || chunkCount < 1 || chunkCount > MAX_CHUNKS) {
    throw new Error(`chunkCount must be between 1 and ${MAX_CHUNKS}.`);
  }
  if (
    !Number.isFinite(input.totalEnergyKwh) ||
    input.totalEnergyKwh < 0 ||
    input.totalEnergyKwh > MAX_TOTAL_ENERGY_KWH
  ) {
    throw new Error('totalEnergyKwh is out of permitted numeric bounds.');
  }
  const dateRangeStart = String(input.dateRangeStart ?? '').slice(0, 32);
  const dateRangeEnd = String(input.dateRangeEnd ?? '').slice(0, 32);

  return {
    ownerId: input.ownerId,
    filename: input.filename,
    recordCount,
    sizeBytes,
    chunkCount,
    totalEnergyKwh: Math.round(input.totalEnergyKwh * 100) / 100,
    dateRangeStart,
    dateRangeEnd,
  };
}

export interface ValidatedUserSettingsWrite {
  ownerId: string;
  arimaP: number;
  arimaD: number;
  arimaQ: number;
  defaultHorizon: 12 | 24 | 48;
}

export function validateUserSettingsWrite(input: {
  ownerId: string;
  arimaP: number;
  arimaD: number;
  arimaQ: number;
  defaultHorizon: number;
}): ValidatedUserSettingsWrite {
  if (!ID_PATTERN.test(input.ownerId)) {
    throw new Error('Invalid user ID.');
  }
  const arimaP = Math.round(input.arimaP);
  const arimaD = Math.round(input.arimaD);
  const arimaQ = Math.round(input.arimaQ);
  const defaultHorizon = Math.round(input.defaultHorizon);

  if (arimaP < 1 || arimaP > 12) throw new Error('AR order (p) must be between 1 and 12.');
  if (arimaD < 0 || arimaD > 2) throw new Error('Differencing order (d) must be between 0 and 2.');
  if (arimaQ < 0 || arimaQ > 4) throw new Error('MA order (q) must be between 0 and 4.');
  if (defaultHorizon !== 12 && defaultHorizon !== 24 && defaultHorizon !== 48) {
    throw new Error('Forecast horizon must be 12, 24, or 48 hours.');
  }

  return {
    ownerId: input.ownerId,
    arimaP,
    arimaD,
    arimaQ,
    defaultHorizon,
  };
}
