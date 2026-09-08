import React, { useEffect, useMemo, useState } from 'react';
import { AlertCircle, Check, Loader2, Ticket, X } from 'lucide-react';
import { createCoupon, listCoupons } from '../../services/coupons';
import { HostProperty } from '../../services/hostApp';
import { normalizeCouponCode, validateCouponDraft } from '../../utils/couponDraft';
import { Coupon } from '../../types';
import {
  fieldClass,
  labelClass,
  selectClass,
  sheetBackdropClass,
  sheetPanelClass,
} from './sheetControls';

/**
 * Creating a discount code from the phone.
 *
 * Deliberately create-and-list rather than a full editor: the console's
 * AdminCouponsPage still owns editing and deleting, which are the operations
 * you do not want to fat-finger on a phone. What this sheet adds is the thing
 * that is actually time-sensitive — an admin standing in front of a guest, or
 * answering a message, who needs a code to exist right now.
 *
 * The list above the form is not decoration. Codes are unique
 * case-insensitively, so without it the only way to discover SUMMER10 is taken
 * is to fill the form in and have the API refuse it.
 */

const toIsoDate = (date: Date): string => date.toISOString().slice(0, 10);

const DAY_MS = 24 * 60 * 60 * 1000;

interface CouponSheetProps {
  /** The admin's properties, already loaded by HostShell. A coupon applies to
   *  the ones picked here and to no others. */
  properties: HostProperty[];
  onClose: () => void;
}

