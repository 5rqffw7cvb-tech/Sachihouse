import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { TopNavBar } from './TopNavBar';
import { MobileBottomNav } from './MobileBottomNav';
import { getSiteSettings } from '../services/storage';

export const GlobalLayout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [footerTitle, setFooterTitle] = useState<string | null>(null);
  const [footerCopyright, setFooterCopyright] = useState<string | null>(null);

  useEffect(() => {
    const fetchSettings = async () => {
      try {
        const settings = await getSiteSettings();
        if (settings) {
          setFooterTitle(settings.footerTitle || null);
          setFooterCopyright(settings.footerCopyright || null);
        }
      } catch (error) {
        console.error('Failed to load site settings', error);
      }
    };
    fetchSettings();

    window.addEventListener('site-settings-updated', fetchSettings);
    return () => window.removeEventListener('site-settings-updated', fetchSettings);
  }, []);

  return (
    <div className="bg-[#e8e5e6] text-[#1b1c1d] font-['Inter'] min-h-screen flex flex-col">
      <TopNavBar />

      {/* Main Content */}
      <main className="flex-1 max-w-[1280px] mx-auto px-3 md:px-6 py-12 md:py-16 pt-6 md:pt-[120px] pb-24 md:pb-12 w-full">
        {children}
      </main>

      {/* BottomNavBar (Mobile Only) */}
      <MobileBottomNav />

      {/* Footer */}
      <footer className="bg-[#f5f3f4] text-[#1b1c1d] text-[12px] md:text-[14px] font-['Plus_Jakarta_Sans'] border-t border-[#e4e2e3] w-full py-6 md:py-8 px-4 md:px-6 flex flex-col md:flex-row justify-between items-center gap-4 md:gap-6 pb-20 md:pb-8 mt-8">
        <div className="text-[16px] md:text-[18px] font-bold text-[#1b1c1d]">
          {footerTitle || ''}
        </div>
        <div className="text-[#44474c]">
          {footerCopyright || ''}
        </div>
      </footer>
    </div>
  );
};
