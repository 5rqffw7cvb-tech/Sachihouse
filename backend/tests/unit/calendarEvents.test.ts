import { describe, expect, it } from 'vitest';
import { MemoryStore } from '../../src/store/memoryStore.js';
import type { AuthUser, CalendarEventInput, PropertyData } from '../../src/store/types.js';

async function setup(): Promise<{ store: MemoryStore; actor: AuthUser }> {
  const store = new MemoryStore();
  await store.init();
  const actor = (await store.getUserById(1))!;
  expect(actor.role).toBe('ADMIN');
  return { store, actor };
}

function input(overrides: Partial<CalendarEventInput> = {}): CalendarEventInput {
  return {
    propertyId: 'main',
    title: '消防検査',
    date: '2026-10-08',
    startTime: '10:00',
    endTime: '11:00',
    ...overrides,
  };
}

describe('MemoryStore calendar events', () => {
  it('(a) creates an event and reads it back with the same fields', async () => {
    const { store, actor } = await setup();
    const created = await store.createCalendarEvent(input(), actor);
    expect(created.id.startsWith('cal_')).toBe(true);
    expect(created.note).toBe('');
    expect(created.propertyId).toBe('main');
    expect(created.title).toBe('消防検査');
    expect(created.date).toBe('2026-10-08');
    expect(created.startTime).toBe('10:00');
    expect(created.endTime).toBe('11:00');
    expect(typeof created.createdAt).toBe('number');
    expect(created.updatedAt).toBe(created.createdAt);

    const fetched = await store.getCalendarEvent(created.id);
    expect(fetched).toEqual(created);

    const withNote = await store.createCalendarEvent(input({ note: 'bring keys' }), actor);
    expect((await store.getCalendarEvent(withNote.id))!.note).toBe('bring keys');
    expect(withNote.id).not.toBe(created.id);
  });

  it('(a) get of an unknown id returns null', async () => {
    const { store } = await setup();
    expect(await store.getCalendarEvent('cal_nope')).toBeNull();
  });

  it('(b) create on a non-existent property throws', async () => {
    const { store, actor } = await setup();
    await expect(store.createCalendarEvent(input({ propertyId: 'nope' }), actor)).rejects.toThrow();
    // exact id match only — the metalink is not accepted
    await expect(store.createCalendarEvent(input({ propertyId: 'sachi-ojima' }), actor)).rejects.toThrow();
    expect(await store.listCalendarEvents(['main', 'nope'])).toEqual([]);
  });

  it('(c) list is sorted by date then startTime', async () => {
    const { store, actor } = await setup();
    await store.createCalendarEvent(input({ title: 'C', date: '2026-10-09', startTime: '09:00', endTime: '10:00' }), actor);
    await store.createCalendarEvent(input({ title: 'B', date: '2026-10-08', startTime: '14:00', endTime: '15:00' }), actor);
    await store.createCalendarEvent(input({ title: 'D', date: '2026-11-01', startTime: '08:00', endTime: '09:00' }), actor);
    await store.createCalendarEvent(input({ title: 'A', date: '2026-10-08', startTime: '09:30', endTime: '10:00' }), actor);
    const list = await store.listCalendarEvents(['main']);
    expect(list.map((e) => e.title)).toEqual(['A', 'B', 'C', 'D']);
  });

  it('(d) date range filter is inclusive and each bound is optional', async () => {
    const { store, actor } = await setup();
    for (const date of ['2026-10-01', '2026-10-05', '2026-10-10', '2026-10-15']) {
      await store.createCalendarEvent(input({ title: date, date }), actor);
    }
    const titles = async (f?: { fromDate?: string; toDate?: string }) =>
      (await store.listCalendarEvents(['main'], f)).map((e) => e.date);

    expect(await titles({ fromDate: '2026-10-05', toDate: '2026-10-10' })).toEqual(['2026-10-05', '2026-10-10']);
    expect(await titles({ fromDate: '2026-10-10' })).toEqual(['2026-10-10', '2026-10-15']);
    expect(await titles({ toDate: '2026-10-05' })).toEqual(['2026-10-01', '2026-10-05']);
    expect(await titles()).toEqual(['2026-10-01', '2026-10-05', '2026-10-10', '2026-10-15']);
    expect(await titles({})).toHaveLength(4);
    expect(await titles({ fromDate: '2026-10-11', toDate: '2026-10-14' })).toEqual([]);
  });

  it('(e) list over several properties does not leak others; [] returns []', async () => {
    const { store, actor } = await setup();
    const m = await store.createCalendarEvent(input({ title: 'main-ev' }), actor);
    const s = await store.createCalendarEvent(input({ propertyId: 'list_shin', title: 'shin-ev', date: '2026-10-07' }), actor);

    expect((await store.listCalendarEvents(['main'])).map((e) => e.id)).toEqual([m.id]);
    expect((await store.listCalendarEvents(['list_shin'])).map((e) => e.id)).toEqual([s.id]);
    expect((await store.listCalendarEvents(['main', 'list_shin'])).map((e) => e.id)).toEqual([s.id, m.id]);
    expect(await store.listCalendarEvents([])).toEqual([]);
    expect(await store.listCalendarEvents(['other'])).toEqual([]);
  });

  it('(f) mutating returned objects does not change the store', async () => {
    const { store, actor } = await setup();
    const created = await store.createCalendarEvent(input(), actor);
    created.title = 'hacked';

    const got = (await store.getCalendarEvent(created.id))!;
    expect(got.title).toBe('消防検査');
    got.title = 'hacked-get';
    got.date = '1999-01-01';

    const list = await store.listCalendarEvents(['main']);
    expect(list[0].title).toBe('消防検査');
    list[0].title = 'hacked-list';
    list.pop();

    const again = await store.listCalendarEvents(['main']);
    expect(again).toHaveLength(1);
    expect(again[0].title).toBe('消防検査');
    expect(again[0].date).toBe('2026-10-08');

    const updated = (await store.updateCalendarEvent(created.id, { note: 'x' }, actor))!;
    updated.note = 'hacked-update';
    expect((await store.getCalendarEvent(created.id))!.note).toBe('x');
  });

  it('(g) partial update keeps identity fields and bumps updatedAt; unknown id -> null', async () => {
    const { store, actor } = await setup();
    const created = await store.createCalendarEvent(input({ note: 'orig' }), actor);
    await new Promise((r) => setTimeout(r, 5));
    const updated = await store.updateCalendarEvent(created.id, { title: '新タイトル', startTime: '10:30' }, actor);
    expect(updated).not.toBeNull();
    expect(updated!.id).toBe(created.id);
    expect(updated!.propertyId).toBe(created.propertyId);
    expect(updated!.createdAt).toBe(created.createdAt);
    expect(updated!.updatedAt).toBeGreaterThanOrEqual(created.updatedAt);
    expect(updated!.title).toBe('新タイトル');
    expect(updated!.startTime).toBe('10:30');
    // untouched fields stay
    expect(updated!.note).toBe('orig');
    expect(updated!.date).toBe('2026-10-08');
    expect(updated!.endTime).toBe('11:00');
    expect(await store.getCalendarEvent(created.id)).toEqual(updated);

    // propertyId in the patch (not allowed by type) must not move the event
    const sneaky = await store.updateCalendarEvent(created.id, { propertyId: 'list_shin' } as never, actor);
    expect(sneaky!.propertyId).toBe('main');

    // note can be cleared to ''
    expect((await store.updateCalendarEvent(created.id, { note: '' }, actor))!.note).toBe('');

    expect(await store.updateCalendarEvent('cal_missing', { title: 'x' }, actor)).toBeNull();
  });

  it('(h) delete returns true, then get is null and a second delete returns false', async () => {
    const { store, actor } = await setup();
    const keep = await store.createCalendarEvent(input({ title: 'keep' }), actor);
    const created = await store.createCalendarEvent(input(), actor);
    expect(await store.deleteCalendarEvent(created.id, actor)).toBe(true);
    expect(await store.getCalendarEvent(created.id)).toBeNull();
    expect(await store.deleteCalendarEvent(created.id, actor)).toBe(false);
    expect((await store.listCalendarEvents(['main'])).map((e) => e.id)).toEqual([keep.id]);
  });

  it('(i) deleteProperty removes that property\'s events only', async () => {
    const { store, actor } = await setup();
    const m = await store.createCalendarEvent(input(), actor);
    const s = await store.createCalendarEvent(input({ propertyId: 'list_shin' }), actor);
    await store.deleteProperty('main');
    expect(await store.getCalendarEvent(m.id)).toBeNull();
    expect(await store.listCalendarEvents(['main'])).toEqual([]);
    expect(await store.getCalendarEvent(s.id)).not.toBeNull();
    expect((await store.listCalendarEvents(['list_shin'])).map((e) => e.id)).toEqual([s.id]);
  });

  it('(j) renameProperty moves events to the new id', async () => {
    const { store, actor } = await setup();
    const m = await store.createCalendarEvent(input(), actor);
    const s = await store.createCalendarEvent(input({ propertyId: 'list_shin' }), actor);
    const sBefore = await store.listCalendarEvents(['list_shin']);

    await store.renameProperty('main', 'main2', {} as PropertyData);

    const moved = await store.listCalendarEvents(['main2']);
    expect(moved.map((e) => e.id)).toEqual([m.id]);
    expect(moved[0].propertyId).toBe('main2');
    expect(moved[0].title).toBe('消防検査');
    expect(moved[0].createdAt).toBe(m.createdAt);
    expect(await store.listCalendarEvents(['main'])).toEqual([]);
    expect(await store.listCalendarEvents(['list_shin'])).toEqual(sBefore);
    expect((await store.getCalendarEvent(s.id))!.propertyId).toBe('list_shin');
    // new events can be created on the renamed property, not on the old id
    await expect(store.createCalendarEvent(input({ propertyId: 'main2' }), actor)).resolves.toBeTruthy();
    await expect(store.createCalendarEvent(input({ propertyId: 'main' }), actor)).rejects.toThrow();
  });

  it('(k) renameProperty addressed by metalink also moves events', async () => {
    const { store, actor } = await setup();
    const m = await store.createCalendarEvent(input(), actor);
    await store.renameProperty('sachi-ojima', 'main3', {} as PropertyData);
    expect((await store.getCalendarEvent(m.id))!.propertyId).toBe('main3');
    expect(await store.listCalendarEvents(['main'])).toEqual([]);
    expect((await store.listCalendarEvents(['main3'])).map((e) => e.id)).toEqual([m.id]);
  });

  it('(l) renaming to the same id keeps the events', async () => {
    const { store, actor } = await setup();
    const m = await store.createCalendarEvent(input(), actor);
    await store.renameProperty('main', 'main', {} as PropertyData);
    expect((await store.getCalendarEvent(m.id))!.propertyId).toBe('main');
    expect((await store.listCalendarEvents(['main'])).map((e) => e.id)).toEqual([m.id]);
  });

  it('events never change blocked dates (availability)', async () => {
    const { store, actor } = await setup();
    const before = await store.listBlockedDates('main');
    const date = '2026-12-24';
    expect(before).not.toContain(date);
    const ev = await store.createCalendarEvent(input({ date }), actor);
    expect(await store.listBlockedDates('main')).toEqual(before);
    await store.updateCalendarEvent(ev.id, { date: '2026-12-25' }, actor);
    expect(await store.listBlockedDates('main')).toEqual(before);
    await store.deleteCalendarEvent(ev.id, actor);
    expect(await store.listBlockedDates('main')).toEqual(before);
  });
});