export const CouponSheet: React.FC<CouponSheetProps> = ({ properties, onClose }) => {
  const [existing, setExisting] = useState<Coupon[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [code, setCode] = useState('');
  const [type, setType] = useState<Coupon['type']>('percentage');
  const [value, setValue] = useState('10');
  const [startDate, setStartDate] = useState(() => toIsoDate(new Date()));
  const [endDate, setEndDate] = useState(() => toIsoDate(new Date(Date.now() + 7 * DAY_MS)));
  const [propertyIds, setPropertyIds] = useState<string[]>([]);

  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [created, setCreated] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listCoupons()
      .then((coupons) => {
        if (cancelled) return;
        setExisting([...coupons].sort((a, b) => b.createdAt - a.createdAt));
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setLoadError(cause instanceof Error ? cause.message : 'Could not load the existing coupons.');
        }
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const normalizedCode = normalizeCouponCode(code);
  const takenCodes = useMemo(() => existing.map((coupon) => coupon.code), [existing]);

  const toggleProperty = (id: string) => {
    setFormError(null);
    setPropertyIds((prev) => (prev.includes(id) ? prev.filter((value) => value !== id) : [...prev, id]));
  };

  const allSelected = properties.length > 0 && propertyIds.length === properties.length;

  const handleCreate = async () => {
    const problem = validateCouponDraft(
      { code, type, value, startDate, endDate, propertyIds },
      takenCodes,
    );
    if (problem) {
      setFormError(problem);
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      const coupon = await createCoupon({
        code: normalizedCode,
        type,
        value: Number(value),
        startDate,
        endDate,
        active: true,
        propertyIds,
      });
      setExisting((prev) => [coupon, ...prev]);
      setCreated(coupon.code);
      // Keep the dates and the property picks: the next code an admin writes
      // in one sitting is almost always the same campaign for another tier.
      setCode('');
      setValue(type === 'percentage' ? '10' : '');
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : 'Could not create the coupon.');
    } finally {
      setSaving(false);
    }
  };

  const describe = (coupon: Coupon): string => {
    const amount = coupon.type === 'percentage'
      ? `${coupon.value}% off`
      : `¥${coupon.value.toLocaleString('en-US')}/night`;
    return `${amount} · ${coupon.startDate.slice(5)} – ${coupon.endDate.slice(5)}`;
  };

  return (
    <div className={sheetBackdropClass} onClick={onClose} role="presentation">
      <div
        className={sheetPanelClass}
        style={{ paddingBottom: 'calc(1.5rem + env(safe-area-inset-bottom, 0px))' }}
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Coupons"
      >
        <div className="pt-2.5 sticky top-0 bg-surface z-10">
          <div className="w-10 h-1 rounded-full bg-line-strong mx-auto" />
          <div className="flex items-start gap-2 px-5 pt-3 pb-3.5 border-b border-line">
            <div className="flex-1 min-w-0 flex flex-col gap-0.5">
              <h2 className="text-[20px] tracking-[-0.3px] truncate">Coupons</h2>
              <span className="text-[13px] text-ink-muted truncate">
                クーポン · discount codes for the price simulator
              </span>
            </div>
            <button type="button" onClick={onClose} aria-label="Close" className="shrink-0 p-1 -mr-1 mt-0.5">
              <X className="w-5 h-5 text-ink-soft" />
            </button>
          </div>
        </div>

        <div className="px-5 pt-4 flex flex-col gap-4">
          {(formError || loadError) && (
            <div className="flex items-start gap-2.5 bg-danger-tint text-danger border border-danger/20
              rounded-control px-3.5 py-3 text-[13px]">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span className="flex-1 min-w-0">{formError ?? loadError}</span>
            </div>
          )}

          {created && !formError && (
            <div className="flex items-start gap-2.5 bg-ok-tint text-ok border border-ok/20
              rounded-control px-3.5 py-3 text-[13px]">
              <Check className="w-4 h-4 shrink-0 mt-0.5" />
              <span className="flex-1 min-w-0">
                {created} is live. Guests enter it in the price simulator on the property page.
              </span>
            </div>
          )}

          <label className="block">
            <span className={labelClass}>Code *</span>
            <input
              value={code}
              onChange={(event) => { setCode(event.target.value); setFormError(null); setCreated(null); }}
              className={`${fieldClass} font-mono tracking-wide uppercase`}
              placeholder="SUMMER10"
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
            />
            <span className="block mt-1.5 text-[12px] text-ink-muted leading-snug">
              Typed by hand, not generated, and stored uppercase. Guests type it exactly.
            </span>
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className={labelClass}>Discount</span>
              <select
                value={type}
                onChange={(event) => {
                  const next = event.target.value as Coupon['type'];
                  setType(next);
                  setValue(next === 'percentage' ? '10' : '');
                  setFormError(null);
                }}
                className={selectClass}
              >
                <option value="percentage">% off</option>
                <option value="fixed_night">Flat ¥/night</option>
              </select>
            </label>
            <label className="block">
              <span className={labelClass}>{type === 'percentage' ? 'Percent *' : 'Yen / night *'}</span>
              <input
                value={value}
                onChange={(event) => { setValue(event.target.value); setFormError(null); }}
                type="number"
                inputMode="numeric"
                min={type === 'percentage' ? 1 : 0}
                max={type === 'percentage' ? 100 : undefined}
                step={1}
                className={`${fieldClass} tabular-nums`}
                placeholder={type === 'percentage' ? '10' : '12000'}
              />
            </label>
          </div>
          <p className="-mt-2 text-[12px] text-ink-muted leading-snug">
            {type === 'percentage'
              ? 'Takes that much off the nightly rate at every guest-count tier.'
              : 'Replaces the nightly rate at every guest-count tier, whatever the party size.'}
          </p>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className={labelClass}>Valid from *</span>
              <input
                type="date"
                value={startDate}
                onChange={(event) => { setStartDate(event.target.value); setFormError(null); }}
                className={fieldClass}
              />
            </label>
            <label className="block">
              <span className={labelClass}>Valid to *</span>
              <input
                type="date"
                value={endDate}
                onChange={(event) => { setEndDate(event.target.value); setFormError(null); }}
                className={fieldClass}
              />
            </label>
          </div>
          <p className="-mt-2 text-[12px] text-ink-muted leading-snug">
            The whole stay has to fall inside this window. A stay that only partly overlaps is refused
            outright, not prorated — so set it wide enough to cover the check-out.
          </p>

          <div>
            <div className="flex items-baseline justify-between gap-2 mb-1.5">
              <span className={`${labelClass} mb-0`}>Properties *</span>
              {properties.length > 1 && (
                <button
                  type="button"
                  onClick={() => {
                    setFormError(null);
                    setPropertyIds(allSelected ? [] : properties.map((property) => property.id));
                  }}
                  className="text-[12px] font-semibold text-link"
                >
                  {allSelected ? 'Clear all' : 'Select all'}
                </button>
              )}
            </div>
            <div className="rounded-control border border-line bg-subtle overflow-hidden">
              {properties.length === 0 ? (
                <p className="px-3.5 py-3 text-[13px] text-ink-muted">No properties on your account.</p>
              ) : properties.map((property, index) => {
                const checked = propertyIds.includes(property.id);
                return (
                  <button
                    key={property.id}
                    type="button"
                    onClick={() => toggleProperty(property.id)}
                    aria-pressed={checked}
                    className={`w-full min-h-[52px] px-3.5 py-2.5 flex items-center gap-3 text-left
                      active:bg-brand-tint ${index === properties.length - 1 ? '' : 'border-b border-line'}`}
                  >
                    <span
                      className={`w-5 h-5 shrink-0 rounded-[6px] border flex items-center justify-center ${
                        checked ? 'bg-brand border-brand text-white' : 'bg-surface border-line-strong'
                      }`}
                    >
                      {checked && <Check className="w-3.5 h-3.5" />}
                    </span>
                    <span className="flex-1 min-w-0 text-[15px] text-ink truncate">{property.name}</span>
                  </button>
                );
              })}
            </div>
            <span className="block mt-1.5 text-[12px] text-ink-muted leading-snug">
              A code works only on the properties ticked here.
            </span>
          </div>

          <button
            type="button"
            onClick={() => { void handleCreate(); }}
            disabled={saving || loading || !normalizedCode || propertyIds.length === 0}
            className="h-13 min-h-[52px] rounded-control bg-brand text-white
              font-['Plus_Jakarta_Sans'] text-[15px] font-bold flex items-center justify-center gap-2
              disabled:opacity-50"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Ticket className="w-4 h-4" />}
            Create coupon
          </button>

          <div className="pt-1">
            <span className={labelClass}>
              Already live{!loading && existing.length > 0 ? ` · ${existing.length}` : ''}
            </span>
            <div className="rounded-control border border-line bg-subtle overflow-hidden">
              {loading ? (
                <div className="py-7 flex items-center justify-center text-ink-muted">
                  <Loader2 className="w-5 h-5 animate-spin" />
                </div>
              ) : existing.length === 0 ? (
                <p className="px-3.5 py-3 text-[13px] text-ink-muted">No coupons yet.</p>
              ) : existing.map((coupon, index) => (
                <div
                  key={coupon.id}
                  className={`px-3.5 py-2.5 flex items-center gap-3 ${
                    index === existing.length - 1 ? '' : 'border-b border-line'
                  }`}
                >
                  <span
                    className={`w-1.5 h-1.5 shrink-0 rounded-full ${coupon.active ? 'bg-ok' : 'bg-line-strong'}`}
                    aria-label={coupon.active ? 'Active' : 'Inactive'}
                  />
                  <span className="min-w-0 flex-1 flex flex-col gap-0.5">
                    <span className="text-[14px] font-mono text-ink truncate">{coupon.code}</span>
                    <span className="text-[12px] text-ink-muted truncate">{describe(coupon)}</span>
                  </span>
                  <span className="text-[12px] text-ink-muted shrink-0 tabular-nums">
                    {coupon.propertyIds.length === properties.length && properties.length > 0
                      ? 'All'
                      : `${coupon.propertyIds.length}×`}
                  </span>
                </div>
              ))}
            </div>
            <span className="block mt-1.5 text-[12px] text-ink-muted leading-snug">
              Editing and deleting stay in the console — this screen only adds.
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CouponSheet;
