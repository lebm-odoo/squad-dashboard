import { createQuery } from '@tanstack/svelte-query';
import { parseResponse } from 'hono/client';
import { api } from './api.ts';
import { prefs } from './prefs.svelte.ts';

/** What the dashboard follows, chosen on its first page: every page shows the spaces it opens. */
export const setupQuery = () => createQuery(() => ({ queryKey: ['setup'], queryFn: () => parseResponse(api.setup.$get()) }));

/** The spaces a choice opens: Squad needs a squad, and stays out of sight while hidden. */
export function spaces(setup: { follow: string | null; squad: unknown } | undefined, hidden = prefs.hidden) {
  return { squad: !hidden && !!setup?.squad && setup.follow === 'squad' };
}

const en = {
  welcome: 'Welcome',
  language: 'Language',
  title: 'What do you want to follow?',
  sub: 'What waits for you, your work, your reviews, your tasks, and the work of others they touch; your squad can join them. The settings change this choice at any time. The first collection reads two years of history: it takes a few minutes.',
  follows: {
    me: ['Me', 'What waits for me, my work and my reviews, my Odoo tasks: read first.'],
    squad: ['Me and my squad', 'Me, plus my squad’s work, journeys and reviews, read right after me.'],
  } as Record<string, [string, string]>,
  me: 'My trigram',
  meHint: (who: string) => (who ? `Found in git config user.email: ${who}.` : 'git config user.email gives none: type it.'),
  lead: 'Squad lead',
  members: 'Squad members',
  membersHint: 'Trigrams separated by spaces.',
  collect: 'Start the first collection',
  start: 'Start',
  starting: 'Saving…',
  bad: (word: string) => `Not a trigram: ${word}`,
  noLead: 'A squad needs its lead.',
};

const fr: typeof en = {
  welcome: 'Bienvenue',
  language: 'Langue',
  title: 'Que veux-tu suivre ?',
  sub: 'Ce qui t’attend, ton travail, tes reviews, tes tâches, et le travail des autres qu’ils touchent ; ton squad peut s’y ajouter. Les réglages changent ce choix quand tu veux. La première collecte lit deux ans d’historique : elle prend quelques minutes.',
  follows: {
    me: ['Moi', 'Ce qui m’attend, mon travail et mes reviews, mes tâches Odoo : lus en premier.'],
    squad: ['Moi et mon squad', 'Moi, plus le travail, les parcours et les reviews de mon squad, lus juste après moi.'],
  },
  me: 'Mon trigramme',
  meHint: (who) => (who ? `Trouvé dans git config user.email : ${who}.` : 'git config user.email n’en donne pas : le taper.'),
  lead: 'Lead du squad',
  members: 'Membres du squad',
  membersHint: 'Trigrammes séparés par des espaces.',
  collect: 'Lancer la première collecte',
  start: 'Commencer',
  starting: 'Enregistrement…',
  bad: (word) => `Pas un trigramme : ${word}`,
  noLead: 'Un squad a besoin de son lead.',
};

export const words = { en, fr };
