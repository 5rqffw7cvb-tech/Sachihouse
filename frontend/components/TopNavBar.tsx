import React, { useState, useEffect, useRef } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Settings, User, LogOut } from 'lucide-react';
import { getCurrentUser, logout, subscribeToAuth } from '../services/auth';
import { getSiteSettings } from '../services/storage';

export const TopNavBar: React.FC<{ actionButton?: React.ReactNode }> = ({ actionButton }) => {
  const { pathname, search } = useLocation();
  const navigate = useNavigate();
  const [authUser, setAuthUser] = useState(getCurrentUser());
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [navTitle, setNavTitle] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(getCurrentUser()?.email ?? null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const isAuthenticated = !!authUser;
  const canManageUsers = authUser?.role === 'ADMIN';
  const canUseMyProperties = authUser?.role === 'HOST';

  useEffect(() => {
    const fetchSettings = async () => {
      try {
        const settings = await getSiteSettings();
        if (settings?.navTitle) {
          setNavTitle(settings.navTitle);
        }
      } catch (error) {
        console.error('Failed to load site settings', error);
      }
    };
    fetchSettings();

    window.addEventListener('site-settings-updated', fetchSettings);
    return () => window.removeEventListener('site-settings-updated', fetchSettings);
  }, []);

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

  const handleLogin = () => {
    navigate(`/login?redirect=${encodeURIComponent(pathname + search)}`);
  };

  const handleLogout = async () => {
    await logout();
    setIsDropdownOpen(false);
  };

  const isHome = pathname === '/' || pathname === '/index.html';
  const isBlog = pathname.startsWith('/blog');

  return (
    <nav className="hidden md:block bg-[#ffffff] font-['Plus_Jakarta_Sans'] antialiased border-b border-[#e4e2e3] shadow-[0_4px_20px_rgba(0,0,0,0.05)] fixed top-0 left-0 w-full z-50">
      <div className="max-w-[1280px] mx-auto flex justify-between items-center px-3 md:px-6 py-3">
        <div className="flex items-center gap-8">
          <Link to="/" className="text-[20px] font-bold tracking-tight text-[#1b1c1d]">{navTitle ?? ''}</Link>
          <div className="hidden md:flex gap-6 items-center">
            <Link 
              to="/" 
              className={isHome 
                ? "text-[#1b1c1d] border-b-2 border-[#1b1c1d] pb-1 font-semibold hover:text-[#1b1c1d] transition-colors duration-150 active:scale-95" 
                : "text-[#44474c] font-medium hover:text-[#1b1c1d] transition-colors duration-150 active:scale-95"}
            >
              Properties
            </Link>
            <Link 
              to="/blog" 
              className={isBlog 
                ? "text-[#1b1c1d] border-b-2 border-[#1b1c1d] pb-1 font-semibold hover:text-[#1b1c1d] transition-colors duration-150 active:scale-95" 
                : "text-[#44474c] font-medium hover:text-[#1b1c1d] transition-colors duration-150 active:scale-95"}
            >
              Blog
            </Link>
          </div>
        </div>
        <div className="flex items-center gap-4">
          {actionButton}
          {!isAuthenticated ? (
            <button 
              onClick={handleLogin}
              className="p-2 text-[#44474c] hover:text-[#1b1c1d] transition-colors"
              title="Sign In"
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
                  <button 
                    onClick={() => { setIsDropdownOpen(false); navigate('/admin/properties'); }}
                    className="w-full text-left px-4 py-2 text-sm text-[#44474c] hover:bg-[#f5f3f4] hover:text-[#1b1c1d] transition-colors"
                  >
                    Property Admin
                  </button>
                  <button 
                    onClick={() => { setIsDropdownOpen(false); navigate('/blog/admin'); }}
                    className="w-full text-left px-4 py-2 text-sm text-[#44474c] hover:bg-[#f5f3f4] hover:text-[#1b1c1d] transition-colors"
                  >
                    Blog Admin
                  </button>
                  {canManageUsers && (
                    <button 
                      onClick={() => { setIsDropdownOpen(false); navigate('/admin/users'); }}
                      className="w-full text-left px-4 py-2 text-sm text-[#44474c] hover:bg-[#f5f3f4] hover:text-[#1b1c1d] transition-colors"
                    >
                      User Admin
                    </button>
                  )}
                  {canUseMyProperties && (
                    <button 
                      onClick={() => { setIsDropdownOpen(false); navigate('/?scope=mine'); }}
                      className="w-full text-left px-4 py-2 text-sm text-[#44474c] hover:bg-[#f5f3f4] hover:text-[#1b1c1d] transition-colors"
                    >
                      My Properties
                    </button>
                  )}
                  <div className="border-t border-[#e4e2e3] my-1"></div>
                  <button 
                    onClick={handleLogout}
                    className="w-full text-left px-4 py-2 text-sm text-[#ba1a1a] hover:bg-[#f5f3f4] transition-colors flex items-center gap-2"
                  >
                    <LogOut className="w-4 h-4" /> Sign out
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </nav>
  );
};
