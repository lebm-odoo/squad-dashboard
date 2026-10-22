import { readFile, rename, rm, writeFile } from 'node:fs/promises';
import { type configPatch, type DashboardConfig, dashboardConfig } from '@sd/shared';
import { z } from 'zod';
import { unreadable } from './files';

export class ConfigError extends Error {}

export async function loadConfig(path: string): Promise<DashboardConfig> {
  const text = await readFile(path, 'utf8').catch((error) => {
    const reason = unreadable(path, error);
    throw new ConfigError(error.code === 'ENOENT' ? `${reason} : la première page le crée` : reason);
  });
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new ConfigError(`${path} n’est pas du JSON valide`);
  }
  const parsed = dashboardConfig.safeParse(raw);
  if (!parsed.success) throw new ConfigError(`${path} :\n${z.prettifyError(parsed.error)}`);
  return parsed.data;
}

/**
 * Writes changes into config.json: an empty GitHub login goes back to the deduced one, an empty arrival is dropped, a squad
 * given replaces the V1's `lead` and `members`; the file is replaced whole, never read half written.
 */
export async function saveConfig(path: string, patch: z.infer<typeof configPatch>) {
  // The first page writes it when there is none yet.
  const raw: Record<string, unknown> = await readFile(path, 'utf8').then(JSON.parse, (error) => {
    if (error.code === 'ENOENT') return {};
    throw error;
  });
  const { github_logins, arrivals, squad, ...rest } = patch;
  const next: Record<string, unknown> = { ...raw, ...rest };
  if (squad !== undefined) {
    delete next.lead;
    delete next.members;
  }
  if (squad === null) delete next.squad;
  else if (squad) next.squad = squad;
  const merged = (key: string, changes: Record<string, string>) => {
    const values = { ...(raw[key] as Record<string, string> | undefined), ...changes };
    next[key] = Object.fromEntries(Object.entries(values).filter(([, value]) => value));
  };
  if (github_logins) merged('github_logins', github_logins);
  if (arrivals) merged('arrivals', arrivals);
  const parsed = dashboardConfig.safeParse(next);
  if (!parsed.success) throw new ConfigError(z.prettifyError(parsed.error));
  const text = `${JSON.stringify(next, null, 2)}\n`;
  // Docker mounts config.json alone, in a directory of its own: the file cannot be replaced there, only rewritten.
  await writeFile(`${path}.tmp`, text)
    .then(() => rename(`${path}.tmp`, path))
    .catch(async () => {
      await rm(`${path}.tmp`, { force: true });
      await writeFile(path, text);
    });
  return parsed.data;
}

/** The squad Moi and Squad show: none while the dashboard follows me alone, which keeps it for the day it is followed again. */
export const followedSquad = (config: DashboardConfig) => (config.follow === 'squad' ? config.squad : undefined);

/** Whose work the collection reads whole: me, and my squad when it is followed. */
export function followed(config: DashboardConfig, me: string) {
  const squad = followedSquad(config);
  return [...new Set([me, ...(squad ? [squad.lead, ...squad.members] : [])])];
}

/** Me and my squad, followed or not: their PRs and reviews make a review request a colleague's. */
export function squadOf(config: DashboardConfig, me: string) {
  return new Set([me, ...(config.squad ? [config.squad.lead, ...config.squad.members] : [])]);
}
