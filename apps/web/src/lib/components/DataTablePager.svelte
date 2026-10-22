<script lang="ts" generics="T">
import ChevronLeft from '@lucide/svelte/icons/chevron-left';
import ChevronRight from '@lucide/svelte/icons/chevron-right';
import type { Table } from '@tanstack/table-core';
import { Button } from '#lib/components/ui/button/index.ts';
import * as Select from '#lib/components/ui/select/index.ts';
import { m } from '#lib/i18n.svelte.ts';

let { table }: { table: Table<T> } = $props();
const words = $derived(m().table);
</script>

<div class="flex flex-wrap items-center justify-between gap-3 px-1 pt-3 text-sm text-muted-foreground">
  <span>{words.items(table.getFilteredRowModel().rows.length)}</span>
  <div class="flex items-center gap-4">
    <div class="flex items-center gap-2">
      <span class="hidden sm:inline">{words.rowsPerPage}</span>
      <Select.Root
        type="single"
        value={`${table.getState().pagination.pageSize}`}
        onValueChange={(value) => table.setPageSize(Number(value))}
      >
        <Select.Trigger size="sm" class="w-20">{table.getState().pagination.pageSize}</Select.Trigger>
        <Select.Content>{#each [25, 50, 100, 200] as size (size)}<Select.Item value={`${size}`}>{size}</Select.Item>{/each}</Select.Content>
      </Select.Root>
    </div>
    <span class="tabular-nums">{words.page(table.getState().pagination.pageIndex + 1, Math.max(1, table.getPageCount()))}</span>
    <div class="flex gap-1">
      <Button variant="outline" size="icon" class="size-8" disabled={!table.getCanPreviousPage()} onclick={() => table.previousPage()} aria-label={words.previous}>
        <ChevronLeft />
      </Button>
      <Button variant="outline" size="icon" class="size-8" disabled={!table.getCanNextPage()} onclick={() => table.nextPage()} aria-label={words.next}>
        <ChevronRight />
      </Button>
    </div>
  </div>
</div>
