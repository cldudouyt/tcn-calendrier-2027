// Veille automatique des inscriptions — exécutée chaque matin par GitHub Actions (.github/workflows/veille-auto.yml).
//
// 1. lit les épreuves publiées (API du site) et les pages à surveiller (data/sources.json) ;
// 2. lit le calendrier régional FFTRI, puis la fiche FFTRI et les pages officielles de chaque épreuve ;
// 3. prépare des propositions (ouvert, annoncé, annulé) et des alertes, sans rien publier ;
// 4. les envoie à l'API d'administration, où elles attendent une validation humaine.
//
// Usage : node scripts/veille-auto.ts [--dry-run] [--limit=N] [--only=<eventGroupId>]
// Variables : SITE_URL (défaut : site de production), ADMIN_TOKEN (sans lui : simulation, rien n'est envoyé).
import { readFileSync, appendFileSync } from 'node:fs';
import {
  ALERT_LABELS, buildProposals, cleanUrl, groupKeywords, isSocial, matchCalendar, parseFftriCalendar, parseFftriEvent, scanPage,
  type FftriEventInfo, type GroupObservation, type PageScan, type SourceEntry, type SourcePage, type WatchEvent,
} from '../worker/watch.ts';

const SITE_URL = (process.env.SITE_URL || 'https://tcn-calendrier-2027.cldudouyt.workers.dev').replace(/\/$/, '');
const ADMIN_TOKEN = process.env.ADMIN_TOKEN ?? '';
const args = new Map(process.argv.slice(2).map((a) => { const [k, v = 'true'] = a.replace(/^--/, '').split('='); return [k ?? '', v]; }));
const DRY_RUN = args.has('dry-run') || !ADMIN_TOKEN;
const LIMIT = Number(args.get('limit') ?? 200);
const ONLY = args.get('only');
const CALENDAR_URL = 'https://fftri.t2area.com/calendrier-pays-de-la-loire/calendrier.html';
const USER_AGENT = `tcn-calendrier-2027-veille/1.0 (+${SITE_URL}/veille/)`;
const DELAY_MS = 1500;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const log = (...a: unknown[]) => console.log(...a);

// --- Accès réseau poli : robots.txt respecté, une requête à la fois, délai entre deux pages.
const robotsCache = new Map<string, string[]>();
async function disallowed(url: string): Promise<boolean> {
  const u = new URL(url);
  if (!robotsCache.has(u.origin)) {
    let rules: string[] = [];
    try {
      const res = await fetch(`${u.origin}/robots.txt`, { headers: { 'user-agent': USER_AGENT }, signal: AbortSignal.timeout(10_000) });
      if (res.ok) {
        let applies = false;
        for (const raw of (await res.text()).split('\n')) {
          const line = raw.replace(/#.*/, '').trim();
          const [key = '', ...rest] = line.split(':');
          const value = rest.join(':').trim();
          if (/^user-agent$/i.test(key)) applies = value === '*' || /tcn-calendrier/i.test(value);
          else if (applies && /^disallow$/i.test(key) && value) rules.push(value);
        }
      }
    } catch { rules = []; }
    robotsCache.set(u.origin, rules);
  }
  const path = u.pathname + u.search;
  return (robotsCache.get(u.origin) ?? []).some((rule) => !rule.includes('*') && path.startsWith(rule));
}

interface Fetched { url: string; ok: boolean; status: number; html: string; error?: string }
const pageCache = new Map<string, Fetched>();
async function getPage(url: string): Promise<Fetched> {
  const cached = pageCache.get(url);
  if (cached) return cached;
  let result: Fetched;
  if (await disallowed(url)) {
    result = { url, ok: false, status: 0, html: '', error: 'exclu par robots.txt' };
  } else {
    result = { url, ok: false, status: 0, html: '' };
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        const res = await fetch(url, { headers: { 'user-agent': USER_AGENT, accept: 'text/html', 'accept-language': 'fr' }, redirect: 'follow', signal: AbortSignal.timeout(25_000) });
        const html = res.ok ? await res.text() : '';
        if (!res.ok) await res.body?.cancel();
        result = { url, ok: res.ok, status: res.status, html, ...(res.ok ? {} : { error: `HTTP ${res.status}` }) };
        if (res.ok || res.status < 500) break;
      } catch (err) {
        result = { url, ok: false, status: 0, html: '', error: err instanceof Error ? err.message : String(err) };
      }
      await sleep(3000);
    }
    await sleep(DELAY_MS);
  }
  pageCache.set(url, result);
  return result;
}

// --- Données publiées
interface ApiEvent extends WatchEvent { [key: string]: unknown }
async function loadEvents(): Promise<WatchEvent[]> {
  const res = await fetch(`${SITE_URL}/api/events`, { headers: { accept: 'application/json', 'user-agent': USER_AGENT } });
  if (!res.ok) throw new Error(`Lecture des épreuves impossible : ${SITE_URL}/api/events → HTTP ${res.status}`);
  const body = (await res.json()) as { events: ApiEvent[] };
  return body.events.map((e) => ({
    id: e.id, eventGroupId: e.eventGroupId, department: e.department, date: e.date, name: e.name, town: e.town,
    registrationStatus: e.registrationStatus, registrationUrl: e.registrationUrl, officialUrl: e.officialUrl,
  }));
}

