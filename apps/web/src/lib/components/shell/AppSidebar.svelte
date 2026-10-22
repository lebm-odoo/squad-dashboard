<script lang="ts">
import CircleArrowUp from '@lucide/svelte/icons/circle-arrow-up';
import Settings from '@lucide/svelte/icons/settings';
import { createQuery } from '@tanstack/svelte-query';
import { parseResponse } from 'hono/client';
import { api } from '#lib/api.ts';
import * as Sidebar from '#lib/components/ui/sidebar/index.ts';
import { m } from '#lib/i18n.svelte.ts';
import { setupQuery, spaces } from '#lib/setup.svelte.ts';
import { page } from '$app/state';
import Brand from './Brand.svelte';
import { mePages, squadPages } from './nav.ts';

const setup = setupQuery();
const version = createQuery(() => ({ queryKey: ['version'], queryFn: () => parseResponse(api.version.$get()) }));
const shown = $derived(spaces(setup.data));
const current = (href: string) => page.url.pathname === href;
</script>

<Sidebar.Root collapsible="icon" variant="inset">
  <Sidebar.Header>
    <Sidebar.Menu>
      <Sidebar.MenuItem>
        <Sidebar.MenuButton size="lg">
          {#snippet child({ props })}
            <a href="/" {...props}>
              <Brand />
            </a>
          {/snippet}
        </Sidebar.MenuButton>
      </Sidebar.MenuItem>
    </Sidebar.Menu>
  </Sidebar.Header>
  <Sidebar.Content>
    <Sidebar.Group>
      <Sidebar.GroupLabel>{m().nav.me}</Sidebar.GroupLabel>
      <Sidebar.Menu>
        {#each mePages as [href, key, Icon] (href)}
          <Sidebar.MenuItem>
            <Sidebar.MenuButton isActive={current(href)} tooltipContent={m().nav.mePages[key]}>
              {#snippet child({ props })}<a {href} {...props}><Icon /><span>{m().nav.mePages[key]}</span></a>{/snippet}
            </Sidebar.MenuButton>
          </Sidebar.MenuItem>
        {/each}
      </Sidebar.Menu>
    </Sidebar.Group>
    {#if shown.squad}
      <Sidebar.Group>
        <Sidebar.GroupLabel>{m().nav.squad}</Sidebar.GroupLabel>
        <Sidebar.Menu>
          {#each squadPages as [href, key, Icon] (href)}
            <Sidebar.MenuItem>
              <Sidebar.MenuButton isActive={current(href)} tooltipContent={m().nav.squadPages[key]}>
                {#snippet child({ props })}<a {href} {...props}><Icon /><span>{m().nav.squadPages[key]}</span></a>{/snippet}
              </Sidebar.MenuButton>
            </Sidebar.MenuItem>
          {/each}
        </Sidebar.Menu>
      </Sidebar.Group>
    {/if}
  </Sidebar.Content>
  <Sidebar.Footer>
    <Sidebar.Menu>
      {#if version.data?.newer && version.data.latest}
        {@const text = m().settings.about.badge(version.data.latest.version)}
        <Sidebar.MenuItem>
          <Sidebar.MenuButton tooltipContent={text} class="text-link">
            {#snippet child({ props })}<a href="/settings#about" {...props}><CircleArrowUp /><span>{text}</span></a>{/snippet}
          </Sidebar.MenuButton>
        </Sidebar.MenuItem>
      {/if}
      <Sidebar.MenuItem>
        <Sidebar.MenuButton isActive={current('/settings')} tooltipContent={m().settings.title}>
          {#snippet child({ props })}<a href="/settings" {...props}><Settings /><span>{m().settings.title}</span></a>{/snippet}
        </Sidebar.MenuButton>
      </Sidebar.MenuItem>
    </Sidebar.Menu>
  </Sidebar.Footer>
  <Sidebar.Rail />
</Sidebar.Root>
