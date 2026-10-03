import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PropertyTimeline, TimelineEventMarker, TimelineRow } from './PropertyTimeline';
import type { TimelineBar } from './timeline';

// One week, two houses. The dots are host appointments: they must show on the
// day, open on click, and never take a night or a lane away from the board.
const days = [
  '2026-10-01',
  '2026-10-02',
  '2026-10-03',
  '2026-10-04',
  '2026-10-05',
  '2026-10-06',
  '2026-10-07',
];

const marker = (iso: string, count: number): TimelineEventMarker => ({
  iso,
  count,
  title: Array.from({ length: count }, (_, i) => `1${i}:00–1${i + 1}:00 · Job ${i + 1}`).join('\n'),
});

const rows = (p1: Partial<TimelineRow> = {}, p2: Partial<TimelineRow> = {}): TimelineRow[] => [
  { id: 'p1', name: 'House A', bars: [], ...p1 },
  { id: 'p2', name: 'House B', bars: [], ...p2 },
];

function renderTimeline(
  timelineRows: TimelineRow[],
  props: Partial<React.ComponentProps<typeof PropertyTimeline>> = {},
) {
  const onToggleNight = vi.fn();
  const onSelectBar = vi.fn();
  const onSelectEvents = vi.fn();
  const utils = render(
    <PropertyTimeline
      days={days}
      rows={timelineRows}
      todayIso="2026-10-01"
      onToggleNight={onToggleNight}
      onSelectBar={onSelectBar}
      onSelectEvents={onSelectEvents}
      {...props}
    />,
  );
  return { ...utils, onToggleNight, onSelectBar, onSelectEvents };
}

const eventButtons = () => screen.queryAllByRole('button', { name: /event/ });

