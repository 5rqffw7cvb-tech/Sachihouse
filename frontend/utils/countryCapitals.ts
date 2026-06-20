/**
 * Maps ISO 3166-1 alpha-3 nationality codes to their country's capital city.
 * Also supports common English country name variants for OCR fallback matching.
 */
const CAPITALS_BY_CODE: Record<string, string> = {
  // Asia-Pacific
  JPN: 'Tokyo',
  VNM: 'Hanoi',
  CHN: 'Beijing',
  KOR: 'Seoul',
  TWN: 'Taipei',
  THA: 'Bangkok',
  SGP: 'Singapore',
  MYS: 'Kuala Lumpur',
  PHL: 'Manila',
  IDN: 'Jakarta',
  IND: 'New Delhi',
  AUS: 'Canberra',
  NZL: 'Wellington',
  HKG: 'Hong Kong',
  MAC: 'Macao',
  MMR: 'Naypyidaw',
  KHM: 'Phnom Penh',
  LAO: 'Vientiane',
  BRN: 'Bandar Seri Begawan',
  TLS: 'Dili',
  NPL: 'Kathmandu',
  BGD: 'Dhaka',
  LKA: 'Sri Jayawardenepura Kotte',
  PAK: 'Islamabad',
  AFG: 'Kabul',
  IRN: 'Tehran',
  IRQ: 'Baghdad',
  // Americas
  USA: 'Washington D.C.',
  CAN: 'Ottawa',
  MEX: 'Mexico City',
  BRA: 'Brasilia',
  ARG: 'Buenos Aires',
  CHL: 'Santiago',
  COL: 'Bogota',
  PER: 'Lima',
  VEN: 'Caracas',
  ECU: 'Quito',
  BOL: 'Sucre',
  PRY: 'Asuncion',
  URY: 'Montevideo',
  // Europe
  GBR: 'London',
  FRA: 'Paris',
  DEU: 'Berlin',
  ITA: 'Rome',
  ESP: 'Madrid',
  PRT: 'Lisbon',
  NLD: 'Amsterdam',
  BEL: 'Brussels',
  CHE: 'Bern',
  AUT: 'Vienna',
  SWE: 'Stockholm',
  NOR: 'Oslo',
  DNK: 'Copenhagen',
  FIN: 'Helsinki',
  POL: 'Warsaw',
  RUS: 'Moscow',
  UKR: 'Kyiv',
  CZE: 'Prague',
  SVK: 'Bratislava',
  HUN: 'Budapest',
  ROU: 'Bucharest',
  BGR: 'Sofia',
  SRB: 'Belgrade',
  HRV: 'Zagreb',
  GRC: 'Athens',
  TUR: 'Ankara',
  // Middle East & Africa
  SAU: 'Riyadh',
  ARE: 'Abu Dhabi',
  QAT: 'Doha',
  KWT: 'Kuwait City',
  BHR: 'Manama',
  OMN: 'Muscat',
  ISR: 'Jerusalem',
  JOR: 'Amman',
  LBN: 'Beirut',
  EGY: 'Cairo',
  ZAF: 'Pretoria',
  NGA: 'Abuja',
  KEN: 'Nairobi',
  ETH: 'Addis Ababa',
  GHA: 'Accra',
  TZA: 'Dodoma',
  UGA: 'Kampala',
};

// Map common full country name variants (uppercase) to ISO codes
const NAME_TO_CODE: Record<string, string> = {
  JAPAN: 'JPN',
  VIETNAM: 'VNM',
  'VIET NAM': 'VNM',
  CHINA: 'CHN',
  'SOUTH KOREA': 'KOR',
  KOREA: 'KOR',
  TAIWAN: 'TWN',
  THAILAND: 'THA',
  SINGAPORE: 'SGP',
  MALAYSIA: 'MYS',
  PHILIPPINES: 'PHL',
  INDONESIA: 'IDN',
  INDIA: 'IND',
  AUSTRALIA: 'AUS',
  'NEW ZEALAND': 'NZL',
  'HONG KONG': 'HKG',
  MYANMAR: 'MMR',
  CAMBODIA: 'KHM',
  LAOS: 'LAO',
  NEPAL: 'NPL',
  BANGLADESH: 'BGD',
  'SRI LANKA': 'LKA',
  PAKISTAN: 'PAK',
  IRAN: 'IRN',
  USA: 'USA',
  'UNITED STATES': 'USA',
  'UNITED STATES OF AMERICA': 'USA',
  CANADA: 'CAN',
  MEXICO: 'MEX',
  BRAZIL: 'BRA',
  ARGENTINA: 'ARG',
  'UNITED KINGDOM': 'GBR',
  UK: 'GBR',
  ENGLAND: 'GBR',
  FRANCE: 'FRA',
  GERMANY: 'DEU',
  ITALY: 'ITA',
  SPAIN: 'ESP',
  PORTUGAL: 'PRT',
  NETHERLANDS: 'NLD',
  BELGIUM: 'BEL',
  SWITZERLAND: 'CHE',
  AUSTRIA: 'AUT',
  SWEDEN: 'SWE',
  NORWAY: 'NOR',
  DENMARK: 'DNK',
  FINLAND: 'FIN',
  POLAND: 'POL',
  RUSSIA: 'RUS',
  UKRAINE: 'UKR',
  TURKEY: 'TUR',
  'SAUDI ARABIA': 'SAU',
  UAE: 'ARE',
  'UNITED ARAB EMIRATES': 'ARE',
  EGYPT: 'EGY',
  'SOUTH AFRICA': 'ZAF',
};

