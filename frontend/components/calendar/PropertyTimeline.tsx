import React from 'react';
import { format, parseISO } from 'date-fns';
import { Building2, Settings2 } from 'lucide-react';
import { buildSegments, countVacant, Night, Segment } from './timeline';

/**
 * Every property against one run of dates, one row each.
 *
 * A month grid answers "what is this square doing?" one property at a time.
 * The question a host actually has is "who can I put where?", which needs all
 * the properties side by side and stays drawn as whole objects rather than as
 * a row of identical blocked squares.
 *
 * Laid out with CSS grid rather than absolute positioning: a bar is simply a
 * cell spanning N columns, so nothing has to be measured in pixels and the
 * columns stay aligned with the header at any width.
 */

export interface TimelineRow {
  id: string;
  name: string;
  imageUrl?: string;
  nights: Map<string, Night>;
}

export interface PropertyTimelineProps {
  /** ISO dates, ascending and contiguous. */
  days: string[];
  rows: TimelineRow[];
  todayIso: string;
  /** Clicking a free night — used to block it. Omitted rows are read-only. */
  onToggleNight?: (propertyId: string, iso: string) => void;
  /** Clicking an occupied bar. */
  onSelectSegment?: (propertyId: string, segment: Segment) => void;
  /** Clicking a property's name — opens its settings. */
  onSelectProperty?: (propertyId: string) => void;
  /** The property whose settings are currently open, highlighted in the list. */
  activePropertyId?: string;
  /** Nights mid-request, shown dimmed so a double click is obviously ignored. */
  busyNights?: Set<string>;
}

const BAR: Record<Exclude<Night['kind'], 'free'>, string> = {
  booking: 'bg-brand text-white',
  hold: 'bg-hold-tint text-hold ring-1 ring-inset ring-hold/30',
  imported: 'bg-info-tint text-info ring-1 ring-inset ring-info/25',
  manual: 'bg-ink-muted/25 text-ink-soft ring-1 ring-inset ring-ink-muted/30',
};

const LABEL: Record<Exclude<Night['kind'], 'free'>, string> = {
  booking: 'Direct booking',
  hold: 'Unpaid hold',
  imported: 'Imported',
  manual: 'Blocked',
};

/** Fixed, not minmax(…,1fr): the track would otherwise size to max-content, and
 *  a one-night bar labelled "Blocked" would widen its own column enough to push
 *  a week off the visible area. Every day gets the same width regardless of what
 *  sits in it; the bars truncate instead. */
const DAY_COL = '46px';
/** Set as a custom property so the name column can shrink on a phone, where
 *  215px would leave barely three days visible. */
const NAME_COL = 'var(--tl-name)';

