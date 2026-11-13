const DAY = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const MONTH = new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const WEEKDAY_SHORT = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', timeZone: 'UTC' });
const MONTH_SHORT = new Intl.DateTimeFormat('fr-FR', { month: 'short', timeZone: 'UTC' });
const PARIS = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'long', timeStyle: 'short', timeZone: 'Europe/Paris' });
const PARIS_DATE = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'long', timeZone: 'Europe/Paris' });

/** Une date d'épreuve est un jour civil : on la manipule à midi UTC pour éviter tout décalage. */
export const dayToDate = (iso: string): Date => new Date(`${iso}T12:00:00Z`);
export const formatDay = (iso: string): string => DAY.format(dayToDate(iso));
export const formatMonth = (monthKey: string): string => MONTH.format(dayToDate(`${monthKey}-01`));
export const weekdayShort = (iso: string): string => WEEKDAY_SHORT.format(dayToDate(iso));
export const monthShort = (iso: string): string => MONTH_SHORT.format(dayToDate(iso));
export const dayNumber = (iso: string): number => dayToDate(iso).getUTCDate();
export const monthKey = (iso: string): string => iso.slice(0, 7);
/** 1 = lundi … 7 = dimanche. */
export const isoWeekday = (iso: string): number => dayToDate(iso).getUTCDay() || 7;

export function addDays(iso: string, days: number): string {
  const d = dayToDate(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Horodatage affiché à l'heure de Paris. */
export function formatParis(isoDateTime: string, precision: 'date' | 'minute' = 'minute'): string {
  const d = new Date(isoDateTime.length === 10 ? `${isoDateTime}T12:00:00Z` : isoDateTime);
  return precision === 'date' || isoDateTime.length === 10 ? PARIS_DATE.format(d) : `${PARIS.format(d)} (heure de Paris)`;
}

export function listMonths(first: string, last: string): string[] {
  const out: string[] = [];
  let [y, m] = first.split('-').map(Number) as [number, number];
  for (;;) {
    const key = `${y}-${String(m).padStart(2, '0')}`;
    out.push(key);
    if (key === last) break;
    m += 1;
    if (m > 12) { m = 1; y += 1; }
    if (out.length > 60) break;
  }
  return out;
}

/** Normalisation pour la recherche : sans accents, apostrophes ni casse. */
export function normalizeText(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[’'`\-–]/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
}
