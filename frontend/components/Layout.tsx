
import React from 'react';
import { NavLink, Link, useLocation, useParams, Outlet } from 'react-router-dom';
import { Home, MapPin, DollarSign, BookOpen, Settings, ShieldCheck, Calculator, ThumbsUp, ExternalLink, Globe, List, ChevronLeft } from 'lucide-react';
import { PropertyData } from '../types';
import { useLanguage } from '../contexts/LanguageContext';
import { Language } from '../utils/translations';

interface LayoutProps {
  data: PropertyData;
}

// Platform Button Component - Redesigned
const PlatformButton: React.FC<{ url?: string; name: string; color: string; bgColor: string; label: string }> = ({ url, name, color, bgColor, label }) => {
    if (!url) return null;
    return (
        <a 
            href={url} 
            target="_blank" 
            rel="noopener noreferrer"
            className="group flex items-center justify-between p-3 rounded-xl border border-gray-200 bg-white hover:border-blue-200 hover:shadow-md transition-all duration-200 min-w-[200px]"
        >
            <div className="flex items-center gap-3">
                <div 
                    className="w-10 h-10 rounded-lg flex items-center justify-center text-white font-extrabold text-xl shadow-sm" 
                    style={{ backgroundColor: color }}
                >
                    {name.charAt(0)}
                </div>
                <div className="flex flex-col">
                    <span className="text-[10px] uppercase font-bold text-gray-400 tracking-wider leading-none mb-0.5">{label}</span>
                    <span className="font-bold text-gray-900 leading-none">{name}</span>
                </div>
            </div>
            <ExternalLink className="w-4 h-4 text-gray-300 group-hover:text-blue-500 transition-colors" />
        </a>
    );
};

