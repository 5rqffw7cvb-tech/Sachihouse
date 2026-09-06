
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { AlertCircle, Eye, EyeOff, Loader2, ShieldCheck } from 'lucide-react';
import { checkAuth, login, register } from '../services/auth';
import { GlobalLayout } from '../components/GlobalLayout';
import { loadTurnstileScript, TURNSTILE_SITE_KEY } from '../services/turnstile';

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
  const nameRef = useRef<HTMLInputElement>(null);
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
  const [mode, setMode] = useState<'signin' | 'register'>('signin');

  const isRegister = mode === 'register';

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

    const name = nameRef.current?.value.trim() ?? '';
    const email = emailRef.current?.value.trim() ?? '';
    const password = passwordRef.current?.value ?? '';
    const result = isRegister
      ? await register(name, email, password, turnstileToken)
      : await login(email, password, turnstileToken);
    if (result.success) {
      navigate(redirectTarget, { replace: true });
      return;
    }

    setErrorMsg(result.error || (isRegister
      ? 'Could not create your account. Please try again.'
      : 'Email or password is incorrect. Please try again.'));
    setTurnstileToken('');
    if (window.turnstile && turnstileWidgetIdRef.current) {
      window.turnstile.reset(turnstileWidgetIdRef.current);
    }
    setIsSubmitting(false);
  };

  return (
    <GlobalLayout>
      <div className="flex items-center justify-center min-h-[60vh] px-4">
        <div className="w-full max-w-[380px]">
          <div className="bg-white rounded-2xl border border-[#e4e2e3] shadow-[0_1px_2px_rgba(27,28,29,0.04),0_8px_24px_rgba(27,28,29,0.06)] px-7 py-8 sm:px-9 sm:py-10">
            <div className="flex flex-col items-center text-center mb-7">
              <div className="w-11 h-11 rounded-full bg-[#1b1c1d] flex items-center justify-center mb-4">
                <ShieldCheck className="w-5 h-5 text-white" strokeWidth={2} />
              </div>
              <h1 className="font-['Plus_Jakarta_Sans'] text-[22px] font-bold text-[#1b1c1d] tracking-tight">
                {isRegister ? 'Create host account' : 'Sign in'}
              </h1>
              <p className="text-[13px] text-[#74777d] mt-1">
                {isRegister ? 'Start hosting at host level 1' : 'Staff and host access only'}
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4" autoComplete="off">
              {isRegister && (
                <div>
                  <label className="block text-[12px] font-semibold text-[#44474c] uppercase tracking-[0.04em] mb-1.5">Name</label>
                  <input
                    type="text"
                    autoComplete="off"
                    required
                    ref={nameRef}
                    defaultValue=""
                    className="w-full rounded-xl border border-[#d8d6d8] bg-[#fbfafa] px-3.5 py-2.5 text-[15px] text-[#1b1c1d] placeholder:text-[#9ea3ab] focus:outline-none focus:border-[#1b1c1d] focus:ring-2 focus:ring-[#1b1c1d]/10 focus:bg-white transition-colors"
                    placeholder="Your name"
                  />
                </div>
              )}

              <div>
                <label className="block text-[12px] font-semibold text-[#44474c] uppercase tracking-[0.04em] mb-1.5">Email</label>
                <input
                  type="email"
                  autoComplete="off"
                  required
                  ref={emailRef}
                  defaultValue=""
                  className="w-full rounded-xl border border-[#d8d6d8] bg-[#fbfafa] px-3.5 py-2.5 text-[15px] text-[#1b1c1d] placeholder:text-[#9ea3ab] focus:outline-none focus:border-[#1b1c1d] focus:ring-2 focus:ring-[#1b1c1d]/10 focus:bg-white transition-colors"
                  placeholder="you@example.com"
                />
              </div>

              <div>
                <label className="block text-[12px] font-semibold text-[#44474c] uppercase tracking-[0.04em] mb-1.5">Password</label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="new-password"
                    required
                    ref={passwordRef}
                    defaultValue=""
                    className="w-full rounded-xl border border-[#d8d6d8] bg-[#fbfafa] px-3.5 py-2.5 pr-10 text-[15px] text-[#1b1c1d] placeholder:text-[#9ea3ab] focus:outline-none focus:border-[#1b1c1d] focus:ring-2 focus:ring-[#1b1c1d]/10 focus:bg-white transition-colors"
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

              <div className="relative flex justify-center min-h-[65px] items-center pt-1">
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
                <div className="flex items-start gap-2 text-red-600 text-[13px] bg-red-50 rounded-lg px-3 py-2.5">
                  <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                  <span>{errorMsg}</span>
                </div>
              )}

              <button
                type="submit"
                disabled={isSubmitting || !turnstileToken}
                className="w-full flex items-center justify-center gap-2 rounded-xl bg-[#1b1c1d] text-white font-semibold text-[14px] px-4 py-2.5 hover:bg-[#041627] active:scale-[0.99] disabled:opacity-40 disabled:active:scale-100 transition-all"
              >
                {isSubmitting && <Loader2 className="w-4 h-4 animate-spin" />}
                {isRegister ? 'Create account' : 'Sign in'}
              </button>
            </form>

            <p className="mt-5 text-[13px] text-[#74777d] text-center">
              {isRegister ? 'Already have an account?' : 'No account yet?'}{' '}
              <button
                type="button"
                onClick={() => {
                  setErrorMsg(null);
                  setMode((prev) => (prev === 'register' ? 'signin' : 'register'));
                }}
                className="text-[#1b1c1d] font-semibold hover:underline"
              >
                {isRegister ? 'Sign in' : 'Create a host account'}
              </button>
            </p>
          </div>

          <p className="mt-6 text-[13px] text-[#74777d] text-center">
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
