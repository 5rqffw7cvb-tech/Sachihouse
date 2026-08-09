
export interface PricingTier {
  guests: number;
  price: number;
}

export interface CleaningTier {
  minGuests: number;
  maxGuests: number;
  price: number;
}

export interface PricingConfig {
  rates: PricingTier[];
  cleaning: CleaningTier[];
  childDiscountPercent: number; // e.g. 30 for 30%
  childAgeMin: number; // e.g. 3 (start of child age)
  childAgeMax: number; // e.g. 10 (end of child age, inclusive)
  longStayDiscountPercent: number; // e.g. 10 for 10%
  longStayMinNights: number; // e.g. 7
}

export interface HouseRule {
  id: string;
  text: string;
  icon: string; // key for lucide icon
  type: 'allowed' | 'forbidden';
}

export interface ManualItem {
  id: string;
  title: string;
  content: string;
  imageUrl?: string;
}

export interface ICalFeed {
  id: string;
  name: string;
  url: string;
  lastSynced: string;
}

// A global, admin-managed discount code for the Price Simulator — not tied to
// one property. `code` is typed by hand (admin picks it, can edit it later to
// fix a typo) and must be unique case-insensitively. `propertyIds` is the set
// of properties this coupon is assigned to; applying it also requires the
// guest's entire stay to fall within [startDate, endDate] (no partial-stay
// proration). Managed on the dedicated /admin/coupons page, not per-property.
export interface Coupon {
  id: string;
  code: string;
  type: 'percentage' | 'fixed_night';
  // percentage: 1-100 (% off every guest-count tier's nightly rate).
  // fixed_night: flat JPY nightly rate that replaces every tier's price,
  // regardless of guest count.
  value: number;
  startDate: string; // YYYY-MM-DD
  endDate: string;   // YYYY-MM-DD
  active: boolean;
  createdAt: number;
  updatedAt: number;
  propertyIds: string[];
}

export interface HighlightItem {
  id: string;
  title: string;
  description: string;
  icon: string;
}

export interface SleepingArrangement {
  id: string;
  title: string;
  description: string;
  imageUrl: string;
  photos?: string[];
}

export interface AccessInfo {
  train: string;
  airport: string;
  checkIn: string;
  nearestStationName?: string;
  nearestStationDistance?: string;
  nearestAirportDriveTime?: string;
  youtubeGuideUrl?: string;
}

export interface SocialInfo {
  facebookUrl: string;
  footerImageUrl: string;
  airbnbUrl?: string;
  bookingUrl?: string;
  agodaUrl?: string;
  expediaUrl?: string;
  vrboUrl?: string;
}

// Sent to the guest by email once they submit the check-in form reached via a
// booking-specific link. Every field is optional and simply omitted from the
// email if blank.
export interface CheckInInfo {
  wifiName?: string;
  wifiPassword?: string;
  entryCode?: string; // door code, keybox code, or free-text entry instructions
  emergencyContactPhone?: string;
  googleMapsUrl?: string;
}

export interface EmailJsConfig {
  serviceId: string;
  templateId: string;
  publicKey: string;
}

export interface PropertyTitles {
  // Page Content Titles
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

  // Navigation Menu Labels
  menuHome: string;
  menuAccess: string;
  menuPricing: string;
  menuRules: string;
  menuManual: string;
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

export interface HostPlansConfig {
  currency: string;
  yearlyDiscountPercent: number;
  plans: Record<HostPlanCode, { monthlyPrice: number }>;
}

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

// Basic = host level 2, Plus = level 3, Pro = level 4.
export const PLAN_TO_HOST_LEVEL: Record<HostPlanCode, 2 | 3 | 4> = {
  basic: 2,
  plus: 3,
  pro: 4,
};

export interface GalleryCategoryDef {
    id: string;
    label: string;
}

export interface GalleryItem {
    id: string;
    url: string;
    caption: string;
    category: string; 
    showOnHome?: boolean; // New property to toggle visibility on Home Page hero
}

export interface PropertyData {
  id?: string;
  name: string;
  metalink?: string;
  archivedAt?: number | null;
  reviewStatus?: 'approved' | 'pending_review';
  translations?: {
    [language: string]: Partial<PropertyData>;
  };
  // Browser Tab Settings
  metaTitle?: string;
  metaFavicon?: string;

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
  
  // Theme Color Options
  themeColor?: 'blue' | 'airbnb' | 'booking' | 'agoda';

  adminEmail?: string;
  maxGuests: number;
  bedrooms: number;
  beds: number;
  baths: number;
  bathFacilityType: 'bathroom' | 'shower_room';
  toilets: number;

  highlights: HighlightItem[];

  accessInfo: AccessInfo;
  checkInInfo?: CheckInInfo;

  additionalRules: string;

  pricing: PricingConfig;
  rules: HouseRule[];
  manual: ManualItem[];
  icalFeeds: ICalFeed[];
  // Opt-in per property: guests book and pay online instead of emailing for a
  // quote. Absent or disabled keeps the legacy enquiry flow.
  directBooking?: {
    enabled: boolean;
    minNights?: number;
    maxAdvanceDays?: number;
    sameDayCutoffHour?: number;
    freeCancellationDays?: number;
  };
  amenities: string[];
  
  // Dynamic Categories
  galleryCategories: GalleryCategoryDef[];
  
  galleryImages: GalleryItem[];
  
  sleepingArrangements: SleepingArrangement[];
  
  social: SocialInfo;
  emailJs?: EmailJsConfig;
  
  titles: PropertyTitles;
}

export interface BookingConfirmation {
  id: string;
  confirmationNo: string;
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
  discountLabel?: string;
  discountAmount: number;
  totalAmount: number;
  depositAmount: number;
  balanceDue: number;
  notes?: string;
  // Snapshotted from the property's cancellation policy at creation time.
  // Undefined on older rows — fall back to 7.
  freeCancellationDays?: number;
  includeInAccounting: boolean;
  // 'online' rows are created automatically from a paid Stripe booking;
  // 'manual' rows are host-entered for off-platform stays.
  source: 'online' | 'manual';
  sourceBookingId?: string;
  createdByUserId: number;
  createdByName: string;
  createdAt: number;
  updatedAt: number;
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
  residency?: 'resident' | 'foreign';
  createdAt: number;
  updatedAt: number;
}
