import type { Column, ColumnDef, FilterFn, RowData } from '@tanstack/table-core';

declare module '@tanstack/table-core' {
  interface ColumnMeta<TData extends RowData, TValue> {
    label?: string;
    hint?: string;
    align?: 'right' | 'center';
    /** Classes of the column's cells. */
    class?: string;
    /** The value written in the CSV export, when it is not the sorting value. */
    csv?: (row: TData) => unknown;
    /** A column that only filters: never shown, nor exported. */
    facetOnly?: boolean;
  }
}

/** Keeps a row whose value, or one of its values, is among those chosen. */
export const inFacet: FilterFn<unknown> = (row, id, wanted: string[]) => {
  const value = row.getValue(id);
  return Array.isArray(value) ? value.some((x) => wanted.includes(String(x))) : wanted.includes(String(value));
};

export const columnLabel = <T>(column: Column<T, unknown>) => column.columnDef.meta?.label ?? column.id;

// biome-ignore lint/suspicious/noExplicitAny: each column has its own value type, as TanStack's own examples type them.
export type Columns<T> = ColumnDef<T, any>[];
