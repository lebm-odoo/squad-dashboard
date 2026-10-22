<script lang="ts">
import { personName } from '#lib/format.ts';
import { m } from '#lib/i18n.svelte.ts';
import { type FeatureReviewer, reviewerKind } from '#lib/squad/model.ts';

let { y }: { y: FeatureReviewer } = $props();
const icons: Record<string, string> = { rplus: 'r+', validation: '✓', changes: '✎', comment: '💬' };
const kind = $derived(reviewerKind(y));
</script>

<span class="rtag {kind}" title={m().reviewerTags[kind]}>{icons[kind]} {personName(y.who)}</span>
