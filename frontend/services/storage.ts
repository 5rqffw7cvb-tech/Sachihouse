// Use native date formatting to avoid pulling date-fns into the initial bundle
const formatDateYMD = (date: Date): string => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};
import { ApiError, apiRequest } from './api';
import { PropertyData, SiteSettings } from '../types';

const STORAGE_KEY = 'tokyo_zen_stay_data';
let blockedDatesCache: Set<string> = new Set();

export const DEFAULT_DATA: PropertyData = {
  id: 'main',
  metalink: 'sachi-ojima',
  name: 'Sachi House Ojima',
  metaTitle: 'Sachi House Ojima',
  metaFavicon: 'https://cdn-icons-png.flaticon.com/512/2111/2111320.png',
  subtitle: 'Family-friendly Tokyo stay with direct train access and self check-in',
  description: 'Fallback property data used when the backend is temporarily unavailable.',
  address: 'Koto City, Tokyo, Japan',
  location: {
    countryCode: 'JP',
    countryName: 'Japan',
    provinceCode: 'JP-13',
    provinceName: 'Tokyo',
    cityName: 'Koto City',
  },
  mapEmbedUrl: 'https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d3240.356784777568!2d139.8200639!3d35.6928236!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x601888eeb05342d3%3A0x6b77209930357732!2sOjima%20Station!5e0!3m2!1sen!2sjp!4v1709825164835!5m2!1sen!2sjp',
  hostName: 'Kenji',
  hostImageUrl: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&q=80&w=400',
  isSuperhost: true,
  superhostSince: '2023',
  themeColor: 'airbnb',
  adminEmail: 'reservations@sachihouse.com',
  maxGuests: 7,
  bedrooms: 3,
  beds: 5,
  baths: 1,
  toilets: 1,
  highlights: [
    { id: 'h1', title: 'Direct Train Access', description: 'Fast route to Shinjuku and central Tokyo.', icon: 'TrainFront' },
    { id: 'h2', title: 'Family Friendly', description: 'Spacious layout for up to 7 guests.', icon: 'Users' },
    { id: 'h3', title: 'Remote Work Ready', description: 'Stable Wi-Fi and work desk available.', icon: 'Monitor' }
  ],
  accessInfo: {
    train: '8 minutes on foot from the nearest station.',
    airport: 'Haneda and Narita routes are documented in the access guide.',
    checkIn: 'Self check-in via lockbox. Check-in 15:00, check-out 11:00.',
    youtubeGuideUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
  },
  additionalRules: 'Quiet hours after 22:00. No smoking indoors.',
  pricing: {
    rates: [
      { guests: 1, price: 5000 },
      { guests: 2, price: 5000 },
      { guests: 3, price: 4700 },
      { guests: 4, price: 4500 },
      { guests: 5, price: 4300 },
      { guests: 6, price: 4000 },
      { guests: 7, price: 4000 }
    ],
    cleaning: [
      { minGuests: 1, maxGuests: 3, price: 5000 },
      { minGuests: 4, maxGuests: 4, price: 8000 },
      { minGuests: 5, maxGuests: 7, price: 13000 }
    ],
    childDiscountPercent: 30,
    childAgeMin: 3,
    childAgeMax: 10,
    longStayDiscountPercent: 10,
    longStayMinNights: 7
  },
  rules: [
    { id: 'r1', text: 'No smoking indoors', icon: 'CigaretteOff', type: 'forbidden' },
    { id: 'r2', text: 'No parties or events', icon: 'PartyPopper', type: 'forbidden' },
    { id: 'r3', text: 'Remove shoes at entrance', icon: 'Footprints', type: 'allowed' }
  ],
  manual: [
    { id: 'm1', title: 'Wi-Fi', content: 'Network details are shared after booking confirmation.' },
    { id: 'm2', title: 'Trash Separation', content: 'Follow the posted separation guide in the kitchen.' }
  ],
  icalFeeds: [
    { id: 'cal1', name: 'Airbnb', url: 'https://example.com/airbnb.ics', lastSynced: new Date().toISOString() }
  ],
  amenities: ['High-speed Wi-Fi', 'Kitchen', 'Washing Machine', 'Air Conditioning', 'Microwave'],
  galleryCategories: [
    { id: 'featured', label: 'Featured' },
    { id: 'bedroom', label: 'Bedroom' }
  ],
  galleryImages: [
    { id: 'g1', url: 'https://images.unsplash.com/photo-1505693416388-ac5ce068fe85?auto=format&fit=crop&q=80&w=1200', caption: 'Main living area', category: 'featured', showOnHome: true },
    { id: 'g2', url: 'https://images.unsplash.com/photo-1484154218962-a197022b5858?auto=format&fit=crop&q=80&w=900', caption: 'Kitchen', category: 'featured' }
  ],
  sleepingArrangements: [
    { id: 's1', title: 'Bedroom 1', description: 'Two semi-double beds', imageUrl: 'https://images.unsplash.com/photo-1505693416388-ac5ce068fe85?auto=format&fit=crop&q=80&w=900' },
    { id: 's2', title: 'Bedroom 2', description: 'One double bed and floor mattress', imageUrl: 'https://images.unsplash.com/photo-1505693416388-ac5ce068fe85?auto=format&fit=crop&q=80&w=900' }
  ],
  social: {
    facebookUrl: 'https://facebook.com/sachihouse',
    footerImageUrl: 'https://images.unsplash.com/photo-1494526585095-c41746248156?auto=format&fit=crop&q=80&w=1200',
    airbnbUrl: 'https://airbnb.com',
    bookingUrl: 'https://booking.com',
    agodaUrl: 'https://agoda.com'
  },
  titles: {
    about: 'About this stay',
    sleeping: 'Sleeping arrangements',
    amenities: 'Amenities',
    access: 'Access',
    accessSubtitle: 'Transport, airport guidance, and check-in instructions',
    pricing: 'Pricing & availability',
    pricingSubtitle: 'Rates, cleaning fee, and availability calendar',
    rules: 'House rules',
    rulesSubtitle: 'Please review the stay rules before booking',
    manual: 'Guest manual',
    manualSubtitle: 'Usage instructions for appliances and facilities',
    menuHome: 'Home',
    menuAccess: 'Access',
    menuPricing: 'Pricing',
    menuRules: 'Rules',
    menuManual: 'Manual'
  }
};

