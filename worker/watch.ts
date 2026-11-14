// Veille automatique : lecture des pages officielles et préparation de propositions.
// Module pur (aucun accès réseau ni API Cloudflare) : utilisé par scripts/veille-auto.ts et testé par Vitest.
// Rien n'est publié ici : les propositions sont validées par une personne avant publication.

/** Épreuve telle que la veille la connaît (sous-ensemble de RaceEvent). */
export interface WatchEvent {
  id: string;
  eventGroupId: string;
  department: string;
  date: string;
  name: string;
  town: string | null;
  registrationStatus: string;
  registrationUrl: string | null;
  officialUrl: string | null;
}

/** Ligne du calendrier régional FFTRI (une manifestation, une ou plusieurs journées). */
export interface CalendarEntry { name: string; dates: string[]; department: string; town: string; url: string }

export interface FftriEventInfo {
  url: string;
  startDate: string | null;
  raceDates: string[];
  /** Indicateur structuré de la page ; null s'il est absent. */
  cancelled: boolean | null;
  officialUrl: string | null;
  registerUrl: string | null;
}

/** context : abords larges (pour repérer « 2027 ») ; near : texte qui précède immédiatement (pour attribuer le lien à une épreuve). */
export interface TicketingLink { url: string; text: string; context: string; near: string; mentions2027: boolean }

export interface PageScan {
  url: string;
  hash: string;
  snippets: string[];
  ticketing: TicketingLink[];
  /** Phrases d'annonce d'ouverture proches de « 2027 », avec leur contexte. */
  announcements: Excerpt[];
  /** Mentions de places complètes pour l'édition 2027, avec leur contexte. */
  fullNotices: Excerpt[];
}

export interface Excerpt { quote: string; context: string }

/** Page d'organisateur à surveiller pour un groupe d'épreuves (data/sources.json). */
export interface SourcePage {
  url: string;
  /** « epreuve » : page dédiée à l'épreuve ; « club » : page générale où il faut retrouver l'épreuve par mots-clés. */
  scope: 'epreuve' | 'club';
}
export interface SourceEntry { eventGroupId: string; keywords?: string[]; pages: SourcePage[] }

export type AlertKind =
  | 'date_differente' | 'manifestation_non_suivie' | 'formats_complets' | 'page_modifiee' | 'source_injoignable';

export const ALERT_LABELS: Record<AlertKind, string> = {
  date_differente: 'Date différente au calendrier FFTRI',
  manifestation_non_suivie: 'Manifestation absente du site',
  formats_complets: 'Formats signalés complets',
  page_modifiee: 'Page officielle modifiée',
  source_injoignable: 'Source injoignable',
};

export interface WatchAlert { eventId: string | null; kind: AlertKind; message: string; sourceUrl: string; quote: string | null }

/** Proposition au format attendu par validateChange (worker/lib.ts). */
export interface WatchChange {
  eventId: string;
  checkedAt: string;
  summary: string;
  patch: { registrationStatus: 'ouvert' | 'annonce' | 'annule'; registrationEvidence: string; officialUrl?: string; registrationUrl?: string };
}

// ---------------------------------------------------------------------------
// Texte et normalisation

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '’', lsquo: '‘', laquo: '«', raquo: '»', eacute: 'é', egrave: 'è', ecirc: 'ê', agrave: 'à', ccedil: 'ç', ocirc: 'ô', ucirc: 'û', icirc: 'î' };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, code: string) => {
    if (code[0] === '#') {
      const n = code[1]?.toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[code.toLowerCase()] ?? m;
  });
}

/** Texte visible d'une page : sans scripts, styles ni commentaires ; blocs séparés par « | ». */
export function htmlToText(html: string): string {
  const stripped = html
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<noscript[\s\S]*?<\/noscript>|<nav\b[\s\S]*?<\/nav>|<!--[\s\S]*?-->/gi, ' ')
    .replace(/<[^>]+>/g, '|');
  return decodeEntities(stripped).replace(/​/g, '').replace(/[|\s]*\|[|\s]*/g, ' | ').replace(/\s+/g, ' ').trim();
}

