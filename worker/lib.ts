// Logique pure de la veille (sans dépendance Cloudflare) : testable avec Vitest.
import type { RaceEvent, RegistrationStatus } from '../src/lib/types';
import { REGISTRATION_STATUSES, isValidIsoDate } from '../src/lib/schema';

/** Jour et heure à Paris, quel que soit le régime d'heure (été/hiver). */
export function parisParts(date: Date): { weekday: string; hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Paris', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date);
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? '';
  return { weekday: get('weekday'), hour: Number(get('hour')), minute: Number(get('minute')) };
}

/**
 * Le cron Cloudflare est en UTC : il est déclenché à 06:30 et 07:30 UTC chaque jour, et
 * seul le déclenchement qui tombe à 08 h 30 à Paris est exécuté.
 */
export function isDailySlot(date: Date): boolean {
  const p = parisParts(date);
  return p.hour === 8 && p.minute === 30;
}

export const PATCH_FIELDS = [
  'registrationStatus', 'registrationUrl', 'officialUrl', 'registrationOpenAt', 'registrationEvidence',
  'price', 'formatAvailability', 'sourceConflict', 'date', 'formats', 'raceStartLocation', 'raceStartLatLon', 'transportBikePolicy',
] as const;
export type PatchField = (typeof PATCH_FIELDS)[number];
export type EventPatch = Partial<Pick<RaceEvent, PatchField>>;

export interface ChangeInput { eventId: string; checkedAt: string; summary: string; patch: EventPatch }
export interface ValidChange extends ChangeInput { category: string; evidence: string | null; sourceUrl: string | null }

const CATEGORY_BY_STATUS: Record<RegistrationStatus, string> = {
  ouvert: 'ouvert_confirme', annonce: 'ouverture_annoncee', non_verifie: 'non_confirme', a_confirmer: 'source_contradictoire',
  complet: 'complet', ferme: 'ferme', annule: 'annule',
};
export const CATEGORY_LABELS: Record<string, string> = {
  ouvert_confirme: 'Ouvert confirmé', ouverture_annoncee: 'Ouverture annoncée', non_confirme: 'Non confirmé',
  source_contradictoire: 'Sources contradictoires',
  complet: 'Complet', ferme: 'Fermé', annule: 'Annulé', modification: 'Modification de date ou de format',
  information: 'Information complétée',
};

/**
 * Au chargement d'un Worker Cloudflare (hors requête), l'horloge est figée à 0 : toute date paraîtrait
 * future. Le contrôle n'a de sens que si l'horloge est réelle (build, tests, requête en cours).
 */
export function isInFuture(iso: string, nowMs: number = Date.now()): boolean {
  return nowMs > 0 && Date.parse(iso) > nowMs + 60_000;
}

const isHttps = (v: unknown): v is string => typeof v === 'string' && /^https:\/\/[^\s]+$/.test(v);
const isIsoDateTime = (v: unknown): v is string => typeof v === 'string' && v.length >= 10 && !Number.isNaN(Date.parse(v));

