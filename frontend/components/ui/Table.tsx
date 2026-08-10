import React from 'react';

/**
 * Data table for the admin console. Drop it into a Card with `padded={false}`
 * so the rows meet the card's edge and the header band lines up with it.
 */
export interface Column<T> {
  /** Header label. */
  header: React.ReactNode;
  /** Cell renderer. */
  cell: (row: T) => React.ReactNode;
  /** Tailwind width/alignment classes for this column. */
  className?: string;
  /** Hides the column below md — for detail that mobile can afford to lose. */
  hideOnMobile?: boolean;
}

export interface TableProps<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  /** Shown in place of the body when `rows` is empty. */
  empty?: React.ReactNode;
}

export function Table<T>({ columns, rows, rowKey, empty }: TableProps<T>) {
  if (rows.length === 0 && empty) {
    return <>{empty}</>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-[14px] border-collapse">
        <thead>
          <tr className="bg-subtle">
            {columns.map((col, i) => (
              <th
                key={i}
                className={`text-left px-4 py-2.5 text-[12px] font-bold uppercase tracking-wide text-ink-soft
                  border-b border-line whitespace-nowrap
                  ${col.hideOnMobile ? 'hidden md:table-cell' : ''} ${col.className ?? ''}`}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={rowKey(row)} className="border-b border-line last:border-0 hover:bg-subtle/60 transition-colors">
              {columns.map((col, i) => (
                <td
                  key={i}
                  className={`px-4 py-3 align-middle text-ink
                    ${col.hideOnMobile ? 'hidden md:table-cell' : ''} ${col.className ?? ''}`}
                >
                  {col.cell(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default Table;
