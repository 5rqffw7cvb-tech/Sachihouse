import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Plus } from 'lucide-react';
import { Alert, Badge, Button, Card, EmptyState, Field, Input, Table } from './index';

describe('Button', () => {
  it('calls back when clicked', async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Save</Button>);
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('ignores clicks while loading, so a slow save cannot be fired twice', async () => {
    const onClick = vi.fn();
    render(<Button loading onClick={onClick}>Save</Button>);
    const button = screen.getByRole('button');
    expect(button).toBeDisabled();
    await userEvent.click(button, { pointerEventsCheck: 0 });
    expect(onClick).not.toHaveBeenCalled();
  });

  it('ignores clicks while disabled', async () => {
    const onClick = vi.fn();
    render(<Button disabled onClick={onClick}>Save</Button>);
    await userEvent.click(screen.getByRole('button'), { pointerEventsCheck: 0 });
    expect(onClick).not.toHaveBeenCalled();
  });

  it('renders every variant through the shared radius token', () => {
    for (const variant of ['primary', 'secondary', 'danger', 'ghost'] as const) {
      const { unmount } = render(<Button variant={variant}>{variant}</Button>);
      expect(screen.getByRole('button')).toHaveClass('rounded-control');
      unmount();
    }
  });

  it('keeps an icon-only button reachable by name', () => {
    render(<Button icon={Plus} aria-label="Add property" />);
    expect(screen.getByRole('button', { name: 'Add property' })).toBeInTheDocument();
  });
});

describe('Alert', () => {
  it('shows its message', () => {
    render(<Alert tone="danger">Could not save</Alert>);
    expect(screen.getByText('Could not save')).toBeInTheDocument();
  });

  it('offers dismissal only when there is somewhere to dismiss to', async () => {
    const onDismiss = vi.fn();
    const { rerender } = render(<Alert tone="ok">Saved</Alert>);
    expect(screen.queryByRole('button', { name: /dismiss/i })).not.toBeInTheDocument();

    rerender(<Alert tone="ok" onDismiss={onDismiss}>Saved</Alert>);
    await userEvent.click(screen.getByRole('button', { name: /dismiss/i }));
    expect(onDismiss).toHaveBeenCalledOnce();
  });
});

describe('Badge', () => {
  it('maps each tone onto its own token pair', () => {
    const { container } = render(
      <>
        <Badge tone="ok">ok</Badge>
        <Badge tone="danger">danger</Badge>
        <Badge tone="hold">hold</Badge>
      </>,
    );
    const classes = [...container.querySelectorAll('span')].map((s) => s.className);
    expect(classes[0]).toContain('text-ok');
    expect(classes[1]).toContain('text-danger');
    expect(classes[2]).toContain('text-hold');
  });
});

describe('Card', () => {
  it('renders a heading and its actions together', () => {
    render(<Card title="Plan pricing" actions={<Button>Save</Button>}><p>body</p></Card>);
    expect(screen.getByRole('heading', { name: 'Plan pricing' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
    expect(screen.getByText('body')).toBeInTheDocument();
  });

  it('drops its padding when a child needs the full width', () => {
    const { container } = render(<Card padded={false}><p>edge to edge</p></Card>);
    expect(container.querySelector('.p-5')).toBeNull();
  });
});

describe('Field', () => {
  it('ties the label to its control', () => {
    render(<Field label="Property name"><Input /></Field>);
    expect(screen.getByText('Property name')).toBeInTheDocument();
  });

  it('replaces the hint with the error when one is present', () => {
    render(<Field label="Code" hint="Uppercase only" error="Code is taken"><Input /></Field>);
    expect(screen.getByText('Code is taken')).toBeInTheDocument();
    expect(screen.queryByText('Uppercase only')).not.toBeInTheDocument();
  });
});

interface Row { id: string; name: string }

describe('Table', () => {
  const columns = [
    { header: 'Name', cell: (r: Row) => r.name },
    { header: 'Id', cell: (r: Row) => r.id, hideOnMobile: true },
  ];

  it('renders a row per record', () => {
    render(<Table<Row> columns={columns} rows={[{ id: 'a', name: 'Ojima' }]} rowKey={(r) => r.id} />);
    expect(screen.getByText('Ojima')).toBeInTheDocument();
    expect(screen.getAllByRole('row')).toHaveLength(2); // header + one record
  });

  it('shows the empty state instead of an empty grid', () => {
    render(
      <Table<Row>
        columns={columns}
        rows={[]}
        rowKey={(r) => r.id}
        empty={<EmptyState title="No properties yet" />}
      />,
    );
    expect(screen.getByText('No properties yet')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });
});
