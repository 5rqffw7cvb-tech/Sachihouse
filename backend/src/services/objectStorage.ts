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
  // Issued invoice PDFs. They are financial records with a statutory retention
  // period, so they get their own bucket when one is configured — a lifecycle
  // rule that expires receipts must never reach them. Falls back to the receipt
  // bucket, then the shared one.
  private readonly invoiceBucketName = process.env.GCS_INVOICE_BUCKET
    || process.env.GCS_RECEIPT_BUCKET
    || process.env.GCS_BUCKET
    || '';
  // Mirrors the bucket chain above, deliberately: whatever bucket this lands on,
  // the project and credentials must be the ones that bucket was granted to.
  private readonly invoiceProjectId = process.env.GCP_INVOICE_PROJECT_ID
    || process.env.GCP_RECEIPT_PROJECT_ID
    || process.env.GCP_PROJECT_ID;
  // Public bucket for property media (gallery/room/host images). Unlike receipts,
  // these are shown on the public website, so they need stable public URLs (no
  // signed-URL expiry). The bucket must be world-readable via IAM allUsers.
  private readonly publicBucketName = process.env.GCS_PUBLIC_BUCKET ?? '';
  private readonly publicProjectId = process.env.GCP_PUBLIC_PROJECT_ID || process.env.GCP_PROJECT_ID;
  // Optional custom domain / CDN (e.g. https://cdn.sachihouse.com) put in front of the
  // public bucket so served URLs hide the raw storage.googleapis.com origin.
  private readonly publicBaseUrl = (process.env.GCS_PUBLIC_BASE_URL ?? '').replace(/\/+$/, '');
  private readonly storage = (this.bucketName || this.receiptBucketName)
    ? new Storage({ projectId: this.projectId || undefined, ...ObjectStorageService.credentialsOption() })
    : null;
  // Receipts can use a dedicated service account (e.g. one scoped to the receipt
  // bucket). Falls back to the shared credentials when no receipt-specific key is set.
  private readonly receiptStorage = this.receiptBucketName
    ? new Storage({ projectId: this.receiptProjectId || undefined, ...ObjectStorageService.receiptCredentialsOption() })
    : null;
  // Invoices can use a dedicated SA; see invoiceCredentialsOption for the chain.
  private readonly invoiceStorage = this.invoiceBucketName
    ? new Storage({ projectId: this.invoiceProjectId || undefined, ...ObjectStorageService.invoiceCredentialsOption() })
    : null;
  // Public media can use a dedicated SA; falls back to the shared credentials.
  private readonly publicStorage = this.publicBucketName
    ? new Storage({ projectId: this.publicProjectId || undefined, ...ObjectStorageService.publicCredentialsOption() })
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

  /**
   * Credentials for the invoice bucket, falling back exactly the way the bucket
   * name does: invoice, then receipt, then shared.
   *
   * Falling back straight to the shared account was a bug. The invoice bucket
   * defaults to the receipt bucket, so on a deployment with a dedicated receipt
   * service account the upload was signed by the shared one — an account that
   * bucket had never been granted, and every archive failed with
   * `storage.objects.create denied`. The two chains have to agree.
   */
  private static invoiceCredentialsOption(): { credentials?: object } {
    const dedicated = ObjectStorageService.parseCredentials(
      process.env.GCP_INVOICE_SERVICE_ACCOUNT_JSON,
      process.env.GCP_INVOICE_SERVICE_ACCOUNT_JSON_B64,
    );
    return dedicated.credentials ? dedicated : ObjectStorageService.receiptCredentialsOption();
  }

  private static publicCredentialsOption(): { credentials?: object } {
    const dedicated = ObjectStorageService.parseCredentials(
      process.env.GCP_PUBLIC_SERVICE_ACCOUNT_JSON,
      process.env.GCP_PUBLIC_SERVICE_ACCOUNT_JSON_B64,
    );
    return dedicated.credentials ? dedicated : ObjectStorageService.credentialsOption();
  }

  // Choose the right Storage client for a bucket: receipt objects must be
  // signed/deleted with the receipt credentials so the resulting URL is authorized.
  private clientForBucket(bucketName: string): Storage | null {
    // Invoices first: their bucket may be the same name as the receipt bucket,
    // but when a dedicated invoice service account exists it is the one whose
    // signature the object will accept.
    if (bucketName === this.invoiceBucketName && this.invoiceStorage) {
      return this.invoiceStorage;
    }
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

  // Aggressively compress a receipt to a small AVIF — just legible enough to confirm
  // the amount/vendor, not archival quality. OCR runs on the raw image upstream, so
  // this only affects the stored copy a human reviews.
  async compressReceiptToAvif(buffer: Buffer, mimeType: string): Promise<{ buffer: Buffer; mimeType: string }> {
    if (!MIME_ALLOWLIST.has(mimeType)) {
      throw new Error('Only JPEG/PNG/WebP images are allowed.');
    }

    const TARGET_BYTES = 40 * 1024; // ~40 KB
    let quality = 42;
    let compressed: Buffer;

    do {
      compressed = await sharp(buffer)
        .rotate()
        .resize({ width: 1100, height: 1100, fit: 'inside', withoutEnlargement: true })
        .avif({ quality, effort: 4 })
        .toBuffer();
      quality -= 8;
    } while (compressed.length > TARGET_BYTES && quality >= 18);

    return { buffer: compressed, mimeType: 'image/avif' };
  }

  // Decode any stored image (e.g. AVIF) into JPEG bytes for OCR, since Gemini does
  // not accept AVIF input.
  async decodeToJpeg(buffer: Buffer): Promise<Buffer> {
    return sharp(buffer).rotate().jpeg({ quality: 90 }).toBuffer();
  }

  // Compress + convert property media to AVIF. AVIF gives ~50% smaller files than
  // JPEG at similar quality (the approach Airbnb uses for its listing photos),
  // which keeps the public site fast. Input must be JPEG/PNG/WebP; output is AVIF.
  async compressToAvif(buffer: Buffer, mimeType: string): Promise<{ buffer: Buffer; mimeType: string }> {
    if (!MIME_ALLOWLIST.has(mimeType)) {
      throw new Error('Only JPEG/PNG/WebP images are allowed.');
    }

    const compressed = await sharp(buffer)
      .rotate()
      .resize({
        width: 2000,
        height: 2000,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .avif({ quality: 50, effort: 4 })
      .toBuffer();

    return { buffer: compressed, mimeType: 'image/avif' };
  }

  // Upload a property gallery/room/host image to the public bucket and return a
  // stable public URL. Falls back to an inline AVIF data URI when no public bucket
  // is configured (local dev) so the feature still works end-to-end.
  async uploadPropertyImage(params: {
    imageBuffer: Buffer;
    mimeType: string;
    propertyId: string;
  }): Promise<{ url: string; mimeType: string; sizeBytes: number }> {
    const avif = await this.compressToAvif(params.imageBuffer, params.mimeType);
    const safeProperty = toSafeSegment(params.propertyId);
    const rand = Math.random().toString(36).slice(2, 8);
    const objectName = `properties/${safeProperty}/${Date.now()}_${rand}.avif`;

    if (!this.publicStorage || !this.publicBucketName) {
      return {
        url: `data:${avif.mimeType};base64,${avif.buffer.toString('base64')}`,
        mimeType: avif.mimeType,
        sizeBytes: avif.buffer.length,
      };
    }

    const bucket = this.publicStorage.bucket(this.publicBucketName);
    const file = bucket.file(objectName);

    // The bucket is world-readable via IAM (allUsers:objectViewer), so we do NOT
    // set a per-object ACL — that would fail on uniform bucket-level access.
    await file.save(avif.buffer, {
      contentType: avif.mimeType,
      resumable: false,
      metadata: { cacheControl: 'public, max-age=31536000, immutable' },
    });

    return {
      // Prefer the custom domain / CDN when configured; otherwise the raw GCS URL.
      url: this.publicBaseUrl
        ? `${this.publicBaseUrl}/${objectName}`
        : `https://storage.googleapis.com/${this.publicBucketName}/${objectName}`,
      mimeType: avif.mimeType,
      sizeBytes: avif.buffer.length,
    };
  }

  async uploadReceiptImage(params: {
    imageBuffer: Buffer;
    mimeType: string;
    propertyId: string;
  }): Promise<UploadResult> {
    const safeProperty = toSafeSegment(params.propertyId);
    const ext = params.mimeType === 'image/avif' ? 'avif'
      : params.mimeType === 'image/png' ? 'png'
      : params.mimeType === 'image/webp' ? 'webp'
      : 'jpg';
    const objectName = `receipts/${safeProperty}/${Date.now()}.${ext}`;

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

  // Store a receipt PDF as-is (no compression) — used by the email-receipt
  // ingest webhook to keep the original invoice PDF as evidence.
  async uploadReceiptPdf(params: {
    pdfBuffer: Buffer;
    propertyId: string;
    fileNameHint?: string;
  }): Promise<UploadResult> {
    const safeProperty = toSafeSegment(params.propertyId);
    const safeHint = params.fileNameHint ? toSafeSegment(params.fileNameHint.replace(/\.pdf$/i, '')) : 'receipt';
    const objectName = `receipts/${safeProperty}/${Date.now()}_${safeHint}.pdf`;

    if (!this.receiptStorage || !this.receiptBucketName) {
      return {
        evidenceUrl: `data:application/pdf;base64,${params.pdfBuffer.toString('base64')}`,
        mimeType: 'application/pdf',
        sizeBytes: params.pdfBuffer.length,
      };
    }

    const bucket = this.receiptStorage.bucket(this.receiptBucketName);
    const file = bucket.file(objectName);

    await file.save(params.pdfBuffer, {
      contentType: 'application/pdf',
      resumable: false,
      metadata: { cacheControl: 'private, max-age=0, no-store' },
    });

    return {
      evidenceUrl: `gcs://${this.receiptBucketName}/${objectName}`,
      mimeType: 'application/pdf',
      sizeBytes: params.pdfBuffer.length,
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


  /** Whether issued invoice PDFs can be archived at all. False means the host
   *  keeps only the copy their browser downloaded. */
  get invoiceArchiveEnabled(): boolean {
    return Boolean(this.invoiceStorage && this.invoiceBucketName);
  }

  /**
   * The bucket invoices are filed into, or null when none resolved.
   *
   * Surfaced to the console because the alternative is asking someone to read
   * deployment variables to answer "did my setting take effect?". A bucket name
   * is not a secret, and the screen that shows it is level-4 only.
   */
  get invoiceBucket(): string | null {
    return this.invoiceBucketName || null;
  }

  /**
   * Archives an issued invoice PDF, unmodified.
   *
   * No compression, unlike every other upload here: this is the 写し a qualified
   * invoice issuer is required to keep, and it has to be byte-identical to what
   * the guest received.
   *
   * The object path carries the issuer and the fiscal year because that is how
   * an accountant asks for them — "everything I issued in 2026" — and a bucket
   * prefix answers that without a database.
   */
  async uploadInvoicePdf(params: {
    pdfBuffer: Buffer;
    issuerUserId: number;
    fiscalYear: number;
    invoiceNo: string;
    fileNameHint?: string;
  }): Promise<{ objectPath: string; sizeBytes: number }> {
    const safeNo = toSafeSegment(params.invoiceNo);
    const safeHint = params.fileNameHint
      ? `_${toSafeSegment(params.fileNameHint.replace(/\.pdf$/i, ''))}`
      : '';
    const objectName =
      `invoices/${params.issuerUserId}/${params.fiscalYear}/${safeNo}${safeHint}.pdf`;

    if (!this.invoiceStorage || !this.invoiceBucketName) {
      throw new Error('No invoice bucket is configured on this server.');
    }

    const file = this.invoiceStorage.bucket(this.invoiceBucketName).file(objectName);

    await file.save(params.pdfBuffer, {
      contentType: 'application/pdf',
      resumable: false,
      metadata: {
        cacheControl: 'private, max-age=0, no-store',
        // Reissuing under the same number would otherwise silently replace the
        // copy that was already handed to a guest.
        metadata: { invoiceNo: params.invoiceNo, issuerUserId: String(params.issuerUserId) },
      },
    });

    return {
      objectPath: `gcs://${this.invoiceBucketName}/${objectName}`,
      sizeBytes: params.pdfBuffer.length,
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


  /**
   * Removes an archived invoice PDF — every version of it.
   *
   * Two reasons this is not deleteEvidenceObject. First, `file.delete()` on a
   * bucket with Object Versioning enabled only retires the live generation: the
   * data stays as a noncurrent version, still stored and still readable. For a
   * document being deleted precisely because it should never have existed,
   * "deleted" has to mean every generation.
   *
   * Second, this one throws. Evidence cleanup is best-effort, but an invoice
   * PDF left in the bucket after the row is gone is an orphan nobody will ever
   * find again, so the caller is told and can say so.
   */
  async deleteInvoiceObject(objectPath: string): Promise<void> {
    const reference = resolveGcsTarget(objectPath);
    const client = reference ? this.clientForBucket(reference.bucketName) : null;
    if (!reference || !client) {
      return;
    }

    const bucket = client.bucket(reference.bucketName);
    // Prefix listing, then an exact-name filter: a prefix alone would also
    // match a sibling whose name merely starts with this one.
    const [files] = await bucket.getFiles({ prefix: reference.objectName, versions: true });
    const generations = files.filter((file) => file.name === reference.objectName);

    if (generations.length === 0) {
      await bucket.file(reference.objectName).delete({ ignoreNotFound: true });
      return;
    }

    for (const generation of generations) {
      await generation.delete({ ignoreNotFound: true });
    }
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
