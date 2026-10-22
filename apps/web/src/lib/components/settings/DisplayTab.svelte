<script lang="ts">
import { setMode, userPrefersMode } from 'mode-watcher';
import Seg from '#lib/components/Seg.svelte';
import { i18n, type Locale, m, setLocale } from '#lib/i18n.svelte.ts';
import { prefs, setPeriod } from '#lib/prefs.svelte.ts';
import Section from './Section.svelte';

const words = $derived(m().settings.display);
</script>

<Section title={m().settings.tabs.display ?? ''} sub={words.sub}>
  <div class="grid gap-5">
    <div class="grid gap-1.5">
      <span class="text-sm font-medium">{words.language}</span>
      <div><Seg options={[['fr', 'Français'], ['en', 'English']]} value={i18n.locale} label={words.language} onchange={(locale) => setLocale(locale as Locale)} /></div>
    </div>
    <div class="grid gap-1.5">
      <span class="text-sm font-medium">{words.theme}</span>
      <div><Seg options={['system', 'light', 'dark'].map((mode) => [mode, words.themes[mode] ?? mode])} value={userPrefersMode.current} label={words.theme} onchange={(mode) => setMode(mode as 'light' | 'dark' | 'system')} /></div>
    </div>
    <div class="grid gap-1.5">
      <span class="text-sm font-medium">{words.period}</span>
      <div><Seg options={['14', '30', '91'].map((days) => [days, m().periods[days] ?? days])} value={prefs.period} label={words.period} onchange={setPeriod} /></div>
    </div>
  </div>
</Section>
