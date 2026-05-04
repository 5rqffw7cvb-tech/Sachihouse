import bcrypt from 'bcryptjs';
import { BlogPost, PropertyData, SiteSettings, StoredUser } from './types.js';

function buildProperty(id: string, metalink: string, name: string, hostName: string, accent: 'blue' | 'airbnb' | 'booking' | 'agoda'): PropertyData & { id: string } {
  return {
    id,
    metalink,
    name,
    subtitle: 'Family-friendly Tokyo stay with direct train access and self check-in',
    description: `${name} is designed for short-term guests who need practical access, strong Wi-Fi, and clear house guidance. The property includes a full kitchen, family sleeping layout, and detailed local transport instructions.`,
    address: 'Koto City, Tokyo, Japan',
    location: {
      countryCode: 'JP',
      countryName: 'Japan',
      provinceCode: 'JP-13',
      provinceName: 'Tokyo',
      cityName: 'Koto City',
    },
    mapEmbedUrl: 'https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d3240.356784777568!2d139.8200639!3d35.6928236!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x601888eeb05342d3%3A0x6b77209930357732!2sOjima%20Station!5e0!3m2!1sen!2sjp!4v1709825164835!5m2!1sen!2sjp',
    hostName,
    hostImageUrl: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&q=80&w=400',
    isSuperhost: true,
    superhostSince: '2023',
    themeColor: accent,
    adminEmail: 'reservations@sachihouse.com',
    maxGuests: 7,
    bedrooms: 3,
    beds: 5,
    baths: 1,
    bathFacilityType: 'bathroom',
    toilets: 1,
    highlights: [
      { id: 'h1', title: 'Direct Train Access', description: 'Fast route to Shinjuku and central Tokyo.', icon: 'TrainFront' },
      { id: 'h2', title: 'Family Friendly', description: 'Spacious layout for up to 7 guests.', icon: 'Users' },
      { id: 'h3', title: 'Remote Work Ready', description: 'Stable Wi-Fi and work desk available.', icon: 'Monitor' }
    ],
    accessInfo: {
      train: '8 minutes on foot from the nearest station. Direct train connection to Shinjuku.',
      airport: 'Haneda and Narita routes are documented with train transfer guidance.',
      checkIn: 'Self check-in via lockbox. Check-in 15:00, check-out 11:00.',
      youtubeGuideUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
    },
    additionalRules: 'Quiet hours after 22:00. No smoking indoors. Follow trash separation rules.',
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
      { id: 'r3', text: 'Remove shoes at entrance', icon: 'Footprints', type: 'allowed' },
      { id: 'r4', text: 'Observe quiet hours after 22:00', icon: 'MoonStar', type: 'allowed' }
    ],
    manual: [
      { id: 'm1', title: 'Wi-Fi', content: 'Network: SachiHouse WiFi. Password is provided after booking confirmation.' },
      { id: 'm2', title: 'Trash Separation', content: 'Separate burnable, recyclable, and plastic waste by the posted schedule.' },
      { id: 'm3', title: 'Air Conditioner', content: 'Use the wall remote and switch off when leaving the property.' }
    ],
    icalFeeds: [
      { id: 'cal1', name: 'Airbnb', url: 'https://example.com/airbnb.ics', lastSynced: new Date().toISOString() }
    ],
    amenities: ['High-speed Wi-Fi', 'Kitchen', 'Washing Machine', 'Air Conditioning', 'Hair Dryer', 'Microwave'],
    galleryCategories: [
      { id: 'featured', label: 'Featured' },
      { id: 'bedroom', label: 'Bedroom' },
      { id: 'living', label: 'Living Area' }
    ],
    galleryImages: [
      { id: 'g1', url: 'https://images.unsplash.com/photo-1505693416388-ac5ce068fe85?auto=format&fit=crop&q=80&w=1200', caption: 'Main living area', category: 'featured', showOnHome: true },
      { id: 'g2', url: 'https://images.unsplash.com/photo-1505693416388-ac5ce068fe85?auto=format&fit=crop&q=80&w=900', caption: 'Bedroom', category: 'bedroom' },
      { id: 'g3', url: 'https://images.unsplash.com/photo-1484154218962-a197022b5858?auto=format&fit=crop&q=80&w=900', caption: 'Kitchen', category: 'living' }
    ],
    sleepingArrangements: [
      {
        id: 's1',
        title: 'Bedroom 1',
        description: 'Two semi-double beds',
        imageUrl: 'https://images.unsplash.com/photo-1505693416388-ac5ce068fe85?auto=format&fit=crop&q=80&w=900',
        photos: ['https://images.unsplash.com/photo-1505693416388-ac5ce068fe85?auto=format&fit=crop&q=80&w=900']
      },
      {
        id: 's2',
        title: 'Bedroom 2',
        description: 'One double bed and floor mattress',
        imageUrl: 'https://images.unsplash.com/photo-1505693416388-ac5ce068fe85?auto=format&fit=crop&q=80&w=900'
      }
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
}

export const siteSettingsSeed: SiteSettings = {
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

export const propertiesSeed = [
  buildProperty('main', 'sachi-ojima', 'Sachi House Ojima', 'Kenji', 'airbnb'),
  buildProperty('list_shin', 'sachi-shinjuku', 'Sachi House Shinjuku', 'Mika', 'booking')
];

export const blockedDatesSeed: Record<string, string[]> = {
  main: ['2026-06-12', '2026-06-13', '2026-06-24'],
  list_shin: ['2026-06-16', '2026-06-17']
};

export const blogPostsSeed: BlogPost[] = [
  {
    id: 'tokyo-family-guide',
    title: 'Tokyo Family Stay Guide',
    excerpt: 'How to plan a smooth family stay near Tokyo transit lines and local shopping streets.',
    content: '# Tokyo Family Stay Guide\n\nUse the pricing page to estimate your stay, then review access instructions before arrival.\n\n## Why this area works\n\n- Direct train access\n- Quiet residential street\n- Family-friendly amenities',
    createdAt: Date.now() - 86400000,
    updatedAt: Date.now() - 86400000,
    imageUrl: 'https://images.unsplash.com/photo-1542051841857-5f90071e7989?auto=format&fit=crop&q=80&w=1200',
    category: 'Travel Tips',
    isFeatured: true,
    authorId: 1
  },
  {
    id: 'airport-access-notes',
    title: 'Airport Access Notes for Late Arrivals',
    excerpt: 'Recommended train routes and check-in tips for guests arriving after sunset.',
    content: '# Airport Access Notes\n\nLate arrivals should review the check-in section carefully and confirm train schedules before departure.',
    createdAt: Date.now() - 43200000,
    updatedAt: Date.now() - 43200000,
    imageUrl: 'https://images.unsplash.com/photo-1516483638261-f4dbaf036963?auto=format&fit=crop&q=80&w=1200',
    category: 'Access',
    isFeatured: false,
    authorId: 1
  }
];

export async function createUserSeed(): Promise<StoredUser[]> {
  return [
    {
      id: 1,
      name: 'Sachi Operations Admin',
      email: 'admin@sachihouse.com',
      role: 'ADMIN',
      assignedPropertyIds: propertiesSeed.map((property) => property.id),
      passwordHash: await bcrypt.hash('admin123', 10)
    },
    {
      id: 2,
      name: 'Sachi Primary Host',
      email: 'host@sachihouse.com',
      role: 'HOST',
      assignedPropertyIds: ['main'],
      passwordHash: await bcrypt.hash('host123', 10)
    }
  ];
}