describe('PropertyTimeline event dots', () => {
  it('(a) draws one dot per day with the count, in that day\'s column, only for the row and days it belongs to', () => {
    renderTimeline(rows({ events: [marker('2026-10-05', 2), marker('2026-10-02', 1), marker('2026-11-30', 3)] }));

    const two = screen.getAllByRole('button', { name: '2 events on 2026-10-05 — House A' });
    expect(two).toHaveLength(1);
    expect(two[0]).toHaveTextContent('2');
    // Column 1 is the name; day i sits in column i + 2. 2026-10-05 is index 4.
    expect(two[0].style.gridColumn).toBe('6');
    expect(two[0]).toHaveAttribute('title', '10:00–11:00 · Job 1\n11:00–12:00 · Job 2');

    const one = screen.getByRole('button', { name: '1 event on 2026-10-02 — House A' });
    expect(one.textContent).toBe('');
    expect(one.style.gridColumn).toBe('3');

    // A day outside the window draws nothing, and the other house has no dots.
    expect(screen.queryByRole('button', { name: /on 2026-11-30/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /event.*House B/ })).toBeNull();
    expect(eventButtons()).toHaveLength(2);
  });

  it('(a) skips a marker whose count is below one', () => {
    renderTimeline(rows({ events: [marker('2026-10-03', 0)] }));
    expect(eventButtons()).toHaveLength(0);
  });

  it('(b) clicking a dot selects the events and neither blocks the night nor opens a bar', () => {
    const { onSelectEvents, onToggleNight, onSelectBar } = renderTimeline(
      rows({ events: [marker('2026-10-05', 2)] }),
    );

    fireEvent.click(screen.getByRole('button', { name: '2 events on 2026-10-05 — House A' }));

    expect(onSelectEvents).toHaveBeenCalledTimes(1);
    expect(onSelectEvents).toHaveBeenCalledWith('p1', '2026-10-05');
    expect(onToggleNight).not.toHaveBeenCalled();
    expect(onSelectBar).not.toHaveBeenCalled();
  });

  it('(b) the dot is a sibling of the night, not nested in it', () => {
    renderTimeline(rows({ events: [marker('2026-10-05', 1)] }));
    const dot = screen.getByRole('button', { name: '1 event on 2026-10-05 — House A' });
    const night = screen.getByRole('button', { name: 'House A, 2026-10-05, available — block this night' });
    expect(night.contains(dot)).toBe(false);
    expect(dot.parentElement).toBe(night.parentElement);
  });

  it('washes the event day yellow in its own row only, over the today tint', () => {
    renderTimeline(rows({ events: [marker('2026-10-05', 1), marker('2026-10-01', 1)] }));

    const night = (house: string, iso: string) =>
      screen.getByRole('button', { name: `${house}, ${iso}, available — block this night` });
    expect(night('House A', '2026-10-05')).toHaveClass('bg-[#fef9c3]');
    // Today (10-01) with an event shows the event wash, not the today tint.
    expect(night('House A', '2026-10-01')).toHaveClass('bg-[#fef9c3]');
    expect(night('House A', '2026-10-01')).not.toHaveClass('bg-brand-tint/60');
    // Same day, other house: untouched; other day, same house: untouched.
    expect(night('House B', '2026-10-05')).not.toHaveClass('bg-[#fef9c3]');
    expect(night('House B', '2026-10-01')).toHaveClass('bg-brand-tint/60');
    expect(night('House A', '2026-10-06')).not.toHaveClass('bg-[#fef9c3]');
  });

  it('(c) a free night with a dot can still be blocked', () => {
    const { onToggleNight, onSelectEvents } = renderTimeline(rows({ events: [marker('2026-10-05', 2)] }));

    fireEvent.click(screen.getByRole('button', { name: 'House A, 2026-10-05, available — block this night' }));

    expect(onToggleNight).toHaveBeenCalledTimes(1);
    expect(onToggleNight).toHaveBeenCalledWith('p1', '2026-10-05');
    expect(onSelectEvents).not.toHaveBeenCalled();
  });

  it('(c) a manual block over a day with a dot still frees on click', () => {
    const manual: TimelineBar = { kind: 'manual', firstNight: '2026-10-04', lastNight: '2026-10-06' };
    const { onToggleNight, onSelectEvents, onSelectBar } = renderTimeline(
      rows({ bars: [manual], events: [marker('2026-10-05', 1)] }),
    );

    // The dot is there on the blocked day too.
    expect(screen.getByRole('button', { name: '1 event on 2026-10-05 — House A' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Blocked' }));

    expect(onToggleNight).toHaveBeenCalledWith('p1', '2026-10-04');
    expect(onSelectEvents).not.toHaveBeenCalled();
    expect(onSelectBar).not.toHaveBeenCalled();
  });

  it('(d) dots take no night and no lane', () => {
    const booking: TimelineBar = {
      kind: 'booking',
      label: 'Tanaka',
      ref: 'b1',
      firstNight: '2026-10-03',
      lastNight: '2026-10-05',
    };
    renderTimeline(rows({ bars: [booking], events: [marker('2026-10-04', 1), marker('2026-10-05', 3)] }));

    expect(screen.queryByText(/parties/)).toBeNull();
    const dot = screen.getByRole('button', { name: '1 event on 2026-10-04 — House A' });
    const row = dot.parentElement!;
    expect(row.style.gridTemplateRows).toBe('repeat(1, 46px)');

    // The nights under the booking stay inert background, dot or not.
    for (const [iso, column] of [['2026-10-04', '5'], ['2026-10-05', '6']] as const) {
      expect(screen.queryByRole('button', { name: `House A, ${iso}, available — block this night` })).toBeNull();
      const cells = Array.from(row.children).filter(
        (el) => (el as HTMLElement).style.gridColumn === column,
      ) as HTMLElement[];
      // The day cell (div) plus the dot (button) — the cell is not turned into a button.
      expect(cells.map((el) => el.tagName)).toEqual(['DIV', 'BUTTON']);
    }
    // A free day with no event is still a blockable night.
    expect(screen.getByRole('button', { name: 'House A, 2026-10-06, available — block this night' })).toBeEnabled();
  });

  it('(e) without onSelectEvents the dot is drawn but inert', () => {
    renderTimeline(rows({ events: [marker('2026-10-05', 2)] }), { onSelectEvents: undefined });
    const dot = screen.getByRole('button', { name: '2 events on 2026-10-05 — House A' });
    expect(dot).toBeDisabled();
    expect(dot).toHaveTextContent('2');
  });

  it('(f) a row without events renders as before', () => {
    const { container } = renderTimeline(rows());
    expect(eventButtons()).toHaveLength(0);
    // Every night of both houses is a blockable button, nothing else added.
    expect(screen.getAllByRole('button', { name: /available — block this night/ })).toHaveLength(14);
    // Name button + 7 nights per house.
    expect(container.querySelectorAll('button')).toHaveLength(16);
  });
});
