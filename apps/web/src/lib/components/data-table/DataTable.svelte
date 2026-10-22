<script lang="ts" generics="T">
import ArrowDown from '@lucide/svelte/icons/arrow-down';
import ArrowUp from '@lucide/svelte/icons/arrow-up';
import ChevronsUpDown from '@lucide/svelte/icons/chevrons-up-down';
import Columns3 from '@lucide/svelte/icons/columns-3';
import Download from '@lucide/svelte/icons/download';
import X from '@lucide/svelte/icons/x';
import {
  type ColumnFiltersState,
  getCoreRowModel,
  getFacetedRowModel,
  getFacetedUniqueValues,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  type PaginationState,
  type Row,
  type SortingState,
  type VisibilityState,
} from '@tanstack/table-core';
import type { Snippet } from 'svelte';
import DataTablePager from '#lib/components/DataTablePager.svelte';
import FacetFilter, { type FacetOption } from '#lib/components/FacetFilter.svelte';
import { Button } from '#lib/components/ui/button/index.ts';
import { createSvelteTable, FlexRender } from '#lib/components/ui/data-table/index.ts';
import * as DropdownMenu from '#lib/components/ui/dropdown-menu/index.ts';
import { Input } from '#lib/components/ui/input/index.ts';
import * as Table from '#lib/components/ui/table/index.ts';
import { downloadCsv } from '#lib/csv.ts';
import { m } from '#lib/i18n.svelte.ts';
import { tooltip } from '#lib/tip.svelte.ts';
import { type Columns, columnLabel, inFacet } from './columns.ts';

/**
 * A table of rows: sorting by any column, a search, facet filters, the columns to show (remembered per table), pages, and
 * the rows shown as CSV. Cells are the columns' own; a footer can total the rows kept.
 */
let {
  data,
  columns,
  sort = [],
  pageSize = 50,
  search,
  searchPlaceholder,
  facets = [],
  hidden = [],
  storageKey,
  csv,
  onrowclick,
  rowClass,
  empty,
  filters,
  actions,
  footer,
  class: className = '',
  dense = false,
  bare = false,
}: {
  data: T[];
  columns: Columns<T>;
  sort?: SortingState;
  pageSize?: number | null;
  search?: (row: T) => string;
  searchPlaceholder?: string;
  facets?: { column: string; title: string; options: FacetOption[] }[];
  hidden?: string[];
  storageKey?: string;
  csv?: string;
  onrowclick?: (row: T, event: MouseEvent) => void;
  rowClass?: (row: T) => string;
  empty?: string;
  filters?: Snippet;
  actions?: Snippet;
  footer?: Snippet<[T[]]>;
  class?: string;
  dense?: boolean;
  /** No toolbar: a small table read as is. */
  bare?: boolean;
} = $props();

const words = $derived(m().table);
const remembered = (() => {
  try {
    return storageKey ? (JSON.parse(localStorage.getItem(`sd-columns:${storageKey}`) ?? 'null') as VisibilityState | null) : null;
  } catch {
    return null;
  }
})();
// svelte-ignore state_referenced_locally
let sorting = $state<SortingState>(sort);
// svelte-ignore state_referenced_locally
let pagination = $state<PaginationState>({ pageIndex: 0, pageSize: pageSize ?? 1_000_000 });
let columnFilters = $state<ColumnFiltersState>([]);
// svelte-ignore state_referenced_locally
let columnVisibility = $state<VisibilityState>({
  ...Object.fromEntries(hidden.map((id) => [id, false])),
  ...remembered,
  ...Object.fromEntries(columns.filter((c) => c.meta?.facetOnly).map((c) => [c.id as string, false])),
});
let query = $state('');

const terms = $derived(query.toLowerCase().split(/\s+/).filter(Boolean));
const searched = $derived(search && terms.length ? data.filter((row) => terms.every((t) => search(row).toLowerCase().includes(t))) : data);
const facetIds = $derived(new Set(facets.map((f) => f.column)));
const defs = $derived(columns.map((c) => (facetIds.has(c.id as string) ? { ...c, filterFn: inFacet as never } : c)));

