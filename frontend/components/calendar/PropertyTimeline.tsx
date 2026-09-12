import React from 'react';
import { format, parseISO } from 'date-fns';
import { Building2, Settings2, Users } from 'lucide-react';
import { OccupiedKind, TimelineBar } from './timeline';
import { assignLanes } from '../../utils/stayLanes';

/**
 * Every property against one run of dates, one row each.
 *
 * A month grid answers "what is this square doing?" one property at a time.
 * The question a host actually has is "who can I put where?", which needs all
 * the properties side by side and stays drawn as whole objects rather than as
 * a row of identical blocked squares.
 *
 * A property's row is as tall as the most parties it ever holds at once. One
 * party is one lane and the row looks as it always did; a house let to two
 * groups over the same nights grows a second lane, so each group keeps an
 * unbroken bar and the overlap is the place where the two are side by side.
 *
 * Laid out with CSS grid rather than absolute positioning: a bar is simply a
 * cell spanning N columns on its lane's row, so nothing has to be measured in
 * pixels and the columns stay aligned with the header at any width.
 */

export interface TimelineRow {
  id: string;
  name: string;
  imageUrl?: string;
  /** Stays and blocks, in any order — lanes are assigned here. */
  bars: TimelineBar[];
}

export interface PropertyTimelineProps {
  /** ISO dates, ascending and contiguous. */
  days: string[];
  rows: TimelineRow[];
  todayIso: string;
  /** Clicking a free night — used to block it. Omitted rows are read-only. */
  onToggleNight?: (propertyId: string, iso: string) => void;
  /** Clicking an occupied bar. */
  onSelectBar?: (propertyId: string, bar: TimelineBar) => void;
  /** Clicking a property's name — opens its settings. */
  onSelectProperty?: (propertyId: string) => void;
  /** The property whose settings are currently open, highlighted in the list. */
  activePropertyId?: string;
  /** Nights mid-request, shown dimmed so a double click is obviously ignored. */
  busyNights?: Set<string>;
}

const BAR: Record<OccupiedKind, string> = {
  booking: 'bg-brand text-white',
  hold: 'bg-hold-tint text-hold ring-1 ring-inset ring-hold/30',
  imported: 'bg-info-tint text-info ring-1 ring-inset ring-info/25',
  // Drained of colour and hatched. A block is the absence of a booking and
  // must not read as one of the filled, channel-coloured stays beside it.
  'imported-block': 'bg-subtle text-ink-muted ring-1 ring-inset ring-line-strong',
  manual: 'bg-ink-muted/25 text-ink-soft ring-1 ring-inset ring-ink-muted/30',
};

/** The hatch itself. Inline rather than an arbitrary `bg-[…]` class: the value
 *  is a gradient with its own commas and parentheses, and it has to survive
 *  the utility pipeline intact for the bar to look unlike a stay at all. */
const HATCH: React.CSSProperties = {
  backgroundImage:
    'repeating-linear-gradient(45deg, transparent, transparent 5px, rgba(0,0,0,0.06) 5px, rgba(0,0,0,0.06) 10px)',
};

