<script lang="ts">
import { label } from '#lib/format.ts';
import type { Board } from '#lib/squad/model.ts';
import Swatch from './Swatch.svelte';

let { board, person, class: className = '' }: { board: Board; person: string; class?: string } = $props();
</script>

<span class="inline-flex items-center gap-1.5 {className}"><Swatch {board} {person} />{label(person)}</span>