async function main(): Promise<void> {
  const checkedAt = new Date().toISOString();
  const today = checkedAt.slice(0, 10);
  const events = (await loadEvents()).filter((e) => e.date >= today);
  const sources = (JSON.parse(readFileSync(new URL('../data/sources.json', import.meta.url), 'utf8')) as { sources: SourceEntry[] }).sources;
  const sourceByGroup = new Map(sources.map((s) => [s.eventGroupId, s]));
  let groupIds = [...new Set(events.map((e) => e.eventGroupId))];
  if (ONLY) groupIds = groupIds.filter((g) => g === ONLY);
  log(`Veille du ${checkedAt} — ${events.length} épreuves à venir, ${groupIds.length} groupes${DRY_RUN ? ' (simulation : rien ne sera envoyé)' : ''}`);

  // 1. Calendrier régional FFTRI
  const calendarPage = await getPage(CALENDAR_URL);
  const calendar = calendarPage.ok ? parseFftriCalendar(calendarPage.html) : [];
  const matches = matchCalendar(calendar, events);
  const calendarByGroup = new Map<string, (typeof matches)[number]['entry']>();
  for (const m of matches) for (const g of m.eventGroupIds) calendarByGroup.set(g, m.entry);
  const unmatched = ONLY ? [] : matches.filter((m) => m.eventGroupIds.length === 0).map((m) => m.entry);
  log(`Calendrier FFTRI : ${calendar.length} manifestations, ${unmatched.length} non rapprochées${calendarPage.ok ? '' : ` (échec : ${calendarPage.error})`}`);

  // 2. Fiches FFTRI et pages officielles
  const observations: GroupObservation[] = [];
  const scans = new Map<string, { scan: PageScan | null; fetched: Fetched; groups: Set<string> }>();
  for (const groupId of groupIds.slice(0, LIMIT)) {
    const entry = calendarByGroup.get(groupId) ?? null;
    let fftri: FftriEventInfo | null = null;
    if (entry) {
      const page = await getPage(entry.url);
      if (page.ok) fftri = parseFftriEvent(page.html, entry.url);
      // La fiche est aussi suivie comme page : un changement (date, formats) y déclenche une alerte de relecture.
      if (!scans.has(entry.url)) scans.set(entry.url, { scan: page.ok ? scanPage(page.html, entry.url) : null, fetched: page, groups: new Set() });
      scans.get(entry.url)!.groups.add(groupId);
    }
    const configured = sourceByGroup.get(groupId);
    const pages: SourcePage[] = [...(configured?.pages ?? [])];
    // Site indiqué par la fiche FFTRI : traité comme page générale (mots-clés exigés).
    const fromFftri = cleanUrl(fftri?.officialUrl);
    if (fromFftri && !isSocial(fromFftri) && !pages.some((p) => p.url.replace(/\/$/, '') === fromFftri.replace(/\/$/, ''))) pages.push({ url: fromFftri, scope: 'club' });

    const observed: GroupObservation['pages'] = [];
    for (const page of pages.filter((p) => !isSocial(p.url))) {
      const fetched = await getPage(page.url);
      let record = scans.get(page.url);
      if (!record) {
        record = { scan: fetched.ok ? scanPage(fetched.html, page.url) : null, fetched, groups: new Set() };
        scans.set(page.url, record);
      }
      record.groups.add(groupId);
      if (record.scan) observed.push({ page, scan: record.scan });
    }
    const groupEvents = events.filter((e) => e.eventGroupId === groupId);
    observations.push({ eventGroupId: groupId, calendar: entry, fftri, pages: observed, keywords: groupKeywords(groupEvents, configured?.keywords ?? []) });
  }

  // 3. Propositions et alertes
  const { changes, alerts } = buildProposals(checkedAt, events, observations, unmatched);
  const report = {
    checkedAt,
    sources: [...scans.entries()].map(([url, r]) => ({
      url, eventGroupIds: [...r.groups], ok: r.fetched.ok, status: r.fetched.status, error: r.fetched.error ?? null,
      hash: r.scan?.hash ?? null, snippets: r.scan?.snippets ?? [],
    })),
    changes,
    alerts,
  };

  const failed = report.sources.filter((s) => !s.ok);
  const names = new Map(events.map((e) => [e.id, e.name]));
  const lines = [
    `## Veille automatique — ${checkedAt}`,
    '',
    `- Pages lues : ${report.sources.length - failed.length} sur ${report.sources.length}`,
    `- Propositions : ${changes.length}`,
    `- Alertes : ${alerts.length}`,
    '',
    ...changes.map((c) => `- **${c.patch.registrationStatus}** — ${names.get(c.eventId) ?? c.eventId} (${c.eventId}) : ${c.summary}`),
    ...alerts.map((a) => `- _${ALERT_LABELS[a.kind]}_ — ${a.message}`),
    ...(failed.length ? ['', '### Pages non lues', ...failed.map((s) => `- ${s.url} : ${s.error ?? s.status}`)] : []),
  ];
  log(lines.join('\n'));
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join('\n')}\n`);

  if (DRY_RUN) {
    if (args.has('json')) log(JSON.stringify(report, null, 2));
    log('\nSimulation : rapport non envoyé (ADMIN_TOKEN absent ou --dry-run).');
    return;
  }
  const res = await fetch(`${SITE_URL}/api/admin/watch/report`, {
    method: 'POST',
    headers: { authorization: `Bearer ${ADMIN_TOKEN}`, 'content-type': 'application/json', 'user-agent': USER_AGENT },
    body: JSON.stringify(report),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`Envoi du rapport refusé : HTTP ${res.status} ${body}`);
  log(`\nRapport reçu par le site : ${body}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
