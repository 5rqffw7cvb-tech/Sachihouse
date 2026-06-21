
import React, { useEffect, useState, Suspense, lazy } from 'react';
import { HashRouter as Router, Routes, Route, ScrollRestoration, useLocation, Outlet, useParams } from 'react-router-dom';
import Layout from './components/Layout';
import SEOHead from './components/SEOHead';
import { PropertyData, SiteSettings } from './types';
import { Loader2 } from 'lucide-react';
import { LanguageProvider, useLanguage } from './contexts/LanguageContext';
import { HelmetProvider } from 'react-helmet-async';
import ListingsPage from './pages/ListingsPage';
import { getAllProperties, getSiteSettings } from './services/storage';
const HomePage = lazy(() => import('./pages/HomePage'));
const AccessPage = lazy(() => import('./pages/AccessPage'));
const PricingPage = lazy(() => import('./pages/PricingPage'));
const RulesPage = lazy(() => import('./pages/RulesPage'));
const ManualPage = lazy(() => import('./pages/ManualPage'));
const AdminPage = lazy(() => import('./pages/AdminPage'));
const PhotoTourPage = lazy(() => import('./pages/PhotoTourPage'));
const BlogPage = lazy(() => import('./pages/BlogPage'));
const BlogPostPage = lazy(() => import('./pages/BlogPostPage'));
const AdminBlogPage = lazy(() => import('./pages/AdminBlogPage'));
const AdminUsersPage = lazy(() => import('./pages/AdminUsersPage'));
const PropertyAdminListPage = lazy(() => import('./pages/PropertyAdminListPage'));
const LoginPage = lazy(() => import('./pages/LoginPage'));
const CheckInPage = lazy(() => import('./pages/CheckInPage'));
const CheckInManagementPage = lazy(() => import('./pages/CheckInManagementPage'));

// ScrollToTop component to fix scroll position on route change in HashRouter
const ScrollToTop = () => {
    const { pathname } = useLocation();

    useEffect(() => {
        window.scrollTo(0, 0);
    }, [pathname]);

    return null;
}

// Define Color Palettes
const THEMES = {
  blue: {
    // Facebook Blue / Default
    50: '#eff6ff',
    100: '#dbeafe',
    200: '#bfdbfe',
    500: '#3b82f6',
    600: '#2563EB',
    700: '#1d4ed8',
  },
  airbnb: {
    // Airbnb Red/Pink
    50: '#fff0f5', // Very light pink
    100: '#ffe4e8',
    200: '#ffccd5',
    500: '#ff5a78',
    600: '#FF385C', // Airbnb Brand Color
    700: '#d90b3e',
  },
  booking: {
    // Booking.com Navy Blue
    50: '#f0f4fa',
    100: '#dbeafe', // shared blue-100 usually fine
    200: '#cce0ff',
    500: '#004cb8',
    600: '#003580', // Booking Brand Color
    700: '#00224f',
  },
  agoda: {
    // Agoda Teal/Greenish
    50: '#f0fdf9',
    100: '#ccfbf1',
    200: '#99f6e4',
    500: '#14b8a6',
    600: '#32a081', // Custom Agoda-ish Teal
    700: '#0f766e',
  }
};

const ThemeInjector = ({ theme }: { theme?: 'blue' | 'airbnb' | 'booking' | 'agoda' }) => {
  useEffect(() => {
    const selectedTheme = theme && THEMES[theme] ? THEMES[theme] : THEMES.blue;
    const root = document.documentElement;

    root.style.setProperty('--color-primary-50', selectedTheme[50]);
    root.style.setProperty('--color-primary-100', selectedTheme[100]);
    root.style.setProperty('--color-primary-200', selectedTheme[200]);
    root.style.setProperty('--color-primary-500', selectedTheme[500]);
    root.style.setProperty('--color-primary-600', selectedTheme[600]);
    root.style.setProperty('--color-primary-700', selectedTheme[700]);

  }, [theme]);

  return null;
};

const applyFavicon = (faviconUrl?: string) => {
    if (!faviconUrl) {
        return;
    }

    let link: HTMLLinkElement | null = document.querySelector("link[rel~='icon']");
    if (!link) {
        link = document.createElement('link');
        link.rel = 'icon';
        document.head.appendChild(link);
    }
    link.href = faviconUrl;
};

