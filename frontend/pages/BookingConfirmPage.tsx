import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { TopNavBar } from '../components/TopNavBar';
import { MobileBottomNav } from '../components/MobileBottomNav';
import { Footer } from '../components/Footer';
import { BookingConfirmForm, signalBookingConfirmCreated } from '../components/BookingConfirmForm';
import { checkAuth, getCurrentUser, subscribeToAuth } from '../services/auth';
import { ApiUser } from '../services/api';

const BookingConfirmPage: React.FC = () => {
  const navigate = useNavigate();
  const [authUser, setAuthUser] = useState<ApiUser | null>(getCurrentUser());
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(checkAuth());

  useEffect(() => {
    let unsubscribe = () => {};
    subscribeToAuth((user) => {
      setAuthUser(user);
      setIsAuthenticated(!!user);
    }).then((unsub) => { unsubscribe = unsub; });
    return () => unsubscribe();
  }, []);

  const canAccess = authUser?.role === 'ADMIN' || authUser?.role === 'HOST';

  const goToRevenue = () => navigate('/admin/booking-confirm');

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-[#e8e5e6]">
        <TopNavBar />
        <div className="max-w-3xl mx-auto px-4 pt-[120px]">
          <div className="bg-white border border-[#e4e2e3] rounded-2xl p-8 text-center">Please login as host/admin to create booking confirmations.</div>
        </div>
      </div>
    );
  }

  if (!canAccess) {
    return (
      <div className="min-h-screen bg-[#e8e5e6]">
        <TopNavBar />
        <div className="max-w-3xl mx-auto px-4 pt-[120px]">
          <div className="bg-white border border-[#e4e2e3] rounded-2xl p-8 text-center">Host or admin role required.</div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#e8e5e6] text-[#1b1c1d] flex flex-col">
      <TopNavBar />
      <main className="flex-1 w-full max-w-[960px] mx-auto px-4 md:px-6 pt-3 md:pt-[110px] pb-24 md:pb-12">
        <div className="flex items-center gap-3 mb-4">
          <button
            type="button"
            onClick={goToRevenue}
            className="shrink-0 flex items-center gap-1.5 rounded-xl border border-[#c4c6cd] bg-white px-3 py-2 text-[13px] font-semibold hover:bg-[#f5f3f4] transition-colors"
          >
            <ArrowLeft className="h-4 w-4" /> Revenue
          </button>
          <div>
            <h1 className="font-['Plus_Jakarta_Sans'] text-[20px] md:text-[28px] font-bold tracking-tight leading-none">New booking</h1>
            <p className="hidden md:block mt-1 text-[13px] text-[#74777d]">Generate a PDF confirmation for a direct booking and send it to your guest.</p>
          </div>
        </div>

        <BookingConfirmForm
          authUser={authUser}
          onCreated={signalBookingConfirmCreated}
          onDone={goToRevenue}
          doneLabel="View revenue"
        />
      </main>
      <MobileBottomNav />
      <Footer />
    </div>
  );
};

export default BookingConfirmPage;
