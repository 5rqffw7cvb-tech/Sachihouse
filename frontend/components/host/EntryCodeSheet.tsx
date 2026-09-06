import React, { useEffect, useState } from 'react';
import { AlertCircle, Check, Copy, KeyRound, Loader2, Pencil, X } from 'lucide-react';
import { getCheckInInfo, updateCheckInInfo } from '../../services/storage';
import { copyText, HostProperty } from '../../services/hostApp';

/**
 * The door code for one property, readable and editable on the phone.
 *
 * This is the same `checkInInfo.entryCode` the console edits and the check-in
 * welcome email sends to a guest once they have submitted their details — so
 * changing it here changes what the next guest is told. The sheet says so
 * rather than letting a host discover it afterwards.
 *
 * It reads and writes through the narrow /check-in-info routes, never the
 * whole-property PUT: changing a door code should not put the property's
 * description, photos and rates on the line.
 */
export interface EntryCodeSheetProps {
  property: HostProperty;
  /** False for a host below level 2, who may read the code but not change it. */
  canEdit: boolean;
  onClose: () => void;
}

export const EntryCodeSheet: React.FC<EntryCodeSheetProps> = ({ property, canEdit, onClose }) => {
  const [code, setCode] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [isEditing, setIsEditing] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    getCheckInInfo(property.id)
      .then((info) => {
        if (cancelled) return;
        setCode(info.entryCode ?? '');
        setDraft(info.entryCode ?? '');
        setError(null);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setError(cause instanceof Error ? cause.message : 'Could not load the entry code.');
      })
      .finally(() => { if (!cancelled) setIsLoading(false); });

    return () => { cancelled = true; };
  }, [property.id]);

  const handleCopy = async () => {
    if (!code) return;
    await copyText(code);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  };

  const handleSave = async () => {
    setIsSaving(true);
    setError(null);
    try {
      const info = await updateCheckInInfo(property.id, { entryCode: draft });
      setCode(info.entryCode ?? '');
      setDraft(info.entryCode ?? '');
      setIsEditing(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save the entry code.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-brand/60 backdrop-blur-sm flex items-end animate-dialog-backdrop"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="w-full bg-surface rounded-t-[24px] max-h-[88dvh] overflow-y-auto animate-dialog-panel"
        style={{ paddingBottom: 'calc(1.5rem + env(safe-area-inset-bottom, 0px))' }}
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Entry code"
      >
        <div className="pt-2.5">
          <div className="w-10 h-1 rounded-full bg-line-strong mx-auto" />
          <div className="flex items-start justify-between gap-3 px-5 pt-3 pb-3.5 border-b border-line">
            <div className="min-w-0 flex flex-col gap-0.5">
              <h2 className="text-[20px] tracking-[-0.3px] truncate">{property.name}</h2>
              <span className="text-[13px] text-ink-muted truncate">{property.address}</span>
            </div>
            <button type="button" onClick={onClose} aria-label="Close" className="shrink-0 p-1 -mr-1">
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
            <span className="flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wide text-ink-soft mb-2">
              <KeyRound className="w-3.5 h-3.5" />
              Entry code
            </span>

            {isLoading ? (
              <div className="h-[60px] rounded-control bg-subtle border border-line flex items-center justify-center">
                <Loader2 className="w-5 h-5 animate-spin text-ink-muted" />
              </div>
            ) : isEditing ? (
              <textarea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                rows={2}
                autoFocus
                placeholder="Door code, keybox code, or free-text instructions"
                className="w-full px-3.5 py-3 rounded-control bg-subtle border border-line text-[18px] text-ink
                  placeholder:text-[15px] placeholder:text-ink-muted focus:outline-none focus:border-brand
                  focus:ring-2 focus:ring-brand/15"
              />
            ) : (
              <div className="min-h-[60px] px-3.5 py-3 rounded-control bg-subtle border border-line
                flex items-center">
                {code ? (
                  <span className="text-[22px] font-semibold text-ink tracking-[0.04em] break-all">{code}</span>
                ) : (
                  <span className="text-[15px] text-ink-muted">Not set yet.</span>
                )}
              </div>
            )}
          </div>

          {isEditing ? (
            <div className="flex gap-2.5">
              <button
                type="button"
                onClick={() => { setDraft(code ?? ''); setIsEditing(false); setError(null); }}
                disabled={isSaving}
                className="flex-1 h-13 min-h-[52px] rounded-control bg-surface border border-line-strong
                  text-[15px] font-semibold text-ink disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => { void handleSave(); }}
                disabled={isSaving || draft.trim() === (code ?? '').trim()}
                className="flex-1 h-13 min-h-[52px] rounded-control bg-brand text-white
                  font-['Plus_Jakarta_Sans'] text-[15px] font-bold flex items-center justify-center gap-2
                  disabled:opacity-50"
              >
                {isSaving && <Loader2 className="w-4 h-4 animate-spin" />}
                Save
              </button>
            </div>
          ) : (
            <div className="flex gap-2.5">
              <button
                type="button"
                onClick={() => { void handleCopy(); }}
                disabled={isLoading || !code}
                className="flex-1 h-13 min-h-[52px] rounded-control bg-surface border border-line-strong
                  flex items-center justify-center gap-2 text-[15px] font-semibold text-ink disabled:opacity-50"
              >
                {copied
                  ? <><Check className="w-[18px] h-[18px]" /> Copied</>
                  : <><Copy className="w-[18px] h-[18px]" /> Copy</>}
              </button>
              {canEdit && (
                <button
                  type="button"
                  onClick={() => setIsEditing(true)}
                  disabled={isLoading}
                  className="flex-1 h-13 min-h-[52px] rounded-control bg-brand text-white
                    flex items-center justify-center gap-2 font-['Plus_Jakarta_Sans'] text-[15px] font-bold
                    disabled:opacity-50"
                >
                  <Pencil className="w-[18px] h-[18px]" />
                  {code ? 'Change' : 'Set code'}
                </button>
              )}
            </div>
          )}

          <p className="text-[12px] text-ink-muted leading-relaxed">
            {canEdit
              ? 'This is the code emailed to a guest once they submit their check-in. Change it here and the next guest gets the new one.'
              : 'Changing the entry code needs host level 2. Ask an administrator to raise your level.'}
          </p>
        </div>
      </div>
    </div>
  );
};

export default EntryCodeSheet;
