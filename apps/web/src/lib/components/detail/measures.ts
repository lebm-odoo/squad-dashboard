import { fmt } from '#lib/format.ts';
import type { Feature } from '#lib/squad/types.ts';

const plEn = (n: number, one: string, many = `${one}s`) => `${fmt(n)} ${n === 1 ? one : many}`;
const plFr = (n: number, one: string, many = `${one}s`) => `${fmt(n)} ${n > 1 ? many : one}`;

/** The parts of the stack a change's lines are split over, in a fixed order: each keeps its colour. */
export const profiles = ['back', 'front', 'views', 'data', 'test'];

const en = {
  level: (c: number | null | undefined): string =>
    c == null ? '—' : c >= 60 ? 'very high' : c >= 40 ? 'high' : c >= 20 ? 'medium' : 'simple',
  profiles: { back: 'Back', front: 'Front', views: 'Views', data: 'Data', test: 'Tests' } as Record<string, string>,
  profileHints: {
    back: 'Python, salary rules, migrations',
    front: 'JS, Owl templates, style',
    views: 'XML views, reports',
    data: 'CSV, JSON, XML records, demo',
    test: 'Python and JS tests',
  } as Record<string, string>,
  factors: {
    taille: (weighted: number, size?: number) =>
      `${plEn(weighted, 'weighted line')}${size != null && size !== weighted ? ` (${fmt(size)} raw)` : ''}`,
    fichiers: (n: number) => plEn(n, 'file'),
    modules: (n: number) => plEn(n, 'module'),
    schema: (models: number, fields: number) =>
      `${[models && plEn(models, 'model'), fields && plEn(fields, 'field')].filter(Boolean).join(', ')} added`,
    migration: 'migration script',
    frontend: 'frontend code',
  },
  points: (points: string, max: number) => `${points} point(s) out of ${max}`,
  facts: {
    size: 'Size',
    sizeValue: (size: number, weighted?: number) => `${plEn(size, 'line')}${weighted != null ? `, ${fmt(weighted)} weighted` : ''}`,
    unknown: 'unknown',
    complexity: 'Complexity',
    complexityValue: (c: number, level: string) => `${c}/100, ${level}`,
    lead: 'Lead time',
    openSince: 'Open for',
    received: 'Reviews received',
    receivedValue: (n: number, rounds: number) => `${n}${rounds ? `, ${plEn(rounds, 'round')} of changes` : ''}`,
    profile: 'Profile',
  },
  sections: { content: 'Content', review: 'Review', complexity: 'Complexity' },
  content: {
    lines: 'lines',
    linesValue: (ins: number, dels: number, mechanical?: number) =>
      `+${fmt(ins)} −${fmt(dels)}${mechanical ? `, of which ${fmt(mechanical)} moved or renamed` : ''}`,
    files: 'files',
    filesValue: (files: number, modules: number) => `${plEn(files, 'file')} in ${plEn(modules, 'module')}`,
    modules: 'modules',
    tests: 'tests',
    testsValue: (lines: number, tests?: number) => `${plEn(lines, 'line')}${tests ? `, ${plEn(tests, 'new test')}` : ''}`,
    none: 'none',
    schema: 'schema',
    migration: 'migration',
    migrationValue: (n: number) => plEn(n, 'line'),
    complexity: 'complexity',
    raw: (size: number, weighted?: number, mechanical?: number) =>
      weighted != null
        ? `${plEn(size, 'raw line')}, ${fmt(weighted)} weighted${mechanical ? `, of which ${fmt(mechanical)} mechanical (moved code, renames) counted for little` : ''}.`
        : `${plEn(size, 'line')}.`,
  },
  review: {
    openedOn: 'opened on',
    first: '1st review',
    firstValue: (delay: string) => `${delay} after the review request`,
    none: 'none',
    from: 'received from',
    changes: 'changes',
    changesValue: (n: number) => (n ? plEn(n, 'round asked', 'rounds asked') : 'none asked'),
    toMerge: 'until the merge',
  },
  commitsTotal: (n: number) => `${plEn(n, 'commit')} in all`,
  breakdown: 'From raw lines to weighted lines',
  rule: 'A line added counts its file’s weight, a line deleted 0.3 of it, a line moved or renamed 0.1; data counts 0.15 up to 300 lines per change, 0.02 beyond; translations are not counted.',
  kinds: {
    back: 'Python',
    front: 'JavaScript',
    migration: 'Migrations',
    rules: 'Salary rules',
    template: 'Owl templates',
    views: 'Views',
    style: 'Style',
    test: 'Tests',
    data: 'Data',
    other: 'Other',
  } as Record<string, string>,
  kindHead: {
    kind: 'Kind of file',
    weight: 'Weight',
    ins: 'Added',
    dels: 'Deleted',
    mechanical: 'Moved, renamed',
    weighted: 'Weighted lines',
    share: 'Share',
  } as Record<string, string>,
};

