import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { AlertCircle, CheckCircle2, Loader2, LockKeyhole, LogIn } from 'lucide-react';
import { checkAuth, login } from '../services/auth';

const LoginPage: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const redirectTarget = useMemo(() => {
    const raw = searchParams.get('redirect') || '/';
    return raw.startsWith('/') ? raw : '/';
  }, [searchParams]);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (checkAuth()) {
      navigate(redirectTarget, { replace: true });
    }
  }, [navigate, redirectTarget]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setErrorMsg(null);
    setIsSubmitting(true);

    const success = await login(email.trim(), password);
    if (success) {
      navigate(redirectTarget, { replace: true });
      return;
    }

    setErrorMsg('Email or password is incorrect. Please try again.');
    setIsSubmitting(false);
  };

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_#dcefff,_#f7f9fc_42%,_#eceef2_100%)] text-[#13181f]">
      <div className="max-w-[760px] mx-auto px-4 md:px-6 py-10 md:py-16">
        <section className="rounded-[32px] border border-[#d8dde6] bg-white shadow-[0_20px_70px_rgba(15,28,45,0.15)] overflow-hidden">
          <div className="px-6 py-6 md:px-10 md:py-8 bg-[linear-gradient(120deg,#0e2339,#183959_45%,#245987)] text-white">
            <div className="inline-flex items-center gap-2 rounded-full bg-white/12 border border-white/20 px-3 py-1 text-xs tracking-[0.08em] uppercase">
              <LockKeyhole className="w-4 h-4" />
              SachiHouse Admin
            </div>
            <h1 className="mt-4 font-['Plus_Jakarta_Sans'] text-[28px] md:text-[34px] font-bold leading-[1.2]">
              Welcome back
            </h1>
            <p className="mt-2 text-white/85 text-[15px] md:text-base">
              Sign in to continue managing properties, content, and bookings.
            </p>
          </div>

          <div className="px-6 py-7 md:px-10 md:py-10">
            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <label className="block text-sm font-semibold text-[#1a1f26] mb-2">Email</label>
                <input
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  className="w-full rounded-xl border border-[#c2cad8] bg-white px-4 py-3 text-[15px] focus:outline-none focus:border-[#12385d] focus:ring-2 focus:ring-[#1f5f96]/20"
                  placeholder="you@sachihouse.com"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-[#1a1f26] mb-2">Password</label>
                <input
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  className="w-full rounded-xl border border-[#c2cad8] bg-white px-4 py-3 text-[15px] focus:outline-none focus:border-[#12385d] focus:ring-2 focus:ring-[#1f5f96]/20"
                  placeholder="Your password"
                />
              </div>

              {errorMsg && (
                <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-red-700 text-sm flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 mt-0.5" />
                  <span>{errorMsg}</span>
                </div>
              )}

              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-[#12385d] text-white font-semibold px-4 py-3 hover:bg-[#0f304f] disabled:opacity-60 transition-colors"
              >
                {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogIn className="w-4 h-4" />}
                Sign in
              </button>
            </form>

            <div className="mt-6 pt-5 border-t border-[#eceff3] flex flex-col gap-3 md:flex-row md:items-center md:justify-between text-sm">
              <div className="inline-flex items-center gap-2 text-[#5a6270]">
                <CheckCircle2 className="w-4 h-4 text-[#1d6a44]" />
                Session is protected with token-based authentication.
              </div>
              <Link to="/" className="text-[#0c4f7e] hover:underline font-semibold">
                Back to listings
              </Link>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
};

export default LoginPage;
