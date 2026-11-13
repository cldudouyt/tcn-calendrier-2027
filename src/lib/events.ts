import rawEvents from '../../data.json';
import rawOutOfRegion from '../../data/hors-region.json';
import rawSurveys from '../../data/releves.json';
import type { OutOfRegionEvent, RaceEvent, RegistrationStatus, Survey } from './types';
import { validateDataset } from './schema';
import { effectiveStatus } from './status';
import { accessCategories } from './transport';
import { addDays, formatDay, isoWeekday, monthKey } from './format';
import type { Filterable } from './filters';

const { events: validated, errors } = validateDataset(rawEvents);
if (errors.length) throw new Error(`data.json non conforme :\n${errors.join('\n')}`);

const byDateThenName = (a: { date: string; name: string }, b: { date: string; name: string }): number =>
  a.date.localeCompare(b.date) || a.name.localeCompare(b.name, 'fr');

/** Les 78 rendez-vous régionaux, triés par date puis nom. */
export const events: RaceEvent[] = [...validated].sort(byDateThenName);
export const outOfRegion: OutOfRegionEvent[] = [...(rawOutOfRegion as OutOfRegionEvent[])].sort(byDateThenName);
export const surveys: Survey[] = [...(rawSurveys as Survey[])].sort((a, b) => b.checkedAt.localeCompare(a.checkedAt));

export const DEPARTMENT_NAMES: Record<string, string> = {
  '44': 'Loire-Atlantique', '49': 'Maine-et-Loire', '53': 'Mayenne', '72': 'Sarthe', '85': 'Vendée',
};
export const FORMAT_LABELS: Record<string, string> = {
  XS: 'XS', S: 'S', M: 'M', L: 'L', XL: 'XL', XXL: 'XXL', Jeunes: 'Jeunes', relais: 'Relais', D3: 'D3', animathlon: 'Animathlon',
};
export const PDF_REFERENCE_DATE = '2026-11-13';

export const eventUrl = (e: Pick<RaceEvent, 'id'>): string => `/epreuves/${e.id}/`;

export function toFilterable(e: RaceEvent): Filterable {
  return {
    id: e.id, name: e.name, town: e.town, department: e.department, kind: e.kind,
    formatTags: e.formatTags, month: monthKey(e.date), status: effectiveStatus(e), access: accessCategories(e),
  };
}

export interface Kpis { total: number; open: number; announced: number; toConfirm: number; byStatus: Record<RegistrationStatus, number> }

/** Indicateurs calculés depuis les données, jamais figés. */
export function computeKpis(list: RaceEvent[]): Kpis {
  const byStatus: Record<RegistrationStatus, number> = { non_verifie: 0, ouvert: 0, annonce: 0, complet: 0, ferme: 0, annule: 0 };
  for (const e of list) byStatus[effectiveStatus(e)] += 1;
  return { total: list.length, open: byStatus.ouvert, announced: byStatus.annonce, toConfirm: byStatus.non_verifie, byStatus };
}

export interface WeekendGroup { key: string; label: string; multi: boolean; events: RaceEvent[] }

/** Clé de regroupement : vendredi, samedi et dimanche d'une même semaine partagent le samedi. */
export function weekendKey(iso: string): string {
  const wd = isoWeekday(iso);
  return wd >= 5 ? addDays(iso, 6 - wd) : iso;
}

/** Regroupe visuellement un week-end sans fusionner les entrées. */
export function groupByWeekend(list: RaceEvent[]): WeekendGroup[] {
  const groups = new Map<string, RaceEvent[]>();
  for (const e of list) {
    const key = weekendKey(e.date);
    groups.set(key, [...(groups.get(key) ?? []), e]);
  }
  return [...groups.entries()].map(([key, evs]) => {
    const first = evs[0]!.date;
    const last = evs[evs.length - 1]!.date;
    const weekend = isoWeekday(first) >= 5;
    const label = first === last ? formatDay(first) : `Week-end du ${formatDay(first)} au ${formatDay(last)}`;
    return { key, label: weekend && first !== last ? label : formatDay(first), multi: evs.length > 1, events: evs };
  });
}

export function siblings(e: RaceEvent): RaceEvent[] {
  return events.filter((o) => o.eventGroupId === e.eventGroupId && o.id !== e.id);
}
