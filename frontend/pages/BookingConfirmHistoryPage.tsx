import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Download, Loader2, Plus, Trash2, X } from 'lucide-react';
import { TopNavBar } from '../components/TopNavBar';
import { MobileBottomNav } from '../components/MobileBottomNav';
import { Footer } from '../components/Footer';
import { BookingConfirmForm, BOOKING_CONFIRM_CREATED_KEY } from '../components/BookingConfirmForm';
import { checkAuth, getCurrentUser, subscribeToAuth } from '../services/auth';
import { getAllProperties } from '../services/storage';
import {
  deleteBookingConfirmation,
  listBookingConfirmations,
  updateBookingConfirmation,
} from '../services/bookingConfirm';
import { downloadBookingConfirmationPdf } from '../utils/bookingConfirmPdf';
import { BookingConfirmation, PropertyData } from '../types';
import { ApiUser } from '../services/api';

type PropertyItem = PropertyData & { id: string };

function formatMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency || 'JPY',
      maximumFractionDigits: (currency || 'JPY') === 'JPY' ? 0 : 2,
    }).format(amount);
  } catch {
    return `${currency} ${amount.toLocaleString('en-US')}`;
  }
}

function formatDate(iso: string): string {
  const parsed = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return iso;
  return parsed.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function csvEscape(value: string | number): string {
  const s = String(value ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const inputClass =
  'rounded-xl border border-[#c4c6cd] bg-white px-3 py-2 text-[13px] text-[#1b1c1d] outline-none focus:border-[#1b1c1d] transition-colors';

const BookingConfirmHistoryPage: React.FC = () => {
  const [authUser, setAuthUser] = useState<ApiUser | null>(getCurrentUser());
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(checkAuth());
  const [rows, setRows] = useState<BookingConfirmation[]>([]);
  const [properties, setProperties] = useState<PropertyItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [propertyId, setPropertyId] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [showForm, setShowForm] = useState(false);

  const canAccess = authUser?.role === 'ADMIN' || authUser?.role === 'HOST';

  useEffect(() => {
    let unsubscribe = () => {};
    subscribeToAuth((user) => {
      setAuthUser(user);
      setIsAuthenticated(!!user);
    }).then((unsub) => { unsubscribe = unsub; });
    return () => unsubscribe();
  }, []);

  const load = async (overrides?: { propertyId?: string; fromDate?: string; toDate?: string }) => {
    if (!canAccess) { setLoading(false); return; }
    const active = { propertyId, fromDate, toDate, ...overrides };
    setLoading(true);
    setErrorMsg(null);
    try {
      const [confirmations, allProps] = await Promise.all([
        listBookingConfirmations({
          propertyId: active.propertyId || undefined,
          fromDate: active.fromDate || undefined,
          toDate: active.toDate || undefined,
        }),
        getAllProperties({ includeArchived: true }),
      ]);
      setRows(confirmations);
      setProperties(allProps);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to load booking confirmations.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canAccess]);

  // Keep a ref to the latest load() so the cross-tab refresh listener always
  // reloads with the current filters.
  const loadRef = useRef(load);
  loadRef.current = load;

  // Refresh the list when a booking is created in another tab (mobile opens the
  // form in a new tab, so the revenue list here won't otherwise know about it).
  useEffect(() => {
    const handler = (e: StorageEvent) => {
      if (e.key === BOOKING_CONFIRM_CREATED_KEY) void loadRef.current();
    };
    window.addEventListener('storage', handler);
    return () => window.removeEventListener('storage', handler);
  }, []);

  // Desktop opens an in-page modal; mobile opens the form in a new tab so the
  // small screen gets a full page to work with.
  const handleNewBooking = () => {
    if (typeof window !== 'undefined' && window.innerWidth < 768) {
      const url = `${window.location.origin}${window.location.pathname}#/admin/booking-confirm/new`;
      window.open(url, '_blank');
    } else {
      setShowForm(true);
    }
  };

  const scopedProperties = useMemo(() => {
    if (!authUser) return [] as PropertyItem[];
    if (authUser.role === 'ADMIN') return properties;
    const assigned = new Set(authUser.assignedPropertyIds ?? []);
    return properties.filter((p) => assigned.has(p.id));
  }, [authUser, properties]);

  const propertyNameById = useMemo(
    () => new Map(properties.map((p) => [p.id, p.name || p.id])),
    [properties],
  );

  const totals = useMemo(() => {
    return rows.reduce(
      (acc, r) => {
        acc.total += r.totalAmount;
        acc.deposit += r.depositAmount;
        acc.balance += r.balanceDue;
        if (r.includeInAccounting) acc.accounted += r.totalAmount;
        return acc;
      },
      { total: 0, deposit: 0, balance: 0, accounted: 0 },
    );
  }, [rows]);

  // Reports mix currencies rarely; show the dominant currency for the summary tiles.
  const summaryCurrency = rows[0]?.currency || 'JPY';

  const handleToggleAccounting = async (row: BookingConfirmation) => {
    setBusyId(row.id);
    try {
      const updated = await updateBookingConfirmation(row.id, { includeInAccounting: !row.includeInAccounting });
      setRows((prev) => prev.map((r) => (r.id === row.id ? updated : r)));
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to update record.');
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (row: BookingConfirmation) => {
    if (!window.confirm(`Delete booking confirmation ${row.confirmationNo}? This cannot be undone.`)) return;
    setBusyId(row.id);
    try {
      await deleteBookingConfirmation(row.id);
      setRows((prev) => prev.filter((r) => r.id !== row.id));
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to delete record.');
    } finally {
      setBusyId(null);
    }
  };

  const exportCsv = () => {
    const header = [
      'confirmation_no', 'property', 'guest', 'guests', 'check_in', 'check_out',
      'currency', 'accommodation', 'cleaning', 'extra', 'discount', 'total', 'deposit', 'balance',
      'in_accounting', 'created_at',
    ];
    const lines = [header.join(',')];
    for (const r of rows) {
      lines.push([
        csvEscape(r.confirmationNo),
        csvEscape(propertyNameById.get(r.propertyId) || r.propertyName),
        csvEscape(r.guestName),
        r.numGuests,
        r.checkInDate,
        r.checkOutDate,
        r.currency,
        r.roomFee,
        r.cleaningFee,
        r.extraFee,
        r.discountAmount ?? 0,
        r.totalAmount,
        r.depositAmount,
        r.balanceDue,
        r.includeInAccounting ? 'yes' : 'no',
        new Date(r.createdAt).toISOString().slice(0, 10),
      ].map((v) => csvEscape(v as string | number)).join(','));
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `direct_booking_revenue_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-[#e8e5e6]">
        <TopNavBar />
        <div className="max-w-3xl mx-auto px-4 pt-[120px]">
          <div className="bg-white border border-[#e4e2e3] rounded-2xl p-8 text-center">Please login as host/admin to view booking confirmations.</div>
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
      <main className="flex-1 w-full max-w-none mx-auto px-4 md:px-8 xl:px-12 pt-3 md:pt-[110px] pb-24 md:pb-12">
        <div className="flex items-end justify-between gap-4 mb-4">
          <div>
            <h1 className="font-['Plus_Jakarta_Sans'] text-[20px] md:text-[28px] font-bold tracking-tight leading-none">Direct booking revenue</h1>
            <p className="hidden md:block mt-1.5 text-[13px] text-[#74777d]">Booking confirmations you have issued, and the revenue they represent.</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button type="button" onClick={exportCsv} className="hidden md:flex items-center gap-1.5 rounded-xl border border-[#c4c6cd] bg-white px-3.5 py-2 text-[13px] font-semibold hover:bg-[#f5f3f4] transition-colors">
              <Download className="h-4 w-4" /> CSV
            </button>
            <button type="button" onClick={handleNewBooking} className="flex items-center gap-1.5 rounded-xl bg-[#1b1c1d] px-3.5 py-2 text-[13px] font-semibold text-white hover:bg-[#333] transition-colors">
              <Plus className="h-4 w-4" /> New Booking
            </button>
          </div>
        </div>

        {errorMsg && <div className="mb-4 rounded-xl border border-[#f5c2c7] bg-[#fdeef0] px-4 py-3 text-[13px] text-[#ba1a1a]">{errorMsg}</div>}

        {/* Summary tiles (desktop only — mobile stays minimal) */}
        <div className="hidden md:grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
          {[
            { label: 'Confirmations', value: String(rows.length) },
            { label: 'Total revenue', value: formatMoney(totals.total, summaryCurrency) },
            { label: 'Balance due', value: formatMoney(totals.balance, summaryCurrency) },
            { label: 'In accounting', value: formatMoney(totals.accounted, summaryCurrency) },
          ].map((tile) => (
            <div key={tile.label} className="rounded-2xl border border-[#e4e2e3] bg-white px-4 py-3">
              <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[#74777d]">{tile.label}</div>
              <div className="mt-1 text-[18px] md:text-[20px] font-bold tabular-nums">{tile.value}</div>
            </div>
          ))}
        </div>

        {/* Filters (desktop only) */}
        <div className="hidden md:flex flex-wrap items-end gap-3 mb-4">
          <div>
            <label className="block text-[11px] font-semibold text-[#74777d] mb-1">Property</label>
            <select className={inputClass} value={propertyId} onChange={(e) => setPropertyId(e.target.value)}>
              <option value="">All properties</option>
              {scopedProperties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-[#74777d] mb-1">Check-in from</label>
            <input type="date" className={inputClass} value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-[#74777d] mb-1">Check-in to</label>
            <input type="date" className={inputClass} value={toDate} onChange={(e) => setToDate(e.target.value)} />
          </div>
          <button type="button" onClick={() => void load()} className="rounded-xl bg-[#1b1c1d] px-4 py-2 text-[13px] font-semibold text-white hover:bg-[#333] transition-colors">Apply</button>
          {(propertyId || fromDate || toDate) && (
            <button
              type="button"
              onClick={() => { setPropertyId(''); setFromDate(''); setToDate(''); void load({ propertyId: '', fromDate: '', toDate: '' }); }}
              className="rounded-xl border border-[#c4c6cd] bg-white px-4 py-2 text-[13px] font-semibold hover:bg-[#f5f3f4] transition-colors"
            >
              Clear
            </button>
          )}
        </div>

        {/* Table (desktop) */}
        <div className="hidden md:block rounded-2xl border border-[#e4e2e3] bg-white overflow-hidden">
          <div className="overflow-x-auto">
            {loading ? (
              <div className="flex items-center justify-center gap-2 py-16 text-[13px] text-[#74777d]"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
            ) : rows.length === 0 ? (
              <div className="py-16 text-center text-[13px] text-[#74777d]">No booking confirmations yet.</div>
            ) : (
              <table className="w-full text-[12.5px] whitespace-nowrap">
                <thead>
                  <tr className="border-b border-[#e4e2e3] text-left text-[11px] uppercase tracking-[0.05em] text-[#74777d]">
                    <th className="px-3 py-2.5 font-semibold">Confirmation</th>
                    <th className="px-3 py-2.5 font-semibold">Property</th>
                    <th className="px-3 py-2.5 font-semibold">Guest</th>
                    <th className="px-3 py-2.5 font-semibold text-center">Pax</th>
                    <th className="px-3 py-2.5 font-semibold">Check-in</th>
                    <th className="px-3 py-2.5 font-semibold">Check-out</th>
                    <th className="px-3 py-2.5 font-semibold text-right">Total</th>
                    <th className="px-3 py-2.5 font-semibold text-right">Deposit</th>
                    <th className="px-3 py-2.5 font-semibold text-right">Balance</th>
                    <th className="px-3 py-2.5 font-semibold text-center">Acct.</th>
                    <th className="px-3 py-2.5 font-semibold text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className="border-b border-[#f0eef0] hover:bg-[#faf9fa]">
                      <td className="px-3 py-2.5 font-semibold">{r.confirmationNo}</td>
                      <td className="px-3 py-2.5">{propertyNameById.get(r.propertyId) || r.propertyName}</td>
                      <td className="px-3 py-2.5">{r.guestName}</td>
                      <td className="px-3 py-2.5 text-center tabular-nums">{r.numGuests}</td>
                      <td className="px-3 py-2.5">{formatDate(r.checkInDate)}</td>
                      <td className="px-3 py-2.5">{formatDate(r.checkOutDate)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums font-semibold">{formatMoney(r.totalAmount, r.currency)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{formatMoney(r.depositAmount, r.currency)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{formatMoney(r.balanceDue, r.currency)}</td>
                      <td className="px-3 py-2.5 text-center">
                        <input
                          type="checkbox"
                          checked={r.includeInAccounting}
                          disabled={busyId === r.id}
                          onChange={() => void handleToggleAccounting(r)}
                          className="h-4 w-4 accent-[#1b1c1d] cursor-pointer"
                          title="Include this revenue in accounting reports"
                        />
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            type="button"
                            onClick={() => void downloadBookingConfirmationPdf(r)}
                            className="rounded-lg p-1.5 text-[#44474c] hover:bg-[#efedef] hover:text-[#1b1c1d] transition-colors"
                            title="Download PDF"
                          >
                            <Download className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleDelete(r)}
                            disabled={busyId === r.id}
                            className="rounded-lg p-1.5 text-[#ba1a1a] hover:bg-[#fdeef0] transition-colors disabled:opacity-50"
                            title="Delete"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* Card list (mobile) — compact, no horizontal scroll */}
        <div className="md:hidden space-y-3">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-16 text-[13px] text-[#74777d] bg-white rounded-2xl border border-[#e4e2e3]"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
          ) : rows.length === 0 ? (
            <div className="py-16 text-center text-[13px] text-[#74777d] bg-white rounded-2xl border border-[#e4e2e3]">No booking confirmations yet.</div>
          ) : (
            rows.map((r) => (
              <div key={r.id} className="rounded-2xl border border-[#e4e2e3] bg-white p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-semibold text-[15px] truncate">{r.guestName}</div>
                    <div className="text-[12px] text-[#74777d] truncate">{propertyNameById.get(r.propertyId) || r.propertyName}</div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="font-bold text-[15px] tabular-nums">{formatMoney(r.totalAmount, r.currency)}</div>
                    <div className="text-[11px] text-[#9a9ca0]">{r.confirmationNo}</div>
                  </div>
                </div>
                <div className="mt-2.5 flex items-center justify-between text-[12px] text-[#44474c]">
                  <span>{formatDate(r.checkInDate)} → {formatDate(r.checkOutDate)}</span>
                  <span className="text-[#74777d]">{r.numGuests} pax</span>
                </div>
                <div className="mt-1 flex items-center justify-between text-[12px]">
                  <span className="text-[#74777d]">Deposit {formatMoney(r.depositAmount, r.currency)}</span>
                  <span className="font-semibold">Balance {formatMoney(r.balanceDue, r.currency)}</span>
                </div>
                <div className="mt-3 flex items-center justify-between border-t border-[#f0eef0] pt-2.5">
                  <label className="flex items-center gap-2 text-[12px] text-[#44474c]">
                    <input
                      type="checkbox"
                      checked={r.includeInAccounting}
                      disabled={busyId === r.id}
                      onChange={() => void handleToggleAccounting(r)}
                      className="h-4 w-4 accent-[#1b1c1d]"
                    />
                    In accounting
                  </label>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => void downloadBookingConfirmationPdf(r)}
                      className="rounded-lg p-2 text-[#44474c] hover:bg-[#efedef] transition-colors"
                      title="Download PDF"
                    >
                      <Download className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleDelete(r)}
                      disabled={busyId === r.id}
                      className="rounded-lg p-2 text-[#ba1a1a] hover:bg-[#fdeef0] transition-colors disabled:opacity-50"
                      title="Delete"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </main>

      {/* Desktop "New Booking" modal */}
      {showForm && (
        <div
          className="fixed inset-0 z-[80] flex items-start justify-center overflow-y-auto bg-black/40 backdrop-blur-[2px] p-4 md:p-8"
          onClick={() => setShowForm(false)}
        >
          <div className="relative w-full max-w-[960px] my-2" onClick={(e) => e.stopPropagation()}>
            <div className="rounded-2xl bg-[#e8e5e6] border border-[#d8d5d7] shadow-2xl overflow-hidden">
              <div className="flex items-center justify-between px-5 py-4 border-b border-[#d8d5d7] bg-white/60">
                <h2 className="text-[16px] font-bold">New booking</h2>
                <button
                  type="button"
                  onClick={() => setShowForm(false)}
                  aria-label="Close"
                  className="rounded-lg p-1.5 text-[#74777d] hover:bg-black/5 transition-colors"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
              <div className="p-5">
                <BookingConfirmForm
                  authUser={authUser}
                  onCreated={() => void load()}
                  onDone={() => setShowForm(false)}
                  doneLabel="Done"
                />
              </div>
            </div>
          </div>
        </div>
      )}

      <MobileBottomNav />
      <Footer />
    </div>
  );
};

export default BookingConfirmHistoryPage;
