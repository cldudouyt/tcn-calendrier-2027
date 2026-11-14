import { normalizeText } from './format';

/** Vue minimale d'une épreuve pour le filtrage (liste et carte partagent ce module). */
export interface Filterable {
  id: string;
  name: string;
  town: string | null;
  department: string;
  kind: string;
  formatTags: string[];
  month: string;
  /** Date ISO de l'épreuve. */
  date: string;
  status: string;
  access: string[];
}

export interface Filters {
  q: string;
  dep: string[];
  kind: string[];
  format: string[];
  month: string[];
  status: string[];
  access: string[];
  /** Afficher aussi les épreuves passées (paramètre d'URL « passees=1 »). */
  past: boolean;
  /** Date du jour (AAAA-MM-JJ, heure de Paris) ; vide = aucun tri par date. Jamais mise dans l'URL. */
  today: string;
}

export const MULTI_KEYS = ['dep', 'kind', 'format', 'month', 'status', 'access'] as const;
export type MultiKey = (typeof MULTI_KEYS)[number];

export const emptyFilters = (): Filters => ({ q: '', dep: [], kind: [], format: [], month: [], status: [], access: [], past: false, today: '' });

export function parseFilters(params: URLSearchParams): Filters {
  const f = emptyFilters();
  f.q = (params.get('q') ?? '').trim();
  f.past = params.get('passees') === '1';
  for (const key of MULTI_KEYS) {
    f[key] = [...new Set(params.getAll(key).flatMap((v) => v.split(',')).map((v) => v.trim()).filter(Boolean))];
  }
  return f;
}

export function serializeFilters(f: Filters): URLSearchParams {
  const p = new URLSearchParams();
  if (f.q.trim()) p.set('q', f.q.trim());
  for (const key of MULTI_KEYS) if (f[key].length) p.set(key, f[key].join(','));
  if (f.past) p.set('passees', '1');
  return p;
}

export const activeFilterCount = (f: Filters): number =>
  (f.q.trim() ? 1 : 0) + MULTI_KEYS.reduce((n, key) => n + f[key].length, 0);

const anyOf = (selected: string[], values: string[]): boolean => selected.length === 0 || values.some((v) => selected.includes(v));

/** Filtres cumulables : ET entre critères, OU entre valeurs d'un même critère. */
export function matches(e: Filterable, f: Filters): boolean {
  // Épreuves passées masquées par défaut, sans attendre une nouvelle publication du site.
  if (!f.past && f.today && e.date < f.today) return false;
  if (f.q.trim()) {
    const hay = normalizeText(`${e.name} ${e.town ?? ''}`);
    if (!normalizeText(f.q).split(' ').every((word) => hay.includes(word))) return false;
  }
  return (
    anyOf(f.dep, [e.department]) &&
    anyOf(f.kind, [e.kind]) &&
    anyOf(f.format, e.formatTags) &&
    anyOf(f.month, [e.month]) &&
    anyOf(f.status, [e.status]) &&
    anyOf(f.access, e.access)
  );
}

export const applyFilters = <T extends Filterable>(events: T[], f: Filters): T[] => events.filter((e) => matches(e, f));

/** Libellé du compteur : « à venir » tant que les épreuves passées sont masquées. */
export function countLabel(shown: number, f: Filters, all: Filterable[]): string {
  if (f.past || !f.today) return shown === all.length ? 'rendez-vous régionaux' : `rendez-vous sur ${all.length}`;
  const upcoming = all.filter((e) => e.date >= f.today).length;
  if (shown !== upcoming) return `rendez-vous à venir sur ${upcoming}`;
  return upcoming < all.length ? `rendez-vous à venir · ${all.length} référencés, épreuves passées masquées` : 'rendez-vous à venir';
}
