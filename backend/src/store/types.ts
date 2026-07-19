import { Role } from '../types/domain.js';

export interface AuthUser {
  id: number;
  name: string;
  email: string;
  role: Role;
  canEditBlog: boolean;
  archivedAt?: number | null;
  assignedPropertyIds: string[];
  hostLevel: 1 | 2 | 3 | 4 | null;
  lastSeenAt?: number | null;
}

export interface StoredUser extends AuthUser {
  passwordHash: string;
}

export interface BlogPost {
  id: string;
  title: string;
  excerpt: string;
  content: string;
  contentFormat?: 'markdown' | 'rich_text' | 'html';
  createdAt: number;
  updatedAt: number;
  imageUrl: string;
  category: string;
  isFeatured: boolean;
  authorId: number;
  archivedAt?: number | null;
}

export interface SiteSettings {
  navTitle: string;
  headerTitle: string;
  headerSubtitle: string;
  browserTitle: string;
  faviconUrl: string;
  footerTitle: string;
  footerCopyright: string;
  listingFilters?: {
    allowedLocations: Array<{
      countryCode: string;
      countryName: string;
      provinceCode: string;
      provinceName: string;
    }>;
  };
  hostPlans?: HostPlansConfig;
}

export type HostPlanCode = 'basic' | 'plus' | 'pro';
export type BillingCycle = 'monthly' | 'yearly';

// Editable from the admin "Services" page. Prices are the monthly price per
// unit in the configured currency; the yearly price is derived by applying
// yearlyDiscountPercent to 12 months.
export interface HostPlansConfig {
  currency: string;               // e.g. 'JPY'
  yearlyDiscountPercent: number;  // e.g. 20
  plans: Record<HostPlanCode, { monthlyPrice: number }>;
}

// Maps a purchasable plan to the host level it grants once an admin approves
// the request. Basic = level 2, Plus = level 3, Pro = level 4.
export const PLAN_TO_HOST_LEVEL: Record<HostPlanCode, 2 | 3 | 4> = {
  basic: 2,
  plus: 3,
  pro: 4,
};

export type SubscriptionRequestStatus = 'pending' | 'approved' | 'rejected';

export interface SubscriptionRequest {
  id: string;
  userId: number;
  userName: string;
  userEmail: string;
  planCode: HostPlanCode;
  billingCycle: BillingCycle;
  status: SubscriptionRequestStatus;
  createdAt: number;
  updatedAt: number;
  decidedByUserId?: number | null;
}

export type IdDocumentType = 'passport' | 'driver_license' | 'residence_card' | 'national_id' | 'unknown';

export interface CheckInGuestEstimatedFlags {
  fullName?: boolean;
  birthYear?: boolean;
  nationality?: boolean;
  address?: boolean;
  gender?: boolean;
  occupation?: boolean;
  documentType?: boolean;
  documentNumber?: boolean;
}

export interface CheckInGuestConfidence {
  fullName?: number;
  birthYear?: number;
  nationality?: number;
  address?: number;
  gender?: number;
  occupation?: number;
  documentType?: number;
  documentNumber?: number;
}

export interface CheckInGuest {
  id: string;
  fullName: string;
  birthYear: number | null;
  nationality: string;
  address: string;
  gender: string;
  occupation: string;
  documentType: IdDocumentType;
  documentNumber: string;
  evidenceUrl: string;
  evidenceMimeType: string;
  ocrText?: string;
  estimated: CheckInGuestEstimatedFlags;
  confidence: CheckInGuestConfidence;
  contactInfo?: string;
  previousLocation?: string;
  nextLocation?: string;
}

export interface CheckInConsent {
  accepted: boolean;
  acceptedAt: number;
  retentionDays: number;
  noticeVersion: string;
}

export interface CheckInAuditInfo {
  submittedAt: number;
  ipAddress: string;
  userAgent: string;
}

export interface CheckInSubmission {
  id: string;
  propertyId: string;
  checkInDate: string;
  checkOutDate: string;
  checkInTime?: string;
  checkOutTime?: string;
  guests: CheckInGuest[];
  consent: CheckInConsent;
  audit: CheckInAuditInfo;
  createdAt: number;
  updatedAt: number;
}

export interface CheckInSubmissionInput {
  propertyId: string;
  checkInDate: string;
  checkOutDate: string;
  checkInTime?: string;
  checkOutTime?: string;
  guests: CheckInGuest[];
  consent: CheckInConsent;
  audit: CheckInAuditInfo;
}

export interface CheckInListFilters {
  propertyId?: string;
  fromDate?: string;
  toDate?: string;
  guestName?: string;
  nationality?: string;
}

