import React, { useState, useEffect } from 'react';
import { PropertyData, SiteSettings } from '../types';
import { MapPin, Users, BedDouble, Bath, Star, ArrowRight, Settings, Trash2, Loader2, Bell, Home, Calendar, Mail, User, X, Check, BedSingle, Toilet, ChevronDown, ChevronUp, Train, Globe, Plus } from 'lucide-react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useLanguage } from '../contexts/LanguageContext';
import { getCurrentUser, subscribeToAuth } from '../services/auth';
import { saveSiteSettings, setPropertyArchived, getAvailableProperties } from '../services/storage';
import { TopNavBar } from '../components/TopNavBar';
import { LanguageSwitcher } from '../components/LanguageSwitcher';
import { MobileBottomNav } from '../components/MobileBottomNav';
import { Footer } from '../components/Footer';
import SearchBookingModal, { SearchModalValues } from '../components/SearchBookingModal';
import { ApiUser } from '../services/api';

// Once the welcome search prompt has been used or dismissed, it stays gone for
// the rest of the browser session.
const SEARCH_MODAL_SEEN_KEY = 'search_modal_seen';
// How long the listings get to themselves before the prompt appears over them.
const SEARCH_MODAL_DELAY_MS = 3000;

export interface ListingsPageProps {
  properties: (PropertyData & { id: string })[];
  settings: SiteSettings;
  onUpdateSettings: (settings: SiteSettings) => void;
}

type AllowedLocation = {
  countryCode: string;
  countryName: string;
  provinceCode: string;
  provinceName: string;
};

