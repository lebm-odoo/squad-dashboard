<script lang="ts">
import Check from '@lucide/svelte/icons/check';
import User from '@lucide/svelte/icons/user';
import Users from '@lucide/svelte/icons/users';
import type { Follow } from '@sd/shared';
import { parseResponse } from 'hono/client';
import { slide } from 'svelte/transition';
import { toast } from 'svelte-sonner';
import { api, messageOf } from '#lib/api.ts';
import Seg from '#lib/components/Seg.svelte';
import TokenHelp from '#lib/components/settings/TokenHelp.svelte';
import Mark from '#lib/components/shell/Mark.svelte';
import { Button } from '#lib/components/ui/button/index.ts';
import { Checkbox } from '#lib/components/ui/checkbox/index.ts';
import { Input } from '#lib/components/ui/input/index.ts';
import { Label } from '#lib/components/ui/label/index.ts';
import { i18n, type Locale, m, setLocale, tr } from '#lib/i18n.svelte.ts';
import { collect, queryClient } from '#lib/live.svelte.ts';
import { setupQuery, words } from '#lib/setup.svelte.ts';
import { splash } from '#lib/splash.svelte.ts';
import { goto } from '$app/navigation';

const setup = setupQuery();
const w = $derived(tr(words));
const icons = { me: User, squad: Users };
let follow = $state<Follow>('me');
let me = $state('');
let lead = $state('');
let members = $state('');
let first = $state(true);
let busy = $state(false);
let filled = false;
// The answers config.json already holds, once: a second visit changes them.
$effect.pre(() => {
  const data = setup.data;
  if (!data || filled) return;
  filled = true;
  follow = data.follow ?? (data.squad ? 'squad' : 'me');
  me = data.me ?? data.whoami;
  lead = data.squad?.lead ?? me;
  members = data.squad?.members.join(' ') ?? '';
  first = !data.follow;
});
const trigrams = (text: string) => [
  ...new Set(
    text
      .toLowerCase()
      .split(/[\s,;]+/)
      .filter(Boolean),
  ),
];

async function start() {
  const who = me.trim().toLowerCase();
  const head = lead.trim().toLowerCase();
  const squad = trigrams(members).filter((member) => member !== head);
  if (follow !== 'me' && !head) return toast.error(w.noLead);
  const typed = [who, ...(follow === 'me' ? [] : [head, ...squad])];
  const bad = typed.find((word) => !/^[a-z]{2,8}$/.test(word));
  if (bad !== undefined) return toast.error(w.bad(bad));
  busy = true;
  try {
    await parseResponse(
      api.setup.$put({
        json: { follow, me: who, squad: follow === 'me' ? null : { lead: head, members: squad } },
      }),
    );
    await queryClient.invalidateQueries();
    if (first) void collect('all');
    await goto('/');
  } catch (error) {
    toast.error(messageOf(error));
  }
  busy = false;
}
</script>

<svelte:head><title>{w.welcome}</title></svelte:head>

