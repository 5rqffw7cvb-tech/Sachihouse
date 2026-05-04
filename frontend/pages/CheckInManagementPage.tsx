import React, { useEffect, useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { TopNavBar } from '../components/TopNavBar';
import { MobileBottomNav } from '../components/MobileBottomNav';
import { checkAuth, getCurrentUser, subscribeToAuth } from '../services/auth';
import { listCheckIns } from '../services/checkin';
import { getAllProperties } from '../services/storage';
import { CheckInSubmission, PropertyData } from '../types';
import { ApiUser } from '../services/api';

function formatAuditDate(value?: number): string {
  if (!value) {
    return 'Unknown';
  }
  return new Date(value).toLocaleString();
}

function maskIpAddress(value?: string): string {
  if (!value) {
    return 'Unknown';
  }
  if (value.includes(':')) {
    const parts = value.split(':').filter(Boolean);
    return `${parts.slice(0, 2).join(':')}:****`;
  }
  const parts = value.split('.');
  if (parts.length === 4) {
    return `${parts[0]}.${parts[1]}.*.*`;
  }
  return value;
}

const CheckInManagementPage: React.FC = () => {
  const [authUser, setAuthUser] = useState<ApiUser | null>(getCurrentUser());
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(checkAuth());
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [submissions, setSubmissions] = useState<CheckInSubmission[]>([]);
  const [properties, setProperties] = useState<(PropertyData & { id: string })[]>([]);
  const [propertyId, setPropertyId] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [guestName, setGuestName] = useState('');
  const [nationality, setNationality] = useState('');

  const canAccess = authUser?.role === 'ADMIN' || authUser?.role === 'HOST';

  useEffect(() => {
    let unsubscribe = () => {};
    subscribeToAuth((user) => {
      setAuthUser(user);
      setIsAuthenticated(!!user);
    }).then((unsub) => {
      unsubscribe = unsub;
    });
    return () => unsubscribe();
  }, []);

  const loadData = async () => {
    if (!canAccess) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setErrorMsg(null);
    try {
      const [rows, allProperties] = await Promise.all([
        listCheckIns({
          propertyId: propertyId || undefined,
          fromDate: fromDate || undefined,
          toDate: toDate || undefined,
          guestName: guestName || undefined,
          nationality: nationality || undefined,
        }),
        getAllProperties({ includeArchived: true }),
      ]);
      setSubmissions(rows);
      setProperties(allProperties);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load check-ins.';
      setErrorMsg(message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, [canAccess]);

  const scopedProperties = useMemo(() => {
    if (!authUser) {
      return [] as (PropertyData & { id: string })[];
    }
    if (authUser.role === 'ADMIN') {
      return properties;
    }
    const assigned = new Set(authUser.assignedPropertyIds ?? []);
    return properties.filter((property) => assigned.has(property.id));
  }, [authUser, properties]);

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-[#fbf9fa]">
        <TopNavBar />
        <div className="max-w-3xl mx-auto px-4 pt-[120px]">
          <div className="bg-white border border-[#e4e2e3] rounded-2xl p-8 text-center">Please login as host/admin to access check-in management.</div>
        </div>
      </div>
    );
  }

  if (!canAccess) {
    return (
      <div className="min-h-screen bg-[#fbf9fa]">
        <TopNavBar />
        <div className="max-w-3xl mx-auto px-4 pt-[120px]">
          <div className="bg-white border border-[#e4e2e3] rounded-2xl p-8 text-center">Host or admin role required.</div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#fbf9fa] text-[#1b1c1d]">
      <TopNavBar />
      <main className="max-w-[1280px] mx-auto px-4 pt-[110px] pb-24 md:pb-10">
        <section className="mb-4 bg-white border border-[#e4e2e3] rounded-2xl p-4 md:p-5">
          <h1 className="font-['Plus_Jakarta_Sans'] text-2xl font-bold mb-4">Check-in Management</h1>
          <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
            <select value={propertyId} onChange={(event) => setPropertyId(event.target.value)} className="border border-[#c4c6cd] rounded-lg px-3 py-2">
              <option value="">All properties</option>
              {scopedProperties.map((property) => (
                <option key={property.id} value={property.id}>{property.name || property.id}</option>
              ))}
            </select>
            <input value={fromDate} onChange={(event) => setFromDate(event.target.value)} type="date" className="border border-[#c4c6cd] rounded-lg px-3 py-2" />
            <input value={toDate} onChange={(event) => setToDate(event.target.value)} type="date" className="border border-[#c4c6cd] rounded-lg px-3 py-2" />
            <input value={guestName} onChange={(event) => setGuestName(event.target.value)} placeholder="Guest name" className="border border-[#c4c6cd] rounded-lg px-3 py-2" />
            <input value={nationality} onChange={(event) => setNationality(event.target.value)} placeholder="Nationality" className="border border-[#c4c6cd] rounded-lg px-3 py-2" />
          </div>
          <button onClick={() => void loadData()} className="mt-3 px-4 py-2 rounded-full bg-[#041627] text-white font-semibold">Apply filters</button>
        </section>

        {errorMsg && <div className="mb-4 text-sm text-red-700">{errorMsg}</div>}

        <section className="bg-white border border-[#e4e2e3] rounded-2xl overflow-hidden">
          {loading ? (
            <div className="p-10 text-[#44474c] inline-flex items-center gap-2"><Loader2 className="w-5 h-5 animate-spin" /> Loading...</div>
          ) : submissions.length === 0 ? (
            <div className="p-10 text-[#44474c]">No check-ins found.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-[#f5f3f4] text-[#44474c]">
                  <tr>
                    <th className="text-left px-4 py-3 font-semibold">Check-in</th>
                    <th className="text-left px-4 py-3 font-semibold">Property</th>
                    <th className="text-left px-4 py-3 font-semibold">Guests</th>
                    <th className="text-left px-4 py-3 font-semibold">Consent</th>
                    <th className="text-left px-4 py-3 font-semibold">Evidence</th>
                  </tr>
                </thead>
                <tbody>
                  {submissions.map((submission) => (
                    <tr key={submission.id} className="border-t border-[#efedef] align-top">
                      <td className="px-4 py-4">
                        <div className="font-semibold">{submission.id}</div>
                        <div className="text-xs text-[#74777d]">{submission.checkInDate} {'->'} {submission.checkOutDate}</div>
                      </td>
                      <td className="px-4 py-4">{submission.propertyId}</td>
                      <td className="px-4 py-4">
                        {submission.guests.map((guest) => (
                          <div key={guest.id} className="mb-2">
                            <div className="font-medium">{guest.fullName}</div>
                            <div className="text-xs text-[#74777d]">{guest.nationality || 'UNKNOWN'} / {guest.documentType}</div>
                          </div>
                        ))}
                      </td>
                      <td className="px-4 py-4 text-xs text-[#44474c]">
                        <div>{submission.consent?.accepted ? 'Accepted' : 'Missing'}</div>
                        <div className="mt-1 text-[#74777d]">{formatAuditDate(submission.consent?.acceptedAt)}</div>
                        <div className="mt-1 text-[#74777d]">Retention: {submission.consent?.retentionDays ?? 'Unknown'} days</div>
                        <div className="mt-1 text-[#74777d]">IP: {maskIpAddress(submission.audit?.ipAddress)}</div>
                      </td>
                      <td className="px-4 py-4">
                        {submission.guests.map((guest) => (
                          <div key={guest.id} className="mb-2">
                            {guest.evidenceUrl ? (
                              <a href={guest.evidenceUrl} target="_blank" rel="noreferrer" className="text-[#003580] underline">View evidence</a>
                            ) : (
                              <span className="text-[#74777d]">No image</span>
                            )}
                          </div>
                        ))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>
      <MobileBottomNav />
    </div>
  );
};

export default CheckInManagementPage;