const table = createSvelteTable({
  get data() {
    return searched;
  },
  get columns() {
    return defs;
  },
  state: {
    get sorting() {
      return sorting;
    },
    get pagination() {
      return pagination;
    },
    get columnFilters() {
      return columnFilters;
    },
    get columnVisibility() {
      return columnVisibility;
    },
  },
  onSortingChange: (updater) => {
    sorting = typeof updater === 'function' ? updater(sorting) : updater;
  },
  onPaginationChange: (updater) => {
    pagination = typeof updater === 'function' ? updater(pagination) : updater;
  },
  onColumnFiltersChange: (updater) => {
    columnFilters = typeof updater === 'function' ? updater(columnFilters) : updater;
  },
  onColumnVisibilityChange: (updater) => {
    columnVisibility = typeof updater === 'function' ? updater(columnVisibility) : updater;
    try {
      if (storageKey) localStorage.setItem(`sd-columns:${storageKey}`, JSON.stringify(columnVisibility));
    } catch {
      // a private window forgets the columns after the visit
    }
  },
  getCoreRowModel: getCoreRowModel(),
  getSortedRowModel: getSortedRowModel(),
  getFilteredRowModel: getFilteredRowModel(),
  getFacetedRowModel: getFacetedRowModel(),
  getFacetedUniqueValues: getFacetedUniqueValues(),
  // svelte-ignore state_referenced_locally
  ...(pageSize ? { getPaginationRowModel: getPaginationRowModel() } : {}),
});

const kept = $derived(table.getFilteredRowModel().rows.map((row) => row.original));
const filtering = $derived(!!query || columnFilters.length > 0);
const shownColumns = $derived(table.getAllLeafColumns().filter((c) => !c.columnDef.meta?.facetOnly && c.getCanHide()));
const facetValue = (column: string) => (columnFilters.find((f) => f.id === column)?.value as string[] | undefined) ?? [];
const counted = (column: string, options: FacetOption[]) => {
  const values = table.getColumn(column)?.getFacetedUniqueValues();
  return options.map((o) => ({ ...o, count: values?.get(o.value) ?? 0 }));
};
const exportRows = () => {
  const cols = table.getVisibleLeafColumns().filter((c) => !c.columnDef.meta?.facetOnly);
  downloadCsv(
    csv as string,
    cols.map((c) => columnLabel(c)),
    table.getSortedRowModel().rows.map((row: Row<T>) => cols.map((c) => c.columnDef.meta?.csv?.(row.original) ?? row.getValue(c.id))),
  );
};
const click = (event: MouseEvent, row: T) => {
  if (!onrowclick || (event.target as HTMLElement).closest('a, button, input, label') || getSelection()?.toString()) return;
  onrowclick(row, event);
};
const align = (a?: string) => (a === 'right' ? 'text-right' : a === 'center' ? 'text-center' : '');
</script>

