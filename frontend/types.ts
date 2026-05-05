
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
}

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

  additionalRules: string;

  pricing: PricingConfig;
  rules: HouseRule[];
  manual: ManualItem[];
  icalFeeds: ICalFeed[];
  amenities: string[];
  
  // Dynamic Categories
  galleryCategories: GalleryCategoryDef[];
  
  galleryImages: GalleryItem[];
  
  sleepingArrangements: SleepingArrangement[];
  
  social: SocialInfo;
  emailJs?: EmailJsConfig;
  
  titles: PropertyTitles;
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