const SiteFaviconSync = () => {
    useEffect(() => {
        let cancelled = false;

        const syncFavicon = async () => {
            try {
                const { getSiteSettings } = await import('./services/storage');
                const settings = await getSiteSettings();
                if (cancelled) {
                    return;
                }
                applyFavicon(settings.faviconUrl);
            } catch (error) {
                console.error('Failed to load site favicon settings', error);
            }
        };

        void syncFavicon();
        window.addEventListener('site-settings-updated', syncFavicon);
        return () => {
            cancelled = true;
            window.removeEventListener('site-settings-updated', syncFavicon);
        };
    }, []);

    return null;
};

const DYNAMIC_IMPORT_RELOAD_KEY = 'dynamic-import-reload-at';
const DYNAMIC_IMPORT_RELOAD_WINDOW_MS = 15000;

const isChunkLoadError = (value: unknown) => {
    const message = value instanceof Error
        ? value.message
        : typeof value === 'string'
            ? value
            : '';

    return /Failed to fetch dynamically imported module|Importing a module script failed|ChunkLoadError|Loading chunk [\w-]+ failed/i.test(message);
};

const shouldReloadForChunkError = () => {
    try {
        const lastAttempt = Number(sessionStorage.getItem(DYNAMIC_IMPORT_RELOAD_KEY) || 0);
        if (Date.now() - lastAttempt < DYNAMIC_IMPORT_RELOAD_WINDOW_MS) {
            return false;
        }
        sessionStorage.setItem(DYNAMIC_IMPORT_RELOAD_KEY, String(Date.now()));
        return true;
    } catch {
        return true;
    }
};

const ChunkReloadSync = () => {
    useEffect(() => {
        const reloadPage = () => {
            if (shouldReloadForChunkError()) {
                window.location.reload();
            }
        };

        const handlePreloadError = (event: Event & { payload?: unknown }) => {
            if (!isChunkLoadError(event.payload)) {
                return;
            }
            event.preventDefault();
            reloadPage();
        };

        const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
            if (!isChunkLoadError(event.reason)) {
                return;
            }
            event.preventDefault();
            reloadPage();
        };

        window.addEventListener('vite:preloadError', handlePreloadError as EventListener);
        window.addEventListener('unhandledrejection', handleUnhandledRejection);

        return () => {
            window.removeEventListener('vite:preloadError', handlePreloadError as EventListener);
            window.removeEventListener('unhandledrejection', handleUnhandledRejection);
        };
    }, []);

    return null;
};

async function testConnection() {
    return;
}

// ---------------------------------------------------------------------------
// Client-side localization helpers (mirrors backend deepMergeRecord logic)
// ---------------------------------------------------------------------------
function clientDeepMerge(base: unknown, patch: unknown): unknown {
    if (!patch || typeof patch !== 'object') return patch;
    if (Array.isArray(patch)) {
        if (!Array.isArray(base)) return (patch as unknown[]).slice();
        const merged = new Array(base.length);
        for (let i = 0; i < base.length; i++) {
            const p = (patch as unknown[])[i];
            merged[i] = (p === undefined || p === null) ? base[i] : clientDeepMerge(base[i], p);
        }
        return merged;
    }
    if (!base || typeof base !== 'object' || Array.isArray(base)) {
        return { ...(patch as Record<string, unknown>) };
    }
    const merged = { ...(base as Record<string, unknown>) };
    for (const [k, v] of Object.entries(patch as Record<string, unknown>)) {
        merged[k] = (v && typeof v === 'object') ? clientDeepMerge(merged[k], v) : v;
    }
    return merged;
}

function applyClientLocalization<T extends PropertyData>(property: T, lang: string): T {
    if (lang === 'en' || !property.translations || typeof property.translations !== 'object') {
        return property;
    }
    const patch = property.translations[lang];
    if (!patch || typeof patch !== 'object') return property;
    const merged = clientDeepMerge(property, patch) as T;
    // Preserve identity fields and translation map
    return { ...merged, id: (property as T & { id?: string }).id, translations: property.translations };
}