const ListingsPage: React.FC<ListingsPageProps> = ({ properties: initialProperties, settings, onUpdateSettings }) => {
  const { t, language } = useLanguage();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [authUser, setAuthUser] = useState<ApiUser | null>(getCurrentUser());
  const [properties, setProperties] = useState(initialProperties);
  const [hosts, setHosts] = useState<ApiUser[]>([]);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [pendingAssignmentKey, setPendingAssignmentKey] = useState<string | null>(null);
  // Co-Host picker: which property's search input is open, and its query.
  const [coHostOpenId, setCoHostOpenId] = useState<string | null>(null);
  const [coHostQuery, setCoHostQuery] = useState('');
  const [visibleCardCount, setVisibleCardCount] = useState(3);
  const [isMobileFiltersOpen, setIsMobileFiltersOpen] = useState(false);
  const [isSearchModalOpen, setIsSearchModalOpen] = useState(false);
  const [draftCountryCode, setDraftCountryCode] = useState('');
  const [draftProvinceCode, setDraftProvinceCode] = useState('');
  const [draftMinBedrooms, setDraftMinBedrooms] = useState('');
  const [draftMinGuests, setDraftMinGuests] = useState('');
  const [draftCheckIn, setDraftCheckIn] = useState('');
  const [draftCheckOut, setDraftCheckOut] = useState('');

  // Availability lookup for the selected date range (null = no dates applied)
  const [availability, setAvailability] = useState<{ ids: Set<string>; priceById: Map<string, number> } | null>(null);
  const [isCheckingAvailability, setIsCheckingAvailability] = useState(false);
  const [availabilityError, setAvailabilityError] = useState<string | null>(null);

  // Settings Modal State
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [editingSettings, setEditingSettings] = useState<SiteSettings>(settings);
  const [isSavingSettings, setIsSavingSettings] = useState(false);

  const isAdmin = authUser?.role === 'ADMIN';
  const isHost = authUser?.role === 'HOST';
  const activeScope = searchParams.get('scope') === 'mine' ? 'mine' : 'all';
  const selectedCountryCode = (searchParams.get('countryCode') || '').toUpperCase();
  const selectedProvinceCode = (searchParams.get('provinceCode') || '').toUpperCase();
  const minBedrooms = Number(searchParams.get('minBedrooms') || 0);
  const minGuests = Number(searchParams.get('minGuests') || 0);
  const selectedCheckIn = searchParams.get('checkIn') || '';
  const selectedCheckOut = searchParams.get('checkOut') || '';
  const datesActive = !!(selectedCheckIn && selectedCheckOut && selectedCheckIn < selectedCheckOut);
  const todayYmd = new Date().toLocaleDateString('sv-SE'); // YYYY-MM-DD in local time

  useEffect(() => {
    setProperties(initialProperties);
  }, [initialProperties]);

  useEffect(() => {
    setEditingSettings(settings);
  }, [settings]);

  useEffect(() => {
    setDraftCountryCode(selectedCountryCode);
    setDraftProvinceCode(selectedProvinceCode);
    setDraftMinBedrooms(minBedrooms > 0 ? String(minBedrooms) : '');
    setDraftMinGuests(minGuests > 0 ? String(minGuests) : '');
    setDraftCheckIn(selectedCheckIn);
    setDraftCheckOut(selectedCheckOut);
  }, [selectedCountryCode, selectedProvinceCode, minBedrooms, minGuests, selectedCheckIn, selectedCheckOut]);

  // Look up which properties are free for the applied date range.
  useEffect(() => {
    if (!datesActive) {
      setAvailability(null);
      setAvailabilityError(null);
      setIsCheckingAvailability(false);
      return;
    }

    let cancelled = false;
    setIsCheckingAvailability(true);
    setAvailabilityError(null);

    getAvailableProperties(selectedCheckIn, selectedCheckOut)
      .then((response) => {
        if (cancelled) return;
        const priceById = new Map<string, number>();
        response.available.forEach((item) => {
          if (typeof item.minNightlyPrice === 'number') {
            priceById.set(item.id, item.minNightlyPrice);
          }
        });
        setAvailability({ ids: new Set(response.available.map((item) => item.id)), priceById });
      })
      .catch((error) => {
        if (cancelled) return;
        console.error('Availability check failed', error);
        setAvailability(null);
        setAvailabilityError(t('listing_no_availability'));
      })
      .finally(() => {
        if (!cancelled) setIsCheckingAvailability(false);
      });

    return () => {
      cancelled = true;
    };
  }, [datesActive, selectedCheckIn, selectedCheckOut, t]);

  useEffect(() => {
    let unsubscribe = () => {};
    subscribeToAuth((user) => {
      setAuthUser(user);
    }).then(unsub => { unsubscribe = unsub; });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!isAdmin) {
      setHosts([]);
      return;
    }

    import('../services/admin').then(({ listUsers }) => {
      listUsers()
        .then((users) => setHosts(users.filter((user) => user.role === 'HOST')))
        .catch((error) => console.error('Failed to load users', error));
    });
  }, [isAdmin]);

  useEffect(() => {
    const nextTitle = settings.browserTitle?.trim() || settings.navTitle?.trim() || 'SachiHouse';
    document.title = nextTitle;
  }, [settings.browserTitle, settings.navTitle]);

  const allowedLocationRows = editingSettings.listingFilters?.allowedLocations ?? [];

  const upsertAllowedLocations = (rows: AllowedLocation[]) => {
    setEditingSettings((prev) => ({
      ...prev,
      listingFilters: {
        allowedLocations: rows,
      },
    }));
  };

  const handleLocationFieldChange = (
    index: number,
    field: 'countryCode' | 'countryName' | 'provinceCode' | 'provinceName',
    value: string,
  ) => {
    const next = allowedLocationRows.map((row, rowIndex) => {
      if (rowIndex !== index) {
        return row;
      }
      return {
        ...row,
        [field]: field.includes('Code') ? value.toUpperCase() : value,
      };
    });
    upsertAllowedLocations(next);
  };

  const handleAddLocationRow = () => {
    upsertAllowedLocations([
      ...allowedLocationRows,
      {
        countryCode: '',
        countryName: '',
        provinceCode: '',
        provinceName: '',
      },
    ]);
  };

  const handleRemoveLocationRow = (index: number) => {
    upsertAllowedLocations(allowedLocationRows.filter((_, rowIndex) => rowIndex !== index));
  };

  const handleDelete = async (e: React.MouseEvent, propertyId: string) => {
    e.preventDefault();
    e.stopPropagation();

    if (!confirm('Archive this listing? You can restore it later from Property Administration.')) {
      return;
    }

    setDeletingId(propertyId);
    try {
      await setPropertyArchived(propertyId, true);
      setProperties(prev => prev.filter(p => p.id !== propertyId));
    } catch (error) {
      console.error("Archive error:", error);
      alert('Failed to archive property. Please try again.');
    } finally {
      setDeletingId(null);
    }
  };

  const buildOptimizedImageUrl = (url: string, width: number) => {
    if (!url.includes('images.unsplash.com')) {
      return url;
    }
    try {
      const parsed = new URL(url);
      parsed.searchParams.set('fm', 'avif');
      parsed.searchParams.set('fit', 'crop');
      parsed.searchParams.set('q', '32');
      parsed.searchParams.set('w', String(width));
      // remove legacy 'auto' param since we're explicitly setting fm=webp
      parsed.searchParams.delete('auto');
      return parsed.toString();
    } catch {
      return url;
    }
  };

  const handleSaveSettings = async () => {
    setIsSavingSettings(true);
    try {
      const normalizedLocations = (editingSettings.listingFilters?.allowedLocations ?? [])
        .map((row) => ({
          countryCode: row.countryCode.trim().toUpperCase(),
          countryName: row.countryName.trim(),
          provinceCode: row.provinceCode.trim().toUpperCase(),
          provinceName: row.provinceName.trim(),
        }))
        .filter((row) => row.countryCode && row.countryName && row.provinceCode && row.provinceName);

      const normalizedSettings: SiteSettings = {
        ...editingSettings,
        navTitle: editingSettings.navTitle.trim(),
        headerTitle: editingSettings.headerTitle.trim(),
        headerSubtitle: editingSettings.headerSubtitle.trim(),
        browserTitle: editingSettings.browserTitle.trim() || editingSettings.navTitle.trim() || 'SachiHouse',
        faviconUrl: editingSettings.faviconUrl.trim(),
        footerTitle: editingSettings.footerTitle.trim(),
        footerCopyright: editingSettings.footerCopyright.trim(),
        listingFilters: {
          allowedLocations: normalizedLocations,
        },
      };

      await saveSiteSettings(normalizedSettings);
      onUpdateSettings(normalizedSettings);
      setIsSettingsModalOpen(false);
    } catch (error) {
      console.error("Save settings error:", error);
      alert('Failed to save settings. Please try again.');
    } finally {
      setIsSavingSettings(false);
    }
  };

  const handleToggleHostAssignment = async (propertyId: string, host: ApiUser) => {
    const currentlyAssigned = host.assignedPropertyIds?.includes(propertyId);
    const assignmentKey = `${propertyId}:${host.id}`;
    setPendingAssignmentKey(assignmentKey);

    try {
      const { assignHostToProperty, listUsers, unassignHostFromProperty } = await import('../services/admin');
      if (currentlyAssigned) {
        await unassignHostFromProperty(propertyId, host.id);
      } else {
        await assignHostToProperty(propertyId, host.id);
      }
      const users = await listUsers();
      setHosts(users.filter((user) => user.role === 'HOST'));
    } catch (error) {
      console.error('Assignment update failed', error);
      alert('Failed to update host assignment.');
    } finally {
      setPendingAssignmentKey(null);
    }
  };

  const updateQueryParams = (updates: Record<string, string | null>) => {
    const next = new URLSearchParams(searchParams);
    Object.entries(updates).forEach(([key, value]) => {
      if (!value) {
        next.delete(key);
        return;
      }
      next.set(key, value);
    });
    setSearchParams(next, { replace: true });
  };

  const handleScopeChange = (scope: 'all' | 'mine') => {
    if (scope === 'mine') {
      updateQueryParams({ scope: 'mine' });
      return;
    }
    updateQueryParams({ scope: null });
  };

  const allowedLocations = settings.listingFilters?.allowedLocations ?? [];
  const countryOptions = Array.from(
    new Map(allowedLocations.map((location) => [location.countryCode, location])).values(),
  );
  const provinceOptions = allowedLocations.filter((location) => location.countryCode === selectedCountryCode);
  const draftProvinceOptions = allowedLocations.filter((location) => location.countryCode === draftCountryCode);
  const selectedCountry = countryOptions.find((country) => country.countryCode === selectedCountryCode);
  const selectedProvince = provinceOptions.find((province) => province.provinceCode === selectedProvinceCode);

  const scopedProperties = isHost && activeScope === 'mine'
    ? properties.filter((property) => authUser?.assignedPropertyIds?.includes(property.id))
    : properties;

  const maxBedrooms = scopedProperties.reduce((max, property) => Math.max(max, property.bedrooms || 0), 0);
  const maxGuestsAvailable = scopedProperties.reduce((max, property) => Math.max(max, property.maxGuests || 0), 0);
  const bedroomOptions = Array.from({ length: Math.max(maxBedrooms, 1) }, (_, index) => index + 1);
  const guestOptions = Array.from({ length: Math.max(maxGuestsAvailable, 1) }, (_, index) => index + 1);

  const filteredProperties = scopedProperties.filter((property) => {
    const propertyCountryCode = property.location?.countryCode?.toUpperCase();
    const propertyProvinceCode = property.location?.provinceCode?.toUpperCase();
    const propertyAddress = (property.address || '').toLowerCase();

    const matchesCountryByAddress = !!selectedCountry && propertyAddress.includes(selectedCountry.countryName.toLowerCase());
    const matchesCountry = !selectedCountryCode
      || matchesCountryByAddress
      || propertyCountryCode === selectedCountryCode;
    if (!matchesCountry) {
      return false;
    }

    const matchesProvinceByAddress = !!selectedProvince && propertyAddress.includes(selectedProvince.provinceName.toLowerCase());
    const matchesProvince = !selectedProvinceCode
      || matchesProvinceByAddress
      || propertyProvinceCode === selectedProvinceCode;
    if (!matchesProvince) {
      return false;
    }
    if (Number.isFinite(minBedrooms) && minBedrooms > 0 && property.bedrooms < minBedrooms) {
      return false;
    }
    if (Number.isFinite(minGuests) && minGuests > 0 && property.maxGuests < minGuests) {
      return false;
    }

    return true;
  });

  // When a date range is applied, keep only properties the backend reports as free.
  // While the check is still loading we show nothing rather than stale (possibly
  // unavailable) listings.
  const displayedProperties = datesActive
    ? (availability ? filteredProperties.filter((property) => availability.ids.has(property.id)) : [])
    : filteredProperties;

  const activeFilterCount = [
    selectedCountryCode,
    selectedProvinceCode,
    minBedrooms > 0 ? String(minBedrooms) : '',
    minGuests > 0 ? String(minGuests) : '',
    datesActive ? 'dates' : '',
  ].filter(Boolean).length;

  const applyDraftFilters = () => {
    updateQueryParams({
      countryCode: draftCountryCode || null,
      provinceCode: draftProvinceCode || null,
      minBedrooms: draftMinBedrooms || null,
      minGuests: draftMinGuests || null,
      checkIn: draftCheckIn && draftCheckOut && draftCheckIn < draftCheckOut ? draftCheckIn : null,
      checkOut: draftCheckIn && draftCheckOut && draftCheckIn < draftCheckOut ? draftCheckOut : null,
    });
    setIsMobileFiltersOpen(false);
  };

  const clearAllFilters = () => {
    setDraftCountryCode('');
    setDraftProvinceCode('');
    setDraftMinBedrooms('');
    setDraftMinGuests('');
    setDraftCheckIn('');
    setDraftCheckOut('');
    updateQueryParams({ countryCode: null, provinceCode: null, minBedrooms: null, minGuests: null, checkIn: null, checkOut: null });
    setIsMobileFiltersOpen(false);
  };

  const markSearchModalSeen = () => {
    try {
      sessionStorage.setItem(SEARCH_MODAL_SEEN_KEY, '1');
    } catch {
      // Private browsing can refuse storage; the prompt simply reappears.
    }
  };

  const closeSearchModal = () => {
    markSearchModalSeen();
    setIsSearchModalOpen(false);
  };

  const handleSearchModalSubmit = (values: SearchModalValues) => {
    markSearchModalSeen();
    setIsSearchModalOpen(false);
    updateQueryParams({
      countryCode: values.countryCode || null,
      provinceCode: values.provinceCode || null,
      minGuests: values.minGuests || null,
      checkIn: values.checkIn,
      checkOut: values.checkOut,
    });
  };

  // Greet arriving guests with the search prompt. Deliberately skipped for
  // signed-in staff (they open this page to manage listings, not to book) and
  // for links that already carry a search, which would otherwise be buried
  // under a dialog asking for the search the visitor just made.
  useEffect(() => {
    if (isAdmin || isHost) return;
    if (activeFilterCount > 0) return;
    try {
      if (sessionStorage.getItem(SEARCH_MODAL_SEEN_KEY)) return;
    } catch {
      // No storage available — showing it is the safer default.
    }
    // Let the listings land first. Opening on arrival reads as an ad, and the
    // guest has not yet seen what it is they would be searching through.
    const timer = window.setTimeout(() => setIsSearchModalOpen(true), SEARCH_MODAL_DELAY_MS);
    return () => window.clearTimeout(timer);
    // Runs once on arrival: later filter changes must not re-open the prompt.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const initialCount = Math.min(3, displayedProperties.length);
    setVisibleCardCount(initialCount);

    const revealAll = () => setVisibleCardCount(displayedProperties.length);
    if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
      const idleId = (window as Window & { requestIdleCallback: (cb: () => void, opts?: { timeout: number }) => number }).requestIdleCallback(revealAll, { timeout: 600 });
      return () => {
        if ('cancelIdleCallback' in window) {
          (window as Window & { cancelIdleCallback: (id: number) => void }).cancelIdleCallback(idleId);
        }
      };
    }

    const timer = window.setTimeout(revealAll, 180);
    return () => window.clearTimeout(timer);
  }, [displayedProperties.length]);

  const visibleProperties = displayedProperties.slice(0, visibleCardCount);

  // The first listing's own photo becomes the search prompt's header image, so
  // the dialog shows the guest what they are about to search through.
  const searchModalHeroUrl = (() => {
    const heroImage = properties
      .flatMap((property) => property.galleryImages ?? [])
      .find((image) => image && image.showOnHome && image.url);
    return heroImage ? buildOptimizedImageUrl(heroImage.url, 640) : undefined;
  })();

  return (
    <div className="bg-[#e8e5e6] text-[#1b1c1d] font-['Inter'] min-h-screen flex flex-col">
      <SearchBookingModal
        open={isSearchModalOpen}
        onClose={closeSearchModal}
        onSubmit={handleSearchModalSubmit}
        allowedLocations={allowedLocations}
        guestOptions={guestOptions}
        todayYmd={todayYmd}
        heroImageUrl={searchModalHeroUrl}
      />
      <TopNavBar
        navTitleOverride={settings.navTitle}
        actionButton={
          <div className="flex items-center gap-2">
            {isAdmin && (
              <>
                <button
                  onClick={() => setIsSettingsModalOpen(true)}
                  className="hidden md:flex bg-[#ffffff] border border-[#c4c6cd] text-[#1b1c1d] px-4 py-2 rounded-full font-semibold text-[14px]/[1.4] hover:bg-[#e4e2e3] transition-colors items-center gap-1.5 shadow-sm"
                >
                  <Settings className="w-4 h-4" /> Edit Page Content
                </button>
              </>
            )}
            <LanguageSwitcher />
          </div>
        }
        mobileActionButton={<LanguageSwitcher compact />}
      />

      {/* Main Content Canvas */}
      <main className="flex-1 w-full max-w-[1280px] mx-auto px-3 md:px-6 py-12 md:py-16 pt-6 md:pt-[120px] pb-24 md:pb-12">
        {/* Header Section */}
        <div className="mb-6">
          <div>
            <h1 className="font-['Plus_Jakarta_Sans'] text-[28px] md:text-[36px] font-bold text-[#1b1c1d] leading-[1.2] mb-2">{settings.headerTitle}</h1>
            <p className="text-[16px] text-[#44474c] leading-[1.6] whitespace-pre-wrap">{settings.headerSubtitle}</p>
          </div>
        </div>

        <div className="mb-4 md:hidden">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setIsMobileFiltersOpen((prev) => !prev)}
              className="flex min-w-0 flex-1 items-center justify-between rounded-xl border border-[#c4c6cd] bg-white px-4 py-3 text-left text-[14px] font-semibold text-[#1b1c1d]"
            >
              <span>
                {t('listing_filters')}
                {activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}
              </span>
              {isMobileFiltersOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </button>
            <button
              type="button"
              onClick={clearAllFilters}
              className="shrink-0 rounded-xl border border-[#c4c6cd] bg-white px-3 py-3 text-[13px] font-semibold text-[#44474c] transition-colors hover:bg-[#efedef]"
            >
              {t('listing_clear_filter')}
            </button>
          </div>

          {isMobileFiltersOpen && (
            <div className="mt-3 grid grid-cols-1 gap-3 rounded-xl border border-[#e4e2e3] bg-white p-3">
              <div>
                <label htmlFor="mobile-listing-country" className="mb-1 block text-[12px] font-semibold uppercase tracking-[0.08em] text-[#44474c]">{t('listing_country')}</label>
                <select
                  id="mobile-listing-country"
                  value={draftCountryCode}
                  onChange={(event) => {
                    setDraftCountryCode(event.target.value.toUpperCase());
                    setDraftProvinceCode('');
                  }}
                  className="w-full rounded-lg border border-[#c4c6cd] bg-white px-3 py-2 text-[14px] text-[#1b1c1d] focus:outline-none focus:border-[#041627] focus:ring-1 focus:ring-[#041627]"
                >
                  <option value="">{t('listing_all_countries')}</option>
                  {countryOptions.map((country) => (
                    <option key={country.countryCode} value={country.countryCode}>{country.countryName}</option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="mobile-listing-province" className="mb-1 block text-[12px] font-semibold uppercase tracking-[0.08em] text-[#44474c]">{t('listing_province')}</label>
                <select
                  id="mobile-listing-province"
                  value={draftProvinceCode}
                  disabled={!draftCountryCode}
                  onChange={(event) => {
                    setDraftProvinceCode(event.target.value.toUpperCase());
                  }}
                  className="w-full rounded-lg border border-[#c4c6cd] bg-white px-3 py-2 text-[14px] text-[#1b1c1d] focus:outline-none focus:border-[#041627] focus:ring-1 focus:ring-[#041627] disabled:bg-[#f5f3f4] disabled:text-[#8a8d92]"
                >
                  <option value="">{t('listing_all_provinces')}</option>
                  {draftProvinceOptions.map((province) => (
                    <option key={province.provinceCode} value={province.provinceCode}>{province.provinceName}</option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="mobile-listing-bedrooms" className="mb-1 block text-[12px] font-semibold uppercase tracking-[0.08em] text-[#44474c]">{t('listing_bedrooms')}</label>
                <select
                  id="mobile-listing-bedrooms"
                  value={draftMinBedrooms}
                  onChange={(event) => setDraftMinBedrooms(event.target.value)}
                  className="w-full rounded-lg border border-[#c4c6cd] bg-white px-3 py-2 text-[14px] text-[#1b1c1d] focus:outline-none focus:border-[#041627] focus:ring-1 focus:ring-[#041627]"
                >
                  <option value="">{t('listing_any')}</option>
                  {bedroomOptions.map((value) => (
                    <option key={value} value={value}>{value}+</option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="mobile-listing-guests" className="mb-1 block text-[12px] font-semibold uppercase tracking-[0.08em] text-[#44474c]">{t('listing_guests')}</label>
                <select
                  id="mobile-listing-guests"
                  value={draftMinGuests}
                  onChange={(event) => setDraftMinGuests(event.target.value)}
                  className="w-full rounded-lg border border-[#c4c6cd] bg-white px-3 py-2 text-[14px] text-[#1b1c1d] focus:outline-none focus:border-[#041627] focus:ring-1 focus:ring-[#041627]"
                >
                  <option value="">{t('listing_any')}</option>
                  {guestOptions.map((value) => (
                    <option key={value} value={value}>{value}+</option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="mobile-listing-checkin" className="mb-1 block text-[12px] font-semibold uppercase tracking-[0.08em] text-[#44474c]">{t('listing_checkin')}</label>
                  <input
                    id="mobile-listing-checkin"
                    type="date"
                    value={draftCheckIn}
                    min={todayYmd}
                    onChange={(event) => {
                      setDraftCheckIn(event.target.value);
                      if (draftCheckOut && event.target.value && draftCheckOut <= event.target.value) {
                        setDraftCheckOut('');
                      }
                    }}
                    className="w-full rounded-lg border border-[#c4c6cd] bg-white px-3 py-2 text-[14px] text-[#1b1c1d] focus:outline-none focus:border-[#041627] focus:ring-1 focus:ring-[#041627]"
                  />
                </div>
                <div>
                  <label htmlFor="mobile-listing-checkout" className="mb-1 block text-[12px] font-semibold uppercase tracking-[0.08em] text-[#44474c]">{t('listing_checkout')}</label>
                  <input
                    id="mobile-listing-checkout"
                    type="date"
                    value={draftCheckOut}
                    min={draftCheckIn || todayYmd}
                    onChange={(event) => setDraftCheckOut(event.target.value)}
                    className="w-full rounded-lg border border-[#c4c6cd] bg-white px-3 py-2 text-[14px] text-[#1b1c1d] focus:outline-none focus:border-[#041627] focus:ring-1 focus:ring-[#041627]"
                  />
                </div>
              </div>
              <button
                type="button"
                onClick={applyDraftFilters}
                className="rounded-lg bg-[#041627] px-3 py-2 text-[13px] font-semibold text-white transition-colors hover:bg-[#041627]/90"
              >
                {t('listing_apply_filter')}
              </button>
            </div>
          )}
        </div>

        <div className="mb-8 hidden flex-wrap items-center gap-2 md:flex">
          <select
            id="desktop-listing-country"
            aria-label={t('listing_country')}
            value={draftCountryCode}
            onChange={(event) => {
              setDraftCountryCode(event.target.value.toUpperCase());
              setDraftProvinceCode('');
            }}
            className="h-10 min-w-[150px] flex-1 rounded-lg border border-[#d7dae0] bg-white px-3 text-[14px] text-[#1b1c1d] transition-colors hover:border-[#a9adb5] focus:outline-none focus:border-[#041627] focus:ring-1 focus:ring-[#041627]"
          >
            <option value="">{t('listing_all_countries')}</option>
            {countryOptions.map((country) => (
              <option key={country.countryCode} value={country.countryCode}>{country.countryName}</option>
            ))}
          </select>
          <select
            id="desktop-listing-province"
            aria-label={t('listing_province')}
            value={draftProvinceCode}
            disabled={!draftCountryCode}
            onChange={(event) => {
              setDraftProvinceCode(event.target.value.toUpperCase());
            }}
            className="h-10 min-w-[150px] flex-1 rounded-lg border border-[#d7dae0] bg-white px-3 text-[14px] text-[#1b1c1d] transition-colors hover:border-[#a9adb5] focus:outline-none focus:border-[#041627] focus:ring-1 focus:ring-[#041627] disabled:cursor-not-allowed disabled:border-[#e3e5e9] disabled:bg-[#f5f3f4] disabled:text-[#8a8d92] disabled:hover:border-[#e3e5e9]"
          >
            <option value="">{t('listing_all_provinces')}</option>
            {draftProvinceOptions.map((province) => (
              <option key={province.provinceCode} value={province.provinceCode}>{province.provinceName}</option>
            ))}
          </select>
          <select
            id="desktop-listing-bedrooms"
            aria-label={t('listing_bedrooms')}
            value={draftMinBedrooms}
            onChange={(event) => setDraftMinBedrooms(event.target.value)}
            className="h-10 w-[130px] rounded-lg border border-[#d7dae0] bg-white px-3 text-[14px] text-[#1b1c1d] transition-colors hover:border-[#a9adb5] focus:outline-none focus:border-[#041627] focus:ring-1 focus:ring-[#041627]"
          >
            <option value="">{t('listing_bedrooms')}</option>
            {bedroomOptions.map((value) => (
              <option key={value} value={value}>{value}+ {t('listing_bedrooms')}</option>
            ))}
          </select>
          <select
            id="desktop-listing-guests"
            aria-label={t('listing_guests')}
            value={draftMinGuests}
            onChange={(event) => setDraftMinGuests(event.target.value)}
            className="h-10 w-[130px] rounded-lg border border-[#d7dae0] bg-white px-3 text-[14px] text-[#1b1c1d] transition-colors hover:border-[#a9adb5] focus:outline-none focus:border-[#041627] focus:ring-1 focus:ring-[#041627]"
          >
            <option value="">{t('listing_guests')}</option>
            {guestOptions.map((value) => (
              <option key={value} value={value}>{value}+ {t('listing_guests')}</option>
            ))}
          </select>
          <input
            id="desktop-listing-checkin"
            type="date"
            aria-label={t('listing_checkin')}
            title={t('listing_checkin')}
            value={draftCheckIn}
            min={todayYmd}
            onChange={(event) => {
              setDraftCheckIn(event.target.value);
              if (draftCheckOut && event.target.value && draftCheckOut <= event.target.value) {
                setDraftCheckOut('');
              }
            }}
            className="h-10 w-[145px] rounded-lg border border-[#d7dae0] bg-white px-3 text-[14px] text-[#1b1c1d] transition-colors hover:border-[#a9adb5] focus:outline-none focus:border-[#041627] focus:ring-1 focus:ring-[#041627]"
          />
          <input
            id="desktop-listing-checkout"
            type="date"
            aria-label={t('listing_checkout')}
            title={t('listing_checkout')}
            value={draftCheckOut}
            min={draftCheckIn || todayYmd}
            onChange={(event) => setDraftCheckOut(event.target.value)}
            className="h-10 w-[145px] rounded-lg border border-[#d7dae0] bg-white px-3 text-[14px] text-[#1b1c1d] transition-colors hover:border-[#a9adb5] focus:outline-none focus:border-[#041627] focus:ring-1 focus:ring-[#041627]"
          />
          <button
            type="button"
            onClick={applyDraftFilters}
            className="h-10 rounded-lg bg-[#041627] px-5 text-[13px] font-semibold text-white transition-colors hover:bg-[#041627]/90"
          >
            {t('listing_apply_filter')}
          </button>
          <button
            type="button"
            onClick={clearAllFilters}
            className="h-10 rounded-lg px-3 text-[13px] font-semibold text-[#63768a] transition-colors hover:bg-[#efedef] hover:text-[#1b1c1d]"
          >
            {t('listing_clear_filter')}
          </button>
          {isHost && (
            <div className="ml-auto inline-flex items-center gap-1 rounded-lg bg-[#f5f3f4] p-1">
              <button
                onClick={() => handleScopeChange('all')}
                className={`rounded-md px-3 py-1.5 text-[13px] font-semibold transition-colors ${activeScope === 'all' ? 'bg-[#041627] text-white shadow-sm' : 'text-[#44474c] hover:text-[#1b1c1d]'}`}
              >
                {t('listing_scope_all')}
              </button>
              <button
                onClick={() => handleScopeChange('mine')}
                className={`rounded-md px-3 py-1.5 text-[13px] font-semibold transition-colors ${activeScope === 'mine' ? 'bg-[#041627] text-white shadow-sm' : 'text-[#44474c] hover:text-[#1b1c1d]'}`}
              >
                {t('listing_my_properties')}
              </button>
            </div>
          )}
        </div>

        {isHost && activeScope === 'mine' && (
          <div className="mb-6 text-[14px] text-[#44474c]">
            {t('listing_scope_mine_desc')}
          </div>
        )}

        {/* Active date range summary */}
        {datesActive && (
          <div className="mb-5 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[14px] text-[#44474c]">
            <span className="inline-flex items-center gap-1.5 font-semibold text-[#1b1c1d]">
              <Calendar className="h-4 w-4 text-[#041627]" />
              {selectedCheckIn} → {selectedCheckOut}
            </span>
            {isCheckingAvailability ? (
              <span className="inline-flex items-center gap-1.5">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                {t('listing_checking_availability')}
              </span>
            ) : availability ? (
              <span>· {displayedProperties.length}</span>
            ) : null}
            <button
              type="button"
              onClick={() => updateQueryParams({ checkIn: null, checkOut: null })}
              className="text-[13px] font-semibold text-[#041627] underline underline-offset-2 hover:text-[#041627]/80"
            >
              {t('listing_clear_dates')}
            </button>
          </div>
        )}

        {/* Property Grid */}
        {datesActive && isCheckingAvailability ? (
          <div className="bg-white border border-[#e4e2e3] rounded-xl px-6 py-10 text-center text-[#44474c]">
            <Loader2 className="mx-auto mb-3 h-6 w-6 animate-spin text-[#041627]" />
            {t('listing_checking_availability')}
          </div>
        ) : displayedProperties.length === 0 ? (
          <div className="bg-white border border-[#e4e2e3] rounded-xl px-6 py-10 text-center text-[#44474c]">
            {datesActive
              ? (availabilityError || t('listing_no_availability'))
              : isHost && activeScope === 'mine'
                ? t('listing_empty_mine')
                : t('listing_empty_all')}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6">
            {visibleProperties.map((property, index) => {
            const imageUrl = property.galleryImages
              ?.find((img) => img && img.showOnHome)
              ?.url || "https://images.unsplash.com/photo-1556228453-efd6c1ff04f6?auto=format&fit=crop&q=72&w=800";
            const imageSrc = buildOptimizedImageUrl(imageUrl, index === 0 ? 640 : 480);
            const imageSrcSet = `${buildOptimizedImageUrl(imageUrl, 320)} 320w, ${buildOptimizedImageUrl(imageUrl, 480)} 480w, ${buildOptimizedImageUrl(imageUrl, 640)} 640w`;
            const assignedHosts = hosts.filter((host) => host.assignedPropertyIds?.includes(property.id));
            const bathLabel = `${property.baths} ${property.bathFacilityType === 'shower_room'
              ? property.baths === 1 ? t('listing_shower_room') : t('listing_shower_rooms')
              : property.baths === 1 ? t('listing_bathroom') : t('listing_bathrooms')}`;
            const rates = property.pricing?.rates ?? [];
            const fromPrice = datesActive
              ? (availability?.priceById.get(property.id)
                ?? (rates.length ? Math.min(...rates.map((rate) => rate.price)) : null))
              : null;

            return (
              <div key={property.id} className="bg-[#ffffff] rounded-2xl md:rounded-xl border border-[#ecebea] md:border-[#e4e2e3] shadow-[0_2px_10px_rgba(15,23,42,0.05)] md:shadow-[0_4px_20px_rgba(0,0,0,0.05)] md:hover:shadow-[0_8px_30px_rgba(0,0,0,0.08)] active:scale-[0.99] md:active:scale-100 overflow-hidden transition-all duration-300 flex flex-col h-full relative group">
                <Link to={`/${property.metalink || property.id}`} className="flex flex-row md:flex-col flex-grow cursor-pointer p-3 md:p-0">
                  {/* Image Container */}
                  <div className="relative w-[104px] h-[104px] shrink-0 rounded-xl md:rounded-none md:w-full md:h-auto md:aspect-[4/3] overflow-hidden bg-[#e4e2e3]">
                    <img
                      src={imageSrc}
                      srcSet={imageSrcSet}
                      sizes="(max-width: 767px) 92vw, (max-width: 1023px) 46vw, 30vw"
                      alt={property.name}
                      loading={index < 2 ? "eager" : "lazy"}
                      fetchPriority={index === 0 ? "high" : "auto"}
                      decoding="async"
                      className="absolute md:relative inset-0 w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
                    />
                    {/* Badges */}
                    <div className="absolute top-2 left-2 md:top-3 md:left-3 flex gap-2">
                      {property.isSuperhost && (
                        <span className="bg-[#1b4332]/90 backdrop-blur-sm text-white px-1.5 py-0.5 md:px-2 md:py-1 rounded-full md:rounded text-[9.5px] md:text-[12px] tracking-[0.05em] font-bold md:font-semibold flex items-center gap-1 shadow-sm leading-none">
                          <Star className="w-2.5 h-2.5 md:w-3.5 md:h-3.5 fill-white" />
                          {t('listing_superhost')}
                        </span>
                      )}
                    </div>
                    <span className="md:hidden absolute bottom-2 left-2 flex items-center gap-1 bg-white/95 backdrop-blur-sm px-1.5 py-0.5 rounded-full text-[10px] font-bold text-[#1b1c1d] shadow-sm">
                      <Star className="w-2.5 h-2.5 text-[#eab308] fill-[#eab308]" />
                      4.96
                    </span>
                  </div>

                  {/* Content */}
                  <div className="pl-3 py-0 md:p-6 flex flex-col flex-grow min-w-0 justify-center md:justify-start">
                    <div className="flex justify-between items-start mb-0 md:mb-1.5">
                      <h2 className="font-['Plus_Jakarta_Sans'] font-semibold tracking-tight md:tracking-normal text-[14.5px] md:text-[18px]/[1.4] text-[#041627] line-clamp-1 pr-2">{property.name}</h2>
                      <div className="hidden md:flex items-center gap-1 text-[#1b1c1d] shrink-0">
                        <Star className="w-4 h-4 text-[#eab308] fill-[#eab308]" />
                        <span className="font-semibold text-[14px]/[1.4]">4.96</span>
                      </div>
                    </div>
                    <p className="hidden md:block text-[14px]/[1.4] text-[#44474c] mb-1.5 line-clamp-1">{property.subtitle || t('listing_property_in_tokyo')}</p>
                    <div className="mt-1 md:mt-0 md:mb-1.5 flex items-center gap-1 md:gap-1.5 text-[11.5px] md:text-[12px] text-[#74777d] md:font-semibold md:uppercase md:tracking-[0.06em]">
                      <MapPin className="h-3 w-3 md:h-3.5 md:w-3.5 shrink-0 text-[#9ea3ab] md:text-[#74777d]" />
                      <span className="line-clamp-1">
                        {property.location
                          ? `${property.location.provinceName}, ${property.location.countryName}`
                          : property.address || t('listing_location_not_set')}
                      </span>
                    </div>
                    {(property.accessInfo?.nearestStationName || property.accessInfo?.nearestStationDistance) && (
                      <div className="mt-1 md:mt-0 md:mb-1.5 flex items-center gap-1 md:gap-1.5 text-[11px] md:text-[12px] font-semibold text-[#5b3f00]">
                        <Train className="h-3 w-3 md:h-3.5 md:w-3.5 shrink-0" />
                        <span className="line-clamp-1">
                          {property.accessInfo?.nearestStationDistance || t('listing_nearby')}
                          {` ${t('listing_from')} `}
                          {property.accessInfo?.nearestStationName || t('listing_nearest_station')}
                        </span>
                      </div>
                    )}

                    {/* From price for the selected date range */}
                    {fromPrice !== null && (
                      <div className="mt-2 flex items-baseline gap-1">
                        <span className="text-[10.5px] md:text-[11px] font-semibold uppercase tracking-[0.06em] text-[#74777d]">{t('listing_price_from')}</span>
                        <span className="text-[15px] md:text-[18px] font-bold text-[#041627]">¥{fromPrice.toLocaleString()}</span>
                        <span className="text-[10.5px] md:text-[11px] text-[#74777d]">{t('listing_per_night')}</span>
                      </div>
                    )}

                    {/* Mobile: compact pill badges */}
                    <div className="flex md:hidden items-center gap-1.5 mt-2 text-[10.5px] font-semibold text-[#44474c]">
                      <span className="inline-flex items-center gap-1 rounded-full bg-[#f5f3f4] px-2 py-0.5" title={`${property.maxGuests} guests`}>
                        <Users className="w-3 h-3" />
                        {property.maxGuests}
                      </span>
                      <span className="inline-flex items-center gap-1 rounded-full bg-[#f5f3f4] px-2 py-0.5" title={`${property.bedrooms} bedrooms`}>
                        <BedSingle className="w-3 h-3" />
                        {property.bedrooms}
                      </span>
                      <span className="inline-flex items-center gap-1 rounded-full bg-[#f5f3f4] px-2 py-0.5" title={bathLabel}>
                        <Bath className="w-3 h-3" />
                        {property.baths}
                      </span>
                    </div>

                    {/* Desktop: evenly distributed stat blocks */}
                    <div className="hidden md:flex items-stretch justify-between mt-auto pt-3 border-t border-[#efedef]">
                      <div className="flex flex-1 flex-col items-center gap-1" title={`${property.maxGuests} guests`}>
                        <Users className="w-4 h-4 text-[#74777d]" />
                        <span className="text-[13px] font-bold text-[#1b1c1d]">{property.maxGuests}</span>
                      </div>
                      <div className="w-px bg-[#efedef]" />
                      <div className="flex flex-1 flex-col items-center gap-1" title={`${property.bedrooms} bedrooms`}>
                        <BedSingle className="w-4 h-4 text-[#74777d]" />
                        <span className="text-[13px] font-bold text-[#1b1c1d]">{property.bedrooms}</span>
                      </div>
                      <div className="w-px bg-[#efedef]" />
                      <div className="flex flex-1 flex-col items-center gap-1" title={`${property.beds} beds`}>
                        <BedDouble className="w-4 h-4 text-[#74777d]" />
                        <span className="text-[13px] font-bold text-[#1b1c1d]">{property.beds}</span>
                      </div>
                      <div className="w-px bg-[#efedef]" />
                      <div className="flex flex-1 flex-col items-center gap-1" title={bathLabel}>
                        <Bath className="w-4 h-4 text-[#74777d]" />
                        <span className="text-[13px] font-bold text-[#1b1c1d]">{property.baths}</span>
                      </div>
                      <div className="w-px bg-[#efedef]" />
                      <div className="flex flex-1 flex-col items-center gap-1" title={`${property.toilets} toilets`}>
                        <Toilet className="w-4 h-4 text-[#74777d]" />
                        <span className="text-[13px] font-bold text-[#1b1c1d]">{property.toilets}</span>
                      </div>
                    </div>
                  </div>
                </Link>

                {/* Admin Actions Overlay */}
                {isAdmin && (
                  <div className="px-3 pb-3 pt-0 md:px-6 md:pb-6 mt-auto z-10 relative">
                    <div className="flex gap-3 pt-4 border-t border-[#e4e2e3]">
                      <button 
                        onClick={(e) => { e.preventDefault(); e.stopPropagation(); navigate(`/${property.metalink || property.id}/admin`); }}
                        className="flex-1 bg-[#ffffff] border border-[#041627] text-[#041627] px-4 py-2 rounded-full font-semibold text-[14px]/[1.4] hover:bg-[#e4e2e3] transition-colors text-center"
                      >
                        Edit
                      </button>
                      {property.id !== 'main' && (
                        <button 
                          onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleDelete(e, property.id); }}
                          disabled={deletingId === property.id}
                          className="px-4 py-2 rounded-full border border-[#c4c6cd] text-[#44474c] hover:text-[#ba1a1a] hover:border-[#ba1a1a] transition-colors disabled:opacity-50"
                        >
                          {deletingId === property.id ? (
                            <Loader2 className="w-5 h-5 animate-spin" />
                          ) : (
                            <Trash2 className="w-5 h-5" />
                          )}
                        </button>
                      )}
                    </div>
                    <div className="mt-3 rounded-xl border border-[#e4e2e3] bg-[#f8f7f7] px-3 py-3 text-[12px] text-[#44474c]">
                        <div className="font-semibold text-[#1b1c1d] mb-2">Assigned Hosts</div>
                        {assignedHosts.length === 0 ? (
                          <div className="text-[#74777d] mb-2">No host assigned yet.</div>
                        ) : (
                          <div className="flex flex-wrap gap-1.5 mb-2">
                            {assignedHosts.map((host) => {
                              const assignmentKey = `${property.id}:${host.id}`;
                              const pending = pendingAssignmentKey === assignmentKey;
                              return (
                                <span key={host.id} className="inline-flex items-center gap-1.5 rounded-full bg-white border border-[#c4c6cd] pl-2.5 pr-1 py-0.5 text-[#1b1c1d]">
                                  {host.name}
                                  <button
                                    type="button"
                                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleToggleHostAssignment(property.id, host); }}
                                    disabled={pending}
                                    className="rounded-full p-0.5 text-[#9a9ca0] hover:text-[#ba1a1a] hover:bg-[#fdeef0] disabled:opacity-50"
                                    title="Remove host"
                                  >
                                    {pending ? <Loader2 className="w-3 h-3 animate-spin" /> : <X className="w-3 h-3" />}
                                  </button>
                                </span>
                              );
                            })}
                          </div>
                        )}

                        {coHostOpenId === property.id ? (
                          <div className="relative">
                            <input
                              autoFocus
                              type="text"
                              value={coHostQuery}
                              onChange={(e) => setCoHostQuery(e.target.value)}
                              onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
                              placeholder="Type a host name or email…"
                              className="w-full rounded-lg border border-[#c4c6cd] bg-white px-2.5 py-2 text-[12px] text-[#1b1c1d] outline-none focus:border-[#041627]"
                            />
                            {(() => {
                              const q = coHostQuery.trim().toLowerCase();
                              const assignedIdSet = new Set(assignedHosts.map((h) => h.id));
                              const suggestions = hosts
                                .filter((h) => !assignedIdSet.has(h.id))
                                .filter((h) => q === '' || h.name.toLowerCase().includes(q) || h.email.toLowerCase().includes(q))
                                .slice(0, 6);
                              return (
                                <div className="mt-1 max-h-52 overflow-y-auto rounded-lg border border-[#e4e2e3] bg-white shadow-sm">
                                  {suggestions.length === 0 ? (
                                    <div className="px-2.5 py-2 text-[#74777d]">
                                      {hosts.length === 0 ? 'No host accounts available. Create a host in User Administration first.' : 'No matching host.'}
                                    </div>
                                  ) : suggestions.map((host) => {
                                    const assignmentKey = `${property.id}:${host.id}`;
                                    const pending = pendingAssignmentKey === assignmentKey;
                                    return (
                                      <button
                                        key={host.id}
                                        type="button"
                                        onClick={(e) => {
                                          e.preventDefault();
                                          e.stopPropagation();
                                          handleToggleHostAssignment(property.id, host);
                                          setCoHostQuery('');
                                          setCoHostOpenId(null);
                                        }}
                                        disabled={pending}
                                        className="flex w-full items-center justify-between gap-3 px-2.5 py-2 text-left hover:bg-[#f5f3f4] disabled:opacity-50"
                                      >
                                        <span className="min-w-0">
                                          <span className="block font-semibold text-[#1b1c1d] truncate">{host.name}</span>
                                          <span className="block text-[#74777d] truncate">{host.email}</span>
                                        </span>
                                        {pending ? <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" /> : <Plus className="w-3.5 h-3.5 text-[#041627] shrink-0" />}
                                      </button>
                                    );
                                  })}
                                </div>
                              );
                            })()}
                            <button
                              type="button"
                              onClick={(e) => { e.preventDefault(); e.stopPropagation(); setCoHostOpenId(null); setCoHostQuery(''); }}
                              className="mt-1.5 text-[11px] font-semibold text-[#74777d] hover:text-[#1b1c1d]"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={(e) => { e.preventDefault(); e.stopPropagation(); setCoHostOpenId(property.id); setCoHostQuery(''); }}
                            className="inline-flex items-center gap-1 rounded-full border border-[#041627] bg-white px-3 py-1 font-semibold text-[#041627] hover:bg-[#efedef] transition-colors"
                          >
                            <Plus className="w-3.5 h-3.5" /> Co-Host
                          </button>
                        )}
                      </div>
                  </div>
                )}
              </div>
            );
            })}
          </div>
        )}
      </main>

      {/* BottomNavBar (Mobile Only) */}
      <MobileBottomNav />

      {/* Footer */}
      <Footer />

      {/* Settings Modal */}
      {isSettingsModalOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-[#0f172a]/60 p-4 backdrop-blur-[2px]">
          <div className="w-full max-w-4xl max-h-[92vh] overflow-hidden rounded-[28px] border border-[#dce2ea] bg-[#f4f3ef] shadow-[0_36px_90px_-42px_rgba(15,23,42,0.9)]">
            <div className="sticky top-0 z-10 border-b border-[#dce2ea] bg-gradient-to-r from-[#041627] via-[#0f3459] to-[#12506f] px-5 py-5 md:px-7 md:py-6 text-white">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-[11px] uppercase tracking-[0.18em] text-[#cee7fb]">Brand Console</p>
                  <h2 className="mt-1 font-['Plus_Jakarta_Sans'] text-[24px] md:text-[28px] font-bold leading-tight">Edit Page Content</h2>
                  <p className="mt-2 text-[13px] text-[#d7ebfb]">Update branding, tab title, and listing filters from one place.</p>
                </div>
                <button
                  onClick={() => setIsSettingsModalOpen(false)}
                  className="rounded-full border border-white/25 bg-white/10 p-2.5 text-white transition-colors hover:bg-white/20"
                  aria-label="Close settings modal"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>

            <div className="max-h-[calc(92vh-184px)] overflow-y-auto px-5 py-6 md:px-7 md:py-7 space-y-6">
              <section className="rounded-2xl border border-[#dce2ea] bg-white p-5 shadow-sm md:p-6">
                <div className="mb-4 flex items-center gap-2">
                  <Globe className="h-4 w-4 text-[#0f4f74]" />
                  <h3 className="text-[16px] font-bold text-[#122235]">Header and Browser Branding</h3>
                </div>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div className="md:col-span-2 rounded-xl border border-[#d8e7f2] bg-[#f4fafe] p-4">
                    <label className="mb-1.5 block text-[13px] font-semibold text-[#154463]">Browser Tab Title</label>
                    <input
                      type="text"
                      className="w-full rounded-lg border border-[#b9d3e6] bg-white px-4 py-2.5 text-[14px] text-[#122235] focus:outline-none focus:border-[#0f4f74] focus:ring-2 focus:ring-[#c9e4f5]"
                      value={editingSettings.browserTitle}
                      onChange={(e) => setEditingSettings({ ...editingSettings, browserTitle: e.target.value })}
                      placeholder="SachiHouse | Property Listings"
                    />
                    <p className="mt-1 text-[12px] text-[#3d6882]">This controls the tab title for listings and global pages.</p>
                  </div>

                  <div>
                    <label className="mb-1.5 block text-[13px] font-semibold text-[#122235]">Navigation Title</label>
                    <input
                      type="text"
                      className="w-full rounded-lg border border-[#c8d0da] bg-white px-4 py-2.5 text-[14px] text-[#122235] focus:outline-none focus:border-[#0f4f74] focus:ring-2 focus:ring-[#d7e6f2]"
                      value={editingSettings.navTitle}
                      onChange={(e) => setEditingSettings({ ...editingSettings, navTitle: e.target.value })}
                    />
                  </div>

                  <div>
                    <label className="mb-1.5 block text-[13px] font-semibold text-[#122235]">Header Title</label>
                    <input
                      type="text"
                      className="w-full rounded-lg border border-[#c8d0da] bg-white px-4 py-2.5 text-[14px] text-[#122235] focus:outline-none focus:border-[#0f4f74] focus:ring-2 focus:ring-[#d7e6f2]"
                      value={editingSettings.headerTitle}
                      onChange={(e) => setEditingSettings({ ...editingSettings, headerTitle: e.target.value })}
                    />
                  </div>

                  <div className="md:col-span-2">
                    <label className="mb-1.5 block text-[13px] font-semibold text-[#122235]">Header Subtitle</label>
                    <textarea
                      className="min-h-[96px] w-full resize-y rounded-lg border border-[#c8d0da] bg-white px-4 py-2.5 text-[14px] text-[#122235] focus:outline-none focus:border-[#0f4f74] focus:ring-2 focus:ring-[#d7e6f2]"
                      value={editingSettings.headerSubtitle}
                      onChange={(e) => setEditingSettings({ ...editingSettings, headerSubtitle: e.target.value })}
                    />
                  </div>

                  <div className="md:col-span-2">
                    <label className="mb-1.5 block text-[13px] font-semibold text-[#122235]">Site Favicon URL</label>
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        className="w-full rounded-lg border border-[#c8d0da] bg-white px-4 py-2.5 text-[14px] text-[#122235] focus:outline-none focus:border-[#0f4f74] focus:ring-2 focus:ring-[#d7e6f2]"
                        value={editingSettings.faviconUrl || ''}
                        onChange={(e) => setEditingSettings({ ...editingSettings, faviconUrl: e.target.value })}
                        placeholder="https://example.com/favicon.png"
                      />
                      {editingSettings.faviconUrl && (
                        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-[#c8d0da] bg-white p-1.5">
                          <img src={editingSettings.faviconUrl} alt="Favicon preview" className="h-7 w-7 object-contain" />
                        </div>
                      )}
                    </div>
                    <p className="mt-1 text-[12px] text-[#63768a]">Applied globally across listings, login, and admin pages.</p>
                  </div>
                </div>
              </section>

              <section className="rounded-2xl border border-[#dce2ea] bg-white p-5 shadow-sm md:p-6">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <MapPin className="h-4 w-4 text-[#0f4f74]" />
                    <h3 className="text-[16px] font-bold text-[#122235]">Listings Filter Locations</h3>
                  </div>
                  <button
                    type="button"
                    onClick={handleAddLocationRow}
                    className="rounded-lg border border-[#0f4f74] px-3.5 py-2 text-[13px] font-semibold text-[#0f4f74] transition-colors hover:bg-[#f0f7fc]"
                  >
                    Add location row
                  </button>
                </div>

                <p className="mb-3 text-[13px] text-[#63768a]">Only these locations appear in the country and province filters.</p>

                <div className="space-y-3">
                  {allowedLocationRows.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-[#c8d0da] bg-[#fafbfc] p-4 text-[13px] text-[#63768a]">
                      No allowed locations yet. Add at least one row.
                    </div>
                  ) : allowedLocationRows.map((row, index) => (
                    <div key={`${row.countryCode}-${row.provinceCode}-${index}`} className="rounded-xl border border-[#dce2ea] bg-[#fcfdfd] p-4">
                      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                        <input
                          type="text"
                          value={row.countryCode}
                          onChange={(event) => handleLocationFieldChange(index, 'countryCode', event.target.value)}
                          placeholder="Country Code (e.g. JP)"
                          className="w-full rounded-lg border border-[#c8d0da] px-3 py-2 text-[14px] text-[#122235] focus:outline-none focus:border-[#0f4f74] focus:ring-2 focus:ring-[#d7e6f2]"
                        />
                        <input
                          type="text"
                          value={row.countryName}
                          onChange={(event) => handleLocationFieldChange(index, 'countryName', event.target.value)}
                          placeholder="Country Name"
                          className="w-full rounded-lg border border-[#c8d0da] px-3 py-2 text-[14px] text-[#122235] focus:outline-none focus:border-[#0f4f74] focus:ring-2 focus:ring-[#d7e6f2]"
                        />
                        <input
                          type="text"
                          value={row.provinceCode}
                          onChange={(event) => handleLocationFieldChange(index, 'provinceCode', event.target.value)}
                          placeholder="Province Code (e.g. JP-13)"
                          className="w-full rounded-lg border border-[#c8d0da] px-3 py-2 text-[14px] text-[#122235] focus:outline-none focus:border-[#0f4f74] focus:ring-2 focus:ring-[#d7e6f2]"
                        />
                        <input
                          type="text"
                          value={row.provinceName}
                          onChange={(event) => handleLocationFieldChange(index, 'provinceName', event.target.value)}
                          placeholder="Province Name"
                          className="w-full rounded-lg border border-[#c8d0da] px-3 py-2 text-[14px] text-[#122235] focus:outline-none focus:border-[#0f4f74] focus:ring-2 focus:ring-[#d7e6f2]"
                        />
                      </div>
                      <div className="mt-3 flex justify-end">
                        <button
                          type="button"
                          onClick={() => handleRemoveLocationRow(index)}
                          className="rounded-md px-2.5 py-1 text-[13px] font-semibold text-[#ba1a1a] transition-colors hover:bg-[#fff0f0]"
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              <section className="rounded-2xl border border-[#dce2ea] bg-white p-5 shadow-sm md:p-6">
                <div className="mb-4 flex items-center gap-2">
                  <Home className="h-4 w-4 text-[#0f4f74]" />
                  <h3 className="text-[16px] font-bold text-[#122235]">Footer Configuration</h3>
                </div>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div>
                    <label className="mb-1.5 block text-[13px] font-semibold text-[#122235]">Footer Title</label>
                    <input
                      type="text"
                      className="w-full rounded-lg border border-[#c8d0da] bg-white px-4 py-2.5 text-[14px] text-[#122235] focus:outline-none focus:border-[#0f4f74] focus:ring-2 focus:ring-[#d7e6f2]"
                      value={editingSettings.footerTitle}
                      onChange={(e) => setEditingSettings({ ...editingSettings, footerTitle: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="mb-1.5 block text-[13px] font-semibold text-[#122235]">Footer Copyright</label>
                    <input
                      type="text"
                      className="w-full rounded-lg border border-[#c8d0da] bg-white px-4 py-2.5 text-[14px] text-[#122235] focus:outline-none focus:border-[#0f4f74] focus:ring-2 focus:ring-[#d7e6f2]"
                      value={editingSettings.footerCopyright}
                      onChange={(e) => setEditingSettings({ ...editingSettings, footerCopyright: e.target.value })}
                    />
                  </div>
                </div>
              </section>
            </div>

            <div className="sticky bottom-0 z-10 flex items-center justify-end gap-3 border-t border-[#dce2ea] bg-gradient-to-r from-[#f1f3f6] to-[#edf2f6] px-5 py-4 md:px-7">
              <button
                onClick={() => setIsSettingsModalOpen(false)}
                className="rounded-lg border border-[#c1cad4] bg-white px-5 py-2.5 text-[14px] font-semibold text-[#3b4c5f] transition-colors hover:bg-[#f3f5f8]"
                disabled={isSavingSettings}
              >
                Cancel
              </button>
              <button
                onClick={handleSaveSettings}
                disabled={isSavingSettings}
                className="flex items-center gap-2 rounded-lg bg-[#0f3459] px-5 py-2.5 text-[14px] font-semibold text-white transition-colors hover:bg-[#0a2947] disabled:opacity-75"
              >
                {isSavingSettings ? <Loader2 className="h-5 w-5 animate-spin" /> : <Check className="h-5 w-5" />}
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ListingsPage;
