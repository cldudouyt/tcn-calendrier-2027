// Signalements communautaires des inscriptions : validation, sécurité des adresses, évaluation d'une page.
// Module pur (aucun accès réseau ni API Cloudflare) : utilisé par worker/index.ts et testé par Vitest.
import type { FormatAvailability, RaceEvent } from '../src/lib/types';
import { editionYear, groupKeywords, hashText, htmlToText, isTicketing, normalize, parseFrenchDates } from './watch';

export const REPORT_TYPES = ['inscriptions_ouvertes', 'complet', 'ouverture_annoncee'] as const;
export type ReportType = (typeof REPORT_TYPES)[number];
export const REPORT_TYPE_LABELS: Record<ReportType, string> = {
  inscriptions_ouvertes: 'Inscriptions ouvertes',
  complet: 'Complet',
  ouverture_annoncee: 'Ouverture annoncée',
};

/** en_attente → confirme | sans_effet | a_verifier ; un administrateur clôt ensuite les « à vérifier » (traite | rejete). */
export type ReportState = 'en_attente' | 'confirme' | 'sans_effet' | 'a_verifier' | 'traite' | 'rejete';

export const MAX_URL_LENGTH = 500;

// ---------------------------------------------------------------------------
// Adresse fournie par un membre : contrôles anti-SSRF avant tout stockage ou lecture.

const PRIVATE_HOST = /^(localhost|.*\.localhost|.*\.local|.*\.internal|.*\.lan|.*\.home|.*\.corp|.*\.intranet)$/i;
const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

export function isForbiddenHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/\.$/, '');
  if (!h.includes('.')) return true; // nom sans domaine (machine interne)
  if (IPV4.test(h) || h.startsWith('[') || h.includes(':')) return true; // adresses IP littérales, IPv6
  return PRIVATE_HOST.test(h);
}

const TRACKING = /^(utm_[a-z]+|fbclid|gclid|mc_[a-z]+|ref|igshid)$/i;

