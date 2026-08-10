import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { AdminShell } from '../components/AdminShell';
import { BookingConfirmForm, signalBookingConfirmCreated } from '../components/BookingConfirmForm';
import { getCurrentUser, subscribeToAuth } from '../services/auth';
import { ApiUser } from '../services/api';

const BookingConfirmPage: React.FC = () => {
  const navigate = useNavigate();
  const [authUser, setAuthUser] = useState<ApiUser | null>(getCurrentUser());

  useEffect(() => {
    let unsubscribe = () => {};
    subscribeToAuth((user) => setAuthUser(user)).then((unsub) => { unsubscribe = unsub; });
    return () => unsubscribe();
  }, []);

  const goToRevenue = () => navigate('/admin/booking-confirm');

  return (
    <AdminShell
      title="New booking"
      subtitle="Generate a PDF confirmation for a direct booking and send it to your guest."
      access="host"
      activeKey="bookingConfirm"
      maxWidthClass="max-w-[960px]"
      signInMessage="Please login as host/admin to create booking confirmations."
      deniedTitle="Host or admin role required"
      deniedMessage="Your current account does not have permission to create booking confirmations."
      actions={(
        <button
          type="button"
          onClick={goToRevenue}
          className="shrink-0 flex items-center gap-1.5 rounded-control border border-line-strong bg-surface px-3 py-2 text-[13px] font-semibold hover:bg-subtle transition-colors"
        >
          <ArrowLeft className="h-4 w-4" /> Revenue
        </button>
      )}
    >
        <BookingConfirmForm
          authUser={authUser}
          onCreated={signalBookingConfirmCreated}
          onDone={goToRevenue}
          doneLabel="View revenue"
        />
    </AdminShell>
  );
};

export default BookingConfirmPage;