export const DEFAULT_SITE_SETTINGS: SiteSettings = {
  navTitle: 'SachiHouse78',
  headerTitle: 'Tokyo Stays for Families and Small Groups',
  headerSubtitle: 'Browse managed properties, compare highlights, and open the full guest guide before booking.',
  faviconUrl: 'https://cdn-icons-png.flaticon.com/512/2111/2111320.png',
  footerTitle: 'SachiHouse78',
  footerCopyright: 'Copyright 2026 SachiHouse78. All rights reserved.',
  listingFilters: {
    allowedLocations: [
      {
        countryCode: 'JP',
        countryName: 'Japan',
        provinceCode: 'JP-13',
        provinceName: 'Tokyo',
      },
    ],
  },
};

export interface PropertyListFilters {
  countryCode?: string;
  provinceCode?: string;
  minBedrooms?: number;
  minGuests?: number;
}

export const getAllProperties = async (filters?: PropertyListFilters): Promise<(PropertyData & { id: string })[]> => {
  const query = new URLSearchParams();
  if (filters?.countryCode) {
    query.set('countryCode', filters.countryCode);
  }
  if (filters?.provinceCode) {
    query.set('provinceCode', filters.provinceCode);
  }
  if (filters?.minBedrooms && filters.minBedrooms > 0) {
    query.set('minBedrooms', String(filters.minBedrooms));
  }
  if (filters?.minGuests && filters.minGuests > 0) {
    query.set('minGuests', String(filters.minGuests));
  }
  const suffix = query.toString() ? `?${query.toString()}` : '';

  try {
    const response = await apiRequest<{ properties: (PropertyData & { id: string })[] }>(`/properties${suffix}`);
    if (!Array.isArray(response.properties)) {
      throw new Error('Invalid properties payload');
    }
    return response.properties;
  } catch {
    return [{ ...DEFAULT_DATA, id: DEFAULT_DATA.id || 'main' }];
  }
};

export const getPropertyData = async (propertyId: string = 'main'): Promise<PropertyData> => {
  try {
    const response = await apiRequest<{ property: PropertyData & { id: string } }>(`/properties/${propertyId}`);
    if (!response.property || typeof response.property !== 'object') {
      throw new Error('Invalid property payload');
    }
    return response.property;
  } catch {
    return { ...DEFAULT_DATA, id: propertyId };
  }
};

export const savePropertyData = async (data: PropertyData, propertyId: string = 'main'): Promise<void> => {
  const payload = { ...data, id: propertyId, metalink: data.metalink || propertyId };
  try {
    await apiRequest(`/properties/${propertyId}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      await apiRequest('/properties', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      return;
    }
    throw error;
  }
};

export const deletePropertyData = async (propertyId: string): Promise<void> => {
  await apiRequest(`/properties/${propertyId}`, {
    method: 'DELETE',
  });
};

export const getSiteSettings = async (): Promise<SiteSettings> => {
  try {
    const response = await apiRequest<{ settings: SiteSettings }>('/site-settings');
    if (!response.settings || typeof response.settings !== 'object') {
      throw new Error('Invalid site settings payload');
    }
    return { ...DEFAULT_SITE_SETTINGS, ...(response.settings ?? {}) };
  } catch {
    return { ...DEFAULT_SITE_SETTINGS };
  }
};

export const saveSiteSettings = async (settings: SiteSettings): Promise<void> => {
  await apiRequest('/site-settings', {
    method: 'PUT',
    body: JSON.stringify(settings),
  });
  window.dispatchEvent(new Event('site-settings-updated'));
};

export const refreshBlockedDates = async (data: PropertyData) => {
  const propertyId = data.id || data.metalink || 'main';
  try {
    const response = await apiRequest<{ blockedDates: string[] }>(`/properties/${propertyId}/blocked-dates`);
    blockedDatesCache = new Set(response.blockedDates);
  } catch {
    blockedDatesCache = new Set();
  }
  window.dispatchEvent(new Event('ical-updated'));
};

export const isDateBlocked = (date: Date): boolean => {
  return blockedDatesCache.has(formatDateYMD(date));
};
