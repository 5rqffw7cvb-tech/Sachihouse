import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { AlertCircle, Eye, EyeOff, Home, Loader2, Share, ShieldCheck } from 'lucide-react';
import { HostAppMeta } from '../../components/host/HostAppMeta';
import { checkAuth, login } from '../../services/auth';
import { loadTurnstileScript, TURNSTILE_SITE_KEY } from '../../services/turnstile';

/**
 * The host app's own sign-in screen.
 *
 * Two things make it different from the site's login page, and both are the
 * point of the app: it carries none of the marketing chrome, and it asks for a
 * remembered session, so a host signs in once on the phone they installed it
 * on and does not see this screen again.
 *
 * There is no register mode here on purpose — a host account is granted, not
 * self-served, and /become-host already exists for people who need one.
 */
const HostLoginPage: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const redirectTarget = useMemo(() => {
    const raw = searchParams.get('redirect') || '/app';
    // Reject protocol-relative "//evil.com" as well as absolute URLs: both are
    // off-origin despite starting with a slash.
    const safe = raw.startsWith('/') && !raw.startsWith('//') ? raw : '/app';
    // Never bounce back to this screen after a successful sign-in.
    return safe.startsWith('/app/login') ? '/app' : safe;
  }, [searchParams]);

  // Uncontrolled, as on the site's login page: mobile browsers autofill by
  // writing straight to the DOM without firing onChange, so a controlled value
  // goes stale and gets wiped by the next unrelated re-render.
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const widgetIdRef = useRef<string | null>(null);

  const [turnstileEl, setTurnstileEl] = useState<HTMLDivElement | null>(null);
  const [turnstileToken, setTurnstileToken] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (checkAuth()) {
      navigate(redirectTarget, { replace: true });
      return;
    }
    if (!turnstileEl) return;

    let cancelled = false;
    loadTurnstileScript()
      .then(() => {
        if (cancelled || !window.turnstile) return;
        try {
          widgetIdRef.current = window.turnstile.render(turnstileEl, {
            sitekey: TURNSTILE_SITE_KEY,
            callback: (token) => setTurnstileToken(token),
            'expired-callback': () => setTurnstileToken(''),
            'error-callback': (code?: string) => {
              setTurnstileToken('');
              setErrorMsg(`Anti-bot check error (${code ?? 'unknown'}). Please reopen the app.`);
            },
          });
        } catch (error) {
          setErrorMsg(
            `Could not start the anti-bot check (${error instanceof Error ? error.message : String(error)}).`,
          );
        }
      })
      .catch(() => {
        if (!cancelled) setErrorMsg('Could not load the anti-bot check. Check your connection and try again.');
      });

    return () => {
      cancelled = true;
      if (window.turnstile && widgetIdRef.current) {
        window.turnstile.remove(widgetIdRef.current);
        widgetIdRef.current = null;
      }
    };
  }, [navigate, redirectTarget, turnstileEl]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setErrorMsg(null);

    if (!turnstileToken) {
      setErrorMsg('Please wait for the anti-bot check to finish.');
      return;
    }

    setIsSubmitting(true);
    const result = await login(
      emailRef.current?.value.trim() ?? '',
      passwordRef.current?.value ?? '',
      turnstileToken,
      remember,
    );

    if (result.success) {
      navigate(redirectTarget, { replace: true });
      return;
    }

    setErrorMsg(result.error || 'Email or password is incorrect. Please try again.');
    setTurnstileToken('');
    window.turnstile?.reset(widgetIdRef.current ?? undefined);
    setIsSubmitting(false);
  };

  return (
    <div className="min-h-[100dvh] bg-surface text-ink font-['Inter'] flex flex-col px-6">
      <HostAppMeta />
      <div style={{ height: 'calc(env(safe-area-inset-top, 0px) + 0.5rem)' }} className="shrink-0" />
      <div className="h-16 shrink-0" />

      <div className="w-14 h-14 rounded-[16px] bg-brand flex items-center justify-center shrink-0">
        <Home className="w-[26px] h-[26px] text-white" />
      </div>

      <h1 className="mt-5 text-[28px] tracking-[-0.5px]">Sachi House</h1>
      <p className="mt-1.5 text-[15px] text-ink-muted">Host console</p>

      <form onSubmit={handleSubmit} className="mt-9 flex flex-col gap-4">
        <label className="flex flex-col gap-1.5">
          <span className="text-[12px] font-semibold uppercase tracking-wide text-ink-soft">Email</span>
          <input
            ref={emailRef}
            type="email"
            name="email"
            autoComplete="username"
            inputMode="email"
            autoCapitalize="none"
            autoCorrect="off"
            required
            className="h-12 px-3.5 rounded-control bg-subtle border border-line text-[16px] text-ink
              placeholder:text-ink-muted focus:outline-none focus:border-brand focus:ring-2 focus:ring-brand/15"
            placeholder="host@sachi-house.net"
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-[12px] font-semibold uppercase tracking-wide text-ink-soft">Password</span>
          <div className="relative">
            <input
              ref={passwordRef}
              type={showPassword ? 'text' : 'password'}
              name="password"
              autoComplete="current-password"
              required
              className="w-full h-12 pl-3.5 pr-12 rounded-control bg-subtle border border-line text-[16px] text-ink
                focus:outline-none focus:border-brand focus:ring-2 focus:ring-brand/15"
            />
            <button
              type="button"
              onClick={() => setShowPassword((value) => !value)}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              className="absolute right-0 top-0 h-12 w-12 flex items-center justify-center text-ink-muted"
            >
              {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
            </button>
          </div>
        </label>

        <button
          type="button"
          onClick={() => setRemember((value) => !value)}
          aria-pressed={remember}
          className="flex items-center gap-3.5 min-h-11 text-left"
        >
          <span className="flex-1 min-w-0 flex flex-col gap-0.5">
            <span className="text-[15px] font-semibold text-ink">Stay signed in</span>
            <span className="text-[12px] text-ink-muted leading-snug">
              You will only be asked again if you sign out.
            </span>
          </span>
          <span
            className={`w-[50px] h-[30px] rounded-full p-[3px] shrink-0 flex items-center transition-colors ${
              remember ? 'bg-brand justify-end' : 'bg-line-strong justify-start'
            }`}
          >
            <span className="w-6 h-6 rounded-full bg-surface" />
          </span>
        </button>

        {errorMsg && (
          <div className="flex items-start gap-2.5 bg-danger-tint text-danger border border-danger/20 rounded-card px-4 py-3 text-[13px]">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span className="flex-1 min-w-0">{errorMsg}</span>
          </div>
        )}

        <div ref={setTurnstileEl} className="flex justify-center min-h-[1px]" />

        <button
          type="submit"
          disabled={isSubmitting}
          className="h-13 min-h-[52px] rounded-control bg-brand text-white font-['Plus_Jakarta_Sans'] text-[15px] font-bold
            flex items-center justify-center gap-2 disabled:opacity-60"
        >
          {isSubmitting && <Loader2 className="w-4 h-4 animate-spin" />}
          Sign in
        </button>

        <div className="flex items-center justify-center gap-1.5 text-ink-muted">
          <ShieldCheck className="w-3.5 h-3.5" />
          <span className="text-[12px]">Protected by Turnstile</span>
        </div>
      </form>

      <div className="flex-1 min-h-6" />

      <div className="flex items-center gap-3 bg-subtle border border-line rounded-card px-4 py-3.5">
        <div className="w-[38px] h-[38px] rounded-control bg-surface border border-line flex items-center justify-center shrink-0">
          <Share className="w-[18px] h-[18px] text-ink-soft" />
        </div>
        <div className="flex-1 min-w-0 flex flex-col gap-0.5">
          <span className="text-[14px] font-semibold text-ink">Add to Home Screen</span>
          <span className="text-[12px] text-ink-muted leading-snug">
            Share &rarr; Add to Home Screen. Opens full screen, no browser bar.
          </span>
        </div>
      </div>

      <div style={{ height: 'calc(2rem + env(safe-area-inset-bottom, 0px))' }} className="shrink-0" />
    </div>
  );
};

export default HostLoginPage;