const fr: typeof en = {
  level: (c) => (c == null ? '—' : c >= 60 ? 'très élevée' : c >= 40 ? 'élevée' : c >= 20 ? 'moyenne' : 'simple'),
  profiles: { back: 'Back', front: 'Front', views: 'Vues', data: 'Data', test: 'Tests' },
  profileHints: {
    back: 'Python, règles salariales, migrations',
    front: 'JS, templates Owl, style',
    views: 'vues XML, rapports',
    data: 'CSV, JSON, records XML, démo',
    test: 'tests Python et JS',
  },
  factors: {
    taille: (weighted, size) =>
      `${plFr(weighted, 'ligne pondérée', 'lignes pondérées')}${size != null && size !== weighted ? ` (${fmt(size)} brutes)` : ''}`,
    fichiers: (n) => plFr(n, 'fichier'),
    modules: (n) => plFr(n, 'module'),
    schema: (models, fields) => `${[models && plFr(models, 'modèle'), fields && plFr(fields, 'champ')].filter(Boolean).join(', ')} ajoutés`,
    migration: 'script de migration',
    frontend: 'code frontend',
  },
  points: (points, max) => `${points} point(s) sur ${max}`,
  facts: {
    size: 'Taille',
    sizeValue: (size, weighted) => `${fmt(size)} lignes${weighted != null ? `, ${fmt(weighted)} pondérées` : ''}`,
    unknown: 'inconnue',
    complexity: 'Complexité',
    complexityValue: (c, level) => `${c}/100, ${level}`,
    lead: 'Lead time',
    openSince: 'Ouverte depuis',
    received: 'Reviews reçues',
    receivedValue: (n, rounds) => `${n}${rounds ? `, ${plFr(rounds, 'tour')} de changements` : ''}`,
    profile: 'Profil',
  },
  sections: { content: 'Contenu', review: 'Review', complexity: 'Complexité' },
  content: {
    lines: 'lignes',
    linesValue: (ins, dels, mechanical) =>
      `+${fmt(ins)} −${fmt(dels)}${mechanical ? `, dont ${fmt(mechanical)} déplacées ou renommées` : ''}`,
    files: 'fichiers',
    filesValue: (files, modules) => `${plFr(files, 'fichier')} dans ${plFr(modules, 'module')}`,
    modules: 'modules',
    tests: 'tests',
    testsValue: (lines, tests) => `${fmt(lines)} lignes${tests ? `, ${plFr(tests, 'nouveau test', 'nouveaux tests')}` : ''}`,
    none: 'aucun',
    schema: 'schéma',
    migration: 'migration',
    migrationValue: (n) => `${fmt(n)} lignes`,
    complexity: 'complexité',
    raw: (size, weighted, mechanical) =>
      weighted != null
        ? `${fmt(size)} lignes brutes, ${fmt(weighted)} pondérées${mechanical ? `, dont ${fmt(mechanical)} mécaniques (code déplacé, renommages) comptées pour peu` : ''}.`
        : `${fmt(size)} lignes.`,
  },
  review: {
    openedOn: 'ouverte le',
    first: '1ʳᵉ review',
    firstValue: (delay) => `${delay} après la mise en review`,
    none: 'aucune',
    from: 'reçues de',
    changes: 'changements',
    changesValue: (n) => (n ? plFr(n, 'tour demandé', 'tours demandés') : 'aucun demandé'),
    toMerge: 'jusqu’au merge',
  },
  commitsTotal: (n) => `${plFr(n, 'commit')} au total`,
  breakdown: 'Des lignes brutes aux lignes pondérées',
  rule: 'Une ligne ajoutée compte le poids de son fichier, une ligne supprimée 0,3 de ce poids, une ligne déplacée ou renommée 0,1 ; la data compte 0,15 jusqu’à 300 lignes par changement, 0,02 au-delà ; les traductions ne comptent pas.',
  kinds: {
    back: 'Python',
    front: 'JavaScript',
    migration: 'Migrations',
    rules: 'Règles salariales',
    template: 'Templates Owl',
    views: 'Vues',
    style: 'Style',
    test: 'Tests',
    data: 'Data',
    other: 'Autres',
  },
  kindHead: {
    kind: 'Type de fichier',
    weight: 'Poids',
    ins: 'Ajoutées',
    dels: 'Supprimées',
    mechanical: 'Déplacées, renommées',
    weighted: 'Lignes pondérées',
    share: 'Part',
  },
};

/** The words of a card's measures, in both languages. */
export const words = { en, fr };

/** Each factor of the complexity score worth 2 points or more, the biggest first, in words, with its ceiling. */
export function complexityReasons(f: Feature, factors: (typeof en)['factors']) {
  const described: Record<string, [number, () => string]> = {
    taille: [35, () => factors.taille(f.weighted ?? f.size ?? 0, f.weighted != null ? f.size : undefined)],
    fichiers: [15, () => factors.fichiers(f.files ?? 0)],
    modules: [15, () => factors.modules(Object.keys(f.modules ?? {}).length)],
    schéma: [10, () => factors.schema(f.new_models ?? 0, f.new_fields ?? 0)],
    migration: [8, () => factors.migration],
    frontend: [5, () => factors.frontend],
  };
  return Object.entries(f.complexity_factors || {})
    .filter(([key, points]) => points >= 2 && described[key])
    .sort((a, b) => b[1] - a[1])
    .map(([key, points]) => {
      const [max, text] = described[key] as [number, () => string];
      return { key, points, max, text: text() };
    });
}
