import React, { useEffect, useState } from 'react';
import { getSiteSettings } from '../services/storage';

function readCachedSettings(): { footerTitle?: string; footerCopyright?: string } {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem('cache_settings');
    if (!raw) return {};
    const parsed = JSON.parse(raw) as { footerTitle?: string; footerCopyright?: string };
    return { footerTitle: parsed.footerTitle, footerCopyright: parsed.footerCopyright };
  } catch {
    return {};
  }
}

/**
 * Shared system footer: single row, same height as the top nav (py-3),
 * desktop-only (hidden on mobile). Self-loads site settings so it can be
 * dropped into any page with no props.
 */
export const Footer: React.FC = () => {
  const [settings, setSettings] = useState<{ footerTitle?: string; footerCopyright?: string }>(readCachedSettings);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      getSiteSettings()
        .then((s) => {
          if (!cancelled) setSettings({ footerTitle: s.footerTitle, footerCopyright: s.footerCopyright });
        })
        .catch(() => { /* keep cached/empty */ });
    };
    load();
    window.addEventListener('site-settings-updated', load);
    return () => {
      cancelled = true;
      window.removeEventListener('site-settings-updated', load);
    };
  }, []);

  return (
    <footer className="hidden md:block bg-[#f5f3f4] border-t border-[#e4e2e3] font-['Plus_Jakarta_Sans'] mt-auto">
      <div className="max-w-[1280px] mx-auto px-3 md:px-6 py-3 flex items-center justify-between gap-4">
        <span className="text-[14px] font-bold text-[#1b1c1d] truncate">{settings.footerTitle || ''}</span>
        <span className="text-[12px] text-[#74777d] truncate">{settings.footerCopyright || ''}</span>
      </div>
    </footer>
  );
};
