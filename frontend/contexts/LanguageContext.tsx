
import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { translations, Language } from '../utils/translations';

interface LanguageContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: (key: keyof typeof translations['en']) => string;
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

const SUPPORTED: Language[] = ['en', 'vi', 'ja', 'zh', 'ko'];

function getSavedLanguage(): Language | null {
  try {
    const saved = localStorage.getItem('app_language') as Language | null;
    return saved && SUPPORTED.includes(saved) ? saved : null;
  } catch {
    return null;
  }
}

function detectBrowserLanguage(): Language {
  const saved = getSavedLanguage();
  if (saved) return saved;

  const preferredLanguages = Array.isArray(navigator.languages) && navigator.languages.length > 0
    ? navigator.languages
    : [navigator.language];

  for (const preferred of preferredLanguages) {
    const nav = preferred.toLowerCase();
    if (nav.startsWith('vi')) return 'vi';
    if (nav.startsWith('ja')) return 'ja';
    if (nav.startsWith('zh')) return 'zh';
    if (nav.startsWith('ko')) return 'ko';
    if (nav.startsWith('en')) return 'en';
  }

  return 'en';
}

export const LanguageProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [language, setLanguage] = useState<Language>(() => detectBrowserLanguage());

  useEffect(() => {
    // keep in sync if localStorage changed externally
    const saved = getSavedLanguage();
    if (saved) setLanguage(saved);
  }, []);

  const handleSetLanguage = (lang: Language) => {
    setLanguage(lang);
    try {
      localStorage.setItem('app_language', lang);
    } catch {
      // Ignore storage failures and keep runtime state only.
    }
  };

  const value = React.useMemo(() => {
    const t = (key: keyof typeof translations['en']) => {
      return translations[language][key] || translations['en'][key] || key;
    };
    return { language, setLanguage: handleSetLanguage, t };
  }, [language]);

  return (
    <LanguageContext.Provider value={value}>
      {children}
    </LanguageContext.Provider>
  );
};

export const useLanguage = () => {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error('useLanguage must be used within a LanguageProvider');
  }
  return context;
};
