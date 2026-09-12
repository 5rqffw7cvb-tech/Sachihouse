/**
 * What a timeline row is made of.
 *
 * The month grid asked "what is the state of this square?", and this module
 * used to answer that: one night, one state, built by writing every source
 * into a map and letting the last writer win. That model cannot hold two
 * parties in one house at once — the second booking silently overwrote the
 * first — so a row is now a list of bars with their own date ranges, stacked
 * into lanes by utils/stayLanes.
 */

/** What is sitting on a night, in the order a night used to be claimed.
 *
 * `imported` and `imported-block` both arrive down the same iCal feed and
 * both take the night off the market, but only the first is a reservation
 * with a party behind it. Drawn identically they were indistinguishable —
 * a Hostex block read as a Hostex Direct booking — so they are separate
 * kinds, which also makes every `Record<OccupiedKind, …>` force the choice.
 */
export type NightKind = 'free' | 'booking' | 'hold' | 'imported' | 'imported-block' | 'manual';

/** Everything a bar can be. `free` is the absence of a bar, not a kind of one. */
export type OccupiedKind = Exclude<NightKind, 'free'>;

/** One stay or block, as a closed range of nights. */
export interface TimelineBar {
  kind: OccupiedKind;
  /** Guest or channel name. Absent on a manual block, which has no guest. */
  label?: string;
  /** The underlying record, so a click knows what it opened. */
  ref?: string;
  /** First night, inclusive. */
  firstNight: string;
  /** Last night, inclusive — the night before check-out. */
  lastNight: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function isoPlusDay(iso: string): string {
  const next = new Date(`${iso}T00:00:00`).getTime() + DAY_MS;
  const date = new Date(next);
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

/**
 * Collapses loose dates into contiguous runs.
 *
 * Manual and imported blocks arrive as a bag of individual dates rather than
 * as ranges, and drawing each as its own one-night bar would turn a fortnight
 * closed for renovation into fourteen separate blocks. Runs are what a host
 * reads as one decision.
 */
export function collapseDateRuns(dates: Iterable<string>): Array<{ firstNight: string; lastNight: string }> {
  const sorted = [...new Set(dates)].filter(Boolean).sort();
  const runs: Array<{ firstNight: string; lastNight: string }> = [];

  for (const iso of sorted) {
    const last = runs[runs.length - 1];
    if (last && isoPlusDay(last.lastNight) === iso) {
      last.lastNight = iso;
    } else {
      runs.push({ firstNight: iso, lastNight: iso });
    }
  }

  return runs;
}
