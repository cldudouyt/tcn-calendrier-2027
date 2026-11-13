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
}

export const MULTI_KEYS = ['dep', 'kind', 'format', 'month', 'status', 'access'] as const;
export type MultiKey = (typeof MULTI_KEYS)[number];

export const emptyFilters = (): Filters => ({ q: '', dep: [], kind: [], format: [], month: [], status: [], access: [] });

export function parseFilters(params: URLSearchParams): Filters {
  const f = emptyFilters();
  f.q = (params.get('q') ?? '').trim();
  for (const key of MULTI_KEYS) {
    f[key] = [...new Set(params.getAll(key).flatMap((v) => v.split(',')).map((v) => v.trim()).filter(Boolean))];
  }
  return f;
}

export function serializeFilters(f: Filters): URLSearchParams {
  const p = new URLSearchParams();
  if (f.q.trim()) p.set('q', f.q.trim());
  for (const key of MULTI_KEYS) if (f[key].length) p.set(key, f[key].join(','));
  return p;
}

export const activeFilterCount = (f: Filters): number =>
  (f.q.trim() ? 1 : 0) + MULTI_KEYS.reduce((n, key) => n + f[key].length, 0);

const anyOf = (selected: string[], values: string[]): boolean => selected.length === 0 || values.some((v) => selected.includes(v));

/** Filtres cumulables : ET entre critères, OU entre valeurs d'un même critère. */
export function matches(e: Filterable, f: Filters): boolean {
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
