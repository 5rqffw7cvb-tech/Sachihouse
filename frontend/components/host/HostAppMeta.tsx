import { useEffect, type FC } from 'react';

/**
 * Turns the document into an installable host app — but only while a /app
 * screen is mounted.
 *
 * These tags are deliberately not in index.html. The document is shared with
 * the guest-facing site, and a site-wide manifest would mean a visitor adding
 * the property homepage to their home screen gets an icon called "Sachi Host"
 * that opens the host console. Injecting them here scopes the install offer to
 * the people the app is for, and iOS only reads them at the moment someone
 * taps Add to Home Screen — which is always on one of these screens.
 */
const APP_TITLE = 'Sachi Host';
const APP_THEME_COLOR = '#e8e5e6';

interface Managed {
  el: HTMLElement;
  /** Content to put back on unmount; null means the tag was ours to remove. */
  previous: string | null;
}

const setMeta = (name: string, content: string, managed: Managed[]) => {
  const existing = document.querySelector<HTMLMetaElement>(`meta[name="${name}"]`);
  if (existing) {
    managed.push({ el: existing, previous: existing.content });
    existing.content = content;
    return;
  }
  const meta = document.createElement('meta');
  meta.name = name;
  meta.content = content;
  document.head.appendChild(meta);
  managed.push({ el: meta, previous: null });
};

export const HostAppMeta: FC = () => {
  useEffect(() => {
    const managed: Managed[] = [];

    const manifest = document.createElement('link');
    manifest.rel = 'manifest';
    manifest.href = '/manifest.webmanifest';
    document.head.appendChild(manifest);
    managed.push({ el: manifest, previous: null });

    setMeta('apple-mobile-web-app-capable', 'yes', managed);
    setMeta('mobile-web-app-capable', 'yes', managed);
    // 'default' keeps the status bar opaque, so iOS reserves that strip itself
    // rather than painting our page under the clock.
    setMeta('apple-mobile-web-app-status-bar-style', 'default', managed);
    setMeta('apple-mobile-web-app-title', APP_TITLE, managed);
    setMeta('theme-color', APP_THEME_COLOR, managed);

    return () => {
      managed.forEach(({ el, previous }) => {
        if (previous === null) {
          el.remove();
        } else if (el instanceof HTMLMetaElement) {
          el.content = previous;
        }
      });
    };
  }, []);

  return null;
};

export default HostAppMeta;