// A host-generated booking confirmation for a direct (off-platform) booking.
// Amounts are whole-currency units (JPY has no minor unit). The property's
// name/address/public URL are snapshotted at creation time so the stored record
// (and any regenerated PDF) stays stable even if the property is later edited.
export interface BookingConfirmation {
  id: string;
  confirmationNo: string;   // human-readable, e.g. BC-20260719-AB12
  propertyId: string;
  propertyName: string;
  propertyAddress: string;
  propertyUrl: string;      // public listing URL captured at creation
  guestName: string;
  guestEmail?: string;
  guestPhone?: string;
  numGuests: number;
  checkInDate: string;      // YYYY-MM-DD
  checkOutDate: string;     // YYYY-MM-DD
  checkInTime: string;      // HH:mm (default 15:00)
  checkOutTime: string;     // HH:mm (default 10:00)
  currency: string;         // e.g. JPY
  roomFee: number;
  cleaningFee: number;
  extraFeeLabel?: string;
  extraFee: number;
  totalAmount: number;
  depositAmount: number;
  balanceDue: number;
  notes?: string;
  // When true the host has opted this direct-booking revenue into accounting.
  // Currently informational only — it is NOT auto-posted to the double-entry
  // journal, but it drives the direct-booking revenue report.
  includeInAccounting: boolean;
  createdByUserId: number;
  createdByName: string;
  createdAt: number;
  updatedAt: number;
}

// Builds a human-readable confirmation number like BC-20260719-A1B2 from a
// timestamp plus a short random suffix (collisions are effectively impossible
// at this volume and the id column, not this string, is the real key).
export function generateConfirmationNo(timestamp: number): string {
  const date = new Date(timestamp);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `BC-${y}${m}${d}-${suffix}`;
}

export interface BookingConfirmationInput {
  propertyId: string;
  propertyName: string;
  propertyAddress: string;
  propertyUrl: string;
  guestName: string;
  guestEmail?: string;
  guestPhone?: string;
  numGuests: number;
  checkInDate: string;
  checkOutDate: string;
  checkInTime: string;
  checkOutTime: string;
  currency: string;
  roomFee: number;
  cleaningFee: number;
  extraFeeLabel?: string;
  extraFee: number;
  totalAmount: number;
  depositAmount: number;
  balanceDue: number;
  notes?: string;
  includeInAccounting: boolean;
  createdByUserId: number;
  createdByName: string;
}

export interface BookingConfirmationListFilters {
  propertyId?: string;
  fromDate?: string;   // filters on checkInDate >= fromDate
  toDate?: string;     // filters on checkInDate <= toDate
  guestName?: string;
}

export interface BookingConfirmationPatch {
  guestName?: string;
  guestEmail?: string;
  guestPhone?: string;
  numGuests?: number;
  checkInDate?: string;
  checkOutDate?: string;
  checkInTime?: string;
  checkOutTime?: string;
  roomFee?: number;
  cleaningFee?: number;
  extraFeeLabel?: string;
  extraFee?: number;
  totalAmount?: number;
  depositAmount?: number;
  balanceDue?: number;
  notes?: string;
  includeInAccounting?: boolean;
}

export interface PropertyData {
  id?: string;
  metalink?: string;
  archivedAt?: number | null;
  reviewStatus?: 'approved' | 'pending_review';
  name: string;
  subtitle: string;
  description: string;
  address: string;
  location?: {
    countryCode: string;
    countryName: string;
    provinceCode: string;
    provinceName: string;
    cityName?: string;
  };
  mapEmbedUrl: string;
  hostName: string;
  hostImageUrl: string;
  isSuperhost?: boolean;
  superhostSince?: string;
  themeColor?: 'blue' | 'airbnb' | 'booking' | 'agoda';
  adminEmail?: string;
  maxGuests: number;
  bedrooms: number;
  beds: number;
  baths: number;
  bathFacilityType: 'bathroom' | 'shower_room';
  toilets: number;
  highlights: Array<{ id: string; title: string; description: string; icon: string }>;
  accessInfo: {
    train: string;
    airport: string;
    checkIn: string;
    nearestStationName?: string;
    nearestStationDistance?: string;
    nearestAirportDriveTime?: string;
    youtubeGuideUrl?: string;
  };
  additionalRules: string;
  pricing: {
    rates: Array<{ guests: number; price: number }>;
    cleaning: Array<{ minGuests: number; maxGuests: number; price: number }>;
    childDiscountPercent: number;
    childAgeMin: number;
    childAgeMax: number;
    longStayDiscountPercent: number;
    longStayMinNights: number;
  };
  rules: Array<{ id: string; text: string; icon: string; type: 'allowed' | 'forbidden' }>;
  manual: Array<{ id: string; title: string; content: string; imageUrl?: string }>;
  icalFeeds: Array<{ id: string; name: string; url: string; lastSynced: string }>;
  amenities: string[];
  galleryCategories: Array<{ id: string; label: string }>;
  galleryImages: Array<{ id: string; url: string; caption: string; category: string; showOnHome?: boolean }>;
  sleepingArrangements: Array<{ id: string; title: string; description: string; imageUrl: string; photos?: string[] }>;
  social: {
    facebookUrl: string;
    footerImageUrl: string;
    airbnbUrl?: string;
    bookingUrl?: string;
    agodaUrl?: string;
  };
  titles: {
    about: string;
    sleeping: string;
    amenities: string;
    access: string;
    accessSubtitle: string;
    pricing: string;
    pricingSubtitle: string;
    rules: string;
    rulesSubtitle: string;
    manual: string;
    manualSubtitle: string;
    menuHome: string;
    menuAccess: string;
    menuPricing: string;
    menuRules: string;
    menuManual: string;
  };
  translations?: {
    [language: string]: Partial<PropertyData>;
  };
}