/** Valide et normalise l'adresse : https/http, port standard, pas d'identifiants ni d'IP, paramètres de suivi retirés. */
export function normalizeReportUrl(raw: unknown): { ok: true; url: string; host: string } | { ok: false; error: string } {
  if (typeof raw !== 'string' || !raw.trim()) return { ok: false, error: 'Adresse de la source manquante.' };
  const value = raw.trim();
  if (value.length > MAX_URL_LENGTH) return { ok: false, error: `Adresse trop longue (${MAX_URL_LENGTH} caractères au plus).` };
  let u: URL;
  try { u = new URL(value); } catch { return { ok: false, error: 'Adresse invalide : copiez le lien complet, commençant par https://.' }; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return { ok: false, error: 'Seules les adresses web (https://) sont acceptées.' };
  if (u.username || u.password) return { ok: false, error: 'Adresse refusée (identifiants intégrés).' };
  if (u.port && u.port !== '443' && u.port !== '80') return { ok: false, error: 'Adresse refusée (port inhabituel).' };
  if (isForbiddenHost(u.hostname)) return { ok: false, error: 'Adresse refusée : utilisez la page publique de l’organisateur ou de la billetterie.' };
  u.protocol = 'https:';
  u.port = '';
  u.hash = '';
  u.hostname = u.hostname.toLowerCase();
  for (const key of [...u.searchParams.keys()]) if (TRACKING.test(key)) u.searchParams.delete(key);
  if (u.pathname.length > 1) u.pathname = u.pathname.replace(/\/+$/, '') || '/';
  return { ok: true, url: u.toString(), host: u.hostname };
}

/** Domaines connus : billetteries reconnues, calendrier FFTRI, sites officiels déjà référencés. */
export function buildKnownHosts(events: RaceEvent[], sourceUrls: string[]): Set<string> {
  const hosts = new Set(['fftri.t2area.com', 'www.klikego.com', 'klikego.com', 'www.timepulse.fr', 'timepulse.fr', 'in.inscriptions-tiel.com',
    'in.njuko.com', 'www.helloasso.com', 'protiming.fr', 'www.protiming.fr', 'www.espace-competition.com', 'www.ironman.com']);
  const add = (raw: string | null | undefined): void => {
    if (!raw) return;
    try { hosts.add(new URL(raw).hostname.toLowerCase()); } catch { /* ignoré */ }
  };
  for (const e of events) { add(e.officialUrl); add(e.registrationUrl); for (const f of e.formatAvailability ?? []) add(f.sourceUrl); }
  for (const url of sourceUrls) add(url);
  return hosts;
}

/** Un domaine connu, ou un sous-domaine d'une billetterie reconnue, peut être lu automatiquement. */
export function isKnownHost(host: string, known: Set<string>): boolean {
  const h = host.toLowerCase();
  if (known.has(h) || known.has(h.replace(/^www\./, '')) || known.has(`www.${h}`)) return true;
  return isTicketing(`https://${h}/inscription`);
}

/** Même épreuve + même type + même format + même page (adresse normalisée) = même signalement. */
export function reportDedupeKey(eventId: string, type: ReportType, format: string, url: string): string {
  return hashText(`${eventId}|${type}|${format}|${url.toLowerCase().replace(/^https?:\/\/(www\.)?/, '')}`);
}

export interface ReportInput { eventId: string; type: ReportType; format: string; url: string; host: string }

/** Validation stricte du formulaire : épreuve du référentiel, type autorisé, format de l'épreuve, adresse sûre. */
export function validateReport(raw: unknown, events: Map<string, RaceEvent>): { ok: true; report: ReportInput } | { ok: false; error: string } {
  const b = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const eventId = typeof b.eventId === 'string' ? b.eventId : '';
  const event = events.get(eventId);
  if (!event) return { ok: false, error: 'Épreuve inconnue.' };
  if (!(REPORT_TYPES as readonly unknown[]).includes(b.type)) return { ok: false, error: 'Type de signalement non pris en charge.' };
  const type = b.type as ReportType;
  const format = typeof b.format === 'string' ? b.format.trim() : '';
  if (format && (type !== 'complet' || !event.formatTags.includes(format))) return { ok: false, error: 'Format inconnu pour cette épreuve.' };
  const url = normalizeReportUrl(b.url);
  if (!url.ok) return url;
  return { ok: true, report: { eventId, type, format, url: url.url, host: url.host } };
}

// ---------------------------------------------------------------------------
// Évaluation d'une page officielle

export interface Assessment {
  outcome: 'confirme' | 'sans_effet' | 'a_verifier';
  reason: string;
  /** Passage de la page qui fonde la décision. */
  quote: string | null;
  patch?: {
    registrationStatus?: 'ouvert' | 'complet' | 'annonce';
    registrationEvidence?: string;
    registrationUrl?: string;
    officialUrl?: string;
    registrationOpenAt?: string;
    formatAvailability?: FormatAvailability[];
  };
  summary?: string;
}

const OPEN = /inscriptions?\s+(?:en\s+ligne\s+)?(?:sont\s+|est\s+)?(?:ouvertes?|ouverte)\b|places?\s+(?:encore\s+)?disponibles?|ouvertes?\s+jusqu.(?:au|à)/i;
const CLOSED = /inscriptions?\s+(?:en\s+ligne\s+)?(?:sont\s+|est\s+)?(?:ferm[ée]es?|closes?|cl[ôo]tur[ée]es?|termin[ée]es?)/i;
const FULL = /\bcompl[èe]te?s?\b|sold[\s-]?out|plus\s+de\s+places?|liste\s+d.attente/i;
const WHOLE_FULL = /(?:toutes\s+(?:les|nos)\s+(?:épreuves|epreuves|courses|distances)|l.(?:événement|evenement|épreuve|epreuve)|la\s+course|les\s+inscriptions?)\s+(?:est|sont|affiche|affichent)?\s*compl[èe]te?s?/i;
const NOT_YET = /(?:pas\s+encore|bientôt|bientot)\s+ouvert|ouvriront|ouvrira|(?:ouverture|ouvertes?)\s+(?:des\s+inscriptions\s+)?(?:le|prévue|prevue|prochainement|à venir|a venir|à partir du|a partir du|dès le|des le)|à partir du|a partir du/i;
const ANNOUNCE = /(?:ouverture\s+des\s+inscriptions|inscriptions?[^|.!?]{0,30}?(?:ouvriront|ouvrira|ouvrent|ouverture|à\s+partir\s+du|a\s+partir\s+du|dès\s+le|des\s+le))[^|.!?]{0,80}/i;

const MONTHS: Record<string, string> = { janvier: '01', fevrier: '02', mars: '03', avril: '04', mai: '05', juin: '06', juillet: '07', aout: '08', septembre: '09', octobre: '10', novembre: '11', decembre: '12' };

/** Date d'ouverture écrite en toutes lettres avec l'année (« 1er décembre 2026 », « 01/12/2026 ») ; jamais déduite. */
export function explicitOpeningDate(quote: string): string | null {
  const n = normalize(quote);
  const m = /\b(\d{1,2})(?:er)? (janvier|fevrier|mars|avril|mai|juin|juillet|aout|septembre|octobre|novembre|decembre) (20\d\d)\b/.exec(n);
  if (m) return `${m[3]}-${MONTHS[m[2] ?? '']}-${String(m[1]).padStart(2, '0')}`;
  const d = /\b(\d{1,2})\/(\d{1,2})\/(20\d\d)\b/.exec(quote);
  if (d && Number(d[2]) >= 1 && Number(d[2]) <= 12) return `${d[3]}-${String(d[2]).padStart(2, '0')}-${String(d[1]).padStart(2, '0')}`;
  return null;
}

const excerpt = (text: string, re: RegExp, span = 90): string | null => {
  const m = re.exec(text);
  if (!m) return null;
  const i = m.index;
  return text.slice(Math.max(0, i - span), i + m[0].length + span).replace(/\s*\|\s*/g, ' · ').replace(/\s+/g, ' ').trim();
};

/** Le format cité près d'une mention « complet » (« format S », « open M », « distance L »). */
function mentionsFormat(context: string, format: string): boolean {
  const f = format.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:format|distance|open|triathlon|duathlon|aquathlon|swimrun|course|épreuve|epreuve)\\s+(?:distance\\s+)?${f}\\b|\\b${f}\\s+(?:open|individuel|relais|jeunes)\\b`, 'i').test(context);
}

function allDates(text: string): string[] {
  const numeric = [...text.matchAll(/\b(\d{1,2})\/(\d{1,2})\/(20\d\d)\b/g)].map((m) => `${m[3]}-${String(m[2]).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}`);
  return [...new Set([...parseFrenchDates(text), ...numeric])];
}

/**
 * Évalue une page officielle pour un signalement. Toute incertitude (autre édition, épreuve ou date non
 * reconnue, page illisible, indices contradictoires) donne « à vérifier » : rien n'est publié.
 */
export function assessReport(event: RaceEvent, report: ReportInput, html: string): Assessment {
  const text = htmlToText(html);
  const verify = (reason: string, quote: string | null = null): Assessment => ({ outcome: 'a_verifier', reason, quote });

  if (text.length < 200) return verify('Contenu illisible (page dynamique ou vide) : vérification manuelle nécessaire.');
  const year = editionYear(report.url);
  if (year !== null && year !== 2027) return verify(`La page concerne l’édition ${year}, pas 2027.`);
  if (year === null && !text.includes('2027')) return verify('La page ne mentionne pas l’édition 2027.');

  const keywords = groupKeywords([event]);
  const hay = normalize(`${text} ${report.url}`);
  if (!keywords.some((k) => hay.includes(normalize(k)))) return verify('L’épreuve n’est pas reconnue sur cette page (nom ou commune absents).');
  const dates2027 = allDates(text).filter((d) => d.startsWith('2027'));
  if (dates2027.length && !dates2027.includes(event.date)) {
    return verify(`Les dates 2027 de la page (${dates2027.slice(0, 4).join(', ')}) ne comprennent pas celle de l’épreuve (${event.date}).`);
  }

  const current = event.registrationStatus;
  const evidenceUrl = report.url;
  const officialUrl = event.officialUrl ? {} : { officialUrl: evidenceUrl };

  if (report.type === 'inscriptions_ouvertes') {
    const open = excerpt(text, OPEN);
    if (!open) return verify('Aucune mention explicite d’inscriptions ouvertes (un bouton seul ne suffit pas).');
    const contra = excerpt(text, CLOSED) ?? excerpt(text, NOT_YET) ?? excerpt(text, FULL);
    if (contra) return verify('La page contient aussi des indications contraires (fermé, complet ou pas encore ouvert).', contra);
    if (current === 'ouvert') return { outcome: 'sans_effet', reason: 'Inscriptions déjà indiquées comme ouvertes.', quote: open };
    if (current === 'complet' || current === 'ferme' || current === 'annule' || current === 'a_confirmer') {
      return verify(`Le site indique actuellement « ${current} » : la contradiction doit être examinée.`, open);
    }
    return {
      outcome: 'confirme', reason: 'Inscriptions 2027 ouvertes selon la source officielle.', quote: open,
      summary: `Inscriptions ouvertes, confirmées sur ${report.host} à la suite d’un signalement.`,
      patch: {
        registrationStatus: 'ouvert',
        registrationEvidence: `La page ${evidenceUrl} indique : « ${open} »`,
        ...(isTicketing(evidenceUrl) ? { registrationUrl: evidenceUrl } : {}),
        ...officialUrl,
      },
    };
  }

  if (report.type === 'complet') {
    const full = excerpt(text, FULL, 140);
    if (!full) {
      return verify(excerpt(text, CLOSED) ? '« Fermé » n’est pas « complet » : aucune mention explicite de places épuisées.' : 'Aucune mention explicite « complet » sur la page.');
    }
    if (report.format) {
      if (!mentionsFormat(full, report.format)) return verify(`La mention « complet » ne cite pas le format ${report.format}.`, full);
      const others = (event.formatAvailability ?? []).filter((f) => f.format !== report.format);
      const entry: FormatAvailability = { format: report.format, status: 'complet', evidence: `La page ${evidenceUrl} indique : « ${full} »`, sourceUrl: evidenceUrl };
      if (event.formatAvailability?.some((f) => f.format === report.format && f.status === 'complet')) {
        return { outcome: 'sans_effet', reason: `Format ${report.format} déjà indiqué complet.`, quote: full };
      }
      const single = event.formatTags.length === 1;
      return {
        outcome: 'confirme', reason: `Format ${report.format} complet selon la source officielle.`, quote: full,
        summary: `Format ${report.format} complet, confirmé sur ${report.host} à la suite d’un signalement.`,
        patch: {
          formatAvailability: [...others, entry],
          ...(single ? { registrationStatus: 'complet' as const, registrationEvidence: entry.evidence } : {}),
          ...officialUrl,
        },
      };
    }
    const whole = excerpt(text, WHOLE_FULL, 140);
    if (!whole && event.formatTags.length > 1) return verify('Plusieurs formats existent : la page ne dit pas que toute l’épreuve est complète. Précisez le format.', full);
    if (current === 'complet') return { outcome: 'sans_effet', reason: 'Épreuve déjà indiquée complète.', quote: whole ?? full };
    return {
      outcome: 'confirme', reason: 'Épreuve complète selon la source officielle.', quote: whole ?? full,
      summary: `Épreuve complète, confirmée sur ${report.host} à la suite d’un signalement.`,
      patch: { registrationStatus: 'complet', registrationEvidence: `La page ${evidenceUrl} indique : « ${whole ?? full} »`, ...officialUrl },
    };
  }

  // ouverture_annoncee
  const announce = excerpt(text, ANNOUNCE, 40);
  if (!announce) return verify('Aucune annonce d’ouverture des inscriptions sur la page.');
  if (current === 'ouvert' || current === 'complet') return { outcome: 'sans_effet', reason: 'Le site indique déjà une information plus précise.', quote: announce };
  if (current !== 'non_verifie' && current !== 'annonce') return verify(`Le site indique actuellement « ${current} » : la contradiction doit être examinée.`, announce);
  const openAt = explicitOpeningDate(announce);
  if (current === 'annonce' && (!openAt || event.registrationOpenAt?.startsWith(openAt))) {
    return { outcome: 'sans_effet', reason: 'Ouverture déjà indiquée comme annoncée.', quote: announce };
  }
  return {
    outcome: 'confirme', reason: openAt ? `Ouverture annoncée le ${openAt}.` : 'Ouverture annoncée, sans date précise.', quote: announce,
    summary: `Ouverture des inscriptions annoncée${openAt ? ` pour le ${openAt}` : ''}, d’après ${report.host} à la suite d’un signalement.`,
    patch: {
      registrationStatus: 'annonce',
      registrationEvidence: `La page ${evidenceUrl} indique : « ${announce} »`,
      ...(openAt ? { registrationOpenAt: openAt } : {}),
      ...officialUrl,
    },
  };
}
