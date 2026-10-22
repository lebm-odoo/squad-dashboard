<script lang="ts">
import { parseResponse } from 'hono/client';
import { toast } from 'svelte-sonner';
import { api, messageOf } from '#lib/api.ts';
import { Button } from '#lib/components/ui/button/index.ts';
import { Input } from '#lib/components/ui/input/index.ts';
import { Label } from '#lib/components/ui/label/index.ts';
import { m, tr } from '#lib/i18n.svelte.ts';
import { queryClient } from '#lib/live.svelte.ts';
import { words as setupWords } from '#lib/setup.svelte.ts';
import Section from './Section.svelte';
import type { Checks, Settings } from './types.ts';

let { settings, checks }: { settings: Settings; checks: Checks | null } = $props();
// svelte-ignore state_referenced_locally
let trigram = $state(settings.config.me ?? '');
// svelte-ignore state_referenced_locally
let members = $state(settings.config.squad?.members.join(' ') ?? '');
let busy = $state(false);
const words = $derived(m().settings);

async function save() {
  const me = trigram.trim().toLowerCase() || settings.whoami;
  const list = [
    ...new Set(
      members
        .toLowerCase()
        .split(/[\s,;]+/)
        .filter(Boolean),
    ),
  ].filter((member) => member !== me);
  const bad = [me, ...list].find((word) => !/^[a-z]{2,8}$/.test(word));
  if (bad) return toast.error(words.me.badTrigram(bad));
  busy = true;
  try {
    await parseResponse(
      api.settings.config.$put({ json: { ...(trigram.trim() ? { me } : {}), squad: list.length ? { lead: me, members: list } : null } }),
    );
    toast.success(words.saved);
    await queryClient.invalidateQueries({ queryKey: ['settings'] });
    await queryClient.invalidateQueries({ queryKey: ['setup'] });
    await queryClient.invalidateQueries({ queryKey: ['squad'] });
  } catch (error) {
    toast.error(messageOf(error));
  }
  busy = false;
}
</script>

<div class="grid gap-4">
  <Section title={words.me.follow} sub={words.me.followSub}>
    {#snippet action()}<Button variant="outline" size="sm" href="/setup">{words.me.change}</Button>{/snippet}
    {@const [title, text] = tr(setupWords).follows[settings.config.follow ?? 'me'] ?? ['', '']}
    <p class="text-sm font-medium">{title}</p>
    <p class="text-[13px] text-muted-foreground">{text}</p>
  </Section>
  <Section title={words.me.title} sub={words.me.sub}>
    <div class="grid max-w-xl gap-1.5">
      <Label for="me">{words.me.trigram}</Label>
      <Input id="me" bind:value={trigram} placeholder={settings.whoami} autocomplete="off" spellcheck="false" class="max-w-40 lowercase" />
      <p class="text-xs text-muted-foreground">{words.me.trigramHint(settings.whoami)}</p>
    </div>
    <dl class="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[13px]">
      <dt class="text-muted-foreground">{words.me.github}</dt>
      <dd>{checks?.github.login ?? words.me.notChecked}</dd>
      <dt class="text-muted-foreground">{words.me.odoo}</dt>
      <dd>{checks?.odoo.user ?? (checks ? checks.odoo.detail : words.me.notChecked)}</dd>
    </dl>
  </Section>
  <Section title={words.me.squad} sub={words.me.squadSub}>
    <div class="grid max-w-xl gap-1.5">
      <Label for="members">{words.me.members}</Label>
      <Input id="members" bind:value={members} placeholder="efgh ijkl mnop" autocomplete="off" spellcheck="false" />
      <p class="text-xs text-muted-foreground">{words.me.membersHint}</p>
      <div class="mt-1 flex flex-wrap gap-1.5">
        {#each [...new Set(members.toLowerCase().split(/[\s,;]+/).filter(Boolean))] as member (member)}
          <span class="rounded-full border px-2.5 py-0.5 text-xs">{member.toUpperCase()}</span>
        {:else}
          <span class="text-xs text-muted-foreground">{words.me.noSquad}</span>
        {/each}
      </div>
    </div>
  </Section>
  <div><Button disabled={busy} onclick={save}>{busy ? words.saving : words.save}</Button></div>
</div>
