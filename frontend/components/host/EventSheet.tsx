import React, { useState } from 'react';
import { AlertCircle, Loader2, Plus, Trash2, X } from 'lucide-react';
import type {
  PropertyCalendarEvent,
  PropertyCalendarEventInput,
  PropertyCalendarEventPatch,
} from '../../services/calendar';
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
 * plumber, a key handover — or changing and removing one already there.
 *
 * Passing `event` opens the sheet on that event; without it the sheet makes a
 * new one. The sheet keeps everything typed when a request fails, so a
 * refused request costs a tap, not the whole form.
 */
interface EventSheetBase {
  /** The calendar is loading. Saving waits until it is done, so the change is
   *  not written over by a load that started before it. */
  busy: boolean;
  onClose: () => void;
}

export type CreateEventSheetProps = EventSheetBase & {
  /** YYYY-MM-DD: the day the host had open. Pre-fills the date field. */
  date: string;
  /** Properties an event can go on: the visible ones whose calendar loaded,
   *  in the order of the full list. */
  properties: HostProperty[];
  onCreate: (propertyId: string, input: PropertyCalendarEventInput) => Promise<void>;
  event?: undefined;
};

export type EditEventSheetProps = EventSheetBase & {
  /** The event being changed. Pre-fills every field. */
  event: PropertyCalendarEvent;
  /** The house it is on. Shown, not editable: an event stays on its house. */
  propertyName: string;
  onUpdate: (event: PropertyCalendarEvent, patch: PropertyCalendarEventPatch) => Promise<void>;
  onDelete: (event: PropertyCalendarEvent) => Promise<void>;
};

export type EventSheetProps = CreateEventSheetProps | EditEventSheetProps;

/** The sheet edits when it is given an event. A guard rather than an inline
 *  `props.event !== undefined`: without strictNullChecks that check does not
 *  narrow the union. */
function isEditProps(props: EventSheetProps): props is EditEventSheetProps {
  return props.event !== undefined;
}

export const EventSheet: React.FC<EventSheetProps> = (props) => {
  const { busy, onClose } = props;
  const isEdit = isEditProps(props);
  const [title, setTitle] = useState(() => props.event?.title ?? '');
  const [note, setNote] = useState(() => props.event?.note ?? '');
  const [date, setDate] = useState(() => (isEditProps(props) ? props.event.date : props.date));
  const [startTime, setStartTime] = useState(() => props.event?.startTime ?? '10:00');
  const [endTime, setEndTime] = useState(() => props.event?.endTime ?? '11:00');
  const [propertyId, setPropertyId] = useState(() =>
    (isEditProps(props) ? '' : props.properties[0]?.id ?? ''));
  const [pending, setPending] = useState<'save' | 'delete' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const dateWindow = eventDateWindow();
  const properties = isEditProps(props) ? [] : props.properties;
  // The list can change under an open sheet: a refresh can lose the house the
  // select still shows. Fall back to the first one left rather than post to a
  // house the calendar no longer has.
  const effectiveId = properties.some((property) => property.id === propertyId)
    ? propertyId
    : (properties[0]?.id ?? '');
  const heading = isEdit ? 'Edit event' : 'New event';

  // A request in flight finishes in this sheet: closing it now would hide the
  // error if the request fails.
  const requestClose = () => {
    if (pending) return;
    onClose();
  };

  const handleSave = async () => {
    const draft = { title, note, date, startTime, endTime };
    // The date window is only checked when the date changes. An event that has
    // drifted out of it since it was made can still be retitled or retimed:
    // measured from its own day, its date always sits inside the window.
    const problem = isEditProps(props) && date === props.event.date
      ? validateEventDraft(draft, Date.parse(`${date}T00:00:00+09:00`))
      : validateEventDraft(draft);
    if (problem) {
      setError(problem);
      return;
    }
    setPending('save');
    setError(null);
    const input = { title: title.trim(), note: note.trim(), date, startTime, endTime };
    try {
      if (isEditProps(props)) {
        await props.onUpdate(props.event, input);
      } else {
        await props.onCreate(effectiveId, input);
      }
    } catch (cause) {
      setError((cause instanceof Error && cause.message) || 'Could not save the event.');
    } finally {
      setPending(null);
    }
  };

  const handleDelete = async () => {
    if (!isEditProps(props)) return;
    if (!window.confirm('Delete this event? This cannot be undone.')) return;
    setPending('delete');
    setError(null);
    try {
      await props.onDelete(props.event);
    } catch (cause) {
      setError((cause instanceof Error && cause.message) || 'Could not delete the event.');
    } finally {
      setPending(null);
    }
  };

  return (
    <div className={sheetBackdropClass} onClick={requestClose} role="presentation">
      <div
        className={sheetPanelClass}
        style={{ paddingBottom: 'calc(1.5rem + env(safe-area-inset-bottom, 0px))' }}
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={heading}
      >
        <div className="pt-2.5 sticky top-0 bg-surface z-10">
          <div className="w-10 h-1 rounded-full bg-line-strong mx-auto" />
          <div className="flex items-start gap-2 px-5 pt-3 pb-3.5 border-b border-line">
            <div className="flex-1 min-w-0 flex flex-col gap-0.5">
              <h2 className="text-[20px] tracking-[-0.3px] truncate">{heading}</h2>
              <span className="text-[13px] text-ink-muted truncate">
                Only you see it. It does not block the night.
              </span>
            </div>
            <button type="button" onClick={requestClose} aria-label="Close" className="shrink-0 p-1 -mr-1 mt-0.5">
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

          {isEditProps(props) ? (
            <div>
              <span className={labelClass}>House</span>
              <p className="text-[15px] text-ink truncate">{props.propertyName}</p>
            </div>
          ) : properties.length >= 2 && (
            <label className="block">
              <span className={labelClass}>House</span>
              <select
                value={effectiveId}
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
              disabled={pending !== null || busy || (!isEdit && properties.length === 0)}
              className="h-13 min-h-[52px] rounded-control bg-brand text-white
                font-['Plus_Jakarta_Sans'] text-[15px] font-bold flex items-center justify-center gap-2
                disabled:opacity-50"
            >
              {pending === 'save' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              Save event
            </button>
            {isEdit && (
              <button
                type="button"
                onClick={() => { void handleDelete(); }}
                disabled={pending !== null || busy}
                className="h-13 min-h-[52px] rounded-control bg-surface border border-danger/30 text-danger
                  font-['Plus_Jakarta_Sans'] text-[15px] font-bold flex items-center justify-center gap-2
                  active:bg-danger-tint disabled:opacity-50"
              >
                {pending === 'delete' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                Delete event
              </button>
            )}
            {busy && <p className="text-center text-[12px] text-ink-muted">Updating calendar…</p>}
          </div>
        </div>
      </div>
    </div>
  );
};

export default EventSheet;