const LABEL: Record<OccupiedKind, string> = {
  booking: 'Direct booking',
  hold: 'Unpaid hold',
  imported: 'Imported',
  'imported-block': 'Blocked (synced)',
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
/** One lane. A two-lane row is exactly twice this, so the day columns and the
 *  header stay aligned however many parties a property holds. */
const LANE_H = 46;

export const PropertyTimeline: React.FC<PropertyTimelineProps> = ({
  days,
  rows,
  todayIso,
  onToggleNight,
  onSelectBar,
  onSelectProperty,
  activePropertyId,
  busyNights,
}) => {
  const gridStyle: React.CSSProperties = {
    gridTemplateColumns: `${NAME_COL} repeat(${days.length}, ${DAY_COL})`,
  };

  const isWeekend = (iso: string) => {
    const d = parseISO(iso).getDay();
    return d === 0 || d === 6;
  };

  const dayIndex = new Map(days.map((iso, index) => [iso, index]));

  return (
    <div className="overflow-x-auto [--tl-name:132px] md:[--tl-name:215px]">
      {/* min-w forces the horizontal scroll rather than squashing days below legibility. */}
      <div className="w-max">

        {/* Date header */}
        <div className="grid sticky top-0 z-10 bg-surface" style={gridStyle}>
          <div className="border-b border-line-strong" />
          {days.map((iso) => {
            const d = parseISO(iso);
            const today = iso === todayIso;
            return (
              <div
                key={iso}
                className={`border-b border-l border-line-strong py-2 text-center ${
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

        {/* One row per property, one lane per concurrent party */}
        {rows.map((row) => {
          const { laned, laneCount } = assignLanes(
            row.bars,
            (bar) => ({ firstNight: bar.firstNight, lastNight: bar.lastNight }),
          );

          // Which nights are spoken for, so the rest stay clickable to block.
          const occupied = new Set<string>();
          for (const bar of row.bars) {
            for (let i = 0; i < days.length; i++) {
              if (days[i] >= bar.firstNight && days[i] <= bar.lastNight) occupied.add(days[i]);
            }
          }

          const rowStyle: React.CSSProperties = {
            ...gridStyle,
            gridTemplateRows: `repeat(${laneCount}, ${LANE_H}px)`,
          };
          const fullHeight = `1 / span ${laneCount}`;

          return (
            // Every child is placed explicitly. Left to auto-placement, the
            // background cells collide with the bars and get pushed onto rows
            // of their own, splitting each property into extra bands.
            <div key={row.id} className="grid items-stretch" style={rowStyle}>
              <button
                type="button"
                disabled={!onSelectProperty}
                onClick={() => onSelectProperty?.(row.id)}
                title={onSelectProperty ? `${row.name} — open settings` : row.name}
                className={`flex items-center gap-2.5 px-3 py-2.5 border-b border-line-strong min-w-0 h-full text-left
                  transition-colors ${
                    row.id === activePropertyId ? 'bg-brand-tint' : onSelectProperty ? 'hover:bg-subtle' : ''
                  } ${onSelectProperty ? 'cursor-pointer' : 'cursor-default'}`}
                style={{ gridRow: fullHeight, gridColumn: 1 }}
              >
                {row.imageUrl ? (
                  <img src={row.imageUrl} alt="" className="w-9 h-9 rounded-control object-cover shrink-0" />
                ) : (
                  <div className="w-9 h-9 rounded-control bg-subtle flex items-center justify-center shrink-0">
                    <Building2 className="w-4 h-4 text-ink-muted" />
                  </div>
                )}
                <span className="min-w-0 flex flex-col">
                  <span className="text-[14px] font-semibold text-ink truncate">{row.name}</span>
                  {laneCount > 1 && (
                    <span className="flex items-center gap-1 text-[11px] font-semibold text-warn">
                      <Users className="w-3 h-3 shrink-0" />
                      {laneCount} parties
                    </span>
                  )}
                </span>
                {onSelectProperty && <Settings2 className="w-3.5 h-3.5 text-ink-muted shrink-0 ml-auto" />}
              </button>

              {/* One cell per day, spanning every lane. A free night is the
                  button that blocks it; an occupied one is inert background
                  that keeps the column rules visible under the bars. */}
              {days.map((iso, i) => {
                const tone = iso === todayIso ? 'bg-brand-tint/60' : isWeekend(iso) ? 'bg-subtle' : '';
                const cellStyle: React.CSSProperties = { gridRow: fullHeight, gridColumn: i + 2 };

                if (occupied.has(iso) || !onToggleNight) {
                  return (
                    <div
                      key={iso}
                      className={`border-b border-l border-line-strong ${tone}`}
                      style={cellStyle}
                    />
                  );
                }

                const busy = busyNights?.has(`${row.id}:${iso}`);
                return (
                  <button
                    key={iso}
                    type="button"
                    disabled={busy}
                    onClick={() => onToggleNight(row.id, iso)}
                    aria-label={`${row.name}, ${iso}, available — block this night`}
                    className={`border-b border-l border-line-strong transition-colors disabled:cursor-default ${tone}
                      ${busy ? 'opacity-40' : 'hover:bg-ink-muted/15'}`}
                    style={cellStyle}
                  />
                );
              })}

              {laned.map(({ item: bar, lane }, index) => {
                // A bar can start before the window or end after it; clamp to
                // what is on screen so it still draws, running to the edge.
                const from = dayIndex.has(bar.firstNight)
                  ? dayIndex.get(bar.firstNight)!
                  : bar.firstNight < days[0] ? 0 : -1;
                const to = dayIndex.has(bar.lastNight)
                  ? dayIndex.get(bar.lastNight)!
                  : bar.lastNight > days[days.length - 1] ? days.length - 1 : -1;
                if (from === -1 || to === -1 || to < from) return null;

                const clickable = bar.kind === 'manual' ? Boolean(onToggleNight) : Boolean(onSelectBar);
                return (
                  <button
                    key={`${row.id}-${bar.kind}-${bar.ref ?? ''}-${bar.firstNight}-${index}`}
                    type="button"
                    disabled={!clickable}
                    onClick={() =>
                      bar.kind === 'manual'
                        ? onToggleNight?.(row.id, bar.firstNight)
                        : onSelectBar?.(row.id, bar)
                    }
                    title={`${bar.label || LABEL[bar.kind]} · ${bar.firstNight} → ${bar.lastNight}`}
                    className={`h-[34px] my-1.5 mx-0.5 rounded-control px-2 flex items-center overflow-hidden
                      text-[12px] font-semibold ${BAR[bar.kind]} ${
                        clickable ? 'cursor-pointer hover:brightness-95' : 'cursor-default'
                      }`}
                    style={{
                      gridRow: lane + 1,
                      gridColumn: `${from + 2} / span ${to - from + 1}`,
                      ...(bar.kind === 'imported-block' ? HATCH : null),
                    }}
                  >
                    <span className="truncate">{bar.label || LABEL[bar.kind]}</span>
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
