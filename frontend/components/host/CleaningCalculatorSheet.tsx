import React, { useEffect, useMemo, useState } from 'react';
import { AlertCircle, Check, CircleCheck, Copy, Loader2, Undo2, X } from 'lucide-react';
import { ApiUser } from '../../services/api';
import {
  CleaningPayout,
  createCleaningPayout,
  deleteCleaningPayout,
  listCleaningPayouts,
} from '../../services/cleaningPayouts';
import { copyText, HostProperty, HostStay, loadStays, todayIso } from '../../services/hostApp';
import {
  calculateCleaningPay,
  DEFAULT_CLEANING_FEE,
  DEFAULT_CO_HOST_PERCENT,
  formatYen,
  parsePercent,
  parseYen,
  PAYABLE_PAST_DAYS,
  payableFromDate,
  payableStays,
  shortDateRange,
  stayRef,
  stayWho,
} from '../../utils/cleaningPay';
import { fieldClass, labelClass, sheetBackdropClass, sheetPanelClass } from './sheetControls';
import { MANUAL_STAY, StayPicker } from './StayPicker';

/**
 * Works out what to pay for one cleaning job and records it as paid.
 *
 * The job is picked from the calendar — stays in the house now or gone in the
 * last 30 days — so the payment is tied to one party and a second person
 * opening this screen sees it is already settled. A job that matches no stay
 * can still be typed in by hand.
 */

export interface CleaningCalculatorSheetProps {
  user: ApiUser;
  properties: HostProperty[];
  onClose: () => void;
}

const YenField: React.FC<{
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  hint?: string;
}> = ({ label, value, onChange, placeholder, hint }) => (
  <label className="block">
    <span className={labelClass}>{label}</span>
    <input
      value={value}
      onChange={(event) => onChange(event.target.value)}
      inputMode="numeric"
      className={`${fieldClass} tabular-nums`}
      placeholder={placeholder ?? '0'}
    />
    {hint && <span className="block mt-1.5 text-[12px] text-ink-muted leading-snug">{hint}</span>}
  </label>
);

const BreakdownLine: React.FC<{ label: string; amount: number }> = ({ label, amount }) => (
  <div className="flex items-center justify-between gap-3 text-[14px] text-ink-soft">
    <span className="min-w-0 truncate">{label}</span>
    <span className="tabular-nums shrink-0">{formatYen(amount)}</span>
  </div>
);

