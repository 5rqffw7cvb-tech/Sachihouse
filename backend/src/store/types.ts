import { Role } from '../types/domain.js';

export interface AuthUser {
  id: number;
  name: string;
  email: string;
  role: Role;
  assignedPropertyIds: string[];
}

export interface StoredUser extends AuthUser {
  passwordHash: string;
}

export interface BlogPost {
  id: string;
  title: string;
  excerpt: string;
  content: string;
  createdAt: number;
  updatedAt: number;
  imageUrl: string;
  category: string;
  isFeatured: boolean;
  authorId: number;
}

export interface SiteSettings {
  navTitle: string;
  headerTitle: string;
  headerSubtitle: string;
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

export interface PropertyData {
  id?: string;
  metalink?: string;
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
}

export interface DataStore {
  init(): Promise<void>;
  authenticate(email: string, password: string): Promise<AuthUser | null>;
  getUserById(id: number): Promise<AuthUser | null>;
  listUsers(): Promise<AuthUser[]>;
  createUser(name: string, email: string, password: string, role: Role, actor: AuthUser): Promise<AuthUser>;
  updateUserName(userId: number, name: string, actor: AuthUser): Promise<AuthUser>;
  updateUserEmail(userId: number, email: string, actor: AuthUser): Promise<AuthUser>;
  updateUserRole(userId: number, role: Role, actor: AuthUser): Promise<AuthUser>;
  updateUserPassword(userId: number, password: string, actor: AuthUser): Promise<void>;
  deleteUser(userId: number, actor: AuthUser): Promise<void>;
  listProperties(): Promise<Array<PropertyData & { id: string }>>;
  getProperty(idOrMetalink: string): Promise<(PropertyData & { id: string }) | null>;
  createProperty(property: PropertyData, actor: AuthUser): Promise<PropertyData & { id: string }>;
  saveProperty(propertyId: string, property: PropertyData, actor: AuthUser): Promise<PropertyData & { id: string }>;
  deleteProperty(propertyId: string, actor: AuthUser): Promise<void>;
  getSiteSettings(): Promise<SiteSettings>;
  saveSiteSettings(settings: SiteSettings, actor: AuthUser): Promise<SiteSettings>;
  listBlockedDates(propertyId: string): Promise<string[]>;
  listBlogPosts(): Promise<BlogPost[]>;
  getBlogPost(id: string): Promise<BlogPost | null>;
  createBlogPost(post: Omit<BlogPost, 'createdAt' | 'updatedAt'>, actor: AuthUser): Promise<BlogPost>;
  updateBlogPost(id: string, post: Partial<Omit<BlogPost, 'id' | 'createdAt' | 'authorId'>>, actor: AuthUser): Promise<BlogPost>;
  deleteBlogPost(id: string, actor: AuthUser): Promise<void>;
  assignHost(propertyId: string, hostUserId: number, actor: AuthUser): Promise<void>;
  unassignHost(propertyId: string, hostUserId: number, actor: AuthUser): Promise<void>;
}
