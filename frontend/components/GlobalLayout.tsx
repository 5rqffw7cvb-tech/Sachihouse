import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { TopNavBar } from './TopNavBar';
import { MobileBottomNav } from './MobileBottomNav';
import { LanguageSwitcher } from './LanguageSwitcher';
import { getSiteSettings } from '../services/storage';
import { SiteSettings } from '../types';

export const GlobalLayout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [siteSettings, setSiteSettings] = useState<SiteSettings | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    const fetchSettings = async (withLoadingState = false) => {
      if (withLoadingState) {
        setIsLoading(true);
      }

      try {
        const settings = await getSiteSettings();
        setSiteSettings(settings);
        setLoadError(null);
      } catch (error) {
        console.error('Failed to load site settings', error);
        setLoadError('Failed to load page settings. Please refresh and try again.');
      } finally {
        setIsLoading(false);
      }
    };
    void fetchSettings(true);

    const handleSettingsUpdated = () => {
      void fetchSettings(false);
    };
    window.addEventListener('site-settings-updated', handleSettingsUpdated);
    return () => window.removeEventListener('site-settings-updated', handleSettingsUpdated);
  }, []);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#e8e5e6] flex flex-col items-center justify-center gap-3 text-[#041627]">
        <Loader2 className="w-8 h-8 animate-spin" />
        <p className="text-sm font-medium tracking-[0.04em] uppercase">Loading...</p>
      </div>
    );
  }

  if (loadError || !siteSettings) {
    return (
      <div className="min-h-screen bg-[#e8e5e6] flex items-center justify-center px-6 text-center text-[#ba1a1a]">
        {loadError || 'Failed to load page settings. Please refresh and try again.'}
      </div>
    );
  }

  return (
    <div className="bg-[#e8e5e6] text-[#1b1c1d] font-['Inter'] min-h-screen flex flex-col">
      <TopNavBar
        navTitleOverride={siteSettings.navTitle}
        actionButton={<LanguageSwitcher />}
        mobileActionButton={<LanguageSwitcher compact />}
      />

      {/* Main Content */}
      <main className="flex-1 max-w-[1280px] mx-auto px-3 md:px-6 py-12 md:py-16 pt-6 md:pt-[120px] pb-24 md:pb-12 w-full">
        {children}
      </main>

      {/* BottomNavBar (Mobile Only) */}
      <MobileBottomNav />

      {/* Footer */}
      <footer className="bg-[#f5f3f4] text-[#1b1c1d] text-[12px] md:text-[14px] font-['Plus_Jakarta_Sans'] border-t border-[#e4e2e3] w-full py-6 md:py-8 px-4 md:px-6 flex flex-col md:flex-row justify-between items-center gap-4 md:gap-6 pb-20 md:pb-8 mt-8">
        <div className="text-[16px] md:text-[18px] font-bold text-[#1b1c1d]">
          {siteSettings.footerTitle || ''}
        </div>
        <div className="text-[#44474c]">
          {siteSettings.footerCopyright || ''}
        </div>
      </footer>
    </div>
  );
};
