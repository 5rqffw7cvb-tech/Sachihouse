import { Role } from '../types/domain.js';

export interface AuthUser {
  id: number;
  name: string;
  email: string;
  role: Role;
  canEditBlog: boolean;
  archivedAt?: number | null;
  assignedPropertyIds: string[];
  hostLevel: 1 | 2 | 3 | null;
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

export interface DataStore {
  init(): Promise<void>;
  authenticate(email: string, password: string): Promise<AuthUser | null>;
  getUserById(id: number): Promise<AuthUser | null>;
  listUsers(): Promise<AuthUser[]>;
  createUser(name: string, email: string, password: string, role: Role, canEditBlog: boolean, actor: AuthUser): Promise<AuthUser>;
  updateUserName(userId: number, name: string, actor: AuthUser): Promise<AuthUser>;
  updateUserEmail(userId: number, email: string, actor: AuthUser): Promise<AuthUser>;
  updateUserRole(userId: number, role: Role, actor: AuthUser): Promise<AuthUser>;
  updateUserCanEditBlog(userId: number, canEditBlog: boolean, actor: AuthUser): Promise<AuthUser>;
  updateUserHostLevel(userId: number, level: 1 | 2 | 3 | null, actor: AuthUser): Promise<AuthUser>;
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
}
