import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { createColumnHelper } from '@tanstack/react-table';
import { LocaleProvider } from '../../i18n/index';
import { DataTable } from './DataTable';

type Row = { id: string; name: string; count: number };
const col = createColumnHelper<Row>();
const columns = [col.accessor('name', { header: 'Name' }), col.accessor('count', { header: 'Count', meta: { align: 'right' } })];
const rows: Row[] = [
  { id: 'a', name: 'alpha', count: 5 },
  { id: 'b', name: 'beta', count: 50 },
  { id: 'c', name: 'gamma', count: 1 },
];

const names = () => screen.getAllByRole('row').slice(1).map((r) => within(r).getAllByRole('cell')[0].textContent);

afterEach(cleanup);

describe('DataTable', () => {
  it('sorts by header click and reports aria-sort', () => {
    render(
      <LocaleProvider>
        <DataTable data={rows} columns={columns} getRowId={(r) => r.id} initialSorting={[{ id: 'count', desc: true }]} />
      </LocaleProvider>,
    );
    expect(names()).toEqual(['beta', 'alpha', 'gamma']);
    const header = screen.getByRole('columnheader', { name: /Count/ });
    expect(header.getAttribute('aria-sort')).toBe('descending');
    fireEvent.click(within(header).getByRole('button'));
    expect(names()).toEqual(['gamma', 'alpha', 'beta']);
  });

  it('filters and shows the no-match state', () => {
    render(
      <LocaleProvider>
        <DataTable data={rows} columns={columns} getRowId={(r) => r.id} globalFilter="zzz" />
      </LocaleProvider>,
    );
    expect(screen.getAllByRole('row')).toHaveLength(1);
  });

  it('calls onRowClick with the row', () => {
    const clicked: string[] = [];
    render(
      <LocaleProvider>
        <DataTable data={rows} columns={columns} getRowId={(r) => r.id} onRowClick={(r) => clicked.push(r.id)} />
      </LocaleProvider>,
    );
    fireEvent.click(screen.getByText('beta'));
    expect(clicked).toEqual(['b']);
  });
});
