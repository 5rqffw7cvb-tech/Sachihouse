
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { AlertCircle, Eye, EyeOff, Loader2 } from 'lucide-react';
import { checkAuth, login } from '../services/auth';
import { GlobalLayout } from '../components/GlobalLayout';

// Cloudflare's published always-pass test site key, used only as a local-dev
// fallback when VITE_TURNSTILE_SITE_KEY isn't configured.
// https://developers.cloudflare.com/turnstile/troubleshooting/testing/
const TURNSTILE_SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY || '1x00000000000000000000AA';
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
const loadTurnstileScript = (): Promise<void> => {
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

const LoginPage: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const redirectTarget = useMemo(() => {
    const raw = searchParams.get('redirect') || '/';
    // Reject "//evil.com"-style protocol-relative paths in addition to absolute
    // URLs, since they also start with "/" but resolve off-origin.
    return raw.startsWith('/') && !raw.startsWith('//') ? raw : '/';
  }, [searchParams]);

  // Uncontrolled on purpose: mobile browsers autofill these fields by writing
  // straight to the DOM without firing onChange, so a controlled value bound
  // to React state would go stale and get wiped on the next unrelated
  // re-render. Read values from refs instead.
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const turnstileWidgetIdRef = useRef<string | null>(null);

  // GlobalLayout renders a "Loading..." placeholder instead of children
  // until its own async siteSettings fetch resolves, so the Turnstile
  // container div doesn't exist in the DOM yet when LoginPage's effects
  // first run. A plain useRef would capture null forever in that case -
  // track the node via state (callback ref) so the render effect re-fires
  // once GlobalLayout actually mounts it.
  const [turnstileContainerEl, setTurnstileContainerEl] = useState<HTMLDivElement | null>(null);

  const [turnstileToken, setTurnstileToken] = useState('');
  const [isTurnstileReady, setIsTurnstileReady] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    if (checkAuth()) {
      navigate(redirectTarget, { replace: true });
      return;
    }

    if (!turnstileContainerEl) {
      console.log('[turnstile] container not mounted yet, waiting');
      return;
    }

    let cancelled = false;
    loadTurnstileScript()
      .then(() => {
        if (cancelled) {
          console.warn('[turnstile] effect cancelled before script resolved');
          return;
        }
        if (!window.turnstile) {
          console.warn('[turnstile] window.turnstile missing after script resolved');
          return;
        }
        console.log('[turnstile] calling render() with sitekey', TURNSTILE_SITE_KEY);
        try {
          turnstileWidgetIdRef.current = window.turnstile.render(turnstileContainerEl, {
            sitekey: TURNSTILE_SITE_KEY,
            callback: (token) => {
              console.log('[turnstile] callback fired, token received');
              setTurnstileToken(token);
            },
            'expired-callback': () => setTurnstileToken(''),
            'error-callback': (code?: string) => {
              console.error('[turnstile] error-callback fired', code);
              setTurnstileToken('');
              setErrorMsg(`Anti-bot check error (${code ?? 'unknown'}). Please refresh.`);
            },
          });
          console.log('[turnstile] render() returned widget id', turnstileWidgetIdRef.current);
          setIsTurnstileReady(true);
        } catch (err) {
          console.error('[turnstile] render() threw', err);
          setErrorMsg(`Could not start the anti-bot check (${err instanceof Error ? err.message : String(err)}).`);
        }
      })
      .catch((err) => {
        console.error('[turnstile] script failed to load', err);
        if (!cancelled) {
          setErrorMsg('Could not load the anti-bot check. Please refresh this page.');
        }
      });

    return () => {
      cancelled = true;
      if (window.turnstile && turnstileWidgetIdRef.current) {
        window.turnstile.remove(turnstileWidgetIdRef.current);
        turnstileWidgetIdRef.current = null;
      }
    };
  }, [navigate, redirectTarget, turnstileContainerEl]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setErrorMsg(null);

    if (!turnstileToken) {
      setErrorMsg('Please complete the anti-bot check.');
      return;
    }

    setIsSubmitting(true);

    const email = emailRef.current?.value.trim() ?? '';
    const password = passwordRef.current?.value ?? '';
    const result = await login(email, password, turnstileToken);
    if (result.success) {
      navigate(redirectTarget, { replace: true });
      return;
    }

    setErrorMsg(result.error || 'Email or password is incorrect. Please try again.');
    setTurnstileToken('');
    if (window.turnstile && turnstileWidgetIdRef.current) {
      window.turnstile.reset(turnstileWidgetIdRef.current);
    }
    setIsSubmitting(false);
  };

  return (
    <GlobalLayout>
      <div className="flex items-center justify-center min-h-[60vh] px-4">
        <div className="w-full max-w-sm">
          <h1 className="font-['Plus_Jakarta_Sans'] text-[26px] font-bold text-[#1b1c1d] mb-1">Sign in</h1>
          <p className="text-[14px] text-[#74777d] mb-8">Staff and host access only.</p>

          <form onSubmit={handleSubmit} className="space-y-4" autoComplete="off">
            <div>
              <label className="block text-[13px] font-semibold text-[#1b1c1d] mb-1.5">Email</label>
              <input
                type="email"
                autoComplete="off"
                required
                ref={emailRef}
                defaultValue=""
                className="w-full rounded-lg border border-[#c4c6cd] bg-white px-4 py-2.5 text-base text-[#1b1c1d] placeholder:text-[#9ea3ab] focus:outline-none focus:border-[#1b1c1d] focus:ring-1 focus:ring-[#1b1c1d] transition-colors"
                placeholder="you@example.com"
              />
            </div>

            <div>
              <label className="block text-[13px] font-semibold text-[#1b1c1d] mb-1.5">Password</label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  required
                  ref={passwordRef}
                  defaultValue=""
                  className="w-full rounded-lg border border-[#c4c6cd] bg-white px-4 py-2.5 pr-10 text-base text-[#1b1c1d] placeholder:text-[#9ea3ab] focus:outline-none focus:border-[#1b1c1d] focus:ring-1 focus:ring-[#1b1c1d] transition-colors"
                  placeholder="••••••••"
                />
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={() => setShowPassword(v => !v)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  className="absolute inset-y-0 right-0 flex items-center justify-center w-10 text-[#9ea3ab] hover:text-[#1b1c1d] transition-colors"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <div className="relative flex justify-center min-h-[65px] items-center">
              {/* Turnstile injects its iframe directly into this DOM node outside
                  React's control, so it must not also be a React-rendered parent
                  (e.g. of the spinner below) - that causes React/DOM conflicts
                  on reconciliation and leaves the widget stuck. */}
              <div ref={setTurnstileContainerEl} />
              {!isTurnstileReady && (
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <Loader2 className="w-5 h-5 animate-spin text-[#9ea3ab]" />
                </div>
              )}
            </div>

            {errorMsg && (
              <div className="flex items-start gap-2 text-red-600 text-[13px]">
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                <span>{errorMsg}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={isSubmitting || !turnstileToken}
              className="w-full flex items-center justify-center gap-2 rounded-lg bg-[#1b1c1d] text-white font-semibold text-[14px] px-4 py-2.5 hover:bg-[#041627] disabled:opacity-50 transition-colors"
            >
              {isSubmitting && <Loader2 className="w-4 h-4 animate-spin" />}
              Sign in
            </button>
          </form>

          <p className="mt-6 text-[13px] text-[#74777d]">
            Not staff?{' '}
            <Link to="/" className="text-[#1b1c1d] font-semibold hover:underline">
              Back to listings
            </Link>
          </p>
        </div>
      </div>
    </GlobalLayout>
  );
};

export default LoginPage;
