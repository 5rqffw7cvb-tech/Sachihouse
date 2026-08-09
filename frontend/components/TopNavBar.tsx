import React, { useState, useEffect, useRef } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Settings, User, LogOut, Loader2, Building2, ClipboardCheck, Wallet, Newspaper, Users, Home, Tag, Ticket, FileText, CalendarDays } from 'lucide-react';
import { getCurrentUser, logout, subscribeToAuth } from '../services/auth';
import { getSiteSettings } from '../services/storage';
import { CheckInLinkPicker } from './CheckInLinkPicker';
import { useLanguage } from '../contexts/LanguageContext';

const NAV_TITLE_FALLBACK = 'SachiHouse';
const MOBILE_HEADER_HEIGHT = 58;
const PULL_REFRESH_THRESHOLD = 64;
const MAX_PULL_DISTANCE = 90;

const getInitialNavTitle = (): string => {
  if (typeof window === 'undefined') {
    return NAV_TITLE_FALLBACK;
  }

  try {
    const cachedSettingsRaw = window.localStorage.getItem('cache_settings');
    if (!cachedSettingsRaw) {
      return NAV_TITLE_FALLBACK;
    }
    const parsed = JSON.parse(cachedSettingsRaw) as { navTitle?: unknown };
    if (typeof parsed.navTitle === 'string' && parsed.navTitle.trim()) {
      return parsed.navTitle.trim();
    }
  } catch {
    // Ignore malformed cache and fall back to default title.
  }

  return NAV_TITLE_FALLBACK;
};