export interface FinancialTransaction {
  id: string;
  propertyId: string;
  transactionNo: string;
  transactionDate: string; // YYYY-MM-DD
  debitAccount: string;
  debitAmount: number;
  creditAccount: string;
  creditAmount: number;
  description: string;
  receiptUrl?: string;
  sourceRef?: string;       // external idempotency key (e.g. gmail:<messageId>)
  createdAt: number;
  updatedAt: number;
}

export interface FinancialTransactionInput {
  propertyId: string;
  transactionNo: string;
  transactionDate: string;
  debitAccount: string;
  debitAmount: number;
  creditAccount: string;
  creditAmount: number;
  description: string;
  receiptUrl?: string;
  sourceRef?: string;
}

export interface PendingTransaction {
  id: string;
  propertyId: string;
  gcsPath: string;          // permanent gcs:// reference
  receiptUrl: string;       // signed URL (resolved at read time)
  ocrProcessed: boolean;
  transactionDate: string;
  debitAccount: string;
  debitAmount: number;
  creditAccount: string;
  creditAmount: number;
  description: string;
  vendor?: string;
  sourceRef?: string;       // external idempotency key (e.g. gmail:<messageId>)
  createdAt: number;
  updatedAt: number;
}

export interface PendingTransactionInput {
  propertyId: string;
  gcsPath: string;
  transactionDate?: string;
  debitAccount?: string;
  debitAmount?: number;
  creditAccount?: string;
  creditAmount?: number;
  description?: string;
  vendor?: string;
  ocrProcessed?: boolean;
  sourceRef?: string;
}

// Email → property routing rule for the email-receipt ingest webhook.
export interface IngestRule {
  email: string;        // normalized lowercase
  propertyId: string;
  createdAt: number;
  updatedAt: number;
}

