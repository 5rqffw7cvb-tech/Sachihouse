
import React, { useState, useMemo, useEffect, useRef } from 'react';
import { PricingConfig, PropertyData } from '../types';
import BookingGuestForm from './BookingGuestForm';
import { PriceResult } from '../utils/pricing';
import { 
    differenceInDays, addDays, format, isBefore, eachDayOfInterval, 
    endOfMonth, getDay, isSameDay, isWithinInterval, addMonths 
} from 'date-fns';
import { Star, Minus, Plus, ChevronDown, ChevronUp, Mail, Calculator, Calendar as CalendarIcon, Users, AlertCircle, ChevronLeft, ChevronRight, X, Baby, Lock, Tag, Loader2, Check } from 'lucide-react';
import { Link } from 'react-router-dom';
import { calculateHomestayPrice } from '../utils/pricing';
import { isDateBlocked, refreshBlockedDates } from '../services/storage';
import { useLanguage } from '../contexts/LanguageContext';
import { getDateFnsLocale } from '../utils/translations';
import { AppliedCoupon, getQuote, QuoteResult } from '../services/pricing';

interface BookingWidgetProps {
  pricing: PricingConfig;
  className?: string;
  adminEmail?: string;
  // Both are required before the widget will offer online booking; without them
  // it keeps the original "email the host" behaviour.
  propertyId?: string;
  directBooking?: PropertyData['directBooking'];
}

type CalculationResult = 
  | { isValid: false; message: string }
  | (PriceResult & { nights: number; isValid: true });

// Helper functions to replace missing date-fns exports
const startOfDay = (date: Date): Date => {
  const newDate = new Date(date);
  newDate.setHours(0, 0, 0, 0);
  return newDate;
};

const startOfMonth = (date: Date): Date => {
  const newDate = new Date(date);
  newDate.setDate(1);
  newDate.setHours(0, 0, 0, 0);
  return newDate;
};