const createDraftPropertyData = (propertyId: string): PropertyData => {
    const readableName = propertyId
        .replace(/^list_/, '')
        .replace(/[-_]+/g, ' ')
        .trim();

    return {
        id: propertyId,
        metalink: propertyId,
        name: readableName ? `New Property ${readableName}` : 'New Property',
        metaTitle: 'New Property',
        subtitle: 'Describe your property',
        description: 'Add an engaging description for this property.',
        address: '',
        mapEmbedUrl: '',
        hostName: '',
        hostImageUrl: '',
        adminEmail: '',
        maxGuests: 1,
        bedrooms: 1,
        beds: 1,
        baths: 1,
        bathFacilityType: 'bathroom',
        toilets: 1,
        highlights: [],
        accessInfo: {
            train: '',
            airport: '',
            checkIn: '',
            youtubeGuideUrl: '',
        },
        additionalRules: '',
        pricing: {
            rates: [{ guests: 1, price: 5000 }],
            cleaning: [{ minGuests: 1, maxGuests: 1, price: 0 }],
            childDiscountPercent: 0,
            childAgeMin: 0,
            childAgeMax: 0,
            longStayDiscountPercent: 0,
            longStayMinNights: 7,
        },
        rules: [],
        manual: [],
        icalFeeds: [],
        amenities: [],
        galleryCategories: [{ id: 'featured', label: 'Featured' }],
        galleryImages: [],
        sleepingArrangements: [],
        social: {
            facebookUrl: '',
            footerImageUrl: '',
            airbnbUrl: '',
            bookingUrl: '',
            agodaUrl: '',
        },
        titles: {
            about: 'About this stay',
            sleeping: 'Sleeping arrangements',
            amenities: 'Amenities',
            access: 'Access',
            accessSubtitle: 'Transport and check-in information',
            pricing: 'Pricing & availability',
            pricingSubtitle: 'Rates, fees, and calendar details',
            rules: 'House rules',
            rulesSubtitle: 'Please review before booking',
            manual: 'Guest manual',
            manualSubtitle: 'Helpful details for your stay',
            menuHome: 'Home',
            menuAccess: 'Access',
            menuPricing: 'Pricing',
            menuRules: 'Rules',
            menuManual: 'Manual',
        },
    };
};

const PropertyRoutes = () => {
    const { id } = useParams<{ id: string }>();
    const { pathname } = useLocation();
    const { language } = useLanguage();
    const propertyId = id || 'main'; // default
    
    const [data, setData] = useState<PropertyData | null>(null);
    
    const [isSyncing, setIsSyncing] = useState(true);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [icalUpdate, setIcalUpdate] = useState(0);

    useEffect(() => {
        let cancelled = false;
        setIsSyncing(true);
        setLoadError(null);
        setData(null);

        import('./services/storage').then(({ getPropertyData, refreshBlockedDates }) => {
            getPropertyData(propertyId).then(cloudData => {
                if (cancelled) return;
                setData(cloudData);
                setIsSyncing(false);
                localStorage.setItem(`cache_property_${propertyId}`, JSON.stringify(cloudData));
                
                refreshBlockedDates(cloudData).then(() => setIcalUpdate(n => n + 1));
            }).catch(err => {
                if (cancelled) return;
                const status = typeof err === 'object' && err !== null && 'status' in err
                    ? Number((err as { status?: unknown }).status)
                    : undefined;
                const message = err instanceof Error ? err.message : '';
                const isAdminEditorRoute = /^\/[^/]+\/admin\/?$/.test(pathname);
                const isNotFound = status === 404 || /property not found/i.test(message);

                if (isAdminEditorRoute && isNotFound) {
                    const draftData = createDraftPropertyData(propertyId);
                    setData(draftData);
                    setIsSyncing(false);
                    setLoadError(null);
                    return;
                }
                console.error("Cloud fetch error:", err);
                setLoadError('Failed to load latest property data.');
                setIsSyncing(false);
            });
        });

        return () => {
            cancelled = true;
        };
    }, [propertyId, pathname]);

    useEffect(() => {
        const handler = () => setIcalUpdate(n => n + 1);
        window.addEventListener('ical-updated', handler);
        return () => window.removeEventListener('ical-updated', handler);
    }, []);

    const handleDataUpdate = (newData: PropertyData) => {
        setData(newData);
        localStorage.setItem(`cache_property_${propertyId}`, JSON.stringify(newData));
        
        // Keep the listings cache in sync to prevent stale data flash on homepage
        const cachedListingsStr = localStorage.getItem('cache_properties');
        if (cachedListingsStr) {
            try {
                let cachedListings = JSON.parse(cachedListingsStr);
                let updated = false;
                cachedListings = cachedListings.map((p: any) => {
                    const matchesIds = p.id === propertyId || (p.id === 'main' && propertyId === 'main') || (!p.id && propertyId === 'main');
                    if (matchesIds) {
                        updated = true;
                        return { ...newData, id: propertyId };
                    }
                    return p;
                });
                if (!updated) {
                    cachedListings.push({ ...newData, id: propertyId });
                }
                localStorage.setItem('cache_properties', JSON.stringify(cachedListings));
            } catch(e) {}
        }

        import('./services/storage').then(({ refreshBlockedDates }) => {
            refreshBlockedDates(newData).then(() => setIcalUpdate(n => n + 1));
        });
    };

    if (isSyncing) {
        return <div className="min-h-screen bg-[#e8e5e6] flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-[#041627]" /></div>;
    }

    if (loadError) {
        return <div className="min-h-screen bg-[#e8e5e6] flex flex-col items-center justify-center text-red-500">{loadError}</div>;
    }

    if (!data) return <div className="min-h-screen bg-[#e8e5e6] flex flex-col items-center justify-center text-red-500">Failed to load property data for {propertyId}</div>;

    // Apply translation client-side — no re-fetch needed on language change
    const localizedData = applyClientLocalization(data, language);

    return (
        <>
            <ThemeInjector theme={data.themeColor} />
            <SEOHead data={localizedData} />
            <Suspense fallback={<div className="min-h-screen bg-[#e8e5e6] flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-gray-400" /></div>}>
                <Routes>
                    <Route element={<Layout data={localizedData} />}>
                        <Route index element={<HomePage data={localizedData} />} />
                        <Route path="access" element={<AccessPage data={localizedData} />} />
                        <Route path="pricing" element={<PricingPage data={localizedData} />} />
                        <Route path="rules" element={<RulesPage data={localizedData} />} />
                        <Route path="manual" element={<ManualPage data={localizedData} />} />
                        <Route path="admin" element={<AdminPage data={data} onUpdate={handleDataUpdate} />} />
                    </Route>
                    <Route path="photos" element={<PhotoTourPage data={localizedData} />} />
                    <Route path="checkin" element={<CheckInPage data={localizedData} propertyId={propertyId} />} />
                </Routes>
            </Suspense>
        </>
    );
};

