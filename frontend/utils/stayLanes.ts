/**
 * Stacking concurrent stays into lanes.
 *
 * Every calendar in this codebase was built on the assumption that one
 * property holds one party at a time, so two stays meeting on a day could only
 * mean a same-day turnover. A house let to two groups at once breaks that: on
 * the shared nights there really are two parties, and a calendar that draws
 * one of them, or draws both as "Out | In", is lying about who is in the
 * building.
 *
 * A lane is a horizontal track within one property's row. Stays that share no
 * night sit in the same lane; stays that overlap are pushed onto separate ones,
 * so a property's row is exactly as tall as the largest number of parties it
 * ever holds at once.
 *
 * The unit is the NIGHT, not the day, and that distinction is the whole design:
 *
 *   A: 17 → 19   nights 17, 18
 *   B: 19 → 22   nights 19, 20, 21
 *
 * These share the calendar day 19 but no night — A is gone by the time B
 * arrives. Counting days would split a same-day turnover across two lanes and
 * throw away the compact "Out | In" cell the calendars already draw for it.
 * Counting nights keeps the turnover in one lane and only splits a genuine
 * overlap, which is the case that actually needs the room.
 */

/** A half-open stay reduced to the closed range of nights it occupies. */
export interface NightRange {
  /** First night, inclusive: the check-in date. */
  firstNight: string;
  /** Last night, inclusive: the night BEFORE check-out. */
  lastNight: string;
}

export interface LanedItem<T> {
  item: T;
  /** 0-based track within the property's row. */
  lane: number;
}

export interface LaneLayout<T> {
  laned: LanedItem<T>[];
  /** Always at least 1, so a row with no stays still has a height. */
  laneCount: number;
}

/**
 * The nights a stay occupies, or null when it occupies none.
 *
 * Check-out morning is not a night — the room is free that day — so the last
 * night is the day before. A zero- or negative-length stay (bad feed data, a
 * check-out on or before the check-in) has no nights at all and is reported as
 * null rather than silently treated as one night.
 */
export function nightRange(checkInDate: string, checkOutDate: string): NightRange | null {
  const start = Date.parse(`${checkInDate}T00:00:00`);
  const end = Date.parse(`${checkOutDate}T00:00:00`);
  if (Number.isNaN(start) || Number.isNaN(end) || end <= start) return null;

  const lastNight = new Date(end);
  lastNight.setDate(lastNight.getDate() - 1);
  return { firstNight: checkInDate, lastNight: toIso(lastNight) };
}

function toIso(date: Date): string {
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

/** True when the two ranges share at least one night. ISO dates compare as strings. */
export function nightsOverlap(a: NightRange, b: NightRange): boolean {
  return a.firstNight <= b.lastNight && b.firstNight <= a.lastNight;
}

/**
 * Greedy interval packing: walk the stays in date order and drop each into the
 * first lane whose occupant has already left.
 *
 * Greedy is optimal here — it never uses more lanes than the maximum number of
 * parties present on any one night, which is the fewest any layout could use.
 *
 * Ordering is fixed (first night, then last night, then the caller's original
 * order) rather than left to the input, so a stay does not hop between lanes
 * when the calendar reloads and the API returns the same records in a
 * different order.
 *
 * @param range Nights the item occupies. An item with no nights is returned in
 *   lane 0 and takes part in no overlap — it cannot collide with anything.
 */
export function assignLanes<T>(items: T[], range: (item: T) => NightRange | null): LaneLayout<T> {
  const indexed = items.map((item, index) => ({ item, index, nights: range(item) }));

  const placeable = indexed.filter((entry) => entry.nights !== null) as Array<{
    item: T; index: number; nights: NightRange;
  }>;

  placeable.sort((a, b) => (
    a.nights.firstNight.localeCompare(b.nights.firstNight)
    || a.nights.lastNight.localeCompare(b.nights.lastNight)
    || a.index - b.index
  ));

  const laneOf = new Map<number, number>();
  // Last night occupied in each lane, by lane index.
  const lastNightInLane: string[] = [];

  for (const entry of placeable) {
    let lane = lastNightInLane.findIndex((occupiedUntil) => occupiedUntil < entry.nights.firstNight);
    if (lane === -1) {
      lane = lastNightInLane.length;
      lastNightInLane.push(entry.nights.lastNight);
    } else {
      lastNightInLane[lane] = entry.nights.lastNight;
    }
    laneOf.set(entry.index, lane);
  }

  return {
    // Returned in the caller's original order: the lane is a layout fact, not
    // a reason to reorder a list the caller may render in its own sequence.
    laned: indexed.map((entry) => ({ item: entry.item, lane: laneOf.get(entry.index) ?? 0 })),
    laneCount: Math.max(1, lastNightInLane.length),
  };
}
