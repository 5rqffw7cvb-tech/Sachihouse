/**
 * Turning per-night occupancy into the bars a timeline draws.
 *
 * The month grid asked "what is the state of this square?". A timeline asks a
 * different question — "where does this stay start and end?" — so consecutive
 * nights belonging to the same guest have to be recognised as one object.
 */

/** What a single night is doing, in the order a night is allowed to be claimed. */
export type NightKind = 'free' | 'booking' | 'hold' | 'imported' | 'manual';

export interface Night {
  kind: NightKind;
  /** Guest or channel name. Empty for free and manually blocked nights. */
  label?: string;
  /** Distinguishes two different stays that happen to share a label. */
  ref?: string;
}

export interface Segment extends Night {
  /** Index into the supplied day list where the run starts. */
  start: number;
  /** Number of consecutive days the run covers. */
  span: number;
}

const FREE: Night = { kind: 'free' };

/**
 * Collapses a run of days into segments. Two adjacent nights merge only when
 * kind, label and ref all match — so back-to-back stays by different guests
 * stay visibly separate even though neither leaves a gap.
 */
export function buildSegments(days: string[], nights: Map<string, Night>): Segment[] {
  const segments: Segment[] = [];

  for (let i = 0; i < days.length; i++) {
    const night = nights.get(days[i]) ?? FREE;
    const last = segments[segments.length - 1];
    const continues =
      last &&
      last.start + last.span === i &&
      last.kind === night.kind &&
      last.label === night.label &&
      last.ref === night.ref;

    if (continues) {
      last.span += 1;
    } else {
      segments.push({ ...night, start: i, span: 1 });
    }
  }

  return segments;
}