function formatPaidAt(paidAt: number): string {
  const date = new Date(paidAt);
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

export const CleaningCalculatorSheet: React.FC<CleaningCalculatorSheetProps> = ({ user, properties, onClose }) => {
  const [cleaningFee, setCleaningFee] = useState(String(DEFAULT_CLEANING_FEE));
  const [isCoHost, setIsCoHost] = useState(false);
  const [coHostPercent, setCoHostPercent] = useState(String(DEFAULT_CO_HOST_PERCENT));
  const [guestPayment, setGuestPayment] = useState('');
  const [bonus, setBonus] = useState('');
  const [supplies, setSupplies] = useState('');
  const [copied, setCopied] = useState(false);

  const [stays, setStays] = useState<HostStay[] | null>(null);
  const [payouts, setPayouts] = useState<CleaningPayout[]>([]);
  const [selection, setSelection] = useState('');
  const [manualLabel, setManualLabel] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const today = todayIso();

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      loadStays(properties.map((property) => property.id)),
      listCleaningPayouts(payableFromDate(today)),
    ])
      .then(([loaded, paid]) => {
        if (cancelled) return;
        setStays(payableStays(loaded.stays, today));
        setPayouts(paid);
        if (loaded.failedPropertyIds.length > 0) {
          setError('Some properties’ calendars did not load; their stays are missing from the list.');
        }
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setStays([]);
        setError(cause instanceof Error ? cause.message : 'Could not load stays.');
      });
    return () => { cancelled = true; };
    // properties is stable for the life of the sheet; today only changes at midnight.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const paidByRef = useMemo(() => {
    const map = new Map<string, CleaningPayout>();
    payouts.forEach((payout) => { if (payout.stayRef) map.set(payout.stayRef, payout); });
    return map;
  }, [payouts]);

  const selectedStay = stays?.find((stay) => stayRef(stay) === selection) ?? null;
  const selectedPayout = selectedStay ? paidByRef.get(stayRef(selectedStay)) ?? null : null;
  const isManual = selection === MANUAL_STAY;

  const pay = calculateCleaningPay({ cleaningFee, isCoHost, coHostPercent, guestPayment, bonus, supplies });
  const ratePercent = `${parsePercent(coHostPercent)}%`;
  const jobLabel = selectedStay
    ? `${selectedStay.propertyName} · ${stayWho(selectedStay)} · ${shortDateRange(selectedStay.checkInDate, selectedStay.checkOutDate)}`
    : isManual ? manualLabel.trim() : '';

  const canMarkPaid = !saving && !selectedPayout && pay.total > 0
    && (selectedStay !== null || (isManual && manualLabel.trim() !== ''));

  const handleSelect = (value: string) => {
    setSelection(value);
    setError(null);
    const stay = stays?.find((item) => stayRef(item) === value);
    // Only direct bookings carry what the guest paid; for OTA stays the field
    // is left for the host to fill from the platform.
    if (stay?.amountTotal != null && (stay.currency ?? 'JPY').toUpperCase() === 'JPY') {
      setGuestPayment(String(stay.amountTotal));
    } else if (stay) {
      setGuestPayment('');
    }
  };

  const handleCopy = async () => {
    const lines = [
      ...(jobLabel ? [jobLabel] : []),
      `清掃料 / Cleaning: ${formatYen(pay.cleaningFee)}`,
      ...(isCoHost ? [`Co-host ${ratePercent}: ${formatYen(pay.coHostShare)}`] : []),
      ...(pay.bonus ? [`ボーナス / Bonus: ${formatYen(pay.bonus)}`] : []),
      ...(pay.supplies ? [`備品立替 / Supplies: ${formatYen(pay.supplies)}`] : []),
      `合計 / Total: ${formatYen(pay.total)}`,
    ];
    await copyText(lines.join('\n'));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  };

  const handleReset = () => {
    setCleaningFee(String(DEFAULT_CLEANING_FEE));
    setIsCoHost(false);
    setCoHostPercent(String(DEFAULT_CO_HOST_PERCENT));
    setGuestPayment('');
    setBonus('');
    setSupplies('');
    setSelection('');
    setManualLabel('');
  };

  const handleMarkPaid = async () => {
    setSaving(true);
    setError(null);
    try {
      const payout = await createCleaningPayout({
        propertyId: selectedStay?.propertyId ?? null,
        stayRef: selectedStay ? stayRef(selectedStay) : null,
        label: jobLabel,
        checkInDate: selectedStay?.checkInDate ?? null,
        checkOutDate: selectedStay?.checkOutDate ?? null,
        cleaningFee: pay.cleaningFee,
        coHostPercent: isCoHost ? parsePercent(coHostPercent) : null,
        guestPayment: isCoHost ? parseYen(guestPayment) : 0,
        bonus: pay.bonus,
        supplies: pay.supplies,
      });
      setPayouts((current) => [payout, ...current]);
      if (isManual) {
        // A manual entry has no stay to show its paid state on, so the form
        // clears to make the next one obvious.
        handleReset();
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not record the payment.');
      // Someone else may have just paid it: reload so the list shows that.
      listCleaningPayouts(payableFromDate(today)).then(setPayouts).catch(() => {});
    } finally {
      setSaving(false);
    }
  };

  const handleUndo = async (payout: CleaningPayout) => {
    setSaving(true);
    setError(null);
    try {
      await deleteCleaningPayout(payout.id);
      setPayouts((current) => current.filter((item) => item.id !== payout.id));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not undo the payment.');
    } finally {
      setSaving(false);
    }
  };

  const canUndo = (payout: CleaningPayout) => user.role === 'ADMIN' || payout.paidByUserId === user.id;

  return (
    <div className={sheetBackdropClass} onClick={onClose} role="presentation">
      <div
        className={sheetPanelClass}
        style={{ paddingBottom: 'calc(1.5rem + env(safe-area-inset-bottom, 0px))' }}
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Cleaning calculator"
      >
        <div className="pt-2.5 sticky top-0 bg-surface z-10">
          <div className="w-10 h-1 rounded-full bg-line-strong mx-auto" />
          <div className="flex items-start gap-2 px-5 pt-3 pb-3.5 border-b border-line">
            <div className="flex-1 min-w-0 flex flex-col gap-0.5">
              <h2 className="text-[20px] tracking-[-0.3px] truncate">Cleaning calculator</h2>
              <span className="text-[13px] text-ink-muted truncate">清掃費の計算 · cleaning pay</span>
            </div>
            <button type="button" onClick={onClose} aria-label="Close" className="shrink-0 p-1 -mr-1 mt-0.5">
              <X className="w-5 h-5 text-ink-soft" />
            </button>
          </div>
        </div>

        <div className="px-5 pt-4 flex flex-col gap-4">
          {error && (
            <div className="flex items-start gap-2.5 bg-danger-tint text-danger border border-danger/20
              rounded-control px-3.5 py-3 text-[13px]">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span className="flex-1 min-w-0">{error}</span>
            </div>
          )}

          <div>
            <span className={labelClass}>ゲスト / Stay</span>
            <StayPicker
              stays={stays}
              paidByRef={paidByRef}
              today={today}
              value={selection}
              onChange={handleSelect}
            />
            <span className="block mt-1.5 text-[12px] text-ink-muted leading-snug truncate">
              {selectedStay?.summary
                ? selectedStay.summary
                : `In the house now, or checked out in the last ${PAYABLE_PAST_DAYS} days.`}
            </span>
          </div>

          {selectedPayout && (
            <div className="rounded-control border border-ok/20 bg-ok-tint px-3.5 py-3 flex items-start gap-2.5">
              <CircleCheck className="w-5 h-5 text-ok shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0 flex flex-col gap-0.5 text-[13px] text-ink-soft">
                <span className="text-[15px] font-semibold text-ink">
                  {`Paid ${formatYen(selectedPayout.total)}`}
                </span>
                <span>{`${formatPaidAt(selectedPayout.paidAt)} by ${selectedPayout.paidByName}`}</span>
              </div>
              {canUndo(selectedPayout) && (
                <button
                  type="button"
                  onClick={() => { void handleUndo(selectedPayout); }}
                  disabled={saving}
                  className="shrink-0 flex items-center gap-1 text-[13px] font-semibold text-ink-soft disabled:opacity-50"
                >
                  <Undo2 className="w-4 h-4" /> Undo
                </button>
              )}
            </div>
          )}

          {isManual && (
            <label className="block">
              <span className={labelClass}>内容 / What was this for</span>
              <input
                value={manualLabel}
                onChange={(event) => setManualLabel(event.target.value)}
                className={fieldClass}
                placeholder="e.g. Deep clean, Main House, 10/20"
                maxLength={200}
              />
            </label>
          )}

          <YenField
            label="清掃料 / Whole-house clean"
            value={cleaningFee}
            onChange={setCleaningFee}
            hint={`Default ${formatYen(DEFAULT_CLEANING_FEE)} for the whole house.`}
          />

          <button
            type="button"
            role="switch"
            aria-checked={isCoHost}
            onClick={() => setIsCoHost((value) => !value)}
            className="flex items-center gap-3 rounded-control border border-line bg-subtle px-3.5 h-12 text-left"
          >
            <span className="flex-1 min-w-0 text-[15px] text-ink truncate">
              Co-host (% of guest payment)
            </span>
            <span
              className={`w-11 h-6 rounded-full p-0.5 shrink-0 transition-colors ${
                isCoHost ? 'bg-brand' : 'bg-line-strong'
              }`}
            >
              <span
                className={`block w-5 h-5 rounded-full bg-white transition-transform ${
                  isCoHost ? 'translate-x-5' : ''
                }`}
              />
            </span>
          </button>

          {isCoHost && (
            <div>
              <div className="grid grid-cols-[96px_minmax(0,1fr)] gap-3">
                <label className="block">
                  <span className={labelClass}>Rate %</span>
                  <input
                    value={coHostPercent}
                    onChange={(event) => setCoHostPercent(event.target.value)}
                    inputMode="decimal"
                    className={`${fieldClass} tabular-nums`}
                    placeholder={String(DEFAULT_CO_HOST_PERCENT)}
                  />
                </label>
                <YenField
                  label="ゲスト支払額 / Guest paid"
                  value={guestPayment}
                  onChange={setGuestPayment}
                />
              </div>
              <span className="block mt-1.5 text-[12px] text-ink-muted leading-snug">
                {selectedStay && selectedStay.amountTotal == null
                  ? `${selectedStay.channel} does not send the amount to the calendar — type it from the platform. `
                  : `Default ${DEFAULT_CO_HOST_PERCENT}% of what the guest paid for this stay. `}
                {`Co-host share: ${formatYen(pay.coHostShare)}.`}
              </span>
            </div>
          )}

          <YenField label="ボーナス / Bonus" value={bonus} onChange={setBonus} />

          <YenField
            label="備品立替 / Supplies bought"
            value={supplies}
            onChange={setSupplies}
            hint="Household items the co-host paid for, reimbursed at cost."
          />

          <div className="rounded-control border border-line bg-subtle px-3.5 py-3 flex flex-col gap-1.5">
            <BreakdownLine label="清掃料 / Cleaning" amount={pay.cleaningFee} />
            {isCoHost && <BreakdownLine label={`Co-host ${ratePercent}`} amount={pay.coHostShare} />}
            <BreakdownLine label="ボーナス / Bonus" amount={pay.bonus} />
            <BreakdownLine label="備品立替 / Supplies" amount={pay.supplies} />
            <div className="flex items-center justify-between gap-3 pt-2 mt-1 border-t border-line">
              <span className="text-[15px] font-semibold text-ink">合計 / Total</span>
              <span className="font-['Plus_Jakarta_Sans'] text-[22px] font-bold text-ink tabular-nums">
                {formatYen(pay.total)}
              </span>
            </div>
          </div>

          {!selectedPayout && (
            <button
              type="button"
              onClick={() => { void handleMarkPaid(); }}
              disabled={!canMarkPaid}
              className="h-13 min-h-[52px] rounded-control bg-brand text-white
                font-['Plus_Jakarta_Sans'] text-[15px] font-bold flex items-center justify-center gap-2
                disabled:opacity-50"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CircleCheck className="w-4 h-4" />}
              {`Mark as paid · ${formatYen(pay.total)}`}
            </button>
          )}
          {!selectedPayout && !selectedStay && !isManual && (
            <p className="-mt-2 text-[12px] text-ink-muted text-center">
              Choose a stay (or enter by hand) to record the payment.
            </p>
          )}

          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={handleReset}
              className="h-13 min-h-[52px] rounded-control border border-line bg-surface
                text-[15px] font-semibold text-ink-soft"
            >
              Reset
            </button>
            <button
              type="button"
              onClick={() => { void handleCopy(); }}
              className="h-13 min-h-[52px] rounded-control border border-line bg-surface
                text-[15px] font-semibold text-ink-soft flex items-center justify-center gap-2"
            >
              {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CleaningCalculatorSheet;
