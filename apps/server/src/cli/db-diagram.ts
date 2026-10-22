import { resolve } from 'node:path';
import { getTableConfig, type PgTable } from 'drizzle-orm/pg-core';
import * as schema from '../db/schema';

// The tables join on natural keys without foreign keys (facts arrive from each source in any order): these are the logical links.
const links = [
  'github_pr ||..o{ github_review : "repo, number"',
  'github_pr ||..o{ github_force_push : "repo, number"',
  'github_pr ||..o{ github_rplus : "repo, number"',
  'github_pr ||..o| github_rplus_scan : "repo, number"',
  'github_pr ||..o| mergebot_pr : "repo, number"',
  'git_branch ||..o{ git_push : "repo, name = branch"',
  'git_branch ||..o| runbot_bundle : "name"',
  'git_branch ||..o| git_snapshot : "repo, head"',
  'git_snapshot ||..o{ git_transition : "repo, head = old or next"',
  'git_commit ||..o| git_mechanical : "repo, sha = revs"',
  'git_branch ||..o| git_contribution : "repo, name = branch"',
  'dashboard_feature ||..o| archive_entry : "name = key"',
];

const entities = Object.values(schema).map((table) => {
  const { name, columns, primaryKeys } = getTableConfig(table as PgTable);
  const keys = new Set(
    [...columns.filter((column) => column.primary), ...primaryKeys.flatMap((key) => key.columns)].map((column) => column.name),
  );
  const rows = columns.map((column) => {
    const type = column.getSQLType().replace('timestamp with time zone', 'timestamptz').replace('[]', '_array');
    return `    ${type} ${column.name}${keys.has(column.name) ? ' PK' : column.notNull ? '' : ' "nullable"'}`;
  });
  return `  ${name} {\n${rows.join('\n')}\n  }`;
});

const markdown = `# Database schema

Generated from \`apps/server/src/db/schema.ts\` by \`bun run db:diagram\`: do not edit by hand. The dotted links are logical,
without foreign keys: each source delivers its facts in any order.

\`\`\`mermaid
erDiagram
${entities.join('\n')}
${links.map((link) => `  ${link}`).join('\n')}
\`\`\`
`;
await Bun.write(resolve(import.meta.dir, '../../../../docs/database.md'), markdown);
console.log('docs/database.md écrit');
