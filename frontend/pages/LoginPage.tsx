import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { AlertCircle, Loader2 } from 'lucide-react';
import { checkAuth, login } from '../services/auth';
import { GlobalLayout } from '../components/GlobalLayout';

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
    <GlobalLayout>
      <div className="flex items-center justify-center min-h-[60vh] px-4">
        <div className="w-full max-w-sm">
          <h1 className="font-['Plus_Jakarta_Sans'] text-[26px] font-bold text-[#1b1c1d] mb-1">Sign in</h1>
          <p className="text-[14px] text-[#74777d] mb-8">Staff and host access only.</p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-[13px] font-semibold text-[#1b1c1d] mb-1.5">Email</label>
              <input
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-lg border border-[#c4c6cd] bg-white px-4 py-2.5 text-[14px] text-[#1b1c1d] placeholder:text-[#9ea3ab] focus:outline-none focus:border-[#1b1c1d] focus:ring-1 focus:ring-[#1b1c1d] transition-colors"
                placeholder="you@example.com"
              />
            </div>

            <div>
              <label className="block text-[13px] font-semibold text-[#1b1c1d] mb-1.5">Password</label>
              <input
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-lg border border-[#c4c6cd] bg-white px-4 py-2.5 text-[14px] text-[#1b1c1d] placeholder:text-[#9ea3ab] focus:outline-none focus:border-[#1b1c1d] focus:ring-1 focus:ring-[#1b1c1d] transition-colors"
                placeholder="••••••••"
              />
            </div>

            {errorMsg && (
              <div className="flex items-start gap-2 text-red-600 text-[13px]">
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                <span>{errorMsg}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={isSubmitting}
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
