import React, { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { PricingConfig } from '../types';
import { calculateHomestayPrice } from '../utils/pricing';
import { useLanguage } from '../contexts/LanguageContext';

interface StayPriceSummaryProps {
  pricing: PricingConfig;
  nights: number;
  adults: number;
  children: number;
  infants: number;
}

/**
 * What this property costs for the party and dates the guest searched with,
 * with the same lines the booking widget shows so the number does not change
 * meaning between the listing card and the booking page.
 *
 * Renders nothing when the party does not fit the property's rate tiers — the
 * card should not advertise a price for a stay that cannot be sold.
 */
const StayPriceSummary: React.FC<StayPriceSummaryProps> = ({ pricing, nights, adults, children, infants }) => {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);

  const price = calculateHomestayPrice(adults, children, infants, nights, pricing);
  if (!price.isValid || nights <= 0) {
    return null;
  }

  const { breakdown } = price;
  const longStaySaving = breakdown.subtotal - breakdown.discountedSubtotal;

  return (
    <div className="mt-3 rounded-card border border-line bg-subtle/60">
      <button
        type="button"
        onClick={(event) => {
          // The whole card is a link to the property; opening the breakdown
          // must not navigate away from the results.
          event.preventDefault();
          event.stopPropagation();
          setOpen((value) => !value);
        }}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left"
      >
        <span className="min-w-0">
          <span className="block text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-muted">
            {t('listing_total_for_nights').replace('{nights}', String(nights))}
          </span>
          <span className="text-[17px] font-bold text-brand">¥{price.total.toLocaleString()}</span>
        </span>
        <span className="flex shrink-0 items-center gap-1 text-[12px] font-semibold text-ink-muted">
          {t('sim_breakdown_toggle')}
          {open ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        </span>
      </button>

      {open && (
        <div className="space-y-1.5 border-t border-line px-3 pb-3 pt-2.5 text-[12.5px] text-ink-soft">
          <div className="flex justify-between gap-3">
            <span>{t('sim_adults')} × {adults} × {nights}</span>
            <span>¥{breakdown.adultTotal.toLocaleString()}</span>
          </div>
          {children > 0 && (
            <div className="flex justify-between gap-3 text-link">
              <span>{t('sim_children')} ({pricing.childDiscountPercent}% off)</span>
              <span>¥{breakdown.childTotal.toLocaleString()}</span>
            </div>
          )}
          {infants > 0 && (
            <div className="flex justify-between gap-3 text-ok">
              <span>{t('sim_infant_free')}</span>
              <span>¥0</span>
            </div>
          )}
          <div className="flex justify-between gap-3">
            <span>{t('sim_cleaning')}</span>
            <span>¥{breakdown.cleaningFee.toLocaleString()}</span>
          </div>
          {breakdown.discountRate < 1 && (
            <div className="flex justify-between gap-3 font-semibold text-ok">
              <span>{t('sim_long_stay')} ({pricing.longStayDiscountPercent}%)</span>
              <span>-¥{Math.round(longStaySaving).toLocaleString()}</span>
            </div>
          )}
          <div className="flex justify-between gap-3 border-t border-line pt-2 text-[14px] font-bold text-ink">
            <span>{t('sim_total_est')}</span>
            <span>¥{price.total.toLocaleString()}</span>
          </div>
        </div>
      )}
    </div>
  );
};

export default StayPriceSummary;
