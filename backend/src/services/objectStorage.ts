import sharp from 'sharp';
import { Storage } from '@google-cloud/storage';

export interface UploadResult {
  evidenceUrl: string;
  mimeType: string;
  sizeBytes: number;
}

const MIME_ALLOWLIST = new Set(['image/jpeg', 'image/png', 'image/webp']);
const SIGNED_URL_TTL_MS = 10 * 60 * 1000;

function toSafeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80) || 'item';
}

function parseGcsReference(value: string): { bucketName: string; objectName: string } | null {
  if (!value.startsWith('gcs://')) {
    return null;
  }

  const remainder = value.slice('gcs://'.length);
  const firstSlash = remainder.indexOf('/');
  if (firstSlash === -1) {
    return null;
  }

  const bucketName = remainder.slice(0, firstSlash).trim();
  const objectName = remainder.slice(firstSlash + 1).trim();
  if (!bucketName || !objectName) {
    return null;
  }

  return { bucketName, objectName };
}

// Parse a signed/public GCS URL like https://storage.googleapis.com/{bucket}/{object}?X-Goog-...
function parseSignedGcsUrl(value: string): { bucketName: string; objectName: string } | null {
  const m = value.match(/^https?:\/\/storage\.googleapis\.com\/([^/]+)\/(.+?)(?:\?|#|$)/i);
  if (!m) {
    return null;
  }
  const bucketName = m[1].trim();
  const objectName = decodeURIComponent(m[2]).trim();
  if (!bucketName || !objectName) {
    return null;
  }
  return { bucketName, objectName };
}

// Resolve any stored receipt reference (gcs:// path or signed URL) to a bucket+object.
function resolveGcsTarget(value: string): { bucketName: string; objectName: string } | null {
  return parseGcsReference(value) ?? parseSignedGcsUrl(value);
}

export class ObjectStorageService {
  private readonly bucketName = process.env.GCS_BUCKET ?? '';
  // Receipts may live in a dedicated bucket; fall back to the shared bucket.
  private readonly receiptBucketName = process.env.GCS_RECEIPT_BUCKET || process.env.GCS_BUCKET || '';
  private readonly projectId = process.env.GCP_PROJECT_ID;
  private readonly receiptProjectId = process.env.GCP_RECEIPT_PROJECT_ID || process.env.GCP_PROJECT_ID;
  private readonly prefix = process.env.GCS_PREFIX ?? 'checkins';
  private readonly storage = (this.bucketName || this.receiptBucketName)
    ? new Storage({ projectId: this.projectId || undefined, ...ObjectStorageService.credentialsOption() })
    : null;
  // Receipts can use a dedicated service account (e.g. one scoped to the receipt
  // bucket). Falls back to the shared credentials when no receipt-specific key is set.
  private readonly receiptStorage = this.receiptBucketName
    ? new Storage({ projectId: this.receiptProjectId || undefined, ...ObjectStorageService.receiptCredentialsOption() })
    : null;

  private static parseCredentials(raw?: string, b64?: string): { credentials?: object } {
    if (raw) {
      try {
        return { credentials: JSON.parse(raw) };
      } catch {
        // fall through
      }
    }
    if (b64) {
      try {
        return { credentials: JSON.parse(Buffer.from(b64, 'base64').toString('utf8')) };
      } catch {
        // fall through
      }
    }
    return {};
  }

  private static credentialsOption(): { credentials?: object } {
    return ObjectStorageService.parseCredentials(
      process.env.GCP_SERVICE_ACCOUNT_JSON,
      process.env.GCP_SERVICE_ACCOUNT_JSON_B64,
    );
  }

  private static receiptCredentialsOption(): { credentials?: object } {
    const dedicated = ObjectStorageService.parseCredentials(
      process.env.GCP_RECEIPT_SERVICE_ACCOUNT_JSON,
      process.env.GCP_RECEIPT_SERVICE_ACCOUNT_JSON_B64,
    );
    return dedicated.credentials ? dedicated : ObjectStorageService.credentialsOption();
  }

  // Choose the right Storage client for a bucket: receipt objects must be
  // signed/deleted with the receipt credentials so the resulting URL is authorized.
  private clientForBucket(bucketName: string): Storage | null {
    if (bucketName === this.receiptBucketName && this.receiptStorage) {
      return this.receiptStorage;
    }
    return this.storage;
  }

  async compressImage(buffer: Buffer, mimeType: string): Promise<{ buffer: Buffer; mimeType: string }> {
    if (!MIME_ALLOWLIST.has(mimeType)) {
      throw new Error('Only JPEG/PNG/WebP images are allowed.');
    }

    const compressed = await sharp(buffer)
      .rotate()
      .resize({
        width: 1800,
        height: 1800,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .jpeg({ quality: 82, mozjpeg: true })
      .toBuffer();

    return {
      buffer: compressed,
      mimeType: 'image/jpeg',
    };
  }

  async compressReceiptImage(buffer: Buffer, mimeType: string): Promise<{ buffer: Buffer; mimeType: string }> {
    if (!MIME_ALLOWLIST.has(mimeType)) {
      throw new Error('Only JPEG/PNG/WebP images are allowed.');
    }

    const TARGET_BYTES = 100 * 1024; // 100 KB
    let quality = 82;
    let compressed: Buffer;

    do {
      compressed = await sharp(buffer)
        .rotate()
        .resize({ width: 1400, height: 1400, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality, mozjpeg: true })
        .toBuffer();
      quality -= 10;
    } while (compressed.length > TARGET_BYTES && quality > 10);

    return { buffer: compressed, mimeType: 'image/jpeg' };
  }

  async uploadReceiptImage(params: {
    imageBuffer: Buffer;
    mimeType: string;
    propertyId: string;
  }): Promise<UploadResult> {
    const safeProperty = toSafeSegment(params.propertyId);
    const objectName = `receipts/${safeProperty}/${Date.now()}.jpg`;

    if (!this.receiptStorage || !this.receiptBucketName) {
      return {
        evidenceUrl: `data:${params.mimeType};base64,${params.imageBuffer.toString('base64')}`,
        mimeType: params.mimeType,
        sizeBytes: params.imageBuffer.length,
      };
    }

    const bucket = this.receiptStorage.bucket(this.receiptBucketName);
    const file = bucket.file(objectName);

    await file.save(params.imageBuffer, {
      contentType: params.mimeType,
      resumable: false,
      metadata: { cacheControl: 'private, max-age=0, no-store' },
    });

    return {
      // Bucket name is embedded in the path, so signed-URL and delete operations
      // automatically target the receipt bucket.
      evidenceUrl: `gcs://${this.receiptBucketName}/${objectName}`,
      mimeType: params.mimeType,
      sizeBytes: params.imageBuffer.length,
    };
  }

  async uploadEvidenceImage(params: {
    imageBuffer: Buffer;
    mimeType: string;
    propertyId: string;
    guestId: string;
  }): Promise<UploadResult> {
    const safeProperty = toSafeSegment(params.propertyId);
    const safeGuest = toSafeSegment(params.guestId);
    const objectName = `${this.prefix}/${safeProperty}/${Date.now()}_${safeGuest}.jpg`;

    if (!this.storage || !this.bucketName) {
      return {
        evidenceUrl: `data:${params.mimeType};base64,${params.imageBuffer.toString('base64')}`,
        mimeType: params.mimeType,
        sizeBytes: params.imageBuffer.length,
      };
    }

    const bucket = this.storage.bucket(this.bucketName);
    const file = bucket.file(objectName);

    await file.save(params.imageBuffer, {
      contentType: params.mimeType,
      resumable: false,
      metadata: {
        cacheControl: 'private, max-age=0, no-store',
      },
    });

    return {
      evidenceUrl: `gcs://${this.bucketName}/${objectName}`,
      mimeType: params.mimeType,
      sizeBytes: params.imageBuffer.length,
    };
  }

  async getEvidenceAccessUrl(evidenceUrl: string): Promise<string> {
    if (!evidenceUrl || evidenceUrl.startsWith('data:') || /^https?:\/\//i.test(evidenceUrl)) {
      return evidenceUrl;
    }

    const reference = parseGcsReference(evidenceUrl);
    const client = reference ? this.clientForBucket(reference.bucketName) : null;
    if (!reference || !client) {
      return evidenceUrl;
    }

    const [signedUrl] = await client
      .bucket(reference.bucketName)
      .file(reference.objectName)
      .getSignedUrl({
        version: 'v4',
        action: 'read',
        expires: Date.now() + SIGNED_URL_TTL_MS,
      });

    return signedUrl;
  }

  // Normalize a receipt reference to a canonical gcs:// path before persisting,
  // so a (temporary) signed URL coming back from the client never overwrites storage.
  toStorageReference(value?: string): string | undefined {
    if (!value) return value;
    const signed = parseSignedGcsUrl(value);
    if (signed) return `gcs://${signed.bucketName}/${signed.objectName}`;
    return value;
  }

  async deleteEvidenceObject(evidenceUrl: string): Promise<void> {
    if (!evidenceUrl || evidenceUrl.startsWith('data:')) {
      return;
    }

    // Accept both gcs:// paths and signed storage.googleapis.com URLs.
    const reference = resolveGcsTarget(evidenceUrl);
    const client = reference ? this.clientForBucket(reference.bucketName) : null;
    if (!reference || !client) {
      return;
    }

    await client
      .bucket(reference.bucketName)
      .file(reference.objectName)
      .delete({ ignoreNotFound: true });
  }
}
