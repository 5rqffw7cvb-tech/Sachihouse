import { describe, expect, it } from 'vitest';
import { splitEchoedEvents } from '../../src/domain/importedEchoes.js';
import { ImportedEvent } from '../../src/store/types.js';

function event(partial: Partial<ImportedEvent> & { dates: string[] }): ImportedEvent {
  return {
    externalId: 'e1',
    feedId: 'cal1',
    feedName: 'Hostex',
    channelName: null,
    summary: 'Hostex (Not available)',
    description: '',
    checkInDate: partial.dates[0],
    checkOutDate: partial.dates[partial.dates.length - 1],
    guestCount: null,
    ...partial,
  };
}

const own = (...nights: string[]) => ({ nights: new Set(nights) });

describe('splitEchoedEvents', () => {
  it('suppresses an anonymous block sitting entirely on nights we already own', () => {
    const echo = event({ dates: ['2026-10-17', '2026-10-18'] });
    const result = splitEchoedEvents([echo], own('2026-10-17', '2026-10-18'));

    expect(result.kept).toEqual([]);
    expect(result.echoes).toEqual([echo]);
    expect([...result.echoOnlyNights].sort()).toEqual(['2026-10-17', '2026-10-18']);
  });

  it('keeps a real reservation even when it lands on nights we also hold', () => {
    // A genuine double booking — two guests, two platforms, same dates. Hiding
    // it because our own record covers the same nights is the one outcome that
    // would actually cost the host a guest.
    const real = event({
      dates: ['2026-10-17', '2026-10-18'],
      summary: 'Reserved: Jan Tabije 3 guests',
      description: 'Hostex reservation code: 0-HMKSDAMXAA-ifqexzmr1r',
    });

    expect(splitEchoedEvents([real], own('2026-10-17', '2026-10-18')).kept).toEqual([real]);
  });

  it('keeps an anonymous block that covers a night we do not own', () => {
    const partial = event({ dates: ['2026-10-17', '2026-10-18', '2026-10-19'] });

    expect(splitEchoedEvents([partial], own('2026-10-17', '2026-10-18')).kept).toEqual([partial]);
  });

  it('suppresses a block a channel manager coalesced out of two of our stays', () => {
    const merged = event({ dates: ['2026-10-17', '2026-10-18', '2026-10-19'] });
    const result = splitEchoedEvents([merged], own('2026-10-17', '2026-10-18', '2026-10-19'));

    expect(result.kept).toEqual([]);
  });

  it('does not report a night as echo-only when a kept event also covers it', () => {
    const real = event({
      externalId: 'r1',
      dates: ['2026-10-18'],
      summary: 'Reserved: Andrew Young',
      description: 'Hostex reservation code: 0-HMNQHND43R-iffeaeddlf',
    });
    const echo = event({ externalId: 'e2', dates: ['2026-10-17', '2026-10-18'] });
    const result = splitEchoedEvents([echo, real], own('2026-10-17', '2026-10-18'));

    expect(result.kept).toEqual([real]);
    expect([...result.echoOnlyNights]).toEqual(['2026-10-17']);
  });
});