export interface DataStore {
  init(): Promise<void>;
  authenticate(email: string, password: string): Promise<AuthUser | null>;
  getUserById(id: number): Promise<AuthUser | null>;
  listUsers(): Promise<AuthUser[]>;
  touchUserLastSeen(userId: number, timestamp: number): Promise<void>;
  createUser(name: string, email: string, password: string, role: Role, canEditBlog: boolean, actor: AuthUser): Promise<AuthUser>;
  registerHost(name: string, email: string, password: string): Promise<AuthUser>;
  updateUserName(userId: number, name: string, actor: AuthUser): Promise<AuthUser>;
  updateUserEmail(userId: number, email: string, actor: AuthUser): Promise<AuthUser>;
  updateUserRole(userId: number, role: Role, actor: AuthUser): Promise<AuthUser>;
  updateUserCanEditBlog(userId: number, canEditBlog: boolean, actor: AuthUser): Promise<AuthUser>;
  updateUserHostLevel(userId: number, level: 1 | 2 | 3 | 4 | null, actor: AuthUser): Promise<AuthUser>;
  setUserArchived(userId: number, archived: boolean, actor: AuthUser): Promise<AuthUser>;
  updateUserPassword(userId: number, password: string, actor: AuthUser): Promise<void>;
  deleteUser(userId: number, actor: AuthUser): Promise<void>;
  listProperties(includeArchived?: boolean): Promise<Array<PropertyData & { id: string }>>;
  getProperty(idOrMetalink: string): Promise<(PropertyData & { id: string }) | null>;
  createProperty(property: PropertyData, actor: AuthUser): Promise<PropertyData & { id: string }>;
  renameProperty(propertyId: string, newPropertyId: string, property: PropertyData, actor: AuthUser): Promise<PropertyData & { id: string }>;
  saveProperty(propertyId: string, property: PropertyData, actor: AuthUser): Promise<PropertyData & { id: string }>;
  setPropertyArchived(propertyId: string, archived: boolean, actor: AuthUser): Promise<PropertyData & { id: string }>;
  deleteProperty(propertyId: string, actor: AuthUser): Promise<void>;
  getSiteSettings(): Promise<SiteSettings>;
  saveSiteSettings(settings: SiteSettings, actor: AuthUser): Promise<SiteSettings>;
  createSubscriptionRequest(userId: number, planCode: HostPlanCode, billingCycle: BillingCycle): Promise<SubscriptionRequest>;
  listSubscriptionRequests(filters?: { status?: SubscriptionRequestStatus; userId?: number }): Promise<SubscriptionRequest[]>;
  getSubscriptionRequest(id: string): Promise<SubscriptionRequest | null>;
  updateSubscriptionRequestStatus(id: string, status: SubscriptionRequestStatus, actor: AuthUser): Promise<SubscriptionRequest>;
  listBlockedDates(propertyId: string): Promise<string[]>;
  listBlogPosts(includeArchived?: boolean): Promise<BlogPost[]>;
  getBlogPost(id: string): Promise<BlogPost | null>;
  createBlogPost(post: Omit<BlogPost, 'createdAt' | 'updatedAt'>, actor: AuthUser): Promise<BlogPost>;
  updateBlogPost(id: string, post: Partial<Omit<BlogPost, 'id' | 'createdAt' | 'authorId'>>, actor: AuthUser): Promise<BlogPost>;
  setBlogPostArchived(id: string, archived: boolean, actor: AuthUser): Promise<BlogPost>;
  deleteBlogPost(id: string, actor: AuthUser): Promise<void>;
  assignHost(propertyId: string, hostUserId: number, actor: AuthUser): Promise<void>;
  unassignHost(propertyId: string, hostUserId: number, actor: AuthUser): Promise<void>;
  createCheckInSubmission(input: CheckInSubmissionInput): Promise<CheckInSubmission>;
  listCheckInSubmissions(filters?: CheckInListFilters): Promise<CheckInSubmission[]>;
  getCheckInSubmission(id: string): Promise<CheckInSubmission | null>;
  updateCheckInSubmission(
    id: string,
    patch: {
      checkInDate?: string;
      checkOutDate?: string;
      guests?: CheckInGuest[];
    },
  ): Promise<CheckInSubmission | null>;
  deleteCheckInSubmission(id: string): Promise<boolean>;
  deleteExpiredCheckInSubmissions(olderThanTimestamp: number): Promise<CheckInSubmission[]>;
  createBookingConfirmation(input: BookingConfirmationInput): Promise<BookingConfirmation>;
  listBookingConfirmations(filters?: BookingConfirmationListFilters): Promise<BookingConfirmation[]>;
  getBookingConfirmation(id: string): Promise<BookingConfirmation | null>;
  updateBookingConfirmation(id: string, patch: BookingConfirmationPatch): Promise<BookingConfirmation | null>;
  deleteBookingConfirmation(id: string): Promise<boolean>;
  listFinancialTransactions(propertyIds: string[], year?: number): Promise<FinancialTransaction[]>;
  createFinancialTransaction(input: FinancialTransactionInput, actor: AuthUser): Promise<FinancialTransaction>;
  updateFinancialTransaction(id: string, input: Partial<FinancialTransactionInput>, actor: AuthUser): Promise<FinancialTransaction>;
  deleteFinancialTransaction(id: string, actor: AuthUser): Promise<FinancialTransaction | null>;
  bulkImportFinancialTransactions(propertyId: string, transactions: FinancialTransactionInput[], actor: AuthUser): Promise<FinancialTransaction[]>;
  listPendingTransactions(propertyIds: string[]): Promise<PendingTransaction[]>;
  createPendingTransaction(input: PendingTransactionInput, actor: AuthUser): Promise<PendingTransaction>;
  updatePendingTransaction(id: string, input: Partial<PendingTransactionInput>, actor: AuthUser): Promise<PendingTransaction>;
  approvePendingTransaction(id: string, actor: AuthUser): Promise<FinancialTransaction>;
  deletePendingTransaction(id: string, actor: AuthUser): Promise<PendingTransaction | null>;
  // True when the sourceRef already exists in pending or approved transactions
  // (used by the email-receipt ingest webhook to stay idempotent).
  hasFinanceSourceRef(sourceRef: string): Promise<boolean>;
  listIngestRules(): Promise<IngestRule[]>;
  upsertIngestRule(email: string, propertyId: string, actor: AuthUser): Promise<IngestRule>;
  deleteIngestRule(email: string, actor: AuthUser): Promise<boolean>;
}
