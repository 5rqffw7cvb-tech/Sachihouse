
import { eachDayOfInterval, format, isValid, addDays } from 'date-fns';

// Helper to parse ICS date string (e.g., 20231025 or 20231025T120000Z)
const parseICSDate = (dateStr: string): Date | null => {
  if (!dateStr) return null;
  // Basic YYYYMMDD parsing
  const year = parseInt(dateStr.substring(0, 4));
  const month = parseInt(dateStr.substring(4, 6)) - 1;
  const day = parseInt(dateStr.substring(6, 8));
  const date = new Date(year, month, day);
  return isValid(date) ? date : null;
};

// Simple ICS parser used to extract blocked date ranges
const parseICS = (icsContent: string): Set<string> => {
  const blockedDates = new Set<string>();
  const lines = icsContent.split(/\r\n|\n|\r/);
  
  let inEvent = false;
  let dtStart: Date | null = null;
  let dtEnd: Date | null = null;

  for (const line of lines) {
    if (line.startsWith('BEGIN:VEVENT')) {
      inEvent = true;
      dtStart = null;
      dtEnd = null;
    } else if (line.startsWith('END:VEVENT')) {
      inEvent = false;
      if (dtStart && dtEnd) {
        // Calculate all days in the interval
        // Note: DTEND is exclusive in iCal spec
        const endInclusive = addDays(dtEnd, -1);
        
        if (isValid(dtStart) && isValid(endInclusive) && dtStart <= endInclusive) {
            try {
                const interval = eachDayOfInterval({ start: dtStart, end: endInclusive });
                interval.forEach(date => blockedDates.add(format(date, 'yyyy-MM-dd')));
            } catch (e) {
                console.warn("Invalid interval in iCal", dtStart, dtEnd);
            }
        }
      }
    } else if (inEvent) {
      if (line.startsWith('DTSTART')) {
        const parts = line.split(':');
        if (parts.length > 1) dtStart = parseICSDate(parts[1]);
      } else if (line.startsWith('DTEND')) {
        const parts = line.split(':');
        if (parts.length > 1) dtEnd = parseICSDate(parts[1]);
      }
    }
  }
  
  return blockedDates;
};

// List of CORS proxies to try in order
const PROXIES = [
    // corsproxy.io
    (url: string) => `https://corsproxy.io/?url=${encodeURIComponent(url)}&_t=${Date.now()}`,
    // codetabs
    (url: string) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}&_t=${Date.now()}`,
    // thingproxy
    (url: string) => `https://thingproxy.freeboard.io/fetch/${url}`
];

export const fetchAndParseICal = async (url: string): Promise<string[]> => {
  if (!url || url.includes('...')) return []; // Skip placeholder URLs

  let icsContent = '';
  let success = false;

  // Iterate through proxies until one works
  for (const createProxyUrl of PROXIES) {
      try {
          const proxyUrl = createProxyUrl(url);
          const response = await fetch(proxyUrl);
          
          if (response.ok) {
              let text = '';
              const contentType = response.headers.get("content-type");
              if (contentType && contentType.includes("application/json")) {
                  const data = await response.json();
                  text = data.contents;
              } else {
                  text = await response.text();
              }
              
              // Basic validation to ensure we got an iCal file and not an HTML error page
              if (text && text.includes('BEGIN:VCALENDAR')) {
                  icsContent = text;
                  success = true;
                  break; // Stop trying other proxies
              }
          } else {
             console.warn(`Proxy failed: ${proxyUrl} with status ${response.status}`);
          }
      } catch (error) {
          // Silently continue to next proxy
          continue;
      }
  }

  if (!success || !icsContent) {
      console.error(`Failed to fetch iCal from all proxies for URL: ${url}`);
      return [];
  }

  try {
    const blockedSet = parseICS(icsContent);
    return Array.from(blockedSet);
  } catch (error) {
    console.error(`Error parsing iCal content from ${url}:`, error);
    return [];
  }
};