const BookingWidget: React.FC<BookingWidgetProps> = ({ pricing, className, adminEmail, propertyId, directBooking }) => {
  const { t, language } = useLanguage();
  const dateLocale = getDateFnsLocale(language);
  const weekdayLabels = [t('weekday_sun'), t('weekday_mon'), t('weekday_tue'), t('weekday_wed'), t('weekday_thu'), t('weekday_fri'), t('weekday_sat')];
  const today = startOfDay(new Date());
  
  // State for values
  const [checkIn, setCheckIn] = useState<Date | null>(today);
  const [checkOut, setCheckOut] = useState<Date | null>(addDays(today, 3));
  const [adults, setAdults] = useState(2);
  const [children, setChildren] = useState(0); 
  const [infants, setInfants] = useState(0);

  // State for UI toggles
  const [isGuestDropdownOpen, setIsGuestDropdownOpen] = useState(false);
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);
  const [calendarViewMonth, setCalendarViewMonth] = useState(today);
  const [selectingField, setSelectingField] = useState<'checkIn' | 'checkOut'>('checkIn');
  const [isBookingFormOpen, setIsBookingFormOpen] = useState(false);
  // Nights that were taken while the guest was filling in the form; shown so
  // they understand why the calendar suddenly changed under them.
  const [takenDates, setTakenDates] = useState<string[]>([]);

  // Coupon state. Unlike the rest of this widget's price, a coupon discount
  // is always server-validated (getQuote) rather than computed client-side —
  // it needs to check the property's actual coupon list.
  const [couponFieldOpen, setCouponFieldOpen] = useState(false);
  const [couponInput, setCouponInput] = useState('');
  const [appliedCoupon, setAppliedCoupon] = useState<AppliedCoupon | null>(null);
  const [couponQuote, setCouponQuote] = useState<QuoteResult | null>(null);
  const [couponError, setCouponError] = useState<string | null>(null);
  const [checkingCoupon, setCheckingCoupon] = useState(false);

  const canBookOnline = Boolean(propertyId && directBooking?.enabled);

  const calendarRef = useRef<HTMLDivElement>(null);

  // isDateBlocked reads a module-level cache, so a refresh has to be turned into
  // a render for the newly taken nights to show as unavailable.
  const [, setBlockedVersion] = useState(0);
  useEffect(() => {
    const handler = () => setBlockedVersion((n) => n + 1);
    window.addEventListener('ical-updated', handler);
    return () => window.removeEventListener('ical-updated', handler);
  }, []);

  // Close calendar when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (calendarRef.current && !calendarRef.current.contains(event.target as Node)) {
        setIsCalendarOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Find max guests from pricing config
  const maxPayingGuests = Math.max(...pricing.rates.map(r => r.guests), 7);
  const totalPayingGuests = adults + children;

  const calculation = useMemo<CalculationResult | null>(() => {
    if (!checkIn || !checkOut) return null;

    // 1. Basic Validation
    if (isBefore(checkIn, today) && !isSameDay(checkIn, today)) {
        return { isValid: false, message: t('sim_err_checkin_past') };
    }

    const nights = differenceInDays(checkOut, checkIn);

    if (nights <= 0) {
        return { isValid: false, message: t('sim_err_checkout_before') };
    }

    // 2. Check for Blocked Dates logic (Fallback validation)
    try {
        const nightsToStay = eachDayOfInterval({ start: checkIn, end: addDays(checkOut, -1) });
        const hasBlockedDate = nightsToStay.some(night => isDateBlocked(night));

        if (hasBlockedDate) {
            return { isValid: false, message: t('sim_err_blocked_dates') };
        }
    } catch (e) {
        return { isValid: false, message: t('sim_err_invalid_range') };
    }

    // 3. Calculate Price
    const priceDetails = calculateHomestayPrice(adults, children, infants, nights, pricing);

    if (!priceDetails.isValid) {
         return { isValid: false, message: priceDetails.message || t('sim_err_invalid_config') };
    }

    return { nights, ...priceDetails, isValid: true };
  }, [checkIn, checkOut, adults, children, infants, pricing, today, t]);

  // A coupon was validated against one specific date/guest combination — if
  // any of those change, that validation is stale, so clear it and make the
  // guest re-apply rather than silently keep an outdated discount.
  useEffect(() => {
    setAppliedCoupon(null);
    setCouponQuote(null);
    setCouponError(null);
  }, [checkIn, checkOut, adults, children, infants]);

  const handleApplyCoupon = async () => {
    const code = couponInput.trim();
    if (!code || !propertyId || !checkIn || !checkOut) return;
    setCheckingCoupon(true);
    setCouponError(null);
    try {
      const res = await getQuote({
        propertyId,
        checkIn: format(checkIn, 'yyyy-MM-dd'),
        checkOut: format(checkOut, 'yyyy-MM-dd'),
        adults,
        children,
        infants,
        couponCode: code,
      });
      if (res.coupon) {
        setAppliedCoupon(res.coupon);
        setCouponQuote(res.quote);
      } else {
        setAppliedCoupon(null);
        setCouponQuote(null);
        setCouponError(res.couponError || t('sim_coupon_invalid'));
      }
    } catch {
      setAppliedCoupon(null);
      setCouponQuote(null);
      setCouponError(t('sim_coupon_check_failed'));
    } finally {
      setCheckingCoupon(false);
    }
  };

  const handleDateSelect = (day: Date) => {
    if (selectingField === 'checkIn') {
        setCheckIn(day);
        setSelectingField('checkOut');
        // If checkout is before new checkin, reset it
        if (checkOut && (isBefore(checkOut, day) || isSameDay(checkOut, day))) {
            setCheckOut(null);
        }
    } else {
        // Selecting Check-out
        if (isBefore(day, checkIn!) || isSameDay(day, checkIn!)) {
            // User clicked a date before check-in, treat it as new check-in
            setCheckIn(day);
            setCheckOut(null);
            setSelectingField('checkOut');
        } else {
            setCheckOut(day);
            setIsCalendarOpen(false); // Close after full selection
        }
    }
  };

  const handleEmailInquiry = () => {
    if (!calculation || !calculation.isValid || !checkIn || !checkOut) return;

    const fmtIn = format(checkIn, 'yyyy-MM-dd');
    const fmtOut = format(checkOut, 'yyyy-MM-dd');
    const subject = t('sim_email_subject').replace('{checkin}', fmtIn).replace('{checkout}', fmtOut);
    const body = [
      `${t('sim_email_greeting')}`,
      '',
      t('sim_email_intro'),
      '',
      `${t('sim_email_checkin')} ${fmtIn}`,
      `${t('sim_email_checkout')} ${fmtOut}`,
      `${t('sim_email_duration')} ${calculation.nights} ${t('sim_email_nights')}`,
      `${t('sim_email_guests')} ${adults} ${t('sim_adults')}, ${children} ${t('sim_children')}, ${infants} ${t('sim_infants')}`,
      '',
      `${t('sim_email_estimated_price')} ¥${calculation.total.toLocaleString()}`,
      '',
      t('sim_email_signoff'),
    ].join('\n');

    const recipientEmail = adminEmail || 'sachihouse.ad@gmail.com';
    window.location.href = `mailto:${recipientEmail}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  };

  // Helper to display guest summary
  const getGuestSummary = () => {
      const parts = [`${adults} ${t('sim_adults').toLowerCase()}`];
      if (children > 0) parts.push(`${children} ${t('sim_children').toLowerCase()}`);
      if (infants > 0) parts.push(`${infants} ${t('sim_infants').toLowerCase()}`);
      return parts.join(', ');
  };

  // Render Logic for Custom Calendar
  const renderCalendar = () => {
    const start = startOfMonth(calendarViewMonth);
    const end = endOfMonth(calendarViewMonth);
    const days = eachDayOfInterval({ start, end });
    const startDayOfWeek = getDay(start); // 0 = Sunday
    const emptyDays = Array(startDayOfWeek).fill(null);

    return (
        <div className="p-4">
            <div className="flex justify-between items-center mb-4">
                <button onClick={() => setCalendarViewMonth(addMonths(calendarViewMonth, -1))} disabled={isBefore(calendarViewMonth, startOfMonth(today))} className="p-1 hover:bg-gray-100 rounded-full disabled:opacity-30">
                    <ChevronLeft className="w-5 h-5" />
                </button>
                <span className="font-bold text-gray-900">{format(calendarViewMonth, 'MMMM yyyy', { locale: dateLocale })}</span>
                <button onClick={() => setCalendarViewMonth(addMonths(calendarViewMonth, 1))} className="p-1 hover:bg-gray-100 rounded-full">
                    <ChevronRight className="w-5 h-5" />
                </button>
            </div>
            <div className="grid grid-cols-7 gap-1 text-center mb-2">
                {weekdayLabels.map((d, i) => (
                    <div key={i} className="text-xs font-bold text-gray-400">{d}</div>
                ))}
            </div>
            <div className="grid grid-cols-7 gap-1">
                {emptyDays.map((_, i) => <div key={`empty-${i}`} />)}
                {days.map(day => {
                    const isPast = isBefore(day, today);
                    const blocked = isDateBlocked(day);
                    const isDisabled = isPast || blocked;
                    
                    const isSelectedStart = checkIn && isSameDay(day, checkIn);
                    const isSelectedEnd = checkOut && isSameDay(day, checkOut);
                    const isInRange = checkIn && checkOut && isWithinInterval(day, { start: checkIn, end: checkOut });
                    
                    let buttonClass = "w-9 h-9 text-sm rounded-full flex items-center justify-center transition-all relative z-10 ";
                    
                    if (isDisabled) {
                        buttonClass += "text-gray-300 decoration-slate-300 line-through cursor-not-allowed ";
                    } else if (isSelectedStart || isSelectedEnd) {
                        buttonClass += "bg-[var(--color-primary-600)] text-white font-bold ";
                    } else if (isInRange) {
                        buttonClass += "bg-[var(--color-primary-50)] text-[var(--color-primary-700)] ";
                    } else {
                        buttonClass += "hover:bg-gray-100 text-gray-700 font-medium hover:border-gray-900 border border-transparent ";
                    }

                    return (
                        <button 
                            key={day.toISOString()}
                            disabled={isDisabled}
                            onClick={() => handleDateSelect(day)}
                            className={buttonClass}
                        >
                            {format(day, 'd')}
                        </button>
                    )
                })}
            </div>
        </div>
    );
  };

  return (
    <div className={`bg-white rounded-2xl shadow-xl border border-gray-200 overflow-visible lg:sticky lg:top-24 ${className}`} ref={calendarRef}>
      
      {/* Header Section */}
      <div className="bg-gray-50 px-8 py-6 border-b border-gray-100 rounded-t-2xl">
        <div className="flex items-center gap-2 mb-2">
             <Calculator className="w-5 h-5 text-[var(--color-primary-600)]" />
             <span className="text-xs font-bold text-[var(--color-primary-600)] uppercase tracking-wider">{t('sim_title')}</span>
        </div>
        <h3 className="text-xl font-bold text-gray-900 leading-tight">
            {t('sim_subtitle')}
        </h3>
      </div>

      <div className="p-8">
        {/* Price Display */}
        <div className="flex justify-between items-baseline mb-8">
            <div>
            {calculation && calculation.isValid ? (
                <>
                    <span className="text-3xl font-bold text-gray-900">¥{calculation.breakdown.pricePerGuest.toLocaleString()}</span>
                    <span className="text-gray-500 ml-1 text-base">{t('sim_per_night')}</span>
                </>
            ) : (
                <span className="text-3xl font-bold text-gray-900">{t('sim_add_dates')}</span>
            )}
            </div>
            <div className="flex items-center text-xs bg-gray-100 px-3 py-1.5 rounded-full">
               <Star className="w-3.5 h-3.5 text-orange-400 fill-current mr-1.5" />
               <span className="font-bold text-gray-700">4.92</span>
            </div>
        </div>

        {/* Inputs Container */}
        <div className="border border-gray-300 rounded-xl mb-8 bg-white relative">
            {/* Custom Date Inputs Trigger */}
            <div className="flex border-b border-gray-300">
                <div 
                    className={`flex-1 p-4 border-r border-gray-300 cursor-pointer relative hover:bg-gray-50 transition-colors ${isCalendarOpen && selectingField === 'checkIn' ? 'bg-gray-100 shadow-inner' : ''}`}
                    onClick={() => { setIsCalendarOpen(true); setSelectingField('checkIn'); }}
                >
                    <label className="flex items-center gap-1.5 text-[11px] font-bold uppercase text-gray-500 mb-1.5">
                        <CalendarIcon className="w-3.5 h-3.5" /> {t('sim_checkin')}
                    </label>
                    <div className={`text-base font-medium ${checkIn ? 'text-gray-900' : 'text-gray-400'}`}>
                        {checkIn ? format(checkIn, 'MMM dd, yyyy', { locale: dateLocale }) : t('sim_add_dates')}
                    </div>
                </div>
                <div 
                    className={`flex-1 p-4 cursor-pointer relative hover:bg-gray-50 transition-colors ${isCalendarOpen && selectingField === 'checkOut' ? 'bg-gray-100 shadow-inner' : ''}`}
                    onClick={() => { setIsCalendarOpen(true); setSelectingField('checkOut'); }}
                >
                    <label className="flex items-center gap-1.5 text-[11px] font-bold uppercase text-gray-500 mb-1.5">
                        <CalendarIcon className="w-3.5 h-3.5" /> {t('sim_checkout')}
                    </label>
                    <div className={`text-base font-medium ${checkOut ? 'text-gray-900' : 'text-gray-400'}`}>
                        {checkOut ? format(checkOut, 'MMM dd, yyyy', { locale: dateLocale }) : t('sim_add_dates')}
                    </div>
                </div>
            </div>

            {/* Calendar Popover */}
            {isCalendarOpen && (
                <div className="absolute top-[80px] left-0 w-full bg-white border border-gray-200 shadow-2xl rounded-2xl z-50 animate-in fade-in zoom-in-95 duration-200">
                    <div className="flex justify-end p-2 border-b border-gray-100 md:hidden">
                        <button onClick={() => setIsCalendarOpen(false)} className="p-2 text-gray-500">
                            <X className="w-5 h-5"/>
                        </button>
                    </div>
                    {renderCalendar()}
                    
                    {/* Calendar Footer Info */}
                    <div className="px-4 pb-4 pt-2 flex items-center justify-between text-xs text-gray-500 border-t border-gray-100 mt-2">
                        <div className="flex items-center gap-2">
                            <span className="w-2 h-2 rounded-full bg-gray-300"></span> {t('sim_legend_blocked')}
                            <span className="w-2 h-2 rounded-full bg-gray-900"></span> {t('sim_legend_selected')}
                        </div>
                        <button
                            onClick={() => { setCheckIn(null); setCheckOut(null); }}
                            className="underline hover:text-blue-600"
                        >
                            {t('sim_clear_dates')}
                        </button>
                    </div>
                </div>
            )}

            {/* Guest Dropdown */}
            <div className="relative">
                <div 
                    className="p-4 hover:bg-gray-50 cursor-pointer flex justify-between items-center"
                    onClick={() => { setIsGuestDropdownOpen(!isGuestDropdownOpen); setIsCalendarOpen(false); }}
                >
                    <div className="flex-grow">
                        <label className="flex items-center gap-1.5 text-[11px] font-bold uppercase text-gray-500 mb-1.5">
                            <Users className="w-3.5 h-3.5" /> {t('sim_guests')}
                        </label>
                        <span className="text-base font-medium text-gray-900 block truncate">
                            {getGuestSummary()}
                        </span>
                    </div>
                    {isGuestDropdownOpen ? <ChevronUp className="w-5 h-5 text-gray-400"/> : <ChevronDown className="w-5 h-5 text-gray-400"/>}
                </div>

                {/* Dropdown Content */}
                {isGuestDropdownOpen && (
                    <div className="absolute top-0 left-0 w-full bg-white border-b border-gray-200 shadow-lg p-5 z-20 animate-in slide-in-from-top-2 duration-200 rounded-b-xl">
                        {/* Adults */}
                        <div className="flex justify-between items-center mb-6">
                            <div>
                                <div className="font-bold text-gray-900 text-base">{t('sim_adults')}</div>
                                <div className="text-xs text-gray-500">{t('sim_age_prefix')} {pricing.childAgeMax + 1}+</div>
                            </div>
                            <div className="flex items-center gap-4">
                                <button 
                                    onClick={(e) => { e.stopPropagation(); setAdults(Math.max(1, adults - 1)); }}
                                    disabled={adults <= 1}
                                    className="w-9 h-9 rounded-full border border-gray-300 flex items-center justify-center text-gray-500 hover:border-gray-800 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                                >
                                    <Minus className="w-4 h-4"/>
                                </button>
                                <span className="w-6 text-center text-base font-semibold">{adults}</span>
                                <button 
                                    onClick={(e) => { e.stopPropagation(); setAdults(Math.min(maxPayingGuests - children, adults + 1)); }}
                                    disabled={totalPayingGuests >= maxPayingGuests}
                                    className="w-9 h-9 rounded-full border border-gray-300 flex items-center justify-center text-gray-500 hover:border-gray-800 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                                >
                                    <Plus className="w-4 h-4"/>
                                </button>
                            </div>
                        </div>

                        {/* Children */}
                        <div className="flex justify-between items-center mb-6">
                            <div>
                                <div className="font-bold text-gray-900 text-base">{t('sim_children')}</div>
                                <div className="text-xs text-gray-500">{t('sim_age_prefix')} {pricing.childAgeMin}-{pricing.childAgeMax} (-{pricing.childDiscountPercent}%)</div>
                            </div>
                            <div className="flex items-center gap-4">
                                <button 
                                    onClick={(e) => { e.stopPropagation(); setChildren(Math.max(0, children - 1)); }}
                                    disabled={children <= 0}
                                    className="w-9 h-9 rounded-full border border-gray-300 flex items-center justify-center text-gray-500 hover:border-gray-800 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                                >
                                    <Minus className="w-4 h-4"/>
                                </button>
                                <span className="w-6 text-center text-base font-semibold">{children}</span>
                                <button 
                                    onClick={(e) => { e.stopPropagation(); setChildren(Math.min(maxPayingGuests - adults, children + 1)); }}
                                    disabled={totalPayingGuests >= maxPayingGuests}
                                    className="w-9 h-9 rounded-full border border-gray-300 flex items-center justify-center text-gray-500 hover:border-gray-800 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                                >
                                    <Plus className="w-4 h-4"/>
                                </button>
                            </div>
                        </div>

                         {/* Infants */}
                         <div className="flex justify-between items-center mb-6">
                            <div>
                                <div className="font-bold text-gray-900 text-base">{t('sim_infants')}</div>
                                <div className="text-xs text-gray-500">{t('sim_under_prefix')} {pricing.childAgeMin} {t('sim_free_suffix')}</div>
                            </div>
                            <div className="flex items-center gap-4">
                                <button 
                                    onClick={(e) => { e.stopPropagation(); setInfants(Math.max(0, infants - 1)); }}
                                    disabled={infants <= 0}
                                    className="w-9 h-9 rounded-full border border-gray-300 flex items-center justify-center text-gray-500 hover:border-gray-800 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                                >
                                    <Minus className="w-4 h-4"/>
                                </button>
                                <span className="w-6 text-center text-base font-semibold">{infants}</span>
                                <button 
                                    onClick={(e) => { e.stopPropagation(); setInfants(infants + 1); }}
                                    // Infants usually don't have a hard cap in the selector, or we cap at a reasonable number (e.g. 3)
                                    disabled={infants >= 3}
                                    className="w-9 h-9 rounded-full border border-gray-300 flex items-center justify-center text-gray-500 hover:border-gray-800 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                                >
                                    <Plus className="w-4 h-4"/>
                                </button>
                            </div>
                        </div>
                        
                        <div className="pt-2 text-right">
                            <button 
                                onClick={(e) => { e.stopPropagation(); setIsGuestDropdownOpen(false); }}
                                className="text-sm font-bold text-white bg-gray-900 px-5 py-2.5 rounded-lg hover:bg-gray-800 transition-colors"
                            >
                                {t('sim_done')}
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>

        {/* Calculation Result */}
        {calculation && calculation.isValid ? (
            <div className="space-y-6">
                {propertyId && (
                    <div className="space-y-2">
                        {!couponFieldOpen && !appliedCoupon ? (
                            <button
                                type="button"
                                onClick={() => setCouponFieldOpen(true)}
                                className="flex items-center gap-1.5 text-sm font-semibold text-[var(--color-primary-600)] hover:underline"
                            >
                                <Tag className="w-4 h-4" /> {t('sim_coupon_toggle')}
                            </button>
                        ) : appliedCoupon ? (
                            <div className="flex items-center justify-between gap-2 bg-green-50 border border-green-200 rounded-xl px-4 py-3">
                                <span className="flex items-center gap-1.5 text-sm font-bold text-green-700">
                                    <Check className="w-4 h-4" /> {t('sim_coupon_applied')}: {appliedCoupon.code}
                                </span>
                                <button
                                    type="button"
                                    onClick={() => { setAppliedCoupon(null); setCouponQuote(null); setCouponInput(''); setCouponFieldOpen(false); }}
                                    className="text-xs font-semibold text-gray-500 hover:text-gray-800 underline"
                                >
                                    {t('sim_coupon_remove')}
                                </button>
                            </div>
                        ) : (
                            <div className="flex gap-2">
                                <input
                                    type="text"
                                    value={couponInput}
                                    onChange={(e) => { setCouponInput(e.target.value.toUpperCase()); setCouponError(null); }}
                                    placeholder={t('sim_coupon_placeholder')}
                                    className="flex-1 border border-gray-300 rounded-xl px-3 py-2.5 text-sm font-mono uppercase focus:outline-none focus:border-gray-900 focus:ring-1 focus:ring-gray-900"
                                />
                                <button
                                    type="button"
                                    onClick={() => void handleApplyCoupon()}
                                    disabled={!couponInput.trim() || checkingCoupon}
                                    className="px-4 py-2.5 rounded-xl bg-gray-900 text-white text-sm font-bold disabled:opacity-40 flex items-center gap-1.5"
                                >
                                    {checkingCoupon ? <Loader2 className="w-4 h-4 animate-spin" /> : t('sim_coupon_apply')}
                                </button>
                            </div>
                        )}
                        {couponError && <p className="text-xs text-red-600">{couponError}</p>}
                    </div>
                )}
                <div className="bg-gray-50 p-5 rounded-xl border border-gray-100 space-y-3 text-base text-gray-600">
                    <div className="flex justify-between">
                        <span className="underline decoration-dotted cursor-help" title={`¥${calculation.breakdown.pricePerGuest.toLocaleString()} x ${adults} x ${calculation.nights}`}>
                            {t('sim_adults')} ({calculation.nights} nights)
                        </span>
                        <span>¥{(calculation.breakdown.adultTotal).toLocaleString()}</span>
                    </div>
                    
                    {children > 0 && (
                        <div className="flex justify-between text-blue-600">
                            <span className="underline decoration-dotted cursor-help" title={`${pricing.childDiscountPercent}% Discount applied`}>
                                {t('sim_children')} ({pricing.childDiscountPercent}% off)
                            </span>
                            <span>¥{(calculation.breakdown.childTotal).toLocaleString()}</span>
                        </div>
                    )}

                    {infants > 0 && (
                        <div className="flex justify-between text-green-600">
                            <span>{t('sim_infant_free')}</span>
                            <span>¥0</span>
                        </div>
                    )}

                    <div className="flex justify-between">
                        <span>{t('sim_cleaning')}</span>
                        <span>¥{calculation.breakdown.cleaningFee.toLocaleString()}</span>
                    </div>

                    {calculation.breakdown.discountRate < 1 && (
                        <div className="flex justify-between text-green-600 font-bold">
                            <span>{t('sim_long_stay')} ({pricing.longStayDiscountPercent}%)</span>
                            <span>-¥{(calculation.breakdown.subtotal - calculation.breakdown.discountedSubtotal).toLocaleString()}</span>
                        </div>
                    )}

                    {appliedCoupon && couponQuote && (
                        <div className="flex justify-between text-green-600 font-bold">
                            <span>{t('sim_coupon_applied')} ({appliedCoupon.code})</span>
                            <span>-¥{Math.max(0, calculation.total - couponQuote.total).toLocaleString()}</span>
                        </div>
                    )}

                    <div className="border-t border-gray-200 pt-4 mt-2 flex justify-between items-center text-gray-900">
                        <span className="font-bold text-lg">{t('sim_total_est')}</span>
                        <span className="font-bold text-2xl">¥{(appliedCoupon && couponQuote ? couponQuote.total : calculation.total).toLocaleString()}</span>
                    </div>
                </div>

                {takenDates.length > 0 && (
                    <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg p-3">
                        <AlertCircle className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
                        <p className="text-sm text-amber-800">
                            {t('book_err_conflict')} {takenDates.join(', ')}
                        </p>
                    </div>
                )}

                {canBookOnline ? (
                    <button
                        onClick={() => { setTakenDates([]); setIsBookingFormOpen(true); }}
                        className="w-full bg-[var(--color-primary-600)] hover:opacity-90 text-white font-bold text-lg py-4 px-6 rounded-xl shadow-lg shadow-black/10 transition-all duration-200 flex items-center justify-center gap-3 group transform hover:-translate-y-1"
                    >
                        <Lock className="w-5 h-5 group-hover:scale-110 transition-transform" />
                        {t('book_now')}
                    </button>
                ) : (
                    <button
                        onClick={handleEmailInquiry}
                        className="w-full bg-[var(--color-primary-600)] hover:opacity-90 text-white font-bold text-lg py-4 px-6 rounded-xl shadow-lg shadow-black/10 transition-all duration-200 flex items-center justify-center gap-3 group transform hover:-translate-y-1"
                    >
                        <Mail className="w-6 h-6 group-hover:scale-110 transition-transform" />
                        {t('sim_send_inquiry')}
                    </button>
                )}

                <p className="text-xs text-gray-400 text-center leading-tight">
                    {canBookOnline ? t('book_widget_note') : t('sim_note')}
                </p>
            </div>
        ) : (
            <div className="text-center py-8 bg-gray-50 rounded-xl border border-dashed border-gray-200">
                <div className="flex justify-center mb-2">
                    <AlertCircle className="w-6 h-6 text-gray-400" />
                </div>
                <p className="text-blue-600 font-medium">
                    {calculation?.message || t('sim_add_dates')}
                </p>
            </div>
        )}
      </div>

      {isBookingFormOpen && canBookOnline && calculation?.isValid && checkIn && checkOut && (
        <BookingGuestForm
          propertyId={propertyId!}
          checkIn={checkIn}
          checkOut={checkOut}
          nights={calculation.nights}
          adults={adults}
          children={children}
          infants={infants}
          estimatedTotal={appliedCoupon && couponQuote ? couponQuote.total : calculation.total}
          couponCode={appliedCoupon?.code}
          freeCancellationDays={directBooking?.freeCancellationDays}
          onClose={() => setIsBookingFormOpen(false)}
          onDatesUnavailable={(conflicts) => {
            // Someone else paid for these nights first. Close the form, surface
            // the clash and reopen the calendar so the guest can pick again.
            setIsBookingFormOpen(false);
            setTakenDates(conflicts);
            setCheckOut(null);
            setSelectingField('checkIn');
            setIsCalendarOpen(true);
            refreshBlockedDates(propertyId!).catch(() => undefined);
          }}
        />
      )}
    </div>
  );
};

export default BookingWidget;
