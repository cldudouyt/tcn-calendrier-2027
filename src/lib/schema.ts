import type { RaceEvent } from './types';

export const DEPARTMENTS = ['44', '49', '53', '72', '85'] as const;
export const TRANSPORT_CODES = ['D', 'C', 'M', 'B', 'L', '?'] as const;
export const REGISTRATION_STATUSES = ['non_verifie', 'ouvert', 'annonce', 'a_confirmer', 'complet', 'ferme', 'annule'] as const;
export const LOCATION_ACCURACIES = ['non_geocode', 'centre_commune', 'depart_verifie'] as const;
export const EXPECTED_TOTAL = 78;
export const EXPECTED_BY_DEPARTMENT: Record<string, number> = { '44': 20, '49': 10, '53': 15, '72': 13, '85': 20 };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const isStr = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
const isNullOrStr = (v: unknown): boolean => v === null || typeof v === 'string';
const isHttps = (v: unknown): boolean => v === null || (typeof v === 'string' && /^https:\/\//.test(v));
const isLatLon = (v: unknown): boolean =>
  Array.isArray(v) && v.length === 2 && typeof v[0] === 'number' && typeof v[1] === 'number' &&
  v[0] >= 41 && v[0] <= 52 && v[1] >= -6 && v[1] <= 10; // [latitude, longitude] en France métropolitaine

export function isValidIsoDate(value: unknown): value is string {
  if (typeof value !== 'string' || !ISO_DATE.test(value)) return false;
  const d = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/** Valide une entrée ; retourne la liste des problèmes (vide si conforme). */
export function validateEvent(raw: unknown): string[] {
  const errors: string[] = [];
  if (typeof raw !== 'object' || raw === null) return ['entrée non objet'];
  const e = raw as Record<string, unknown>;
  const check = (ok: boolean, msg: string) => { if (!ok) errors.push(msg); };
  check(isStr(e.id), 'id manquant');
  check(isStr(e.eventGroupId), 'eventGroupId manquant');
  check((DEPARTMENTS as readonly unknown[]).includes(e.department), `département invalide : ${String(e.department)}`);
  check(isValidIsoDate(e.date), `date invalide : ${String(e.date)}`);
  check(isStr(e.name), 'nom manquant');
  check(typeof e.formats === 'string', 'formats manquant');
  check(Array.isArray(e.formatTags) && e.formatTags.every(isStr), 'formatTags invalide');
  check(isNullOrStr(e.town), 'town invalide');
  check(isStr(e.kind), 'kind manquant');
  check((TRANSPORT_CODES as readonly unknown[]).includes(e.transport), `code transport invalide : ${String(e.transport)}`);
  check(isStr(e.journey) && isStr(e.lastMile), 'journey/lastMile manquant');
  check((REGISTRATION_STATUSES as readonly unknown[]).includes(e.registrationStatus), `registrationStatus invalide : ${String(e.registrationStatus)}`);
  check(isHttps(e.registrationUrl) && isHttps(e.officialUrl), 'URL officielle ou d’inscription non https');
  check(e.price === null || (typeof e.price === 'number' && e.price >= 0), 'prix invalide');
  if (e.sourceConflict !== undefined && e.sourceConflict !== null) {
    const c = e.sourceConflict as { label?: unknown; url?: unknown };
    check(isStr(c.label) && typeof c.url === 'string' && isHttps(c.url), 'source contradictoire invalide');
  }
  if (e.formatAvailability !== undefined) {
    check(Array.isArray(e.formatAvailability) && e.formatAvailability.every((f: Record<string, unknown>) =>
      isStr(f.format) && ['ouvert', 'complet', 'non_verifie'].includes(String(f.status)) &&
      isStr(f.evidence) && typeof f.sourceUrl === 'string' && isHttps(f.sourceUrl)), 'disponibilités par format invalides');
  }
  check(e.coords === null || isLatLon(e.coords), 'coords doit être [latitude, longitude]');
  check(e.raceStartLatLon === null || isLatLon(e.raceStartLatLon), 'raceStartLatLon doit être [latitude, longitude]');
  check((LOCATION_ACCURACIES as readonly unknown[]).includes(e.locationAccuracy), 'locationAccuracy invalide');
  check(e.coords !== null || e.locationAccuracy === 'non_geocode', 'coords absent mais précision déclarée');
  check(e.locationAccuracy !== 'depart_verifie' || e.raceStartLatLon !== null, 'départ vérifié sans raceStartLatLon');
  check(Array.isArray(e.notes), 'notes invalide');
  // Garde-fous éditoriaux : rien d'affirmé sans source.
  if (e.registrationStatus !== 'non_verifie') {
    check(isStr(e.registrationEvidence), `statut « ${String(e.registrationStatus)} » sans preuve (registrationEvidence)`);
    check(isStr(e.lastCheckedAt), `statut « ${String(e.registrationStatus)} » sans date de vérification`);
    check(isStr(e.officialUrl) || isStr(e.registrationUrl), `statut « ${String(e.registrationStatus)} » sans lien officiel`);
  }
  if (e.price !== null) check(isStr(e.officialUrl) || isStr(e.registrationUrl), 'prix sans source officielle');
  return errors.map((m) => `${String(e.id ?? '?')} : ${m}`);
}

export function validateDataset(raw: unknown): { events: RaceEvent[]; errors: string[] } {
  if (!Array.isArray(raw)) return { events: [], errors: ['le fichier doit contenir un tableau'] };
  const errors = raw.flatMap(validateEvent);
  const ids = new Set<string>();
  for (const e of raw as { id?: string }[]) {
    if (e.id && ids.has(e.id)) errors.push(`${e.id} : id en double`);
    if (e.id) ids.add(e.id);
  }
  return { events: raw as RaceEvent[], errors };
}
