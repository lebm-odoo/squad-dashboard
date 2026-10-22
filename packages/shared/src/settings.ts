import { z } from 'zod';
import { follows, trigram } from './config';

const https = z.string().max(500).startsWith('https://');

/** A to-do of the Moi page: a comment, done or not, and what it refers to, as the squad dashboard kept them. */
export const todo = z
  .object({
    id: z.string().min(1).max(40),
    text: z.string().max(4000).default(''),
    done: z.boolean().default(false),
    at: z.number(),
    done_at: z.number().optional(),
    ref: z
      .object({
        type: z.enum(['feature', 'pr', 'task', 'journey']),
        key: z.string().min(1).max(500),
        label: z.string().max(500).optional(),
        who: z.string().max(500).optional(),
        window: z.string().max(500).optional(),
        url: https.optional(),
      })
      .optional(),
    feature: z.string().min(1).max(500).optional(),
  })
  .refine((item) => item.text.trim() || item.ref || item.feature, 'un to-do a un texte ou une référence');
export const todos = z.array(todo).max(1000);
export type Todo = z.infer<typeof todo>;

/** How deep and how wide a collection reads. */
export const collectSettings = z.object({
  historyDays: z.number().int().min(30).max(3650).default(730),
  /** Points of the GitHub quota (5000 an hour) a collection leaves untouched, for the clicks. */
  githubReserve: z.number().int().min(0).max(5000).default(500),
  /** Heavy queries at once: GitHub allows 60 s of its CPU a minute, which four at once spend within minutes. */
  githubConcurrency: z.number().int().min(1).max(4).default(1),
});
export type CollectSettings = z.infer<typeof collectSettings>;

export const secretNames = ['github_token', 'odoo_api_key'] as const;
export type SecretName = (typeof secretNames)[number];

/** The editable part of config.json: who I am, what I follow, my squad, the GitHub logins forced, the arrivals. */
export const configPatch = z.object({
  me: trigram.optional(),
  follow: z.enum(follows).optional(),
  squad: z
    .object({ lead: trigram, members: z.array(trigram) })
    .nullable()
    .optional(),
  github_logins: z.record(trigram, z.string().regex(/^([A-Za-z0-9-]{1,39})?$/, 'login GitHub invalide')).optional(),
  arrivals: z.record(trigram, z.string().regex(/^(\d{4}(-\d{2})?)?$/, 'une arrivée s’écrit AAAA ou AAAA-MM')).optional(),
});

/** The first page's answers: what to follow, who I am, my squad. */
export const setupInput = z
  .object({
    follow: z.enum(follows),
    me: trigram,
    squad: z.object({ lead: trigram, members: z.array(trigram).max(50) }).nullable(),
  })
  .refine((setup) => setup.follow !== 'squad' || setup.squad, 'suivre un squad demande son lead');
