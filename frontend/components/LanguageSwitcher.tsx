import React, { useEffect, useRef, useState } from 'react';
import { Globe } from 'lucide-react';
import { useLanguage } from '../contexts/LanguageContext';
import { Language } from '../utils/translations';

interface LanguageSwitcherProps {
  className?: string;
  compact?: boolean;
}

const LANG_OPTIONS: Array<{ code: Language; label: string; shortLabel: string }> = [
  { code: 'en', label: 'English', shortLabel: 'EN' },
  { code: 'vi', label: 'Tiếng Việt', shortLabel: 'VI' },
  { code: 'ja', label: '日本語', shortLabel: 'JP' },
  { code: 'zh', label: '中文', shortLabel: 'ZH' },
  { code: 'ko', label: '한국어', shortLabel: 'KO' },
];

export const LanguageSwitcher: React.FC<LanguageSwitcherProps> = ({ className = '', compact = false }) => {
  const { language, setLanguage } = useLanguage();
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const activeOption = LANG_OPTIONS.find((option) => option.code === language) ?? LANG_OPTIONS[0];

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  return (
    <div ref={containerRef} className={`relative ${className}`.trim()}>
      <button
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        className={compact
          ? 'flex items-center gap-1.5 rounded-full border border-[#d8d4d6] bg-white/95 px-3 py-1.5 text-[11px] font-semibold text-[#1b1c1d] shadow-sm backdrop-blur transition-colors hover:bg-[#f5f3f4]'
          : 'flex items-center gap-2 rounded-full border border-[#d8d4d6] bg-white px-3 py-2 text-[13px] font-semibold text-[#1b1c1d] shadow-sm transition-colors hover:bg-[#f5f3f4]'
        }
        aria-haspopup="menu"
        aria-expanded={isOpen}
        title="Switch language"
      >
        <Globe className={compact ? 'h-3.5 w-3.5' : 'h-4 w-4'} />
        <span>{compact ? activeOption.shortLabel : activeOption.label}</span>
      </button>

      {isOpen && (
        <div className="absolute right-0 top-[calc(100%+0.5rem)] min-w-[140px] overflow-hidden rounded-2xl border border-[#e4e2e3] bg-white shadow-[0_12px_40px_rgba(0,0,0,0.12)]">
          {LANG_OPTIONS.map((option) => {
            const isActive = option.code === language;
            return (
              <button
                key={option.code}
                type="button"
                onClick={() => {
                  setLanguage(option.code);
                  setIsOpen(false);
                }}
                className={`flex w-full items-center justify-between px-4 py-3 text-left text-[13px] transition-colors ${
                  isActive ? 'bg-[#041627] text-white' : 'text-[#1b1c1d] hover:bg-[#f5f3f4]'
                }`}
              >
                <span>{option.label}</span>
                <span className={`text-[11px] font-bold ${isActive ? 'text-white/80' : 'text-[#74777d]'}`}>{option.shortLabel}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};