export const TopNavBar: React.FC<{ actionButton?: React.ReactNode; mobileActionButton?: React.ReactNode; navTitleOverride?: string }> = ({ actionButton, mobileActionButton, navTitleOverride }) => {
  const { t } = useLanguage();
  const { pathname, search } = useLocation();
  const navigate = useNavigate();
  const [authUser, setAuthUser] = useState(getCurrentUser());
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [navTitle, setNavTitle] = useState<string>(() => navTitleOverride?.trim() || getInitialNavTitle());
  const [userEmail, setUserEmail] = useState<string | null>(getCurrentUser()?.email ?? null);
  const [isMobileHeaderVisible, setIsMobileHeaderVisible] = useState(true);
  const [pullDistance, setPullDistance] = useState(0);
  const [isPullRefreshing, setIsPullRefreshing] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const mobileLastScrollY = useRef(0);
  const pullStartYRef = useRef<number | null>(null);
  const pullDistanceRef = useRef(0);
  const refreshTimeoutRef = useRef<number | null>(null);
  const isPullRefreshingRef = useRef(false);

  const isAuthenticated = !!authUser;
  const canManageUsers = authUser?.role === 'ADMIN';
  const canUseMyProperties = authUser?.role === 'HOST';
  const canManageBlog = authUser?.role === 'ADMIN' || authUser?.canEditBlog;
  const canManageProperties = authUser?.role === 'ADMIN' || authUser?.role === 'HOST';
  // Finance is reserved for admins and host level 4 only.
  const canUseFinance = authUser?.role === 'ADMIN' || (authUser?.role === 'HOST' && (authUser?.hostLevel ?? 0) >= 4);
  const isHome = pathname === '/' || pathname === '/index.html';
  const isBlog = pathname.startsWith('/blog');
  const isBecomeHost = pathname.startsWith('/become-host');
  // Guests see "Become Host"; hosts below the top level see "Upgrade".
  // Top-level hosts (level 4) and admins don't need the entry.
  const showUpgradeNav = authUser?.role === 'HOST' && (authUser?.hostLevel ?? 1) < 4;
  const showJoinNav = !authUser || authUser.role === 'GUEST';
  const becomeHostNavVisible = showJoinNav || showUpgradeNav;
  const becomeHostNavLabel = showUpgradeNav ? 'Upgrade' : 'Become Host';
  const isBlogPost = /^\/blog\/[^/]+$/.test(pathname);
  const mobilePageTitle = navTitle || NAV_TITLE_FALLBACK;

  useEffect(() => {
    if (typeof navTitleOverride === 'string' && navTitleOverride.trim()) {
      setNavTitle(navTitleOverride.trim());
    }
  }, [navTitleOverride]);

  useEffect(() => {
    if (typeof navTitleOverride === 'string' && navTitleOverride.trim()) {
      return;
    }

    const fetchSettings = async () => {
      try {
        const settings = await getSiteSettings();
        const nextTitle = settings?.navTitle?.trim() || NAV_TITLE_FALLBACK;
        setNavTitle((prev) => (prev === nextTitle ? prev : nextTitle));
      } catch (error) {
        console.error('Failed to load site settings', error);
        setNavTitle((prev) => prev || NAV_TITLE_FALLBACK);
      }
    };
    fetchSettings();

    window.addEventListener('site-settings-updated', fetchSettings);
    return () => window.removeEventListener('site-settings-updated', fetchSettings);
  }, [navTitleOverride]);

  useEffect(() => {
    let unsubscribe = () => {};
    subscribeToAuth((user) => {
      setAuthUser(user);
      setUserEmail(user?.email || null);
    }).then(unsub => { unsubscribe = unsub; });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsDropdownOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    const handleScroll = () => {
      if (window.innerWidth >= 768) {
        return;
      }

      const currentScrollY = window.scrollY;
      if (currentScrollY <= 0) {
        setIsMobileHeaderVisible(true);
        mobileLastScrollY.current = 0;
        return;
      }

      if (currentScrollY > mobileLastScrollY.current && currentScrollY > 50) {
        setIsMobileHeaderVisible(false);
      } else {
        setIsMobileHeaderVisible(true);
      }
      mobileLastScrollY.current = currentScrollY;
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  useEffect(() => {
    if (isBlogPost) {
      return;
    }

    const updatePullDistance = (value: number) => {
      pullDistanceRef.current = value;
      setPullDistance(value);
    };

    const resetPullState = () => {
      isPullRefreshingRef.current = false;
      pullStartYRef.current = null;
      updatePullDistance(0);
      setIsPullRefreshing(false);
    };

    const handleTouchStart = (event: TouchEvent) => {
      if (window.innerWidth >= 768 || isPullRefreshingRef.current) {
        return;
      }
      if (window.scrollY > 0) {
        pullStartYRef.current = null;
        return;
      }
      pullStartYRef.current = event.touches[0]?.clientY ?? null;
    };

    const handleTouchMove = (event: TouchEvent) => {
      if (window.innerWidth >= 768 || isPullRefreshingRef.current || pullStartYRef.current === null) {
        return;
      }

      const touchY = event.touches[0]?.clientY;
      if (typeof touchY !== 'number') {
        return;
      }

      const rawPull = touchY - pullStartYRef.current;
      if (rawPull <= 0 || window.scrollY > 0) {
        updatePullDistance(0);
        return;
      }

      const nextDistance = Math.min(MAX_PULL_DISTANCE, rawPull * 0.5);
      setIsMobileHeaderVisible(true);
      updatePullDistance(nextDistance);
      event.preventDefault();
    };

    const handleTouchEnd = () => {
      if (window.innerWidth >= 768 || pullStartYRef.current === null || isPullRefreshingRef.current) {
        return;
      }

      pullStartYRef.current = null;
      if (pullDistanceRef.current >= PULL_REFRESH_THRESHOLD) {
        isPullRefreshingRef.current = true;
        setIsPullRefreshing(true);
        updatePullDistance(PULL_REFRESH_THRESHOLD);
        refreshTimeoutRef.current = window.setTimeout(() => {
          window.location.reload();
        }, 500);
        return;
      }

      updatePullDistance(0);
    };

    window.addEventListener('touchstart', handleTouchStart, { passive: true });
    window.addEventListener('touchmove', handleTouchMove, { passive: false });
    window.addEventListener('touchend', handleTouchEnd, { passive: true });
    window.addEventListener('touchcancel', resetPullState, { passive: true });

    return () => {
      window.removeEventListener('touchstart', handleTouchStart);
      window.removeEventListener('touchmove', handleTouchMove);
      window.removeEventListener('touchend', handleTouchEnd);
      window.removeEventListener('touchcancel', resetPullState);
    };
  }, [isBlogPost]);

  const handleLogin = () => {
    navigate(`/login?redirect=${encodeURIComponent(pathname + search)}`);
  };

  const handleLogout = async () => {
    await logout();
    setIsDropdownOpen(false);
  };

  return (
    <>
      {!isBlogPost && (
        <>
          <nav
            className={`md:hidden fixed top-0 left-0 w-full bg-[#ffffff]/95 backdrop-blur-sm font-['Plus_Jakarta_Sans'] antialiased border-b border-[#e4e2e3] shadow-[0_2px_12px_rgba(0,0,0,0.04)] z-50 transition-transform duration-300 ${isMobileHeaderVisible ? 'translate-y-0' : '-translate-y-full'}`}
            style={{ paddingTop: 'env(safe-area-inset-top)' }}
          >
            <div className="px-3 py-3 flex items-center justify-between gap-3">
              <span className="min-w-0 truncate text-[18px] font-bold tracking-tight text-[#1b1c1d]">{mobilePageTitle}</span>
              {mobileActionButton ? <div className="shrink-0">{mobileActionButton}</div> : null}
            </div>
          </nav>
          <div className="md:hidden" style={{ height: `calc(env(safe-area-inset-top) + ${MOBILE_HEADER_HEIGHT}px)` }} />
          {/* Pull-to-refresh indicator: fixed BELOW the header, not inside it */}
          <div
            className="md:hidden fixed left-0 w-full z-40 pointer-events-none flex items-center justify-center overflow-hidden"
            style={{
              top: `calc(env(safe-area-inset-top) + ${MOBILE_HEADER_HEIGHT}px)`,
              height: isPullRefreshing ? '44px' : `${Math.max(0, pullDistance - 16)}px`,
              opacity: pullDistance > 16 || isPullRefreshing ? 1 : 0,
              transition: 'height 80ms, opacity 80ms',
            }}
          >
            <Loader2
              className={`w-5 h-5 text-[#6b7280] ${isPullRefreshing ? 'animate-spin' : ''}`}
              style={isPullRefreshing ? undefined : { transform: `rotate(${Math.min(360, pullDistance * 4)}deg)` }}
            />
          </div>
        </>
      )}

      <nav className="hidden md:block bg-[#ffffff] font-['Plus_Jakarta_Sans'] antialiased border-b border-[#e4e2e3] shadow-[0_4px_20px_rgba(0,0,0,0.05)] fixed top-0 left-0 w-full z-50">
        <div className="max-w-[1280px] mx-auto flex justify-between items-center px-3 md:px-6 py-3">
          <div className="flex items-center gap-8">
            <Link to="/" className="text-[20px] font-bold tracking-tight text-[#1b1c1d]">{navTitle}</Link>
            <div className="hidden md:flex gap-6 items-center">
              <Link 
                to="/" 
                className={isHome 
                  ? "text-[#1b1c1d] border-b-2 border-[#1b1c1d] pb-1 font-semibold hover:text-[#1b1c1d] transition-colors duration-150 active:scale-95" 
                  : "text-[#44474c] font-medium hover:text-[#1b1c1d] transition-colors duration-150 active:scale-95"}
              >
                {t('common_properties')}
              </Link>
              <Link
                to="/blog"
                className={isBlog
                  ? "text-[#1b1c1d] border-b-2 border-[#1b1c1d] pb-1 font-semibold hover:text-[#1b1c1d] transition-colors duration-150 active:scale-95"
                  : "text-[#44474c] font-medium hover:text-[#1b1c1d] transition-colors duration-150 active:scale-95"}
              >
                {t('common_blog')}
              </Link>
              {becomeHostNavVisible && (
                <Link
                  to="/become-host"
                  className={isBecomeHost
                    ? "text-[#1b1c1d] border-b-2 border-[#1b1c1d] pb-1 font-semibold hover:text-[#1b1c1d] transition-colors duration-150 active:scale-95"
                    : "text-[#44474c] font-medium hover:text-[#1b1c1d] transition-colors duration-150 active:scale-95"}
                >
                  {becomeHostNavLabel}
                </Link>
              )}
            </div>
          </div>
          <div className="flex items-center gap-4">
            {actionButton}
            {isAuthenticated && <CheckInLinkPicker authUser={authUser} direction="down" />}
            {!isAuthenticated ? (
              <button
                onClick={handleLogin}
                className="p-2 text-[#44474c] hover:text-[#1b1c1d] transition-colors"
                title={t('common_sign_in_title')}
              >
                <Settings className="w-5 h-5" />
              </button>
            ) : (
              <div className="relative" ref={dropdownRef}>
                <button 
                  onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                  className="w-9 h-9 rounded-full bg-[#efedef] flex items-center justify-center hover:bg-[#e4e2e3] transition-colors"
                >
                  <User className="w-5 h-5 text-[#1b1c1d]" />
                </button>

                {isDropdownOpen && (
                  <div className="absolute right-0 mt-2 w-48 bg-white rounded-xl shadow-lg py-1 border border-[#e4e2e3] z-50">
                    <div className="px-4 py-2 border-b border-[#e4e2e3]">
                      <p className="text-sm font-medium text-[#1b1c1d] truncate">{userEmail}</p>
                    </div>
                    {canManageProperties && (
                      <button
                        onClick={() => { setIsDropdownOpen(false); navigate('/admin/properties'); }}
                        className="w-full text-left px-4 py-2.5 text-sm text-[#44474c] hover:bg-[#f5f3f4] hover:text-[#1b1c1d] transition-colors flex items-center gap-2.5"
                      >
                        <Building2 className="w-4 h-4 text-[#74777d]" /> {t('common_admin_property')}
                      </button>
                    )}
                    {canManageProperties && (
                      <button
                        onClick={() => { setIsDropdownOpen(false); navigate('/admin/calendar'); }}
                        className="w-full text-left px-4 py-2.5 text-sm text-[#44474c] hover:bg-[#f5f3f4] hover:text-[#1b1c1d] transition-colors flex items-center gap-2.5"
                      >
                        <CalendarDays className="w-4 h-4 text-[#74777d]" /> Calendar
                      </button>
                    )}
                    {canManageProperties && (
                      <button
                        onClick={() => { setIsDropdownOpen(false); navigate('/admin/checkin-management'); }}
                        className="w-full text-left px-4 py-2.5 text-sm text-[#44474c] hover:bg-[#f5f3f4] hover:text-[#1b1c1d] transition-colors flex items-center gap-2.5"
                      >
                        <ClipboardCheck className="w-4 h-4 text-[#74777d]" /> {t('common_admin_checkin')}
                      </button>
                    )}
                    {canManageProperties && (
                      <button
                        onClick={() => { setIsDropdownOpen(false); navigate('/admin/booking-confirm'); }}
                        className="w-full text-left px-4 py-2.5 text-sm text-[#44474c] hover:bg-[#f5f3f4] hover:text-[#1b1c1d] transition-colors flex items-center gap-2.5"
                      >
                        <FileText className="w-4 h-4 text-[#74777d]" /> Booking Confirm
                      </button>
                    )}
                    {canUseFinance && (
                      <button
                        onClick={() => { setIsDropdownOpen(false); navigate('/admin/finance'); }}
                        className="w-full text-left px-4 py-2.5 text-sm text-[#44474c] hover:bg-[#f5f3f4] hover:text-[#1b1c1d] transition-colors flex items-center gap-2.5"
                      >
                        <Wallet className="w-4 h-4 text-[#74777d]" /> {t('common_admin_finance')}
                      </button>
                    )}
                    {canManageBlog && (
                      <button
                        onClick={() => { setIsDropdownOpen(false); navigate('/blog/admin'); }}
                        className="w-full text-left px-4 py-2.5 text-sm text-[#44474c] hover:bg-[#f5f3f4] hover:text-[#1b1c1d] transition-colors flex items-center gap-2.5"
                      >
                        <Newspaper className="w-4 h-4 text-[#74777d]" /> {t('common_admin_blog')}
                      </button>
                    )}
                    {canManageUsers && (
                      <button
                        onClick={() => { setIsDropdownOpen(false); navigate('/admin/users'); }}
                        className="w-full text-left px-4 py-2.5 text-sm text-[#44474c] hover:bg-[#f5f3f4] hover:text-[#1b1c1d] transition-colors flex items-center gap-2.5"
                      >
                        <Users className="w-4 h-4 text-[#74777d]" /> {t('common_admin_users')}
                      </button>
                    )}
                    {canManageUsers && (
                      <button
                        onClick={() => { setIsDropdownOpen(false); navigate('/admin/coupons'); }}
                        className="w-full text-left px-4 py-2.5 text-sm text-[#44474c] hover:bg-[#f5f3f4] hover:text-[#1b1c1d] transition-colors flex items-center gap-2.5"
                      >
                        <Ticket className="w-4 h-4 text-[#74777d]" /> Coupons
                      </button>
                    )}
                    {canManageUsers && (
                      <button
                        onClick={() => { setIsDropdownOpen(false); navigate('/admin/services'); }}
                        className="w-full text-left px-4 py-2.5 text-sm text-[#44474c] hover:bg-[#f5f3f4] hover:text-[#1b1c1d] transition-colors flex items-center gap-2.5"
                      >
                        <Tag className="w-4 h-4 text-[#74777d]" /> Services
                      </button>
                    )}
                    {canUseMyProperties && (
                      <button
                        onClick={() => { setIsDropdownOpen(false); navigate('/?scope=mine'); }}
                        className="w-full text-left px-4 py-2.5 text-sm text-[#44474c] hover:bg-[#f5f3f4] hover:text-[#1b1c1d] transition-colors flex items-center gap-2.5"
                      >
                        <Home className="w-4 h-4 text-[#74777d]" /> {t('common_my_properties')}
                      </button>
                    )}
                    <div className="border-t border-[#e4e2e3] my-1"></div>
                    <button
                      onClick={handleLogout}
                      className="w-full text-left px-4 py-2.5 text-sm text-[#ba1a1a] hover:bg-[#f5f3f4] transition-colors flex items-center gap-2.5"
                    >
                      <LogOut className="w-4 h-4" /> {t('common_sign_out')}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </nav>
    </>
  );
};
