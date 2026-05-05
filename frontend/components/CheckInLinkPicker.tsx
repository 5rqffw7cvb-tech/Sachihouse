import React, { useEffect, useRef, useState } from 'react';
import { Check, ClipboardList, Link2, Loader2 } from 'lucide-react';
import { ApiUser } from '../services/api';
import { getAllProperties } from '../services/storage';
import { PropertyData } from '../types';

interface Props {
  /** current logged-in user — only renders when ADMIN or HOST */
  authUser: ApiUser | null;
  /** 'down' for desktop navbar, 'up' for mobile bottom nav */
  direction?: 'down' | 'up';
}

type PropertyItem = PropertyData & { id: string };

const buildCheckinUrl = (propertyId: string) =>
  `${window.location.origin}${window.location.pathname}#/${propertyId}/checkin`;

export const CheckInLinkPicker: React.FC<Props> = ({ authUser, direction = 'down' }) => {
  const [open, setOpen] = useState(false);
  const [properties, setProperties] = useState<PropertyItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const canSee = authUser?.role === 'ADMIN' || authUser?.role === 'HOST';

  // close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // load properties when panel opens
  useEffect(() => {
    if (!open || properties.length > 0) return;
    setLoading(true);
    getAllProperties({ includeArchived: false })
      .then((all) => {
        let filtered: PropertyItem[];
        if (authUser?.role === 'ADMIN') {
          filtered = all;
        } else {
          const assigned = authUser?.assignedPropertyIds ?? [];
          filtered = all.filter((p) => assigned.includes(p.id));
        }
        setProperties(filtered);
      })
      .finally(() => setLoading(false));
  }, [open, authUser, properties.length]);

  const handleCopy = async (propertyId: string) => {
    const url = buildCheckinUrl(propertyId);
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // fallback for browsers without clipboard API
      const textarea = document.createElement('textarea');
      textarea.value = url;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
    }
    setCopiedId(propertyId);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setCopiedId(null), 2000);
  };

  if (!canSee) return null;

  const panelClass =
    direction === 'up'
      ? 'bottom-full mb-2 right-0'
      : 'top-full mt-2 right-0';

  return (
    <div className="relative" ref={containerRef}>
      {/* Trigger */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`${direction === 'up'
          ? 'flex flex-col items-center justify-center rounded-lg px-4 py-1 text-[10px] font-medium gap-0'
          : 'flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium'
        } transition-colors ${
          open
            ? 'bg-gray-900 text-white'
            : 'text-[#44474c] hover:bg-[#efedef] hover:text-[#1b1c1d]'
        }`}
        aria-expanded={open}
        aria-label="Check-in links"
      >
        <ClipboardList className={`shrink-0 ${direction === 'up' ? 'h-4 w-4 mb-0.5' : 'h-4 w-4'}`} />
        <span>{direction === 'up' ? 'Check-in' : <span className="hidden sm:inline">Check-in</span>}</span>
      </button>


      {/* Dropdown panel */}
      {open && (
        <div
          className={`absolute ${panelClass} z-[60] w-80 overflow-hidden rounded-2xl border border-[#e4e2e3] bg-white shadow-xl`}
        >
          {/* Header */}
          <div className="flex items-center gap-2 border-b border-[#e4e2e3] px-4 py-3 bg-gray-50">
            <Link2 className="h-4 w-4 shrink-0 text-gray-400" />
            <div>
              <p className="text-xs font-bold uppercase tracking-widest text-gray-500">Guest check-in links</p>
              <p className="text-[11px] text-gray-400">Tap copy → send link to guest</p>
            </div>
          </div>

          {/* Body */}
          <div className="max-h-72 overflow-y-auto py-1">
            {loading && (
              <div className="flex items-center justify-center gap-2 py-8 text-sm text-gray-400">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading…
              </div>
            )}

            {!loading && properties.length === 0 && (
              <div className="flex flex-col items-center gap-1 py-8 text-center">
                <ClipboardList className="h-8 w-8 text-gray-200" />
                <p className="text-sm font-medium text-gray-400">No properties assigned</p>
              </div>
            )}

            {!loading &&
              properties.map((property) => {
                const isCopied = copiedId === property.id;
                const url = buildCheckinUrl(property.id);
                return (
                  <div
                    key={property.id}
                    className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors"
                  >
                    {/* Property info */}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-gray-900">{property.name}</p>
                      <p className="truncate text-[11px] text-gray-400">{url}</p>
                    </div>

                    {/* Copy button */}
                    <button
                      type="button"
                      onClick={() => void handleCopy(property.id)}
                      className={`shrink-0 flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-bold transition-all duration-200 ${
                        isCopied
                          ? 'bg-green-100 text-green-700'
                          : 'bg-gray-900 text-white hover:bg-gray-700 active:scale-95'
                      }`}
                      aria-label={isCopied ? 'Copied!' : 'Copy link'}
                    >
                      {isCopied ? (
                        <>
                          <Check className="h-3.5 w-3.5" /> Copied!
                        </>
                      ) : (
                        <>
                          <Link2 className="h-3.5 w-3.5" /> Copy
                        </>
                      )}
                    </button>
                  </div>
                );
              })}
          </div>
        </div>
      )}
    </div>
  );
};
