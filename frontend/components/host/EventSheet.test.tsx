import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { PropertyCalendarEvent } from '../../services/calendar';
import type { HostProperty } from '../../services/hostApp';
import { jstDateString, ONE_DAY_MS } from '../../utils/eventDraft';
import { EventSheet } from './EventSheet';

const outside = 'Events can only be added from 3 months back to a year ahead.';

const calEvent = (over: Partial<PropertyCalendarEvent>): PropertyCalendarEvent => ({
  id: 'e-1',
  propertyId: 's01',
  title: 'Plumber visit',
  note: '',
  date: jstDateString(Date.now()),
  startTime: '10:00',
  endTime: '11:00',
  createdAt: 0,
  updatedAt: 0,
  ...over,
});

function renderEdit(event: PropertyCalendarEvent) {
  const onUpdate = vi.fn().mockResolvedValue(undefined);
  const onDelete = vi.fn().mockResolvedValue(undefined);
  render(
    <EventSheet
      event={event}
      propertyName="Sachi House 01"
      busy={false}
      onClose={vi.fn()}
      onUpdate={onUpdate}
      onDelete={onDelete}
    />,
  );
  const dialog = screen.getByRole('dialog', { name: 'Edit event' });
  return { dialog, onUpdate, onDelete };
}

const save = (dialog: HTMLElement) =>
  fireEvent.click(within(dialog).getByRole('button', { name: /Save event/ }));

describe('changing an event that has drifted out of the date window', () => {
  // 100 days back: inside the window when it was made, outside it now.
  const oldDate = jstDateString(Date.now() - 100 * ONE_DAY_MS);

  it('still saves a new title when the date is left as it was', async () => {
    const event = calEvent({ date: oldDate });
    const { dialog, onUpdate } = renderEdit(event);

    fireEvent.change(within(dialog).getByLabelText('Title *'), { target: { value: 'Cleaner' } });
    save(dialog);

    await waitFor(() => expect(onUpdate).toHaveBeenCalledTimes(1));
    expect(onUpdate).toHaveBeenCalledWith(event, {
      title: 'Cleaner',
      note: '',
      date: oldDate,
      startTime: '10:00',
      endTime: '11:00',
    });
    expect(within(dialog).queryByRole('alert')).toBeNull();
  });

  it('refuses to move it to another day outside the window, with the usual message', async () => {
    const event = calEvent({ date: oldDate });
    const { dialog, onUpdate } = renderEdit(event);

    fireEvent.change(within(dialog).getByLabelText('Date *'), {
      target: { value: jstDateString(Date.now() - 101 * ONE_DAY_MS) },
    });
    save(dialog);

    expect(within(dialog).getByRole('alert')).toHaveTextContent(outside);
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it('first saves on the old date, then blocks a move to a day outside the window', async () => {
    const event = calEvent({ date: oldDate });
    const { dialog, onUpdate } = renderEdit(event);

    fireEvent.change(within(dialog).getByLabelText('Title *'), { target: { value: 'Cleaner' } });
    save(dialog);
    await waitFor(() => expect(onUpdate).toHaveBeenCalledTimes(1));
    expect(onUpdate.mock.calls[0][1]).toMatchObject({ date: oldDate });

    fireEvent.change(within(dialog).getByLabelText('Date *'), {
      target: { value: jstDateString(Date.now() - 101 * ONE_DAY_MS) },
    });
    save(dialog);
    expect(within(dialog).getByRole('alert')).toHaveTextContent(outside);
    expect(onUpdate).toHaveBeenCalledTimes(1);
  });

  it('still checks the title and times on the old date', () => {
    const { dialog, onUpdate } = renderEdit(calEvent({ date: oldDate }));

    fireEvent.change(within(dialog).getByLabelText('Title *'), { target: { value: '  ' } });
    save(dialog);
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Give the event a title.');

    fireEvent.change(within(dialog).getByLabelText('Title *'), { target: { value: 'Cleaner' } });
    fireEvent.change(within(dialog).getByLabelText('Ends'), { target: { value: '09:00' } });
    save(dialog);
    expect(within(dialog).getByRole('alert'))
      .toHaveTextContent('The end time has to be after the start time.');
    expect(onUpdate).not.toHaveBeenCalled();
  });
});

describe('the sheet that makes a new event', () => {
  it('keeps the date window check for a new event', () => {
    const onCreate = vi.fn();
    render(
      <EventSheet
        date={jstDateString(Date.now())}
        properties={[{ id: 's01', name: 'Sachi House 01', address: '', pricing: {} } as HostProperty]}
        busy={false}
        onClose={vi.fn()}
        onCreate={onCreate}
      />,
    );
    const dialog = screen.getByRole('dialog', { name: 'New event' });
    fireEvent.change(within(dialog).getByLabelText('Title *'), { target: { value: 'Cleaner' } });
    fireEvent.change(within(dialog).getByLabelText('Date *'), {
      target: { value: jstDateString(Date.now() - 100 * ONE_DAY_MS) },
    });
    save(dialog);

    expect(within(dialog).getByRole('alert')).toHaveTextContent(outside);
    expect(onCreate).not.toHaveBeenCalled();
    expect(within(dialog).queryByRole('button', { name: /Delete event/ })).toBeNull();
  });
});