<div class="flex min-w-0 flex-col gap-3 {className}">
  {#if !bare && (search || facets.length || filters || actions || csv || shownColumns.length > 2)}
    <div class="flex flex-wrap items-center gap-2">
      {#if search}
        <Input type="search" class="h-8 w-56 lg:w-72" bind:value={query} placeholder={searchPlaceholder ?? words.search} aria-label={searchPlaceholder ?? words.search} />
      {/if}
      {#each facets as facet (facet.column)}
        <FacetFilter
          title={facet.title}
          options={counted(facet.column, facet.options)}
          selected={facetValue(facet.column)}
          onchange={(values) => table.getColumn(facet.column)?.setFilterValue(values.length ? values : undefined)}
        />
      {/each}
      {@render filters?.()}
      {#if filtering}
        <Button
          variant="ghost"
          size="sm"
          class="h-8 px-2"
          onclick={() => {
            query = '';
            columnFilters = [];
          }}>{words.reset}<X /></Button
        >
      {/if}
      <div class="ml-auto flex items-center gap-2">
        {@render actions?.()}
        {#if csv}
          <Button variant="outline" size="sm" class="h-8" disabled={!kept.length} title={words.exportTitle} onclick={exportRows}><Download />{words.exportCsv}</Button>
        {/if}
        {#if shownColumns.length > 2}
          <DropdownMenu.Root>
            <DropdownMenu.Trigger>
              {#snippet child({ props })}<Button variant="outline" size="sm" class="h-8" {...props}><Columns3 />{words.columns}</Button>{/snippet}
            </DropdownMenu.Trigger>
            <DropdownMenu.Content align="end" class="max-h-96 overflow-auto">
              {#each shownColumns as column (column.id)}
                <DropdownMenu.CheckboxItem checked={column.getIsVisible()} closeOnSelect={false} onCheckedChange={(value) => column.toggleVisibility(!!value)}>
                  {columnLabel(column)}
                </DropdownMenu.CheckboxItem>
              {/each}
            </DropdownMenu.Content>
          </DropdownMenu.Root>
        {/if}
      </div>
    </div>
  {/if}

  <div class="overflow-x-auto rounded-lg border">
    <Table.Root class={dense ? 'text-[13px]' : ''}>
      <Table.Header class="bg-muted">
        {#each table.getHeaderGroups() as group (group.id)}
          <Table.Row>
            {#each group.headers as header (header.id)}
              {@const meta = header.column.columnDef.meta}
              {@const sorted = header.column.getIsSorted()}
              {#snippet hint()}<div class="max-w-80">{meta?.hint}</div>{/snippet}
              <Table.Head class="h-auto py-2 leading-tight whitespace-normal {dense ? 'px-1.5' : ''} {align(meta?.align)}">
                {#if header.isPlaceholder}
                  {''}
                {:else if header.column.getCanSort()}
                  <button
                    class="inline-flex cursor-pointer items-center gap-1 text-left hover:text-foreground {meta?.align === 'right' ? 'justify-end text-right' : ''}"
                    onclick={header.column.getToggleSortingHandler()}
                    {@attach meta?.hint ? tooltip(hint) : () => {}}
                  >
                    <FlexRender content={meta?.label ?? header.column.columnDef.header} context={header.getContext()} />
                    {#if sorted === 'asc'}<ArrowUp class="size-3.5 shrink-0" />{:else if sorted === 'desc'}<ArrowDown class="size-3.5 shrink-0" />{:else}<ChevronsUpDown class="size-3.5 shrink-0 opacity-40" />{/if}
                  </button>
                {:else}
                  <span {@attach meta?.hint ? tooltip(hint) : () => {}}>
                    <FlexRender content={meta?.label ?? header.column.columnDef.header} context={header.getContext()} />
                  </span>
                {/if}
              </Table.Head>
            {/each}
          </Table.Row>
        {/each}
      </Table.Header>
      <Table.Body>
        {#each table.getRowModel().rows as row (row.id)}
          <Table.Row
            class="{onrowclick ? 'cursor-pointer' : ''} {rowClass?.(row.original) ?? ''}"
            onclick={(event: MouseEvent) => click(event, row.original)}
          >
            {#each row.getVisibleCells() as cell (cell.id)}
              {@const meta = cell.column.columnDef.meta}
              <Table.Cell class="align-top {dense ? 'px-1.5 py-1.5' : 'py-2'} {align(meta?.align)} {meta?.align === 'right' ? 'tabular-nums' : ''} {meta?.class ?? ''}">
                <FlexRender content={cell.column.columnDef.cell} context={cell.getContext()} />
              </Table.Cell>
            {/each}
          </Table.Row>
        {:else}
          <Table.Row>
            <Table.Cell colspan={table.getVisibleLeafColumns().length} class="h-24 text-center text-muted-foreground">{empty ?? words.empty}</Table.Cell>
          </Table.Row>
        {/each}
      </Table.Body>
      {#if footer && kept.length}
        <Table.Footer>{@render footer(kept)}</Table.Footer>
      {/if}
    </Table.Root>
  </div>
  {#if pageSize && kept.length > pagination.pageSize}<DataTablePager {table} />{/if}
</div>
