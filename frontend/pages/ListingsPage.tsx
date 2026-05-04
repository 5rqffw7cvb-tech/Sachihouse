import React, { useState, useEffect } from 'react';
import { PropertyData, SiteSettings } from '../types';
import { MapPin, Users, BedDouble, Bath, Star, ArrowRight, Plus, Settings, Trash2, Loader2, Bell, Home, Calendar, Mail, User, X, Check } from 'lucide-react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useLanguage } from '../contexts/LanguageContext';
import { getCurrentUser, subscribeToAuth } from '../services/auth';
import { deletePropertyData, saveSiteSettings } from '../services/storage';
import { TopNavBar } from '../components/TopNavBar';
import { MobileBottomNav } from '../components/MobileBottomNav';
import { ApiUser } from '../services/api';

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
  const [visibleCardCount, setVisibleCardCount] = useState(3);
  
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

  useEffect(() => {
    setProperties(initialProperties);
  }, [initialProperties]);

  useEffect(() => {
    setEditingSettings(settings);
  }, [settings]);

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

  const handleCreateNew = () => {
    const newId = `list_${Math.random().toString(36).substring(2, 5)}`;
    navigate(`/${newId}/admin`);
  };

  const handleDelete = async (e: React.MouseEvent, propertyId: string) => {
    e.preventDefault();
    e.stopPropagation();

    if (!confirm('Are you sure you want to delete this listing? This action cannot be undone.')) {
      return;
    }

    setDeletingId(propertyId);
    try {
      await deletePropertyData(propertyId);
      setProperties(prev => prev.filter(p => p.id !== propertyId));
    } catch (error) {
      console.error("Delete error:", error);
      alert('Failed to delete property. Please try again.');
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

  useEffect(() => {
    const initialCount = Math.min(3, filteredProperties.length);
    setVisibleCardCount(initialCount);

    const revealAll = () => setVisibleCardCount(filteredProperties.length);
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
  }, [filteredProperties.length]);

  const visibleProperties = filteredProperties.slice(0, visibleCardCount);

  return (
    <div className="bg-[#fbf9fa] text-[#1b1c1d] font-['Inter'] min-h-screen flex flex-col">
      <TopNavBar 
        actionButton={
          isAdmin && (
            <div className="flex items-center gap-2">
              <button 
                onClick={() => setIsSettingsModalOpen(true)}
                className="hidden md:flex bg-[#ffffff] border border-[#c4c6cd] text-[#1b1c1d] px-4 py-2 rounded-full font-semibold text-[14px]/[1.4] hover:bg-[#e4e2e3] transition-colors items-center gap-1.5 shadow-sm"
              >
                <Settings className="w-4 h-4" /> Edit Page Content
              </button>
              <button 
                onClick={handleCreateNew}
                className="hidden md:flex bg-[#041627] text-white px-4 py-2 rounded-full font-semibold text-[14px]/[1.4] hover:bg-[#041627]/90 transition-colors items-center gap-1.5 shadow-sm"
              >
                <Plus className="w-4 h-4" /> New Property
              </button>
            </div>
          )
        }
      />

      {/* Main Content Canvas */}
      <main className="flex-1 w-full max-w-[1280px] mx-auto px-3 md:px-6 py-12 md:py-16 pt-6 md:pt-[120px] pb-24 md:pb-12">
        {/* Header Section */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-10 gap-6">
          <div>
            <h1 className="font-['Plus_Jakarta_Sans'] text-[28px] md:text-[36px] font-bold text-[#1b1c1d] leading-[1.2] mb-2">{settings.headerTitle}</h1>
            <p className="text-[16px] text-[#44474c] leading-[1.6] whitespace-pre-wrap">{settings.headerSubtitle}</p>
          </div>
          <div className="flex flex-wrap items-center gap-3 w-full md:w-auto md:justify-end">
            <div className="w-full sm:w-[200px]">
              <label className="mb-1 block text-[12px] font-semibold uppercase tracking-[0.08em] text-[#74777d]">Country</label>
              <select
                value={selectedCountryCode}
                onChange={(event) => {
                  updateQueryParams({
                    countryCode: event.target.value || null,
                    provinceCode: null,
                  });
                }}
                className="w-full rounded-lg border border-[#c4c6cd] bg-white px-3 py-2 text-[14px] text-[#1b1c1d] focus:outline-none focus:border-[#041627] focus:ring-1 focus:ring-[#041627]"
              >
                <option value="">All countries</option>
                {countryOptions.map((country) => (
                  <option key={country.countryCode} value={country.countryCode}>{country.countryName}</option>
                ))}
              </select>
            </div>
            <div className="w-full sm:w-[200px]">
              <label className="mb-1 block text-[12px] font-semibold uppercase tracking-[0.08em] text-[#74777d]">Province</label>
              <select
                value={selectedProvinceCode}
                disabled={!selectedCountryCode}
                onChange={(event) => {
                  updateQueryParams({ provinceCode: event.target.value || null });
                }}
                className="w-full rounded-lg border border-[#c4c6cd] bg-white px-3 py-2 text-[14px] text-[#1b1c1d] focus:outline-none focus:border-[#041627] focus:ring-1 focus:ring-[#041627] disabled:bg-[#f5f3f4] disabled:text-[#8a8d92]"
              >
                <option value="">All provinces</option>
                {provinceOptions.map((province) => (
                  <option key={province.provinceCode} value={province.provinceCode}>{province.provinceName}</option>
                ))}
              </select>
            </div>
            <div className="w-[140px]">
              <label className="mb-1 block text-[12px] font-semibold uppercase tracking-[0.08em] text-[#74777d]">Bedrooms</label>
              <select
                value={minBedrooms > 0 ? String(minBedrooms) : ''}
                onChange={(event) => updateQueryParams({ minBedrooms: event.target.value || null })}
                className="w-full rounded-lg border border-[#c4c6cd] bg-white px-3 py-2 text-[14px] text-[#1b1c1d] focus:outline-none focus:border-[#041627] focus:ring-1 focus:ring-[#041627]"
              >
                <option value="">Any</option>
                {bedroomOptions.map((value) => (
                  <option key={value} value={value}>{value}+</option>
                ))}
              </select>
            </div>
            <div className="w-[140px]">
              <label className="mb-1 block text-[12px] font-semibold uppercase tracking-[0.08em] text-[#74777d]">Guests</label>
              <select
                value={minGuests > 0 ? String(minGuests) : ''}
                onChange={(event) => updateQueryParams({ minGuests: event.target.value || null })}
                className="w-full rounded-lg border border-[#c4c6cd] bg-white px-3 py-2 text-[14px] text-[#1b1c1d] focus:outline-none focus:border-[#041627] focus:ring-1 focus:ring-[#041627]"
              >
                <option value="">Any</option>
                {guestOptions.map((value) => (
                  <option key={value} value={value}>{value}+</option>
                ))}
              </select>
            </div>
            <button
              type="button"
              onClick={() => updateQueryParams({ countryCode: null, provinceCode: null, minBedrooms: null, minGuests: null })}
              className="mt-5 rounded-lg border border-[#c4c6cd] px-3 py-2 text-[13px] font-semibold text-[#44474c] transition-colors hover:bg-[#efedef]"
            >
              Clear filters
            </button>
            {isHost && (
              <div className="hidden md:flex items-center gap-2 rounded-lg border border-[#c4c6cd] bg-white p-1">
                <button
                  onClick={() => handleScopeChange('all')}
                  className={`px-3 py-1.5 rounded-md text-[13px] font-semibold transition-colors ${activeScope === 'all' ? 'bg-[#041627] text-white' : 'text-[#44474c] hover:bg-[#efedef]'}`}
                >
                  All
                </button>
                <button
                  onClick={() => handleScopeChange('mine')}
                  className={`px-3 py-1.5 rounded-md text-[13px] font-semibold transition-colors ${activeScope === 'mine' ? 'bg-[#041627] text-white' : 'text-[#44474c] hover:bg-[#efedef]'}`}
                >
                  My Properties
                </button>
              </div>
            )}
          </div>
        </div>

        {isHost && activeScope === 'mine' && (
          <div className="mb-6 text-[14px] text-[#44474c]">
            Showing only properties assigned to your host account.
          </div>
        )}

        {/* Property Grid */}
        {filteredProperties.length === 0 ? (
          <div className="bg-white border border-[#e4e2e3] rounded-xl px-6 py-10 text-center text-[#44474c]">
            {isHost && activeScope === 'mine'
              ? 'No assigned properties found for your account.'
              : 'No properties match the selected filters.'}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {visibleProperties.map((property, index) => {
            const imageUrl = property.galleryImages?.find(img => img.showOnHome)?.url || "https://images.unsplash.com/photo-1556228453-efd6c1ff04f6?auto=format&fit=crop&q=72&w=800";
            const imageSrc = buildOptimizedImageUrl(imageUrl, index === 0 ? 640 : 480);
            const imageSrcSet = `${buildOptimizedImageUrl(imageUrl, 320)} 320w, ${buildOptimizedImageUrl(imageUrl, 480)} 480w, ${buildOptimizedImageUrl(imageUrl, 640)} 640w`;
            const assignedHosts = hosts.filter((host) => host.assignedPropertyIds?.includes(property.id));
            
            return (
              <div key={property.id} className="bg-[#ffffff] rounded-xl border border-[#e4e2e3] overflow-hidden shadow-[0_4px_20px_rgba(0,0,0,0.05)] hover:shadow-[0_8px_30px_rgba(0,0,0,0.08)] transition-all duration-300 flex flex-col h-full relative group">
                <Link to={`/${property.metalink || property.id}`} className="flex-grow flex flex-col cursor-pointer">
                  {/* Image Container */}
                  <div className="relative aspect-[4/3] overflow-hidden bg-[#e4e2e3]">
                    <img 
                      src={imageSrc}
                      srcSet={imageSrcSet}
                      sizes="(max-width: 767px) 92vw, (max-width: 1023px) 46vw, 30vw"
                      alt={property.name} 
                      loading={index < 2 ? "eager" : "lazy"}
                      fetchPriority={index === 0 ? "high" : "auto"}
                      decoding="async"
                      className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105" 
                    />
                    {/* Badges */}
                    <div className="absolute top-3 left-3 flex gap-2">
                      {property.isSuperhost && (
                        <span className="bg-[#1b4332]/90 backdrop-blur-sm text-white px-2 py-1 rounded text-[12px] tracking-[0.05em] font-semibold flex items-center gap-1 shadow-sm leading-none">
                          <Star className="w-3.5 h-3.5 fill-white" />
                          Superhost
                        </span>
                      )}
                    </div>
                  </div>
                  
                  {/* Content */}
                  <div className="p-6 flex flex-col flex-grow">
                    <div className="flex justify-between items-start mb-2">
                      <h2 className="font-['Plus_Jakarta_Sans'] font-semibold text-[18px]/[1.4] text-[#041627] line-clamp-1 pr-2">{property.name}</h2>
                      <div className="flex items-center gap-1 text-[#1b1c1d] shrink-0">
                        <Star className="w-4 h-4 text-[#eab308] fill-[#eab308]" />
                        <span className="font-semibold text-[14px]/[1.4]">4.96</span>
                      </div>
                    </div>
                    <p className="text-[14px]/[1.5] text-[#44474c] mb-4 line-clamp-1">{property.subtitle || 'Property in Tokyo'}</p>
                    <div className="mb-4 flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-[0.06em] text-[#74777d]">
                      <MapPin className="h-3.5 w-3.5" />
                      <span>
                        {property.location
                          ? `${property.location.provinceName}, ${property.location.countryName}`
                          : property.address || 'Location not set'}
                      </span>
                    </div>
                    
                    <div className="flex flex-wrap gap-4 mb-6 mt-auto">
                      <div className="flex items-center gap-1.5 text-[#44474c]">
                        <Users className="w-4 h-4" />
                        <span className="font-semibold text-[12px] tracking-[0.05em] leading-none">{property.maxGuests} Guests</span>
                      </div>
                      <div className="flex items-center gap-1.5 text-[#44474c]">
                        <BedDouble className="w-4 h-4" />
                        <span className="font-semibold text-[12px] tracking-[0.05em] leading-none">{property.bedrooms} Beds</span>
                      </div>
                      <div className="flex items-center gap-1.5 text-[#44474c]">
                        <Bath className="w-4 h-4" />
                        <span className="font-semibold text-[12px] tracking-[0.05em] leading-none">{property.baths} Bath</span>
                      </div>
                    </div>
                  </div>
                </Link>

                {/* Admin Actions Overlay */}
                {isAdmin && (
                  <div className="px-6 pb-6 pt-0 mt-auto z-10 relative">
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
                        <div className="mb-2">
                          <div className="font-semibold text-[#1b1c1d]">Assigned Hosts</div>
                          {assignedHosts.length === 0 ? (
                            <div className="text-[#74777d]">No host assigned yet.</div>
                          ) : (
                            <div className="flex flex-wrap gap-1.5 mt-1">
                              {assignedHosts.map((host) => (
                                <span key={host.id} className="rounded-full bg-white border border-[#c4c6cd] px-2 py-0.5 text-[#1b1c1d]">
                                  {host.name}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                        <div className="space-y-2">
                          {hosts.length === 0 ? (
                            <div className="text-[#74777d]">No host accounts available. Create a host in User Administration first.</div>
                          ) : hosts.map((host) => {
                            const assigned = host.assignedPropertyIds?.includes(property.id);
                            const assignmentKey = `${property.id}:${host.id}`;
                            return (
                              <div key={host.id} className="flex items-center justify-between gap-3 rounded-lg border border-[#e4e2e3] bg-white px-2.5 py-2">
                                <div>
                                  <div className="font-semibold text-[#1b1c1d]">{host.name}</div>
                                  <div className="text-[#74777d]">{host.email}</div>
                                </div>
                                <button
                                  onClick={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    handleToggleHostAssignment(property.id, host);
                                  }}
                                  disabled={pendingAssignmentKey === assignmentKey}
                                  className={`rounded-full px-3 py-1 font-semibold transition-colors disabled:opacity-60 ${assigned
                                    ? 'bg-[#041627] text-white hover:bg-[#041627]/90'
                                    : 'bg-white text-[#041627] border border-[#041627] hover:bg-[#efedef]'}`}
                                >
                                  {pendingAssignmentKey === assignmentKey ? (
                                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                  ) : assigned ? (
                                    'Unassign Host'
                                  ) : (
                                    'Assign Host'
                                  )}
                                </button>
                              </div>
                            );
                          })}
                        </div>
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
      <footer className="bg-[#f5f3f4] text-[#1b1c1d] text-[12px] md:text-[14px] font-['Plus_Jakarta_Sans'] border-t border-[#e4e2e3] w-full py-6 md:py-8 px-4 md:px-6 flex flex-col md:flex-row justify-between items-center gap-4 md:gap-6 pb-20 md:pb-8 mt-auto">
        <div className="text-[16px] md:text-[18px] font-bold text-[#1b1c1d]">
          {settings.footerTitle}
        </div>
        <div className="flex flex-wrap justify-center gap-3 md:gap-6">
          <a className="text-[#44474c] hover:text-[#1b1c1d] underline" href="#">Privacy Policy</a>
          <a className="text-[#44474c] hover:text-[#1b1c1d] underline" href="#">Terms of Service</a>
          <a className="text-[#44474c] hover:text-[#1b1c1d] underline" href="#">Host Guidelines</a>
          <a className="text-[#44474c] hover:text-[#1b1c1d] underline" href="#">Contact Support</a>
        </div>
        <div className="text-[#44474c]">
          {settings.footerCopyright}
        </div>
      </footer>

      {/* Settings Modal */}
      {isSettingsModalOpen && (
        <div className="fixed inset-0 bg-[#1b1c1d]/50 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-2xl flex flex-col">
            <div className="flex justify-between items-center p-6 border-b border-[#e4e2e3] sticky top-0 bg-white z-10">
              <h2 className="font-['Plus_Jakarta_Sans'] text-[24px] font-bold text-[#041627]">Edit Page Content</h2>
              <button 
                onClick={() => setIsSettingsModalOpen(false)}
                className="p-2 text-[#44474c] hover:bg-[#e4e2e3] rounded-full transition-colors"
              >
                <X className="w-6 h-6" />
              </button>
            </div>
            
            <div className="p-6 space-y-8 flex-grow">
              <div className="space-y-4">
                <h3 className="text-[16px] font-bold text-[#1b1c1d] border-b border-[#e4e2e3] pb-2">Header Configuration</h3>
                
                <div className="space-y-4">
                  <div>
                    <label className="block text-[14px] font-semibold text-[#1b1c1d] mb-1.5">Navigation Title (Logo Text)</label>
                    <input 
                      type="text"
                      className="w-full px-4 py-2 border border-[#c4c6cd] rounded-lg text-[14px] focus:outline-none focus:border-[#041627] focus:ring-1 focus:ring-[#041627]"
                      value={editingSettings.navTitle}
                      onChange={(e) => setEditingSettings({...editingSettings, navTitle: e.target.value})}
                    />
                  </div>
                  <div>
                    <label className="block text-[14px] font-semibold text-[#1b1c1d] mb-1.5">Header Title</label>
                    <input 
                      type="text"
                      className="w-full px-4 py-2 border border-[#c4c6cd] rounded-lg text-[14px] focus:outline-none focus:border-[#041627] focus:ring-1 focus:ring-[#041627]"
                      value={editingSettings.headerTitle}
                      onChange={(e) => setEditingSettings({...editingSettings, headerTitle: e.target.value})}
                    />
                  </div>
                  <div>
                    <label className="block text-[14px] font-semibold text-[#1b1c1d] mb-1.5">Header Subtitle (Contents)</label>
                    <textarea 
                      className="w-full px-4 py-2 border border-[#c4c6cd] rounded-lg text-[14px] focus:outline-none focus:border-[#041627] focus:ring-1 focus:ring-[#041627] min-h-[100px] resize-y"
                      value={editingSettings.headerSubtitle}
                      onChange={(e) => setEditingSettings({...editingSettings, headerSubtitle: e.target.value})}
                    />
                  </div>
                  <div>
                    <label className="block text-[14px] font-semibold text-[#1b1c1d] mb-1.5">Site Favicon URL</label>
                    <div className="flex gap-2 items-center">
                      <input
                        type="text"
                        className="w-full px-4 py-2 border border-[#c4c6cd] rounded-lg text-[14px] focus:outline-none focus:border-[#041627] focus:ring-1 focus:ring-[#041627]"
                        value={editingSettings.faviconUrl || ''}
                        onChange={(e) => setEditingSettings({ ...editingSettings, faviconUrl: e.target.value })}
                        placeholder="https://example.com/favicon.png"
                      />
                      {editingSettings.faviconUrl && (
                        <div className="w-10 h-10 shrink-0 bg-white rounded-lg border border-[#c4c6cd] flex items-center justify-center p-1">
                          <img src={editingSettings.faviconUrl} alt="Favicon preview" className="w-6 h-6 object-contain" />
                        </div>
                      )}
                    </div>
                    <p className="text-[12px] text-[#74777d] mt-1">This icon is applied globally across the whole website.</p>
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                <h3 className="text-[16px] font-bold text-[#1b1c1d] border-b border-[#e4e2e3] pb-2">Listings Filter Locations</h3>
                <p className="text-[13px] text-[#74777d]">Only these country/province options will appear in the listings filters.</p>
                <div className="space-y-3">
                  {allowedLocationRows.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-[#c4c6cd] p-3 text-[13px] text-[#74777d]">No allowed locations yet. Add at least one row.</div>
                  ) : allowedLocationRows.map((row, index) => (
                    <div key={`${row.countryCode}-${row.provinceCode}-${index}`} className="rounded-lg border border-[#e4e2e3] p-3">
                      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                        <input
                          type="text"
                          value={row.countryCode}
                          onChange={(event) => handleLocationFieldChange(index, 'countryCode', event.target.value)}
                          placeholder="Country Code (e.g. JP)"
                          className="w-full rounded-lg border border-[#c4c6cd] px-3 py-2 text-[14px] focus:outline-none focus:border-[#041627] focus:ring-1 focus:ring-[#041627]"
                        />
                        <input
                          type="text"
                          value={row.countryName}
                          onChange={(event) => handleLocationFieldChange(index, 'countryName', event.target.value)}
                          placeholder="Country Name"
                          className="w-full rounded-lg border border-[#c4c6cd] px-3 py-2 text-[14px] focus:outline-none focus:border-[#041627] focus:ring-1 focus:ring-[#041627]"
                        />
                        <input
                          type="text"
                          value={row.provinceCode}
                          onChange={(event) => handleLocationFieldChange(index, 'provinceCode', event.target.value)}
                          placeholder="Province Code (e.g. JP-13)"
                          className="w-full rounded-lg border border-[#c4c6cd] px-3 py-2 text-[14px] focus:outline-none focus:border-[#041627] focus:ring-1 focus:ring-[#041627]"
                        />
                        <input
                          type="text"
                          value={row.provinceName}
                          onChange={(event) => handleLocationFieldChange(index, 'provinceName', event.target.value)}
                          placeholder="Province Name"
                          className="w-full rounded-lg border border-[#c4c6cd] px-3 py-2 text-[14px] focus:outline-none focus:border-[#041627] focus:ring-1 focus:ring-[#041627]"
                        />
                      </div>
                      <div className="mt-2 flex justify-end">
                        <button
                          type="button"
                          onClick={() => handleRemoveLocationRow(index)}
                          className="text-[13px] font-semibold text-[#ba1a1a]"
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={handleAddLocationRow}
                  className="rounded-lg border border-[#041627] px-4 py-2 text-[13px] font-semibold text-[#041627] hover:bg-[#efedef]"
                >
                  Add location row
                </button>
              </div>

              <div className="space-y-4">
                <h3 className="text-[16px] font-bold text-[#1b1c1d] border-b border-[#e4e2e3] pb-2">Footer Configuration</h3>
                <div className="space-y-4">
                  <div>
                    <label className="block text-[14px] font-semibold text-[#1b1c1d] mb-1.5">Footer Title</label>
                    <input 
                      type="text"
                      className="w-full px-4 py-2 border border-[#c4c6cd] rounded-lg text-[14px] focus:outline-none focus:border-[#041627] focus:ring-1 focus:ring-[#041627]"
                      value={editingSettings.footerTitle}
                      onChange={(e) => setEditingSettings({...editingSettings, footerTitle: e.target.value})}
                    />
                  </div>
                  <div>
                    <label className="block text-[14px] font-semibold text-[#1b1c1d] mb-1.5">Footer Copyright</label>
                    <input 
                      type="text"
                      className="w-full px-4 py-2 border border-[#c4c6cd] rounded-lg text-[14px] focus:outline-none focus:border-[#041627] focus:ring-1 focus:ring-[#041627]"
                      value={editingSettings.footerCopyright}
                      onChange={(e) => setEditingSettings({...editingSettings, footerCopyright: e.target.value})}
                    />
                  </div>
                </div>
              </div>
            </div>

            <div className="p-6 border-t border-[#e4e2e3] bg-[#f5f3f4] sticky bottom-0 flex justify-end gap-3 z-10">
              <button 
                onClick={() => setIsSettingsModalOpen(false)}
                className="px-6 py-2 border border-[#c4c6cd] text-[#44474c] font-semibold rounded-lg hover:bg-[#e4e2e3] transition-colors"
                disabled={isSavingSettings}
              >
                Cancel
              </button>
              <button 
                onClick={handleSaveSettings}
                disabled={isSavingSettings}
                className="px-6 py-2 bg-[#041627] text-white font-semibold rounded-lg hover:bg-[#041627]/90 transition-colors flex items-center gap-2"
              >
                {isSavingSettings ? <Loader2 className="w-5 h-5 animate-spin" /> : <Check className="w-5 h-5" />}
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