export const PropertyTimeline: React.FC<PropertyTimelineProps> = ({
  days,
  rows,
  todayIso,
  onToggleNight,
  onSelectSegment,
  onSelectProperty,
  activePropertyId,
  busyNights,
}) => {
  const vacant = countVacant(days, rows.map((r) => r.nights));
  const gridStyle: React.CSSProperties = {
    gridTemplateColumns: `${NAME_COL} repeat(${days.length}, ${DAY_COL})`,
  };

  const isWeekend = (iso: string) => {
    const d = parseISO(iso).getDay();
    return d === 0 || d === 6;
  };

  return (
    <div className="overflow-x-auto [--tl-name:132px] md:[--tl-name:215px]">
      {/* min-w forces the horizontal scroll rather than squashing days below legibility. */}
      <div className="w-max">

        {/* Date header */}
        <div className="grid sticky top-0 z-10 bg-surface" style={gridStyle}>
          <div className="border-b border-line" />
          {days.map((iso) => {
            const d = parseISO(iso);
            const today = iso === todayIso;
            return (
              <div
                key={iso}
                className={`border-b border-l border-line py-2 text-center ${
                  today ? 'bg-brand-tint' : isWeekend(iso) ? 'bg-subtle' : ''
                }`}
              >
                <div className={`text-[13px] font-bold ${today ? 'text-brand' : isWeekend(iso) ? 'text-danger' : 'text-ink'}`}>
                  {format(d, 'd')}
                </div>
                <div className={`text-[10px] uppercase tracking-wide ${today ? 'text-brand font-bold' : 'text-ink-muted'}`}>
                  {today ? 'Today' : format(d, 'EEE')}
                </div>
              </div>
            );
          })}
        </div>

        {/* Vacant summary — the row a host scans before answering an enquiry. */}
        <div className="grid" style={gridStyle}>
          <div className="flex items-center px-3 py-2 text-[12px] font-bold uppercase tracking-wide text-ink-soft border-b border-line">
            Vacant
          </div>
          {days.map((iso, i) => (
            <div
              key={iso}
              className={`border-b border-l border-line py-2 text-center text-[13px] tabular-nums ${
                iso === todayIso ? 'bg-brand-tint' : isWeekend(iso) ? 'bg-subtle' : ''
              } ${vacant[i] === 0 ? 'text-danger font-bold' : 'text-ink-soft font-semibold'}`}
              title={`${vacant[i]} of ${rows.length} free`}
            >
              {vacant[i]}
            </div>
          ))}
        </div>

        {/* One row per property */}
        {rows.map((row) => {
          const segments = buildSegments(days, row.nights);
          return (
            // Every child is placed explicitly on row 1. Left to auto-placement,
            // the background cells collide with the bars and get pushed to a
            // second row, splitting each property across two bands.
            <div key={row.id} className="grid items-center" style={gridStyle}>
              <button
                type="button"
                disabled={!onSelectProperty}
                onClick={() => onSelectProperty?.(row.id)}
                title={onSelectProperty ? `${row.name} — open settings` : row.name}
                className={`flex items-center gap-2.5 px-3 py-2.5 border-b border-line min-w-0 h-full text-left
                  transition-colors ${
                    row.id === activePropertyId ? 'bg-brand-tint' : onSelectProperty ? 'hover:bg-subtle' : ''
                  } ${onSelectProperty ? 'cursor-pointer' : 'cursor-default'}`}
                style={{ gridRow: 1, gridColumn: 1 }}
              >
                {row.imageUrl ? (
                  <img src={row.imageUrl} alt="" className="w-9 h-9 rounded-control object-cover shrink-0" />
                ) : (
                  <div className="w-9 h-9 rounded-control bg-subtle flex items-center justify-center shrink-0">
                    <Building2 className="w-4 h-4 text-ink-muted" />
                  </div>
                )}
                <span className="text-[14px] font-semibold text-ink truncate">{row.name}</span>
                {onSelectProperty && <Settings2 className="w-3.5 h-3.5 text-ink-muted shrink-0 ml-auto" />}
              </button>

              {/* Background cells keep the column rules visible under the bars. */}
              {days.map((iso, i) => (
                <div
                  key={iso}
                  className={`border-b border-l border-line h-[46px] ${
                    iso === todayIso ? 'bg-brand-tint/60' : isWeekend(iso) ? 'bg-subtle' : ''
                  }`}
                  style={{ gridRow: 1, gridColumn: i + 2 }}
                />
              ))}

              {segments.map((seg) => {
                const startCol = seg.start + 2; // grid is 1-based and column 1 is the name
                if (seg.kind === 'free') {
                  return (
                    <div
                      key={`${row.id}-free-${seg.start}`}
                      className="h-[46px] flex"
                      style={{ gridRow: 1, gridColumn: `${startCol} / span ${seg.span}` }}
                    >
                      {Array.from({ length: seg.span }, (_, k) => {
                        const iso = days[seg.start + k];
                        const busy = busyNights?.has(`${row.id}:${iso}`);
                        return (
                          <button
                            key={iso}
                            type="button"
                            disabled={!onToggleNight || busy}
                            onClick={() => onToggleNight?.(row.id, iso)}
                            aria-label={`${row.name}, ${iso}, available — block this night`}
                            className={`flex-1 min-w-0 transition-colors disabled:cursor-default
                              ${busy ? 'opacity-40' : 'hover:bg-ink-muted/15'}`}
                          />
                        );
                      })}
                    </div>
                  );
                }

                const kind = seg.kind as Exclude<Night['kind'], 'free'>;
                const clickable = kind === 'manual' ? Boolean(onToggleNight) : Boolean(onSelectSegment);
                return (
                  <button
                    key={`${row.id}-${seg.kind}-${seg.start}`}
                    type="button"
                    disabled={!clickable}
                    onClick={() =>
                      kind === 'manual'
                        ? onToggleNight?.(row.id, days[seg.start])
                        : onSelectSegment?.(row.id, seg)
                    }
                    title={`${seg.label || LABEL[kind]} · ${days[seg.start]} → ${days[seg.start + seg.span - 1]}`}
                    className={`h-[34px] my-1.5 mx-0.5 rounded-control px-2 flex items-center overflow-hidden
                      text-[12px] font-semibold ${BAR[kind]} ${clickable ? 'cursor-pointer hover:brightness-95' : 'cursor-default'}`}
                    style={{ gridRow: 1, gridColumn: `${startCol} / span ${seg.span}` }}
                  >
                    <span className="truncate">{seg.label || LABEL[kind]}</span>
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default PropertyTimeline;
