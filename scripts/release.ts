/**
 * Prepares a release: `bun run release patch|minor|major|x.y.z [--no-check]`. The checks run on the clean tree, then the
 * CHANGELOG's Unreleased notes become the version's, package.json takes the version, in one commit. Nothing is pushed or
 * tagged: once its pull request is merged, master gets the tag vX.Y.Z and its GitHub release from the release workflow.
 */
import { $ } from 'bun';
import { newer } from '../apps/server/src/release';

const fail = (message: string): never => {
  console.error(message);
  process.exit(1);
};
const [bump = ''] = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));
if ((await $`git status --porcelain`.text()).trim()) fail('des changements non commités : les commiter ou les mettre de côté');
const branch = (await $`git branch --show-current`.text()).trim() || fail('HEAD détachée : se placer sur la branche à publier');

const pkg = await Bun.file('package.json').json();
const [major = 0, minor = 0, patch = 0] = String(pkg.version).replace(/-.*/, '').split('.').map(Number);
// From a pre-release, a bump releases the version it prepares when that one is already of the bump's kind, as npm does.
const pre = String(pkg.version).includes('-');
const version = /^\d+\.\d+\.\d+$/.test(bump)
  ? bump
  : bump === 'major'
    ? pre && !minor && !patch
      ? `${major}.0.0`
      : `${major + 1}.0.0`
    : bump === 'minor'
      ? pre && !patch
        ? `${major}.${minor}.0`
        : `${major}.${minor + 1}.0`
      : bump === 'patch'
        ? pre
          ? `${major}.${minor}.${patch}`
          : `${major}.${minor}.${patch + 1}`
        : fail('usage : bun run release patch|minor|major|x.y.z [--no-check]');
if (!newer(version, pkg.version)) fail(`${version} ne vient pas après ${pkg.version}`);
if ((await $`git tag --list v${version}`.text()).trim()) fail(`le tag v${version} existe déjà`);

// `## x.y.z - date`, without brackets: the V1's update banner reads the notes of the versions after its own that way.
const changelog = await Bun.file('CHANGELOG.md').text();
const unreleased = changelog.match(/^## Unreleased\n([\s\S]*?)(?=^## |(?![\s\S]))/m);
const notes = unreleased?.[1]?.trim() || fail('CHANGELOG.md : rien sous « ## Unreleased » à publier');

if (!process.argv.includes('--no-check')) await $`bun run check`;
const date = new Date().toISOString().slice(0, 10);
await Bun.write('CHANGELOG.md', changelog.replace(unreleased?.[0] ?? '', `## Unreleased\n\n## ${version} - ${date}\n\n${notes}\n\n`));
await Bun.write('package.json', `${JSON.stringify({ ...pkg, version }, null, 2)}\n`);
await $`git commit --quiet -m ${`Release ${version}`} -- CHANGELOG.md package.json`;
console.log(`${version} est prête. Pour la publier : pousser ${branch}, puis sa pull request vers master`);
