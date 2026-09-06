import React, { useState } from 'react';
import { format, parseISO } from 'date-fns';
import { Check, Eye, EyeOff, X } from 'lucide-react';
import { CheckInGuest, CheckInSubmission } from '../../types';

/**
 * One guest ID record, as the law requires it to be kept.
 *
 * The ID photo stays behind an explicit tap, exactly as the desktop console
 * does it. This is a retained identity document, not a thumbnail: a host
 * scrolling the list in a café should not have a passport render itself over
 * their shoulder.
 */
export interface CheckInDetailSheetProps {
  submission: CheckInSubmission | null;
  /** Resolved name for the record's propertyId — the record only stores the id. */
  propertyName: string;
  onClose: () => void;
}

const longDate = (iso: string): string => {
  try {
    return format(parseISO(iso), 'EEE d MMM yyyy');
  } catch {
    return iso;
  }
};

const Field: React.FC<{ label: string; value?: string | number | null; wide?: boolean; mono?: boolean }> = ({
  label,
  value,
  wide = false,
  mono = false,
}) => {
  // Same rule as the console: a field with nothing in it is left out rather
  // than printed as an empty row.
  if (value == null || String(value).trim() === '') return null;
  return (
    <div className={wide ? 'col-span-2' : ''}>
      <dt className="text-[10px] font-semibold uppercase tracking-wide text-ink-muted">{label}</dt>
      <dd className={`mt-0.5 text-[13px] font-medium text-ink break-words ${mono ? 'font-mono text-[11px] text-ink-soft' : ''}`}>
        {String(value)}
      </dd>
    </div>
  );
};

const GuestBlock: React.FC<{ guest: CheckInGuest; index: number; residency?: string }> = ({
  guest,
  index,
  residency,
}) => {
  const [showEvidence, setShowEvidence] = useState(false);
  const travel = [guest.previousLocation, guest.nextLocation].filter(Boolean).join(' → ');

  return (
    <section className="border-t border-line pt-4">
      <header className="flex items-center gap-2.5 mb-3">
        <span className="w-6 h-6 rounded-full bg-brand-tint text-ink-soft text-[11px] font-bold
          flex items-center justify-center shrink-0">
          {index + 1}
        </span>
        <h3 className="flex-1 min-w-0 text-[16px] truncate">{guest.fullName || 'Unnamed guest'}</h3>
        {guest.evidenceUrl ? (
          <span className="shrink-0 inline-flex items-center gap-1 bg-ok-tint text-ok rounded-full px-2 py-0.5 text-[11px] font-semibold">
            <Check className="w-3 h-3" strokeWidth={3} />ID
          </span>
        ) : residency === 'resident' ? (
          <span className="shrink-0 text-[11px] font-medium text-ink-soft">日本居住者</span>
        ) : (
          <span className="shrink-0 bg-warn-tint text-warn rounded-full px-2 py-0.5 text-[11px] font-semibold">
            No ID
          </span>
        )}
      </header>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5">
        <Field label="Birth year" value={guest.birthYear} />
        <Field label="Gender" value={guest.gender} />
        <Field label="Nationality" value={guest.nationality} />
        <Field label="Occupation" value={guest.occupation} />
        <Field label="Document type" value={guest.documentType} />
        <Field label="Document number" value={guest.documentNumber} mono />
        <Field label="Address" value={guest.address} wide />
        <Field label="Contact" value={guest.contactInfo} wide />
        <Field label="Travel" value={travel} wide />
      </dl>

      {guest.evidenceUrl && (
        <div className="mt-4">
          <button
            type="button"
            onClick={() => setShowEvidence((value) => !value)}
            className="w-full h-11 rounded-control bg-brand text-white flex items-center justify-center gap-2
              text-[14px] font-semibold"
          >
            {showEvidence ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            {showEvidence ? 'Hide evidence · ID画像を隠す' : 'View evidence · ID画像を表示'}
          </button>
          {showEvidence && (
            <img
              src={guest.evidenceUrl}
              alt={`ID evidence for ${guest.fullName || 'guest'}`}
              className="mt-3 w-full rounded-control border border-line bg-subtle object-contain"
            />
          )}
        </div>
      )}
    </section>
  );
};

export const CheckInDetailSheet: React.FC<CheckInDetailSheetProps> = ({
  submission,
  propertyName,
  onClose,
}) => {
  if (!submission) return null;

  const [first] = submission.guests;
  const submittedAt = submission.audit?.submittedAt || submission.createdAt;

  return (
    <div
      className="fixed inset-0 z-50 bg-brand/60 backdrop-blur-sm flex items-end animate-dialog-backdrop"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="w-full bg-surface rounded-t-[24px] max-h-[92dvh] overflow-y-auto animate-dialog-panel"
        style={{ paddingBottom: 'calc(1.5rem + env(safe-area-inset-bottom, 0px))' }}
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Check-in record"
      >
        <div className="sticky top-0 bg-surface pt-2.5 z-10">
          <div className="w-10 h-1 rounded-full bg-line-strong mx-auto" />
          <div className="flex items-start justify-between gap-3 px-5 pt-3 pb-3.5 border-b border-line">
            <div className="min-w-0 flex flex-col gap-0.5">
              <h2 className="text-[20px] tracking-[-0.3px] truncate">
                {first?.fullName || 'Check-in record'}
              </h2>
              <span className="text-[13px] text-ink-muted truncate">
                {propertyName} · {submission.guests.length}{' '}
                {submission.guests.length === 1 ? 'guest' : 'guests'}
              </span>
            </div>
            <button type="button" onClick={onClose} aria-label="Close" className="shrink-0 p-1 -mr-1">
              <X className="w-5 h-5 text-ink-soft" />
            </button>
          </div>
        </div>

        <div className="px-5 pt-4">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5">
            <Field
              label="Check-in"
              value={[longDate(submission.checkInDate), submission.checkInTime].filter(Boolean).join(' · ')}
              wide
            />
            <Field
              label="Check-out"
              value={[longDate(submission.checkOutDate), submission.checkOutTime].filter(Boolean).join(' · ')}
              wide
            />
            <Field
              label="Residency"
              value={submission.residency === 'resident'
                ? 'Japan resident · 日本居住者'
                : submission.residency === 'foreign' ? 'Visitor' : null}
              wide
            />
          </dl>
        </div>

        <div className="px-5 pt-4 flex flex-col gap-4">
          {submission.guests.map((guest, index) => (
            <GuestBlock
              key={guest.id}
              guest={guest}
              index={index}
              residency={submission.residency}
            />
          ))}
        </div>

        <div className="px-5 pt-5 mt-4 border-t border-line flex flex-col gap-1">
          <span className="text-[11px] text-ink-muted">
            Submitted {submittedAt ? format(new Date(submittedAt), 'd MMM yyyy HH:mm') : 'at an unknown time'}
          </span>
          <span className="text-[11px] font-mono text-ink-muted break-all">{submission.id}</span>
        </div>
      </div>
    </div>
  );
};

export default CheckInDetailSheet;
