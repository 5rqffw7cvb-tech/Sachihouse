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

export class ObjectStorageService {
  private readonly bucketName = process.env.GCS_BUCKET ?? '';
  private readonly projectId = process.env.GCP_PROJECT_ID;
  private readonly prefix = process.env.GCS_PREFIX ?? 'checkins';
  private readonly storage = this.bucketName
    ? new Storage({ projectId: this.projectId || undefined })
    : null;

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
    if (!reference || !this.storage) {
      return evidenceUrl;
    }

    const [signedUrl] = await this.storage
      .bucket(reference.bucketName)
      .file(reference.objectName)
      .getSignedUrl({
        version: 'v4',
        action: 'read',
        expires: Date.now() + SIGNED_URL_TTL_MS,
      });

    return signedUrl;
  }

  async deleteEvidenceObject(evidenceUrl: string): Promise<void> {
    if (!evidenceUrl || evidenceUrl.startsWith('data:')) {
      return;
    }

    const reference = parseGcsReference(evidenceUrl);
    if (!reference || !this.storage) {
      return;
    }

    await this.storage
      .bucket(reference.bucketName)
      .file(reference.objectName)
      .delete({ ignoreNotFound: true });
  }
}
