import React, { useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Home, RotateCcw } from 'lucide-react';
import { useLanguage } from '../contexts/LanguageContext';
import { abandonBooking } from '../services/booking';

// Where Stripe sends a guest who backed out of the payment page. Nothing was
// charged. The hold would lapse on its own anyway, but landing here is proof
// the guest is done, so it is released right away instead of making the
// nights wait out the rest of the hold window.
const BookingCancelledPage: React.FC = () => {
  const { t } = useLanguage();
  const [searchParams] = useSearchParams();

  useEffect(() => {
    const bookingId = searchParams.get('id');
    if (!bookingId) {
      return;
    }
    const token = window.localStorage.getItem(`booking_token_${bookingId}`);
    if (!token) {
      return;
    }
    abandonBooking(bookingId, token).catch(() => {
      // Nothing actionable for the guest — the hold's own expiry still covers this.
    });
  }, [searchParams]);

  return (
    <div className="min-h-screen bg-[#e8e5e6] py-10 px-4">
      <div className="max-w-xl mx-auto bg-white rounded-2xl shadow-xl border border-gray-100 p-10 text-center">
        <div className="flex justify-center mb-5">
          <RotateCcw className="w-10 h-10 text-gray-400" />
        </div>
        <h1 className="text-2xl font-bold text-gray-900 mb-3">{t('abandoned_title')}</h1>
        <p className="text-gray-600 text-sm leading-relaxed mb-8">{t('abandoned_body')}</p>
        <Link
          to="/"
          className="inline-flex items-center gap-2 bg-[var(--color-primary-600)] text-white font-bold px-6 py-3 rounded-xl hover:opacity-90 transition-opacity"
        >
          <Home className="w-4 h-4" /> {t('result_back_home')}
        </Link>
      </div>
    </div>
  );
};

export default BookingCancelledPage;