// Top-level global route for listings
const ListingsSkeleton = () => (
    <div className="bg-[#e8e5e6] min-h-screen">
        <div className="bg-[#ffffff] font-['Plus_Jakarta_Sans'] border-b border-[#e4e2e3] shadow-[0_4px_20px_rgba(0,0,0,0.05)] fixed top-0 left-0 w-full z-50 h-[72px] flex items-center justify-between px-4 sm:px-6 lg:px-8">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded bg-gray-200 animate-pulse"></div>
              <div className="h-6 bg-gray-200 rounded w-32 animate-pulse"></div>
            </div>
            <div className="h-8 w-8 bg-gray-200 rounded animate-pulse hidden md:block"></div>
        </div>
        <div className="max-w-[1280px] mx-auto px-3 md:px-6 py-12 md:py-16 pt-[100px] md:pt-[120px] pb-24 md:pb-12">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-10 gap-6">
                <div>
                    <div className="h-9 w-64 md:w-96 bg-gray-200 rounded animate-pulse mb-3"></div>
                    <div className="h-5 w-48 bg-gray-200 rounded animate-pulse"></div>
                </div>
                <div className="h-10 w-full md:w-64 bg-gray-200 rounded-lg animate-pulse"></div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {[1, 2, 3, 4, 5, 6].map(i => (
                    <div key={i} className="bg-white rounded-xl border border-[#e4e2e3] overflow-hidden flex flex-col h-[380px] shadow-[0_4px_20px_rgba(0,0,0,0.05)]">
                        <div className="aspect-[4/3] bg-gray-200 animate-pulse"></div>
                        <div className="p-6 flex-1 flex flex-col">
                            <div className="flex justify-between items-start mb-2">
                                <div className="h-6 bg-gray-200 rounded w-3/4 animate-pulse"></div>
                            </div>
                            <div className="h-4 bg-gray-200 rounded w-1/2 animate-pulse mb-4"></div>
                            <div className="flex gap-4 mt-auto">
                                <div className="h-4 w-12 bg-gray-200 rounded animate-pulse"></div>
                                <div className="h-4 w-12 bg-gray-200 rounded animate-pulse"></div>
                                <div className="h-4 w-12 bg-gray-200 rounded animate-pulse"></div>
                            </div>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    </div>
);

const ListingsRoute = () => {
    const { language, t } = useLanguage();
    const [properties, setProperties] = useState<(PropertyData & { id: string })[] | null>(null);
    const [settings, setSettings] = useState<SiteSettings | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [loadError, setLoadError] = useState<string | null>(null);
    
    useEffect(() => {
        let cancelled = false;
        setLoadError(null);
        setIsLoading(true);

        Promise.all([getAllProperties(), getSiteSettings()]).then(([data, settingsData]) => {
            if (cancelled) return;
            setProperties(data);
            setSettings(settingsData);
            localStorage.setItem('cache_properties', JSON.stringify(data));
            localStorage.setItem('cache_settings', JSON.stringify(settingsData));
            setIsLoading(false);
        }).catch(err => {
            if (cancelled) return;
            console.error(err);
            setLoadError(t('common_err_homepage_load'));
            setIsLoading(false);
        });

        return () => {
            cancelled = true;
        };
    }, []);

    const handleUpdateSettings = (newSettings: SiteSettings) => {
        setSettings(newSettings);
        localStorage.setItem('cache_settings', JSON.stringify(newSettings));
    };

    if (isLoading) {
        return (
            <div className="min-h-screen bg-[#e8e5e6] flex flex-col items-center justify-center gap-3 text-[#041627]">
                <Loader2 className="w-8 h-8 animate-spin" />
                <p className="text-sm font-medium tracking-[0.04em] uppercase">{t('loading')}</p>
            </div>
        );
    }

    if (!properties || !settings) {
        return (
            <div className="min-h-screen bg-[#e8e5e6] flex items-center justify-center px-6 text-center text-[#ba1a1a]">
                {t('common_err_homepage_load')}
            </div>
        );
    }

    return (
        <>
            {loadError && (
                <div className="bg-amber-50 text-amber-800 text-center text-sm py-2 px-4 border-b border-amber-200">
                    {loadError}
                </div>
            )}
            <ListingsPage
                properties={properties.map(p => applyClientLocalization(p, language))}
                settings={settings}
                onUpdateSettings={handleUpdateSettings}
            />
        </>
    );
}

const App: React.FC = () => {
    useEffect(() => {
        testConnection();
    }, []);

  return (
    <HelmetProvider>
      <LanguageProvider>
        <Router>
          <ScrollToTop /> {/* Ensure page starts at top on navigation */}
                    <SiteFaviconSync />
                    <ChunkReloadSync />

          <Routes>
                        <Route path="/" element={<ListingsRoute />} />
                                                <Route path="/login" element={<Suspense fallback={<div className="min-h-screen bg-[#e8e5e6] flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-gray-400" /></div>}><LoginPage /></Suspense>} />
                        <Route path="/blog" element={<Suspense fallback={<div className="min-h-screen bg-[#e8e5e6] flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-gray-400" /></div>}><BlogPage /></Suspense>} />
                        <Route path="/blog/admin" element={<Suspense fallback={<div className="min-h-screen bg-[#e8e5e6] flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-gray-400" /></div>}><AdminBlogPage /></Suspense>} />
                        <Route path="/admin/users" element={<Suspense fallback={<div className="min-h-screen bg-[#e8e5e6] flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-gray-400" /></div>}><AdminUsersPage /></Suspense>} />
                        <Route path="/admin/properties" element={<Suspense fallback={<div className="min-h-screen bg-[#e8e5e6] flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-gray-400" /></div>}><PropertyAdminListPage /></Suspense>} />
                        <Route path="/admin/checkin-management" element={<Suspense fallback={<div className="min-h-screen bg-[#e8e5e6] flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-gray-400" /></div>}><CheckInManagementPage /></Suspense>} />
                        <Route path="/blog/:id" element={<Suspense fallback={<div className="min-h-screen bg-[#e8e5e6] flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-gray-400" /></div>}><BlogPostPage /></Suspense>} />
                        <Route path="/:id/*" element={<Suspense fallback={<div className="min-h-screen bg-[#e8e5e6] flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-gray-400" /></div>}><PropertyRoutes /></Suspense>} />
          </Routes>
        </Router>
      </LanguageProvider>
    </HelmetProvider>
  );
};

export default App;