<div class="flex min-h-svh items-start justify-center bg-muted/40 px-4 py-10 sm:items-center">
  <div class="w-full max-w-3xl">
    <div class="mb-8 flex h-12 items-center justify-between gap-4">
      <!-- Mounted once the opening screen is gone: its entrance plays in sight. -->
      {#if !splash.open}
        <div class="flex items-center gap-3">
          <Mark class="size-12" />
          <span class="brand bg-linear-to-r from-brand to-brand-2 bg-clip-text text-2xl font-bold tracking-tight text-transparent">{m().brand}</span>
        </div>
      {/if}
      <div class="ms-auto">
        <Seg options={[['en', 'English'], ['fr', 'Français']]} value={i18n.locale} label={w.language} onchange={(locale) => setLocale(locale as Locale)} />
      </div>
    </div>
    <p class="text-xs font-medium tracking-wide text-muted-foreground uppercase">{w.welcome}</p>
    <h1 class="mb-3 text-2xl font-semibold tracking-tight">{w.title}</h1>
    <p class="mb-5 text-sm text-muted-foreground">{w.sub}</p>

    {#if setup.isError}
      <p class="text-critical">{messageOf(setup.error)}</p>
    {:else if setup.data}
      <div class="grid gap-3 md:grid-cols-2" role="radiogroup" aria-label={w.title}>
        {#each ['me', 'squad'] as const as key (key)}
          {@const [title, text] = w.follows[key] ?? ['', '']}
          {@const Icon = icons[key]}
          <button
            role="radio"
            aria-checked={follow === key}
            class="group relative flex cursor-pointer flex-col items-start gap-2 rounded-xl border bg-card p-4 text-left transition-colors hover:border-foreground/30 aria-checked:border-primary aria-checked:ring-2 aria-checked:ring-primary/20"
            onclick={() => (follow = key)}
          >
            <span class="flex size-9 items-center justify-center rounded-lg bg-muted text-foreground group-aria-checked:bg-primary group-aria-checked:text-primary-foreground"><Icon class="size-[18px]" /></span>
            <span class="font-semibold">{title}</span>
            <span class="text-[13px] leading-snug text-muted-foreground">{text}</span>
            {#if follow === key}<Check class="absolute top-3 right-3 size-4 text-primary" />{/if}
          </button>
        {/each}
      </div>

      <div class="mt-4 grid gap-4 rounded-xl border bg-card p-5">
        <div class="grid max-w-md gap-1.5">
          <Label for="me">{w.me}</Label>
          <Input id="me" bind:value={me} placeholder={setup.data.whoami} autocomplete="off" spellcheck="false" class="max-w-40 lowercase" />
          <p class="text-xs text-muted-foreground">{w.meHint(setup.data.whoami)}</p>
        </div>
        {#if follow !== 'me'}
          <div class="grid gap-4 sm:grid-cols-[10rem_minmax(0,1fr)]" transition:slide={{ duration: 180 }}>
            <div class="grid content-start gap-1.5">
              <Label for="lead">{w.lead}</Label>
              <Input id="lead" bind:value={lead} placeholder={me} autocomplete="off" spellcheck="false" class="lowercase" />
            </div>
            <div class="grid content-start gap-1.5">
              <Label for="members">{w.members}</Label>
              <Input id="members" bind:value={members} placeholder="efgh ijkl mnop" autocomplete="off" spellcheck="false" class="lowercase" />
              <p class="text-xs text-muted-foreground">{w.membersHint}</p>
            </div>
          </div>
        {/if}
      </div>

      <div class="mt-4 grid gap-3 rounded-xl border bg-card p-5">
        <div class="flex items-center justify-between gap-3">
          <p class="text-sm font-medium">{w.connections}</p>
          <Button variant="outline" size="sm" onclick={() => setup.refetch()}>{w.lookAgain}</Button>
        </div>
        {#each ['github', 'odoo'] as const as kind (kind)}
          {@const source = setup.data.keys[kind]}
          <div class="grid gap-1.5 border-t pt-3">
            <p class="text-[13px]">
              <span class="font-medium">{kind === 'github' ? 'GitHub' : 'Odoo'}</span>
              <span class={source === 'none' && kind === 'github' ? 'text-critical' : 'text-muted-foreground'}>
                · {source === 'none' ? w.keyMissing[kind] : w.keyFound(m().settings.connections.sources[kind][source] ?? source)}
              </span>
            </p>
            {#if source === 'none'}<TokenHelp {kind} />{/if}
          </div>
        {/each}
      </div>

      <div class="mt-5 flex flex-wrap items-center justify-end gap-4">
        <Label class="flex cursor-pointer items-center gap-2 font-normal text-muted-foreground">
          <Checkbox bind:checked={first} />{w.collect}
        </Label>
        <Button size="lg" disabled={busy} onclick={start}>{busy ? w.starting : w.start}</Button>
      </div>
    {/if}
  </div>
</div>

<style>
  .brand {
    animation: rise 0.5s 0.35s ease-out both;
  }
  @keyframes rise {
    from {
      opacity: 0;
      transform: translateX(-8px);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .brand {
      animation: none;
    }
  }
</style>