const Layout: React.FC<LayoutProps> = ({ data }) => {
  const location = useLocation();
  const { id } = useParams<{ id: string }>();
  const baseUrl = `/${id || 'main'}`;
  const { language, setLanguage, t } = useLanguage();

  const toggleLanguage = () => {
    const langs: Language[] = ['en', 'vi', 'ja', 'zh'];
    const currentIndex = langs.indexOf(language);
    const nextIndex = (currentIndex + 1) % langs.length;
    setLanguage(langs[nextIndex]);
  };

  // Label maps for display
  const LANG_LABELS: Record<Language, string> = {
    en: 'English',
    vi: 'Tiếng Việt',
    ja: '日本語',
    zh: '中文'
  };

  const LANG_SHORT_LABELS: Record<Language, string> = {
    en: 'EN',
    vi: 'VN',
    ja: 'JP',
    zh: 'CN'
  };

  const navItems = [
    { path: baseUrl, label: data.titles.menuHome && language === 'en' ? data.titles.menuHome : t('nav_home'), icon: Home, end: true },
    { path: `${baseUrl}/access`, label: data.titles.menuAccess && language === 'en' ? data.titles.menuAccess : t('nav_access'), icon: MapPin },
    { path: `${baseUrl}/pricing`, label: data.titles.menuPricing && language === 'en' ? data.titles.menuPricing : t('nav_pricing'), icon: DollarSign },
    { path: `${baseUrl}/rules`, label: data.titles.menuRules && language === 'en' ? data.titles.menuRules : t('nav_rules'), icon: ShieldCheck },
    { path: `${baseUrl}/manual`, label: data.titles.menuManual && language === 'en' ? data.titles.menuManual : t('nav_manual'), icon: BookOpen },
  ];

  return (
    <div className="min-h-screen flex flex-col bg-white">
      {/* Floating Back Button for Mobile (Since no top nav on mobile) */}
      <div className="md:hidden fixed top-4 left-4 z-50">
        <Link to="/" className="w-10 h-10 bg-white/90 backdrop-blur-md border border-gray-200 rounded-full flex items-center justify-center text-gray-900 shadow-sm hover:bg-gray-50 transition-colors">
          <ChevronLeft className="w-6 h-6" />
        </Link>
      </div>

      {/* Desktop Navbar (Hidden on mobile) */}
      <header className="hidden md:block fixed top-0 w-full bg-white/90 backdrop-blur-md z-50 border-b border-gray-100 shadow-sm transition-all duration-300">
        <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            {/* Logo / Back to properties */}
            <div className="flex items-center gap-4">
              <Link to="/" className="text-gray-400 hover:text-gray-900 transition-colors group flex items-center gap-1 text-sm font-medium">
                <ChevronLeft className="w-5 h-5 group-hover:-translate-x-1 transition-transform" />
                <span className="hidden lg:inline">Properties</span>
              </Link>
              <div className="w-px h-6 bg-gray-200"></div>
              <div className="flex items-center gap-2 group cursor-pointer">
                <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center text-white font-bold text-xl transition-colors">
                  S
                </div>
                <span className="font-bold text-lg tracking-tight text-gray-900 line-clamp-1 max-w-[150px] xl:max-w-[300px]">
                  {data.name.split(':')[0] || "Sachi House"}
                </span>
              </div>
            </div>

            {/* Desktop Nav */}
            <nav className="flex space-x-1">
              {navItems.map((item) => (
                <NavLink
                  key={item.path}
                  to={item.path}
                  end={item.end}
                  className={({ isActive }) =>
                    `flex items-center px-4 py-2 rounded-full text-sm font-medium transition-all duration-200 ${
                      isActive
                        ? 'bg-blue-50 text-blue-600'
                        : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                    }`
                  }
                >
                  {item.label}
                </NavLink>
              ))}
            </nav>

            {/* Right Action */}
            <div className="flex items-center gap-3">
               <button 
                  onClick={toggleLanguage}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg transition-colors min-w-[100px] justify-center"
                  title="Switch Language"
               >
                  <Globe className="w-4 h-4" />
                  <span>{LANG_LABELS[language]}</span>
               </button>
               <div className="h-6 w-px bg-gray-200 mx-1"></div>
               <Link to={`${baseUrl}/admin`} className="flex items-center text-gray-400 hover:text-gray-600 transition-colors" title={t('nav_host')}>
                <Settings className="w-5 h-5" />
              </Link>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content (Adjust padding for Mobile Bottom Nav vs Desktop Top Nav) */}
      <main className="flex-grow pt-0 md:pt-16 pb-20 md:pb-0">
        <Outlet />
      </main>

      {/* Footer (Desktop Only) */}
      <footer className="hidden md:block bg-gray-50 border-t border-gray-200 mt-0">
        <div className="max-w-7xl mx-auto py-6 px-3 sm:px-6 lg:px-8 flex flex-col items-start">
           
           <div className="flex flex-wrap gap-6 w-full items-start">
               {/* Custom Facebook Card Section */}
               <a 
                  href={data.social.facebookUrl} 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="group bg-white p-4 rounded-xl shadow-sm border border-gray-200 flex items-center gap-6 hover:shadow-md hover:border-blue-100 transition-all duration-300 max-w-md w-full transform hover:-translate-y-1"
               >
                  <div className="relative shrink-0">
                    {data.social.footerImageUrl ? (
                      <img 
                        src={data.social.footerImageUrl} 
                        alt="Sachi House Avatar" 
                        className="w-20 h-20 rounded-full object-cover border-4 border-white shadow-sm group-hover:scale-105 transition-transform duration-300"
                      />
                    ) : (
                      <div className="w-20 h-20 rounded-full bg-gray-200 border-4 border-white shadow-sm flex items-center justify-center">
                        <span className="text-gray-400 text-[10px]">No img</span>
                      </div>
                    )}
                    <div className="absolute -bottom-1 -right-1 bg-[#1877f2] text-white p-1.5 rounded-full border-2 border-white shadow-sm">
                      <ThumbsUp className="w-3.5 h-3.5" />
                    </div>
                  </div>
                  
                  <div className="flex-1">
                    <h3 className="font-bold text-gray-900 text-xl group-hover:text-[#1877f2] transition-colors mb-1 line-clamp-1">
                      {data.name.split(':')[0] || "Sachi House"}
                    </h3>
                    <p className="text-gray-500 text-xs mb-3 flex items-center gap-1.5">
                       <MapPin className="w-3.5 h-3.5"/> Tokyo, Japan
                    </p>
                    <div className="inline-flex items-center gap-1.5 bg-[#1877f2]/5 group-hover:bg-[#1877f2] text-[#1877f2] group-hover:text-white text-xs font-bold px-4 py-2 rounded-full transition-all duration-300">
                       <ThumbsUp className="w-3.5 h-3.5" />
                       <span>Like Page</span>
                    </div>
                  </div>
               </a>
               
               {/* Other Platforms Section */}
               {(data.social.airbnbUrl || data.social.bookingUrl || data.social.agodaUrl) && (
                   <div className="flex flex-col gap-3 p-4 bg-gray-50/50 rounded-xl">
                        <h4 className="font-bold text-gray-400 text-[10px] uppercase tracking-wider flex items-center gap-2">
                            <span className="w-1 h-3 bg-blue-600 rounded-full"></span>
                            {t('home_also_on')}
                        </h4>
                        <div className="flex flex-wrap gap-2">
                            <PlatformButton url={data.social.airbnbUrl} name="Airbnb" color="#FF385C" bgColor="#fff" label={t('home_book_on')} />
                            <PlatformButton url={data.social.bookingUrl} name="Booking.com" color="#003580" bgColor="#fff" label={t('home_book_on')} />
                            <PlatformButton url={data.social.agodaUrl} name="Agoda" color="#2a2a2a" bgColor="#fff" label={t('home_book_on')} />
                        </div>
                   </div>
               )}
           </div>

           <div className="mt-4 border-t border-gray-200 pt-3 w-full">
             <p className="text-gray-400 text-xs">&copy; {new Date().getFullYear()} {data.name}. {t('footer_rights')}</p>
           </div>
        </div>
      </footer>

      {/* MOBILE BOTTOM NAVIGATION BAR */}
      <div className="md:hidden fixed bottom-0 w-full bg-white border-t border-gray-200 z-50 pb-safe safe-area-bottom">
        <div className="flex justify-around items-center h-16 relative">
            
           {/* Language Switcher Mobile - Floating Absolute or just item */}
           <button 
                onClick={toggleLanguage}
                className="absolute -top-12 right-4 bg-white/90 backdrop-blur border border-gray-200 shadow-sm rounded-full px-3 py-1.5 text-xs font-bold text-gray-700 flex items-center gap-1.5 z-50 min-w-[60px] justify-center"
            >
                <Globe className="w-3.5 h-3.5" />
                {LANG_SHORT_LABELS[language]}
           </button>

          {navItems.map((item) => {
            // Customize label and icon for mobile Pricing item
            const isPricing = item.path === '/pricing';
            // Shorten label for mobile if needed
            let label = item.label;
            // Simple localized override for simulator if needed, else t() handles it
            if (isPricing) {
                if (language === 'en') label = 'Simulator';
                else if (language === 'vi') label = 'Tính giá';
                else if (language === 'ja') label = '計算';
                else if (language === 'zh') label = '计算';
            }

            const Icon = isPricing ? Calculator : item.icon;

            return (
              <NavLink
                key={item.path}
                to={item.path}
                end={item.end}
                className={({ isActive }) =>
                  `flex flex-col items-center justify-center w-full h-full space-y-1 ${
                    isActive ? 'text-blue-600' : 'text-gray-400 hover:text-gray-600'
                  }`
                }
              >
                <Icon className="w-6 h-6" strokeWidth={2} />
                <span className="text-[10px] font-medium truncate max-w-[60px]">{label}</span>
              </NavLink>
            );
          })}
           <Link
              to={`${baseUrl}/admin`}
              className={`flex flex-col items-center justify-center w-full h-full space-y-1 ${location.pathname === `${baseUrl}/admin` ? 'text-blue-600' : 'text-gray-400'}`}
            >
              <Settings className="w-6 h-6" strokeWidth={2} />
              <span className="text-[10px] font-medium">{t('nav_host')}</span>
            </Link>
        </div>
      </div>
    </div>
  );
};

export default Layout;
