/**
 * Cloudflare Turnstile loader, shared by every sign-in surface.
 *
 * There are two now — the site's login page and the host app's — and the
 * script may only be injected once per document, so the in-flight promise has
 * to be shared rather than re-created per page.
 */

// Cloudflare's published always-pass test site key, used only as a local-dev
// fallback when VITE_TURNSTILE_SITE_KEY isn't configured.
// https://developers.cloudflare.com/turnstile/troubleshooting/testing/
export const TURNSTILE_SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY || '1x00000000000000000000AA';

const TURNSTILE_SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js';

declare global {
  interface Window {
    turnstile?: {
      render: (container: HTMLElement, options: {
        sitekey: string;
        callback: (token: string) => void;
        'expired-callback'?: () => void;
        'error-callback'?: (errorCode?: string) => void;
      }) => string;
      reset: (widgetId?: string) => void;
      remove: (widgetId?: string) => void;
    };
  }
}

let turnstileScriptPromise: Promise<void> | null = null;

export const loadTurnstileScript = (): Promise<void> => {
  if (window.turnstile) {
    return Promise.resolve();
  }
  if (!turnstileScriptPromise) {
    turnstileScriptPromise = new Promise((resolve, reject) => {
      const existing = document.querySelector(`script[src="${TURNSTILE_SCRIPT_SRC}"]`);
      if (existing) {
        existing.addEventListener('load', () => resolve());
        existing.addEventListener('error', () => reject(new Error('Failed to load Turnstile script.')));
        return;
      }
      const script = document.createElement('script');
      script.src = TURNSTILE_SCRIPT_SRC;
      script.async = true;
      script.defer = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('Failed to load Turnstile script.'));
      document.head.appendChild(script);
    });
  }
  return turnstileScriptPromise;
};