// Map ISO alpha-3 code to display country name
const COUNTRY_NAMES: Record<string, string> = {
  JPN: 'Japan', VNM: 'Viet Nam', CHN: 'China', KOR: 'South Korea', TWN: 'Taiwan',
  THA: 'Thailand', SGP: 'Singapore', MYS: 'Malaysia', PHL: 'Philippines',
  IDN: 'Indonesia', IND: 'India', AUS: 'Australia', NZL: 'New Zealand',
  HKG: 'Hong Kong', MAC: 'Macao', MMR: 'Myanmar', KHM: 'Cambodia', LAO: 'Laos',
  BRN: 'Brunei', TLS: 'Timor-Leste', NPL: 'Nepal', BGD: 'Bangladesh',
  LKA: 'Sri Lanka', PAK: 'Pakistan', AFG: 'Afghanistan', IRN: 'Iran', IRQ: 'Iraq',
  USA: 'United States', CAN: 'Canada', MEX: 'Mexico', BRA: 'Brazil', ARG: 'Argentina',
  CHL: 'Chile', COL: 'Colombia', PER: 'Peru', VEN: 'Venezuela', ECU: 'Ecuador',
  BOL: 'Bolivia', PRY: 'Paraguay', URY: 'Uruguay',
  GBR: 'United Kingdom', FRA: 'France', DEU: 'Germany', ITA: 'Italy', ESP: 'Spain',
  PRT: 'Portugal', NLD: 'Netherlands', BEL: 'Belgium', CHE: 'Switzerland',
  AUT: 'Austria', SWE: 'Sweden', NOR: 'Norway', DNK: 'Denmark', FIN: 'Finland',
  POL: 'Poland', RUS: 'Russia', UKR: 'Ukraine', CZE: 'Czech Republic',
  SVK: 'Slovakia', HUN: 'Hungary', ROU: 'Romania', BGR: 'Bulgaria',
  SRB: 'Serbia', HRV: 'Croatia', GRC: 'Greece', TUR: 'Turkey',
  SAU: 'Saudi Arabia', ARE: 'UAE', QAT: 'Qatar', KWT: 'Kuwait',
  BHR: 'Bahrain', OMN: 'Oman', ISR: 'Israel', JOR: 'Jordan', LBN: 'Lebanon',
  EGY: 'Egypt', ZAF: 'South Africa', NGA: 'Nigeria', KEN: 'Kenya',
  ETH: 'Ethiopia', GHA: 'Ghana', TZA: 'Tanzania', UGA: 'Uganda',
};

function resolveCode(nationality: string): string | null {
  const upper = nationality.toUpperCase().trim();
  if (CAPITALS_BY_CODE[upper]) return upper;
  return NAME_TO_CODE[upper] ?? null;
}

/**
 * Returns the capital city for a given nationality string.
 * Accepts ISO alpha-3 codes (e.g. "JPN") or common country name variants (e.g. "Japan").
 * Returns empty string if no match found.
 */
export function getCountryCapital(nationality: string): string {
  if (!nationality) return '';
  const code = resolveCode(nationality);
  return code ? (CAPITALS_BY_CODE[code] ?? '') : '';
}

/**
 * Returns "Capital, Country" formatted string (e.g. "Hanoi, Viet Nam").
 * Returns empty string if nationality is not recognized.
 */
export function getCapitalWithCountry(nationality: string): string {
  if (!nationality) return '';
  const code = resolveCode(nationality);
  if (!code) return '';
  const capital = CAPITALS_BY_CODE[code];
  const country = COUNTRY_NAMES[code];
  if (!capital) return '';
  return country ? `${capital}, ${country}` : capital;
}
