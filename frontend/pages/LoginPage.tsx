import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { AlertCircle, Loader2, LogIn, ShieldCheck } from 'lucide-react';
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
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,_#dff2ff,_#fbf9fa_40%,_#f4f4f5_100%)] text-[#1b1c1d]">
      <div className="max-w-[1180px] mx-auto px-4 md:px-8 py-10 md:py-16">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 md:gap-10 items-stretch">
          <section className="rounded-3xl bg-[#041627] text-white p-8 md:p-10 shadow-[0_20px_60px_rgba(4,22,39,0.28)] flex flex-col justify-between overflow-hidden relative">
            <div className="absolute -top-24 -right-24 w-56 h-56 rounded-full bg-[#2d6b9f]/40 blur-2xl" />
            <div className="absolute -bottom-20 -left-12 w-56 h-56 rounded-full bg-[#75b5e8]/20 blur-2xl" />

            <div className="relative z-10">
              <div className="inline-flex items-center gap-2 rounded-full border border-white/30 px-3 py-1 text-[12px] tracking-[0.08em] uppercase">
                <ShieldCheck className="w-4 h-4" />
                Secure Portal
              </div>
              <h1 className="mt-5 font-['Plus_Jakarta_Sans'] text-[30px] md:text-[40px] leading-[1.15] font-bold">
                Sign in to manage SachiHouse operations
              </h1>
              <p className="mt-4 text-white/80 leading-[1.7]">
                Use your admin or host account to access content management and role-based tools.
              </p>
            </div>

            <div className="relative z-10 mt-8 rounded-2xl border border-white/20 bg-white/10 p-4 text-sm">
              <div className="font-semibold mb-2">Demo Accounts</div>
              <div>admin@sachihouse.com / admin123</div>
              <div>host@sachihouse.com / host123</div>
            </div>
          </section>

          <section className="rounded-3xl bg-white border border-[#e4e2e3] shadow-[0_14px_40px_rgba(0,0,0,0.08)] p-7 md:p-10">
            <div className="mb-6">
              <h2 className="font-['Plus_Jakarta_Sans'] text-[28px] font-bold text-[#1b1c1d]">Welcome back</h2>
              <p className="text-[#5a5d62] mt-2">Enter your account credentials to continue.</p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <label className="block text-sm font-semibold text-[#1b1c1d] mb-2">Email</label>
                <input
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  className="w-full rounded-xl border border-[#c4c6cd] px-4 py-3 text-[15px] focus:outline-none focus:border-[#041627] focus:ring-2 focus:ring-[#041627]/20"
                  placeholder="you@sachihouse.com"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-[#1b1c1d] mb-2">Password</label>
                <input
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  className="w-full rounded-xl border border-[#c4c6cd] px-4 py-3 text-[15px] focus:outline-none focus:border-[#041627] focus:ring-2 focus:ring-[#041627]/20"
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
                className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-[#041627] text-white font-semibold px-4 py-3 hover:bg-[#0b2742] disabled:opacity-60 transition-colors"
              >
                {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogIn className="w-4 h-4" />}
                Sign in
              </button>
            </form>

            <div className="mt-6 pt-5 border-t border-[#efedef] text-sm text-[#5a5d62]">
              <Link to="/" className="text-[#0b4f7a] hover:underline font-semibold">
                Back to listings
              </Link>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
};

export default LoginPage;
