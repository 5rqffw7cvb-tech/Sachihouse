import React, { useState } from 'react';
import { Check, Copy, X } from 'lucide-react';
import { copyText } from '../../services/hostApp';
import {
  calculateCleaningPay,
  CO_HOST_RATE,
  DEFAULT_CLEANING_FEE,
  formatYen,
} from '../../utils/cleaningPay';
import { fieldClass, labelClass, sheetBackdropClass, sheetPanelClass } from './sheetControls';

/**
 * Works out what to pay for one cleaning job. Nothing is saved — it is a
 * calculator, and the copy button is how the result leaves the phone.
 */

export interface CleaningCalculatorSheetProps {
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

export const CleaningCalculatorSheet: React.FC<CleaningCalculatorSheetProps> = ({ onClose }) => {
  const [cleaningFee, setCleaningFee] = useState(String(DEFAULT_CLEANING_FEE));
  const [isCoHost, setIsCoHost] = useState(false);
  const [guestPayment, setGuestPayment] = useState('');
  const [bonus, setBonus] = useState('');
  const [supplies, setSupplies] = useState('');
  const [copied, setCopied] = useState(false);

  const pay = calculateCleaningPay({ cleaningFee, isCoHost, guestPayment, bonus, supplies });
  const ratePercent = `${Math.round(CO_HOST_RATE * 100)}%`;

  const handleCopy = async () => {
    const lines = [
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
    setGuestPayment('');
    setBonus('');
    setSupplies('');
  };

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
              Co-host (+{ratePercent} of guest payment)
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
            <YenField
              label="ゲスト支払額 / Guest payment"
              value={guestPayment}
              onChange={setGuestPayment}
              hint={`What the guest paid for this stay. Co-host share: ${formatYen(pay.coHostShare)}.`}
            />
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
              className="h-13 min-h-[52px] rounded-control bg-brand text-white
                font-['Plus_Jakarta_Sans'] text-[15px] font-bold flex items-center justify-center gap-2"
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