/** Valide une proposition de changement. Aucune affirmation n'est acceptée sans preuve ni lien officiel. */
export function validateChange(raw: unknown, base: Map<string, RaceEvent>): { ok: true; change: ValidChange } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const input = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const eventId = typeof input.eventId === 'string' ? input.eventId : '';
  const event = base.get(eventId);
  if (!event) errors.push(`épreuve inconnue : ${eventId || '(vide)'}`);
  if (!isIsoDateTime(input.checkedAt)) errors.push('checkedAt (date de vérification ISO 8601) requis');
  else if (isInFuture(input.checkedAt)) errors.push('checkedAt ne peut pas être dans le futur');
  if (typeof input.summary !== 'string' || input.summary.trim().length < 5) errors.push('summary requis');
  const patchRaw = (typeof input.patch === 'object' && input.patch !== null ? input.patch : {}) as Record<string, unknown>;
  const keys = Object.keys(patchRaw);
  if (keys.length === 0) errors.push('patch vide');
  for (const k of keys) if (!(PATCH_FIELDS as readonly string[]).includes(k)) errors.push(`champ non modifiable : ${k}`);
  const p = patchRaw as EventPatch;

  for (const k of ['registrationUrl', 'officialUrl'] as const) {
    if (k in p && p[k] !== null && !isHttps(p[k])) errors.push(`${k} doit être une URL https`);
  }
  if ('registrationStatus' in p && !(REGISTRATION_STATUSES as readonly unknown[]).includes(p.registrationStatus)) errors.push('registrationStatus invalide');
  if ('date' in p && !isValidIsoDate(p.date)) errors.push('date invalide (YYYY-MM-DD)');
  if ('registrationOpenAt' in p && p.registrationOpenAt !== null && !isIsoDateTime(p.registrationOpenAt)) errors.push('registrationOpenAt invalide');
  if ('price' in p && p.price !== null && !(typeof p.price === 'number' && p.price >= 0)) errors.push('price invalide');
  if ('formats' in p && (typeof p.formats !== 'string' || !p.formats.trim())) errors.push('formats invalide');
  if ('raceStartLatLon' in p && p.raceStartLatLon !== null) {
    const c = p.raceStartLatLon;
    if (!(Array.isArray(c) && c.length === 2 && c[0] >= 41 && c[0] <= 52 && c[1] >= -6 && c[1] <= 10)) errors.push('raceStartLatLon doit être [latitude, longitude]');
  }
  if ('transportBikePolicy' in p && p.transportBikePolicy !== null) {
    const b = p.transportBikePolicy;
    if (!(b && typeof b.summary === 'string' && isHttps(b.sourceUrl) && isIsoDateTime(b.checkedAt) && typeof b.confirmedForDate === 'boolean')) {
      errors.push('transportBikePolicy : summary, sourceUrl https, checkedAt et confirmedForDate requis');
    }
  }

  // Preuve : le fait vérifié et le lien officiel après application du changement.
  const evidence = (p.registrationEvidence ?? event?.registrationEvidence ?? null) || null;
  const link = ('registrationUrl' in p ? p.registrationUrl : event?.registrationUrl) ?? ('officialUrl' in p ? p.officialUrl : event?.officialUrl) ?? null;
  const status = p.registrationStatus;
  if (status && status !== 'non_verifie') {
    if (!evidence) errors.push(`statut « ${status} » refusé sans registrationEvidence (fait vérifié)`);
    if (!link) errors.push(`statut « ${status} » refusé sans lien officiel (registrationUrl ou officialUrl)`);
  }
  if ('price' in p && p.price !== null && !link) errors.push('prix refusé sans lien officiel');
  if ('sourceConflict' in p && p.sourceConflict != null) {
    if (!p.sourceConflict.label?.trim() || !isHttps(p.sourceConflict.url)) errors.push('sourceConflict invalide');
  }
  if (status === 'a_confirmer' && !p.sourceConflict && !event?.sourceConflict) {
    errors.push('un statut contradictoire exige une seconde source identifiée');
  }
  if ('formatAvailability' in p && p.formatAvailability !== undefined) {
    if (!Array.isArray(p.formatAvailability) || p.formatAvailability.some((f) =>
      !f.format?.trim() || !['ouvert', 'complet', 'non_verifie'].includes(f.status) ||
      !f.evidence?.trim() || !isHttps(f.sourceUrl))) {
      errors.push('formatAvailability invalide : source officielle et preuve par format requises');
    }
  }
  if (errors.length || !event) return { ok: false, errors };

  const category = status ? CATEGORY_BY_STATUS[status] : 'date' in p || 'formats' in p ? 'modification' : 'information';
  return {
    ok: true,
    change: { eventId, checkedAt: input.checkedAt as string, summary: (input.summary as string).trim(), patch: p, category, evidence, sourceUrl: link },
  };
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${stable((value as Record<string, unknown>)[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/** Même épreuve + même contenu = même clé, quel que soit le relevé ou l'ordre des champs. */
export async function dedupeKey(eventId: string, patch: EventPatch): Promise<string> {
  const bytes = new TextEncoder().encode(`${eventId}|${stable(patch)}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Un changement qui ne modifie rien par rapport à l'état publié n'est pas une nouveauté. */
export function isNoop(event: RaceEvent, patch: EventPatch): boolean {
  return Object.entries(patch).every(([k, v]) => stable(event[k as PatchField]) === stable(v));
}

export function applyPatch(event: RaceEvent, patch: EventPatch, meta?: { lastCheckedAt: string; changedAt: string }): RaceEvent {
  return { ...event, ...patch, ...(meta ?? {}) };
}

export function mergeOverrides(base: RaceEvent[], overrides: Map<string, EventPatch & { lastCheckedAt?: string; changedAt?: string }>): RaceEvent[] {
  return base.map((e) => {
    const o = overrides.get(e.id);
    return o ? { ...e, ...o } : e;
  });
}

/** Comparaison en temps constant du jeton d'administration. */
export function checkBearer(header: string | null, token: string | undefined): boolean {
  if (!token || token.length < 16 || !header?.startsWith('Bearer ')) return false;
  const a = new TextEncoder().encode(header.slice(7));
  const b = new TextEncoder().encode(token);
  let diff = a.length ^ b.length;
  for (let i = 0; i < b.length; i += 1) diff |= (a[i % Math.max(a.length, 1)] ?? 0) ^ b[i]!;
  return diff === 0;
}
