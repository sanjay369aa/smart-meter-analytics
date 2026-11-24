import fs from 'node:fs';
import path from 'node:path';
import {
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import type { StorageStatus, StoredDatasetFile } from '../types/smartMeter';

export interface StorageConfig {
  mode: 'aws_s3' | 'local_simulation';
  bucket: string;
  region: string;
  prefix: string;
}

interface LocalManifestEntry {
  key: string;
  filename: string;
  size_bytes: number;
  uploaded_at: string;
  record_count: number;
  bucket: string;
}

export function sanitizeFilename(input: string): string {
  const base = path.basename(input.trim()).replace(/[^a-zA-Z0-9._-]/g, '_');
  if (!base || base === '.' || base === '..') {
    throw new Error('Invalid filename.');
  }
  return base.endsWith('.csv') ? base : `${base}.csv`;
}

export function resolveConfinedPath(baseDir: string, filename: string): string {
  const safeName = sanitizeFilename(filename);
  const resolvedBase = path.resolve(baseDir);
  const resolvedTarget = path.resolve(resolvedBase, safeName);
  if (!resolvedTarget.startsWith(resolvedBase + path.sep)) {
    throw new Error('Access denied: invalid storage path.');
  }
  return resolvedTarget;
}

export class CloudStorageService {
  private readonly localSimDir: string;
  private readonly manifestPath: string;
  private config: StorageConfig;

  constructor(dataDir: string) {
    this.localSimDir = path.resolve(dataDir, 'cloud_sim');
    this.manifestPath = path.join(this.localSimDir, 'manifest.json');
    fs.mkdirSync(this.localSimDir, { recursive: true });

    const hasAwsEnv = this.hasAwsCredentials();
    const envBucket = (process.env.AWS_S3_BUCKET ?? '').trim();
    const envRegion = (process.env.AWS_REGION ?? 'us-east-1').trim() || 'us-east-1';
    const envPrefix = (process.env.AWS_S3_PREFIX ?? 'smart-meter-datasets/').trim();

    this.config = {
      mode: hasAwsEnv && envBucket ? 'aws_s3' : 'local_simulation',
      bucket: envBucket || 'smart-meter-local-sim-bucket',
      region: envRegion,
      prefix: envPrefix,
    };
  }

  public hasAwsCredentials(): boolean {
    const keyId = (process.env.AWS_ACCESS_KEY_ID ?? '').trim();
    const secret = (process.env.AWS_SECRET_ACCESS_KEY ?? '').trim();
    return keyId.length > 0 && secret.length > 0;
  }

  private createS3Client(): S3Client {
    if (!this.hasAwsCredentials()) {
      throw new Error(
        'AWS credentials are not configured on the backend. Set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY in server environment variables, or switch to Local Simulation Mode.'
      );
    }
    return new S3Client({
      region: this.config.region,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID!.trim(),
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!.trim(),
      },
    });
  }

  private readManifest(): LocalManifestEntry[] {
    if (!fs.existsSync(this.manifestPath)) return [];
    try {
      const raw = fs.readFileSync(this.manifestPath, 'utf-8');
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  private writeManifest(entries: LocalManifestEntry[]): void {
    fs.mkdirSync(this.localSimDir, { recursive: true });
    fs.writeFileSync(this.manifestPath, JSON.stringify(entries, null, 2), 'utf-8');
  }

  public configure(next: Partial<StorageConfig>): StorageConfig {
    const requestedMode = next.mode ?? this.config.mode;
    const bucket = (next.bucket ?? this.config.bucket).trim();
    const region = (next.region ?? this.config.region).trim() || 'us-east-1';
    const rawPrefix = (next.prefix ?? this.config.prefix).trim();
    const prefix = rawPrefix && !rawPrefix.endsWith('/') ? `${rawPrefix}/` : rawPrefix;

    if (!bucket || !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket)) {
      throw new Error('Bucket name must be 3-63 characters using lowercase letters, numbers, dots, or hyphens.');
    }
    if (!/^[a-z]{2}-[a-z]+-\d+$/.test(region)) {
      throw new Error('Region must be a valid AWS region identifier (e.g., us-east-1, eu-west-1).');
    }

    if (requestedMode === 'aws_s3' && !this.hasAwsCredentials()) {
      throw new Error(
        'Cannot activate live AWS S3 mode because AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY are not set in backend environment variables. Keep Local Simulation Mode active until backend credentials are configured.'
      );
    }

    this.config = { mode: requestedMode, bucket, region, prefix };
    return { ...this.config };
  }

  public async getStatus(): Promise<StorageStatus> {
    const creds = this.hasAwsCredentials();
    const files = await this.listFiles().catch(() => []);
    const lastUploadAt = files.length > 0 ? files[0].uploaded_at : null;

    if (this.config.mode === 'aws_s3') {
      const connected = creds && Boolean(this.config.bucket);
      return {
        mode: 'aws_s3',
        aws_credentials_configured: creds,
        bucket: this.config.bucket,
        region: this.config.region,
        prefix: this.config.prefix,
        connected,
        stored_files_count: files.length,
        last_upload_at: lastUploadAt,
        message: connected
          ? `Connected to AWS S3 bucket "${this.config.bucket}" (${this.config.region}).`
          : 'AWS S3 mode selected, but backend AWS credentials are missing.',
      };
    }

    return {
      mode: 'local_simulation',
      aws_credentials_configured: creds,
      bucket: this.config.bucket,
      region: this.config.region,
      prefix: this.config.prefix,
      connected: true,
      stored_files_count: files.length,
      last_upload_at: lastUploadAt,
      message: creds
        ? 'Running in Local Simulation Mode. Backend AWS credentials are detected and ready if you switch to AWS S3 mode.'
        : 'Running in Local Simulation Mode (AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY not set on backend). Datasets are persisted locally in data/cloud_sim/.',
    };
  }

  public async uploadCsv(
    filename: string,
    csvContent: string,
    recordCount: number
  ): Promise<StoredDatasetFile> {
    const safeName = sanitizeFilename(filename);
    const timestamp = new Date().toISOString();
    const buffer = Buffer.from(csvContent, 'utf-8');

    if (this.config.mode === 'aws_s3') {
      if (!this.hasAwsCredentials() || !this.config.bucket) {
        throw new Error(
          'AWS S3 upload blocked: backend AWS credentials or bucket name are missing. No fake upload was performed.'
        );
      }
      const client = this.createS3Client();
      const s3Key = `${this.config.prefix}${safeName}`;
      await client.send(
        new PutObjectCommand({
          Bucket: this.config.bucket,
          Key: s3Key,
          Body: buffer,
          ContentType: 'text/csv; charset=utf-8',
          Metadata: {
            record_count: String(recordCount),
            uploaded_at: timestamp,
          },
        })
      );
      return {
        key: safeName,
        filename: safeName,
        size_bytes: buffer.byteLength,
        uploaded_at: timestamp,
        storage_mode: 'aws_s3',
        record_count: recordCount,
        bucket: this.config.bucket,
      };
    }

    // Local Simulation Mode — genuinely persists CSV on server disk
    const targetPath = resolveConfinedPath(this.localSimDir, safeName);
    fs.writeFileSync(targetPath, buffer);

    const manifest = this.readManifest().filter((entry) => entry.key !== safeName);
    const entry: LocalManifestEntry = {
      key: safeName,
      filename: safeName,
      size_bytes: buffer.byteLength,
      uploaded_at: timestamp,
      record_count: recordCount,
      bucket: this.config.bucket,
    };
    manifest.unshift(entry);
    this.writeManifest(manifest);

    return {
      ...entry,
      storage_mode: 'local_simulation',
    };
  }

  public async listFiles(): Promise<StoredDatasetFile[]> {
    if (this.config.mode === 'aws_s3') {
      if (!this.hasAwsCredentials() || !this.config.bucket) {
        return [];
      }
      const client = this.createS3Client();
      const res = await client.send(
        new ListObjectsV2Command({
          Bucket: this.config.bucket,
          Prefix: this.config.prefix || undefined,
        })
      );
      const items = (res.Contents ?? [])
        .filter((obj) => obj.Key && obj.Key.endsWith('.csv'))
        .map((obj) => {
          const filename = path.basename(obj.Key!);
          return {
            key: filename,
            filename,
            size_bytes: obj.Size ?? 0,
            uploaded_at: (obj.LastModified ?? new Date()).toISOString(),
            storage_mode: 'aws_s3' as const,
            bucket: this.config.bucket,
          };
        });
      items.sort((a, b) => b.uploaded_at.localeCompare(a.uploaded_at));
      return items;
    }

    const manifest = this.readManifest().filter((entry) => {
      try {
        const p = resolveConfinedPath(this.localSimDir, entry.key);
        return fs.existsSync(p);
      } catch {
        return false;
      }
    });

    return manifest
      .sort((a, b) => b.uploaded_at.localeCompare(a.uploaded_at))
      .map((entry) => ({
        ...entry,
        storage_mode: 'local_simulation' as const,
      }));
  }

  public async retrieveCsv(key: string): Promise<{ filename: string; content: string }> {
    const safeName = sanitizeFilename(key);

    if (this.config.mode === 'aws_s3') {
      const client = this.createS3Client();
      const s3Key = `${this.config.prefix}${safeName}`;
      const res = await client.send(
        new GetObjectCommand({
          Bucket: this.config.bucket,
          Key: s3Key,
        })
      );
      const content = res.Body ? await res.Body.transformToString('utf-8') : '';
      if (!content) {
        throw new Error(`Stored file "${safeName}" was empty or could not be read from S3.`);
      }
      return { filename: safeName, content };
    }

    const targetPath = resolveConfinedPath(this.localSimDir, safeName);
    if (!fs.existsSync(targetPath)) {
      throw new Error(`Stored dataset "${safeName}" was not found.`);
    }
    const content = fs.readFileSync(targetPath, 'utf-8');
    return { filename: safeName, content };
  }
}
