import React, { useState } from 'react';
import { AlertCircle, Loader2, Plus, X } from 'lucide-react';
import type { PropertyCalendarEventInput } from '../../services/calendar';
import { HostProperty } from '../../services/hostApp';
import { eventDateWindow, validateEventDraft } from '../../utils/eventDraft';
import {
  fieldClass,
  labelClass,
  selectClass,
  sheetBackdropClass,
  sheetPanelClass,
  textareaClass,
} from './sheetControls';

/**
 * Putting one of the host's own appointments on the calendar — a cleaner, a
 * plumber, a key handover.
 *
 * Create only for now: changing and removing an event come later. The sheet
 * keeps everything typed when the save fails, so a refused request costs a
 * tap, not the whole form.
 */
export interface EventSheetProps {
  /** YYYY-MM-DD: the day the host had open. Pre-fills the date field. */
  date: string;
  /** Properties an event can go on: the visible ones whose calendar loaded,
   *  in the order of the full list. */
  properties: HostProperty[];
  /** The calendar is loading. Saving waits until it is done, so the new event
   *  is not written over by a load that started before it. */
  busy: boolean;
  onClose: () => void;
  onCreate: (propertyId: string, input: PropertyCalendarEventInput) => Promise<void>;
}

export const EventSheet: React.FC<EventSheetProps> = ({
  date: initialDate,
  properties,
  busy,
  onClose,
  onCreate,
}) => {
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [date, setDate] = useState(() => initialDate);
  const [startTime, setStartTime] = useState('10:00');
  const [endTime, setEndTime] = useState('11:00');
  const [propertyId, setPropertyId] = useState(() => properties[0]?.id ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dateWindow = eventDateWindow();

  const handleSave = async () => {
    const problem = validateEventDraft({ title, note, date, startTime, endTime });
    if (problem) {
      setError(problem);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onCreate(propertyId, { title: title.trim(), note: note.trim(), date, startTime, endTime });
    } catch (cause) {
      setError((cause instanceof Error && cause.message) || 'Could not save the event.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={sheetBackdropClass} onClick={onClose} role="presentation">
      <div
        className={sheetPanelClass}
        style={{ paddingBottom: 'calc(1.5rem + env(safe-area-inset-bottom, 0px))' }}
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="New event"
      >
        <div className="pt-2.5 sticky top-0 bg-surface z-10">
          <div className="w-10 h-1 rounded-full bg-line-strong mx-auto" />
          <div className="flex items-start gap-2 px-5 pt-3 pb-3.5 border-b border-line">
            <div className="flex-1 min-w-0 flex flex-col gap-0.5">
              <h2 className="text-[20px] tracking-[-0.3px] truncate">New event</h2>
              <span className="text-[13px] text-ink-muted truncate">
                Only you see it. It does not block the night.
              </span>
            </div>
            <button type="button" onClick={onClose} aria-label="Close" className="shrink-0 p-1 -mr-1 mt-0.5">
              <X className="w-5 h-5 text-ink-soft" />
            </button>
          </div>
        </div>

        <div className="px-5 pt-4 flex flex-col gap-4">
          {error && (
            <div
              role="alert"
              className="flex items-start gap-2.5 bg-danger-tint text-danger border border-danger/20
                rounded-control px-3.5 py-3 text-[13px]"
            >
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span className="flex-1 min-w-0">{error}</span>
            </div>
          )}

          <label className="block">
            <span className={labelClass}>Title *</span>
            <input
              value={title}
              onChange={(event) => { setTitle(event.target.value); setError(null); }}
              className={fieldClass}
              maxLength={200}
              placeholder="Cleaner"
            />
          </label>

          <label className="block">
            <span className={labelClass}>Note</span>
            <textarea
              value={note}
              onChange={(event) => { setNote(event.target.value); setError(null); }}
              className={textareaClass}
              rows={3}
              maxLength={2000}
            />
          </label>

          <label className="block">
            <span className={labelClass}>Date *</span>
            <input
              type="date"
              value={date}
              onChange={(event) => { setDate(event.target.value); setError(null); }}
              min={dateWindow.from}
              max={dateWindow.to}
              className={fieldClass}
            />
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className={labelClass}>Starts</span>
              <input
                type="time"
                value={startTime}
                onChange={(event) => { setStartTime(event.target.value); setError(null); }}
                step={60}
                className={fieldClass}
              />
            </label>
            <label className="block">
              <span className={labelClass}>Ends</span>
              <input
                type="time"
                value={endTime}
                onChange={(event) => { setEndTime(event.target.value); setError(null); }}
                step={60}
                className={fieldClass}
              />
            </label>
          </div>

          {properties.length >= 2 && (
            <label className="block">
              <span className={labelClass}>House</span>
              <select
                value={propertyId}
                onChange={(event) => { setPropertyId(event.target.value); setError(null); }}
                className={selectClass}
              >
                {properties.map((property) => (
                  <option key={property.id} value={property.id}>{property.name}</option>
                ))}
              </select>
            </label>
          )}

          <div className="flex flex-col gap-1.5">
            <button
              type="button"
              onClick={() => { void handleSave(); }}
              disabled={saving || busy || properties.length === 0}
              className="h-13 min-h-[52px] rounded-control bg-brand text-white
                font-['Plus_Jakarta_Sans'] text-[15px] font-bold flex items-center justify-center gap-2
                disabled:opacity-50"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              Save event
            </button>
            {busy && <p className="text-center text-[12px] text-ink-muted">Updating calendar…</p>}
          </div>
        </div>
      </div>
    </div>
  );
};

export default EventSheet;
