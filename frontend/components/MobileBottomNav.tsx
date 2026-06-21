import React, { useState, useEffect, useRef } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Home, Mail, User, Settings, LogOut } from 'lucide-react';
import { getCurrentUser, logout, subscribeToAuth } from '../services/auth';
import { CheckInLinkPicker } from './CheckInLinkPicker';
import { useLanguage } from '../contexts/LanguageContext';

export const MobileBottomNav: React.FC = () => {
  const { t } = useLanguage();
  const { pathname, search } = useLocation();
  const navigate = useNavigate();
  const [authUser, setAuthUser] = useState(getCurrentUser());
  const [isVisible, setIsVisible] = useState(true);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [userEmail, setUserEmail] = useState<string | null>(getCurrentUser()?.email ?? null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const lastScrollY = useRef(0);
  const navRef = useRef<HTMLElement>(null);

  const isAuthenticated = !!authUser;
  const canManageUsers = authUser?.role === 'ADMIN';
  const canManageProperties = authUser?.role === 'ADMIN' || authUser?.role === 'HOST';
  const canUseMyProperties = authUser?.role === 'HOST';

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
      const currentScrollY = window.scrollY;
      if (currentScrollY > lastScrollY.current && currentScrollY > 50) {
        setIsVisible(false); // scrolling down
      } else {
        setIsVisible(true);  // scrolling up
      }
      lastScrollY.current = currentScrollY;
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // Keep nav anchored to physical screen bottom when software keyboard shrinks the viewport
  useEffect(() => {
    let baseHeight = window.innerHeight;

    const resetBase = () => {
      baseHeight = window.innerHeight;
      if (navRef.current) navRef.current.style.bottom = '';
    };

    const handleResize = () => {
      if (!navRef.current) return;
      const delta = baseHeight - window.innerHeight;
      if (delta > 100) {
        // Keyboard appeared: push nav back down so it stays at physical screen bottom
        navRef.current.style.bottom = `${-delta}px`;
      } else {
        resetBase();
      }
    };

    window.addEventListener('resize', handleResize, { passive: true });
    window.addEventListener('orientationchange', resetBase);
    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('orientationchange', resetBase);
    };
  }, []);

  const handleLogin = () => {
    navigate(`/login?redirect=${encodeURIComponent(pathname + search)}`);
  };

  const handleLogout = async () => {
    await logout();
    setIsDropdownOpen(false);
  };

  const navContainerClass = `bg-[#ffffff]/90 backdrop-blur-md text-[#1b1c1d] text-[10px] font-medium font-['Plus_Jakarta_Sans'] border-t border-[#e4e2e3] shadow-[0_-4px_12px_rgba(0,0,0,0.03)] md:hidden fixed bottom-0 left-0 w-full z-50 flex justify-around items-center px-2 py-2 transition-transform duration-300 ${isVisible ? 'translate-y-0' : 'translate-y-full'}`;

  const isHome = pathname === '/' || pathname === '/index.html';
  const isBlog = pathname.startsWith('/blog');

  return (
    <nav ref={navRef} className={navContainerClass} style={{ paddingBottom: 'calc(0.5rem + env(safe-area-inset-bottom, 0px))' }}>
      <Link 
        className={`flex flex-col items-center justify-center rounded-lg px-4 py-1 duration-200 ${isHome ? 'text-[#1b1c1d] bg-[#efedef]' : 'text-[#44474c] hover:bg-[#e4e2e3]'}`} 
        to="/"
      >
        <Home className="mb-0.5 w-4 h-4" />
        <span>{t('nav_home')}</span>
      </Link>
      <Link
        className={`flex flex-col items-center justify-center rounded-lg px-4 py-1 duration-200 ${isBlog ? 'text-[#1b1c1d] bg-[#efedef]' : 'text-[#44474c] hover:bg-[#e4e2e3]'}`}
        to="/blog"
      >
        <Mail className="mb-0.5 w-4 h-4" />
        <span>{t('common_blog')}</span>
      </Link>
      
      {canManageProperties && (
        <CheckInLinkPicker authUser={authUser} direction="up" />
      )}

      {isAuthenticated ? (
        <div className="relative flex flex-col items-center justify-center" ref={dropdownRef}>
          <button 
            onClick={() => setIsDropdownOpen(!isDropdownOpen)}
            className="flex flex-col items-center justify-center text-[#44474c] hover:bg-[#e4e2e3] rounded-lg px-4 py-1 duration-200"
          >
            <User className="mb-0.5 w-4 h-4" />
            <span>{t('common_account')}</span>
          </button>

          {isDropdownOpen && (
            <div className="absolute bottom-full right-0 mb-2 w-48 bg-white rounded-xl shadow-[0_-4px_20px_rgba(0,0,0,0.1)] py-1 border border-[#e4e2e3] z-50 overflow-hidden">
               <div className="px-4 py-2 border-b border-[#e4e2e3] bg-gray-50 flex flex-col items-start text-left">
                  <p className="text-sm font-medium text-[#1b1c1d] truncate w-full text-left">{userEmail || t('common_admin_fallback')}</p>
               </div>
               <button
                 onClick={() => { setIsDropdownOpen(false); navigate('/admin/properties'); }}
                 className="w-full text-left px-4 py-3 text-sm text-[#44474c] hover:bg-[#f5f3f4] active:bg-gray-100 transition-colors"
               >
                 {t('common_admin_property')}
               </button>
               {canManageProperties && (
                 <button
                   onClick={() => { setIsDropdownOpen(false); navigate('/admin/checkin-management'); }}
                   className="w-full text-left px-4 py-3 text-sm text-[#44474c] hover:bg-[#f5f3f4] active:bg-gray-100 transition-colors"
                 >
                   {t('common_admin_checkin')}
                 </button>
               )}
               <button
                 onClick={() => { setIsDropdownOpen(false); navigate('/blog/admin'); }}
                 className="w-full text-left px-4 py-3 text-sm text-[#44474c] hover:bg-[#f5f3f4] active:bg-gray-100 transition-colors"
               >
                 {t('common_admin_blog')}
               </button>
               {canManageUsers && (
                 <button
                   onClick={() => { setIsDropdownOpen(false); navigate('/admin/users'); }}
                   className="w-full text-left px-4 py-3 text-sm text-[#44474c] hover:bg-[#f5f3f4] active:bg-gray-100 transition-colors"
                 >
                   {t('common_admin_users')}
                 </button>
               )}
               {canUseMyProperties && (
                 <button
                   onClick={() => { setIsDropdownOpen(false); navigate('/?scope=mine'); }}
                   className="w-full text-left px-4 py-3 text-sm text-[#44474c] hover:bg-[#f5f3f4] active:bg-gray-100 transition-colors"
                 >
                   {t('common_my_properties')}
                 </button>
               )}
               <div className="border-t border-[#e4e2e3]"></div>
               <button
                 onClick={handleLogout}
                 className="w-full text-left px-4 py-3 text-sm text-[#ba1a1a] hover:bg-[#f5f3f4] active:bg-red-50 transition-colors flex items-center gap-2"
               >
                 <LogOut className="w-4 h-4" /> {t('common_sign_out')}
               </button>
            </div>
          )}
        </div>
      ) : (
        <button
          onClick={handleLogin}
          className="flex flex-col items-center justify-center text-[#44474c] hover:bg-[#e4e2e3] rounded-lg px-4 py-1 duration-200"
        >
          <Settings className="mb-0.5 w-4 h-4" />
          <span>{t('common_login')}</span>
        </button>
      )}
    </nav>
  );
};
