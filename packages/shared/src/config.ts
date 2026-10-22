import { z } from 'zod';

export const trigram = z.string().regex(/^[a-z]{2,8}$/, 'un trigramme est fait de 2 à 8 lettres minuscules');
const trigrams = z.array(trigram);

/** What the dashboard follows, chosen on its first page: my work alone, or my squad's too. */
export const follows = ['me', 'squad'] as const;
export type Follow = (typeof follows)[number];

// A loose object: the V1 wrote the squad as `lead` and `members`, which the first page reads back before replacing them.
export const dashboardConfig = z.looseObject({
  me: trigram.optional(),
  follow: z.enum(follows).optional(),
  github_logins: z.record(trigram, z.string().regex(/^[A-Za-z0-9-]{1,39}$/, 'login GitHub invalide')).default({}),
  squad: z.object({ lead: trigram, members: trigrams }).optional(),
  arrivals: z.record(trigram, z.string().regex(/^\d{4}(-\d{2})?$/, 'une arrivée s’écrit AAAA ou AAAA-MM')).default({}),
});

export type DashboardConfig = z.infer<typeof dashboardConfig>;