export function normalize(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[’'`]/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
}

const STOPWORDS = new Set(['de', 'du', 'des', 'la', 'le', 'les', 'l', 'd', 'et', 'en', 'sur', 'a', 'au', 'aux', 'and', 'the', 'pays', 'saint', 'st']);

export function tokens(s: string): Set<string> {
  return new Set(normalize(s).split(' ').filter((t) => t.length > 1 && !STOPWORDS.has(t) && !/^\d+$/.test(t)));
}

/** Empreinte stable (non cryptographique) pour détecter un changement de contenu. */
export function hashText(s: string): string {
  let h1 = 0xdeadbeef ^ s.length;
  let h2 = 0x41c6ce57 ^ s.length;
  for (let i = 0; i < s.length; i += 1) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0');
}

const DAY = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
/** « 2027-03-07 » → « 7 mars 2027 ». */
export const frenchDate = (iso: string): string => { const d = new Date(`${iso}T12:00:00Z`); return Number.isNaN(d.getTime()) ? iso : DAY.format(d); };
const frenchDates = (list: string[]): string => list.map(frenchDate).join(' et ');

const clip = (s: string, n = 240): string => (s.length > n ? `${s.slice(0, n - 1).trim()}…` : s);

// ---------------------------------------------------------------------------
// URL

/** Rend une URL utilisable ou null (corrige les fautes de saisie fréquentes du calendrier FFTRI). */
export function cleanUrl(raw: string | null | undefined, base?: string): string | null {
  if (!raw) return null;
  let value = decodeEntities(raw.trim()).replace(/^https?:\/\/http(s?)(?::\/\/)?www\./i, 'https://www.');
  if (/^(mailto|tel|javascript):/i.test(value)) return null;
  try {
    const u = base ? new URL(value, base) : new URL(value);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    if (u.hostname.includes('..') || !u.hostname.includes('.')) return null;
    value = u.toString();
    return value;
  } catch {
    return null;
  }
}

const SOCIAL_HOSTS = /(^|\.)(facebook\.com|instagram\.com|twitter\.com|x\.com|youtube\.com|linkedin\.com|tiktok\.com)$/i;
export const isSocial = (url: string): boolean => {
  try { return SOCIAL_HOSTS.test(new URL(url).hostname); } catch { return true; }
};

/** Billetteries d'inscription reconnues (la bourse aux dossards Swika n'en fait pas partie). */
const TICKETING_HOSTS = /(^|\.)(klikego\.com|timepulse\.fr|helloasso\.com|njuko\.com|inscriptions-tiel\.com|protiming\.fr|espace-competition\.com|ikinoa\.com|yaka-inscription\.com|weezevent\.com|billetweb\.fr|sporkrono-inscriptions\.fr|chronometrage\.com|sportips\.fr|onsinscrit\.com)$/i;
/** Liens de billetterie qui ne concernent pas une épreuve (adhésion, boutique, dons, résultats). */
const NOT_RACE = /adh[eé]sion|cotisation|licence|boutique|don\b|dons\b|resultats|r[eé]sultats|live\./i;

/**
 * Année d'édition écrite comme segment autonome de l'adresse (« …-2026/… », « /2027/ »), ou null.
 * Les identifiants qui collent l'année à un horodatage (« …-20261790260765381 ») ne comptent pas.
 */
export function editionYear(url: string): number | null {
  let path: string;
  try { const u = new URL(url); path = u.pathname + u.search; } catch { return null; }
  const years = [...path.matchAll(/(?:^|[-_/=.])(20[2-3]\d)(?=$|[-_/.?&#])/g)].map((m) => Number(m[1]));
  if (!years.length) return null;
  return years.includes(2027) ? 2027 : years[years.length - 1] ?? null;
}

export function isTicketing(url: string): boolean {
  try {
    const u = new URL(url);
    if (/ironman\.com$/i.test(u.hostname)) return /\/register/i.test(u.pathname);
    return TICKETING_HOSTS.test(u.hostname) && !NOT_RACE.test(u.pathname + u.search);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Calendrier FFTRI

const MONTHS: Record<string, number> = {
  janvier: 1, fevrier: 2, mars: 3, avril: 4, mai: 5, juin: 6, juillet: 7, aout: 8, septembre: 9, octobre: 10, novembre: 11, decembre: 12,
};

/** « 24 AVRIL 2027 · 25 AVRIL 2027 » → ['2027-04-24', '2027-04-25']. */
export function parseFrenchDates(s: string): string[] {
  const out: string[] = [];
  for (const m of normalize(s).matchAll(/\b(\d{1,2})(?:er)? ([a-z]+) (\d{4})\b/g)) {
    const month = MONTHS[m[2] ?? ''];
    const day = Number(m[1]);
    if (!month || day < 1 || day > 31) continue;
    out.push(`${m[3]}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`);
  }
  return [...new Set(out)];
}

/** Lit la liste structurée (variable mapEvents) du calendrier régional FFTRI. */
export function parseFftriCalendar(html: string): CalendarEntry[] {
  const m = /var\s+mapEvents\s*=\s*(\[[\s\S]*?\]);\s*\n/.exec(html);
  if (!m?.[1]) return [];
  let raw: unknown;
  try { raw = JSON.parse(m[1]); } catch { return []; }
  if (!Array.isArray(raw)) return [];
  const out: CalendarEntry[] = [];
  for (const item of raw as Record<string, unknown>[]) {
    const name = typeof item.name === 'string' ? item.name : '';
    const location = typeof item.location === 'string' ? item.location : '';
    const url = cleanUrl(typeof item.url === 'string' ? item.url : null);
    const dates = parseFrenchDates(typeof item.date === 'string' ? item.date : '');
    const [town = '', code = ''] = location.split('·').map((p) => p.trim());
    const department = /^\d{5}$/.test(code) ? code.slice(0, 2) : (/\((\d{2})\)/.exec(name)?.[1] ?? '');
    if (name && url && dates.length) out.push({ name, dates, department, town, url });
  }
  return out;
}

/** Fiche d'une manifestation FFTRI : dates des courses, annulation, liens « Site officiel » et « S'inscrire ». */
export function parseFftriEvent(html: string, url: string): FftriEventInfo {
  const cancelledMatch = /const\s+eventData\s*=\s*\{[\s\S]*?cancelled:\s*(true|false)/.exec(html);
  const startMatch = /const\s+eventData\s*=\s*\{[\s\S]*?date:\s*"(\d{4}-\d{2}-\d{2})"/.exec(html);
  const raceDates = [...new Set([...html.matchAll(/datetime="(\d{4}-\d{2}-\d{2})"/g)].map((m) => m[1] ?? ''))].filter(Boolean).sort();
  const link = (label: RegExp): string | null => {
    for (const m of html.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)) {
      if (label.test(htmlToText(m[2] ?? ''))) {
        const u = cleanUrl(m[1], url);
        if (u && !u.includes('t2area.com')) return u;
      }
    }
    return null;
  };
  return {
    url,
    startDate: startMatch?.[1] ?? null,
    raceDates,
    cancelled: cancelledMatch ? cancelledMatch[1] === 'true' : null,
    officialUrl: link(/^site officiel$/i),
    registerUrl: link(/^s.inscrire$/i),
  };
}

// ---------------------------------------------------------------------------
// Pages des organisateurs

const ANNOUNCE = /(?:inscriptions?|billetterie)[^|.!?]{0,50}?(?:à partir du|a partir du|dès le|des le|ouvriront le|ouvrira le|ouvrent le|ouverture le|ouverture prévue le|à compter du)\s+[^|.!?]{3,40}|ouverture des inscriptions[^|.!?]{0,70}/gi;
const FULL = /[^|.!?]{0,60}\b(?:complète?s?|sold[- ]out)\b[^|.!?]{0,60}/gi;

/** Passages qui mentionnent l'édition 2027 à proximité (même bloc ou bloc voisin). */
function near2027(text: string, index: number, span = 300): boolean {
  return text.slice(Math.max(0, index - span), index + span).includes('2027');
}

export function scanPage(html: string, url: string): PageScan {
  const text = htmlToText(html);
  const ticketing: TicketingLink[] = [];
  const seen = new Set<string>();
  for (const m of html.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = cleanUrl(m[1], url);
    if (!href || !isTicketing(href) || seen.has(href)) continue;
    seen.add(href);
    const idx = m.index ?? 0;
    const context = htmlToText(html.slice(Math.max(0, idx - 700), idx + (m[0]?.length ?? 0) + 300));
    // Le sujet d'un lien est annoncé avant lui (titre, paragraphe) : seuls les abords précédents servent à l'attribuer.
    const near = htmlToText(html.slice(Math.max(0, idx - 350), idx + (m[0]?.length ?? 0)));
    const linkText = htmlToText(m[2] ?? '');
    const year = editionYear(href);
    // Une année explicite dans l'adresse l'emporte sur le texte de la page (lien 2026 resté sur une page 2027).
    const mentions2027 = year !== null ? year === 2027 : href.includes('2027') || linkText.includes('2027') || context.includes('2027');
    ticketing.push({ url: href, text: clip(linkText, 80), context: clip(context, 600), near: clip(near, 400), mentions2027 });
  }
  const excerpt = (m: RegExpMatchArray): Excerpt => {
    const i = m.index ?? 0;
    // Abords immédiats seulement : sur une page générale, le titre voisin désigne l'épreuve concernée.
    return { quote: clip(m[0].trim()), context: text.slice(Math.max(0, i - 120), i + m[0].length) };
  };
  const uniq = (list: Excerpt[]): Excerpt[] => [...new Map(list.map((x) => [x.quote, x])).values()];
  const announcements = uniq([...text.matchAll(ANNOUNCE)].filter((m) => near2027(text, m.index ?? 0)).map(excerpt));
  const fullNotices = uniq([...text.matchAll(FULL)]
    .filter((m) => /2027/.test(m[0]) || (near2027(text, m.index ?? 0, 200) && /épreuve|course|format|distance|dossard|inscription/i.test(m[0])))
    .filter((m) => !/parcours complet|programme complet|complet autour/i.test(m[0]))
    .map(excerpt));
  const blocks = text.split(' | ').map((b) => b.trim()).filter((b) => /inscri|2027|complet|annul|dossard|ouverture/i.test(b) && b.length < 400);
  const snippets = [...new Set(blocks)].slice(0, 60);
  return { url, hash: hashText(snippets.join('\n')), snippets, ticketing, announcements, fullNotices };
}

// ---------------------------------------------------------------------------
// Rapprochement calendrier FFTRI ↔ épreuves du site

function similarity(entry: CalendarEntry, e: WatchEvent): number {
  const a = tokens(`${entry.name} ${entry.town}`);
  const b = tokens(`${e.name} ${e.town ?? ''}`);
  let score = 0;
  for (const t of a) if (b.has(t)) score += 1;
  if (e.town && normalize(e.town) === normalize(entry.town)) score += 3;
  return score;
}

export interface CalendarMatch { entry: CalendarEntry; eventGroupIds: string[] }

/**
 * Associe chaque manifestation FFTRI aux groupes d'épreuves du site : même département, puis date,
 * puis commune ou ressemblance des noms. Une manifestation de plusieurs journées peut couvrir plusieurs
 * groupes (ex. aquathlon le samedi, triathlon le dimanche dans la même commune).
 */
export function matchCalendar(entries: CalendarEntry[], events: WatchEvent[]): CalendarMatch[] {
  return entries.map((entry) => {
    const sameDep = events.filter((e) => e.department === entry.department);
    const onDate = sameDep.filter((e) => entry.dates.includes(e.date));
    const rank = (list: WatchEvent[], min: number): string[] => {
      let best: { id: string; score: number } | null = null;
      for (const e of list) {
        const score = similarity(entry, e);
        if (score >= min && (!best || score > best.score)) best = { id: e.eventGroupId, score };
      }
      return best ? [best.id] : [];
    };
    const groupsOnDate = [...new Set(onDate.map((e) => e.eventGroupId))];
    if (groupsOnDate.length === 1) return { entry, eventGroupIds: groupsOnDate };
    if (groupsOnDate.length > 1) {
      const sameTown = [...new Set(onDate.filter((e) => e.town && normalize(e.town) === normalize(entry.town)).map((e) => e.eventGroupId))];
      return { entry, eventGroupIds: sameTown.length ? sameTown : rank(onDate, 1) };
    }
    // Sans concordance de date, il faut une ressemblance nette (commune + nom) : sinon c'est une autre manifestation.
    return { entry, eventGroupIds: rank(sameDep, 4) };
  });
}

// ---------------------------------------------------------------------------
// Propositions et alertes

export interface GroupObservation {
  eventGroupId: string;
  calendar: CalendarEntry | null;
  fftri: FftriEventInfo | null;
  pages: { page: SourcePage; scan: PageScan }[];
  keywords: string[];
}

const hostOf = (url: string): string => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; } };

/** Mots qui doivent apparaître près d'un lien sur une page générale de club pour l'attribuer à l'épreuve. */
export function groupKeywords(events: WatchEvent[], extra: string[] = []): string[] {
  const words = new Set(extra.map(normalize));
  for (const e of events) {
    for (const t of tokens(e.name)) if (!['triathlon', 'duathlon', 'aquathlon', 'swimrun', 'bike', 'run', 'open'].includes(t) && t.length > 3) words.add(t);
    if (e.town) for (const t of tokens(e.town)) if (t.length > 3) words.add(t);
  }
  return [...words];
}

/** Sur une page générale de club, le passage doit nommer l'épreuve (mots-clés) pour lui être attribué. */
function concerns(page: SourcePage, context: string, keywords: string[]): boolean {
  if (page.scope === 'epreuve') return true;
  const ctx = normalize(context);
  return keywords.some((k) => k && ctx.includes(normalize(k)));
}

function relevant(link: TicketingLink, page: SourcePage, keywords: string[]): boolean {
  return link.mentions2027 && concerns(page, `${link.text} ${link.near} ${link.url}`, keywords);
}

export interface WatchResult { changes: WatchChange[]; alerts: WatchAlert[] }

/**
 * Règles (toutes produisent des propositions à valider, jamais une publication directe) :
 * - fiche FFTRI marquée annulée (indicateur structuré) → proposition « annulé » ;
 * - lien de billetterie pour l'édition 2027 sur une page officielle → proposition « ouvert » ;
 * - phrase d'annonce d'ouverture près de « 2027 », sans billetterie → proposition « annoncé » ;
 * - date du calendrier FFTRI différente, formats « complets », manifestation inconnue → alertes.
 */
export function buildProposals(checkedAt: string, events: WatchEvent[], groups: GroupObservation[], unmatched: CalendarEntry[]): WatchResult {
  const changes: WatchChange[] = [];
  const alerts: WatchAlert[] = [];
  const today = checkedAt.slice(0, 10);

  for (const g of groups) {
    const groupEvents = events.filter((e) => e.eventGroupId === g.eventGroupId && e.date >= today);
    if (!groupEvents.length) continue;
    const first = groupEvents[0]!;

    if (g.calendar) {
      for (const e of groupEvents) {
        if (!g.calendar.dates.includes(e.date)) {
          alerts.push({
            eventId: e.id, kind: 'date_differente', sourceUrl: g.calendar.url, quote: `${g.calendar.name} : ${g.calendar.dates.join(', ')}`,
            message: `Le calendrier FFTRI donne le ${frenchDates(g.calendar.dates)} pour « ${g.calendar.name} » ; le site affiche le ${frenchDate(e.date)} pour « ${e.name} ».`,
          });
        }
      }
    }

    if (g.fftri?.cancelled === true) {
      for (const e of groupEvents) {
        if (e.registrationStatus === 'annule') continue;
        changes.push({
          eventId: e.id, checkedAt,
          summary: `La fiche du calendrier officiel FFTRI signale « ${g.calendar?.name ?? e.name} » comme annulée.`,
          patch: {
            registrationStatus: 'annule',
            registrationEvidence: `La fiche du calendrier officiel FFTRI (${g.fftri.url}) porte l’indicateur « Annulé ».`,
            ...(e.officialUrl || e.registrationUrl ? {} : { officialUrl: g.fftri.officialUrl ?? g.fftri.url }),
          },
        });
      }
      continue;
    }

    for (const { page, scan } of g.pages) {
      for (const notice of scan.fullNotices.filter((n) => concerns(page, n.context, g.keywords))) {
        alerts.push({ eventId: first.id, kind: 'formats_complets', sourceUrl: scan.url, quote: notice.quote, message: `L’organisateur signale des places complètes (${hostOf(scan.url)}).` });
      }
    }

    // Ouverture : un lien de billetterie 2027 publié par l'organisateur (ou la fiche FFTRI).
    const candidates: { link: TicketingLink; pageUrl: string }[] = [];
    for (const { page, scan } of g.pages) for (const link of scan.ticketing) if (relevant(link, page, g.keywords)) candidates.push({ link, pageUrl: scan.url });
    const fftriRegister = g.fftri?.registerUrl;
    if (fftriRegister && isTicketing(fftriRegister) && fftriRegister.includes('2027')) {
      candidates.push({ link: { url: fftriRegister, text: 'S’inscrire', context: '', near: '', mentions2027: true }, pageUrl: g.fftri!.url });
    }
    candidates.sort((a, b) => Number(b.link.url.includes('2027')) - Number(a.link.url.includes('2027')));
    const best = candidates[0];

    for (const e of groupEvents) {
      if (best && (e.registrationStatus === 'non_verifie' || e.registrationStatus === 'annonce')) {
        changes.push({
          eventId: e.id, checkedAt,
          summary: `Un lien d’inscription pour l’édition 2027 est publié sur ${hostOf(best.pageUrl)}.`,
          patch: {
            registrationStatus: 'ouvert',
            registrationUrl: best.link.url,
            registrationEvidence: `La page officielle ${best.pageUrl} publie un lien d’inscription pour l’édition 2027 (${hostOf(best.link.url)}).`,
            ...(e.officialUrl ? {} : { officialUrl: best.pageUrl }),
          },
        });
        continue;
      }
      if (!best && e.registrationStatus === 'non_verifie') {
        const announce = g.pages.flatMap(({ page, scan }) => scan.announcements
          .filter((a) => concerns(page, a.context, g.keywords))
          .map((a) => ({ quote: a.quote, url: scan.url })))[0];
        if (announce) {
          changes.push({
            eventId: e.id, checkedAt,
            summary: `L’organisateur annonce l’ouverture des inscriptions 2027 (${hostOf(announce.url)}).`,
            patch: {
              registrationStatus: 'annonce',
              registrationEvidence: `La page officielle ${announce.url} indique : « ${announce.quote} »`,
              ...(e.officialUrl ? {} : { officialUrl: announce.url }),
            },
          });
        }
      }
    }
  }

  for (const entry of unmatched) {
    alerts.push({
      eventId: null, kind: 'manifestation_non_suivie', sourceUrl: entry.url, quote: `${entry.name} — ${entry.town} — ${entry.dates.join(', ')}`,
      message: `« ${entry.name} » (${frenchDates(entry.dates)}) figure au calendrier FFTRI des Pays de la Loire mais ne correspond à aucune épreuve du site.`,
    });
  }
  return { changes, alerts };
}
