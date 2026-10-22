import { cpus } from 'node:os';
import { join } from 'node:path';
import { Git, Slots } from './git';

export type Clone = { repo: string; remote: string; slug: string; git: Git };

/** The three clones under `root`, sharing one pool of git processes: odoo and enterprise branches live on odoo-dev. */
export function openClones(root: string, slots = new Slots(cpus().length)): Clone[] {
  return [
    { repo: 'odoo', remote: 'dev', slug: 'odoo-dev/odoo' },
    { repo: 'enterprise', remote: 'dev', slug: 'odoo-dev/enterprise' },
    { repo: 'upgrade', remote: 'origin', slug: 'odoo/upgrade' },
  ].map((clone) => ({ ...clone, git: new Git(join(root, clone.repo), slots) }));
}
