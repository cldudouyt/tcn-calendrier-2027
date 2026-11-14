// Worker Cloudflare : API publique, administration protégée et contrôle quotidien.
// Les pages statiques (dist/) sont servies par la liaison ASSETS.
import type { RaceEvent } from '../src/lib/types';
import { STATUS_META, effectiveStatus } from '../src/lib/status';
import { eventsWithRegistrations, REGISTRATION_FIELDS } from '../src/lib/registration-surveys';
import { surveys } from '../src/lib/events';
import {
  CATEGORY_LABELS, applyPatch, checkBearer, dedupeKey, isNoop, isDailySlot, mergeOverrides, validateChange,
  type EventPatch,
} from './lib';
import { ALERT_LABELS, hashText, type AlertKind } from './watch';

export interface Env { ASSETS: Fetcher; DB?: D1Database; ADMIN_TOKEN?: string }

const BASE = eventsWithRegistrations;
const BASE_BY_ID = new Map(BASE.map((e) => [e.id, e]));
const USER_AGENT = 'tcn-calendrier-2027-veille/1.0 (controle quotidien de liens officiels)';

const json = (body: unknown, status = 200, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...headers } });
const now = (): string => new Date().toISOString();

type Override = EventPatch & { lastCheckedAt?: string; changedAt?: string };

/** Données publiées : transcription de référence + changements validés. Sans base, la référence seule. */
async function loadEvents(env: Env): Promise<{ events: RaceEvent[]; source: 'd1' | 'statique' }> {
  if (!env.DB) return { events: BASE, source: 'statique' };
  try {
    const { results } = await env.DB.prepare('SELECT event_id, patch FROM event_overrides').all<{ event_id: string; patch: string }>();
    const overrides = new Map(results.map((r) => {
      const patch = JSON.parse(r.patch) as Override;
      const baseline = BASE_BY_ID.get(r.event_id);
      if (baseline?.lastCheckedAt && (!patch.lastCheckedAt || Date.parse(baseline.lastCheckedAt) > Date.parse(patch.lastCheckedAt))) {
        for (const field of REGISTRATION_FIELDS) delete patch[field];
        delete patch.lastCheckedAt;
        delete patch.changedAt;
      }
      return [r.event_id, patch] as const;
    }));
    return { events: mergeOverrides(BASE, overrides), source: 'd1' };
  } catch (err) {
    console.error('Lecture D1 impossible, repli sur la référence', err);
    return { events: BASE, source: 'statique' };
  }
}

async function publicApi(url: URL, env: Env): Promise<Response> {
  const { events, source } = await loadEvents(env);
  const headers = { 'x-data-source': source, 'cache-control': 'public, max-age=60' };
  if (url.pathname === '/api/events') return json({ count: events.length, events }, 200, headers);
  if (url.pathname === '/api/status') {
    return json({ statuses: events.map((e) => { const s = effectiveStatus(e); return { id: e.id, status: s, label: STATUS_META[s].label, tone: STATUS_META[s].tone }; }) }, 200, headers);
  }
  const one = url.pathname.match(/^\/api\/events\/([a-z0-9-]+)$/);
  if (one) {
    const event = events.find((e) => e.id === one[1]);
    if (!event) return json({ error: 'Épreuve inconnue' }, 404);
    let history: unknown[] = [];
    if (env.DB) {
      try {
        history = (await env.DB.prepare('SELECT previous_status, new_status, recorded_at FROM status_history WHERE event_id = ? ORDER BY id DESC').bind(event.id).all()).results;
      } catch { /* historique indisponible */ }
    }
    return json({ event, statusHistory: history }, 200, headers);
  }
  if (url.pathname === '/api/updates') {
    if (!env.DB) return json({ updates: [], lastCheck: null }, 200, headers);
    try {
      const { results } = await env.DB.prepare(
        "SELECT id, event_id, category, summary, evidence, source_url, checked_at, decided_at FROM changes WHERE state = 'publie' ORDER BY decided_at DESC LIMIT 100",
      ).all<{ id: number; event_id: string; category: string; summary: string; evidence: string | null; source_url: string | null; checked_at: string; decided_at: string }>();
      const run = await env.DB.prepare("SELECT finished_at FROM check_runs WHERE state = 'termine' ORDER BY id DESC LIMIT 1").first<{ finished_at: string }>();
      return json({
        lastCheck: run?.finished_at ?? null,
        updates: results.map((r) => ({
          id: r.id, eventId: r.event_id, eventName: BASE_BY_ID.get(r.event_id)?.name ?? r.event_id, category: r.category,
          categoryLabel: CATEGORY_LABELS[r.category] ?? r.category, summary: r.summary, evidence: r.evidence, sourceUrl: r.source_url,
          checkedAt: r.checked_at, publishedAt: r.decided_at,
        })),
      }, 200, headers);
    } catch (err) {
      console.error(err);
      return json({ updates: [], lastCheck: null }, 200, headers);
    }
  }
  return json({ error: 'Route inconnue' }, 404);
}

/** Enregistre des propositions en attente ; rien n'est publié à cette étape. */
async function importChanges(db: D1Database, items: unknown[], origin: 'import' | 'correction' | 'veille_auto', events: RaceEvent[]) {
  const current = new Map(events.map((e) => [e.id, e]));
  const report = { received: items.length, queued: [] as number[], duplicates: 0, unchanged: 0, alreadyDecided: 0, rejected: [] as { index: number; errors: string[] }[] };
  // La veille automatique ne repropose jamais ce qu'un administrateur a déjà publié ou rejeté.
  const decided = new Set<string>();
  if (origin === 'veille_auto' && items.length) {
    const { results } = await db.prepare("SELECT dedupe_key FROM changes WHERE state IN ('publie', 'rejete')").all<{ dedupe_key: string }>();
    for (const r of results) decided.add(r.dedupe_key);
  }
  for (const [index, item] of items.entries()) {
    const result = validateChange(item, current);
    if (!result.ok) { report.rejected.push({ index, errors: result.errors }); continue; }
    const c = result.change;
    if (isNoop(current.get(c.eventId)!, c.patch)) { report.unchanged += 1; continue; }
    const key = await dedupeKey(c.eventId, c.patch);
    if (decided.has(key)) { report.alreadyDecided += 1; continue; }
    const res = await db.prepare(
      'INSERT OR IGNORE INTO changes (event_id, category, patch, summary, evidence, source_url, checked_at, origin, dedupe_key, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).bind(c.eventId, c.category, JSON.stringify(c.patch), c.summary, c.evidence, c.sourceUrl, c.checkedAt, origin, key, now()).run();
    if (res.meta.changes === 0) report.duplicates += 1; else report.queued.push(Number(res.meta.last_row_id));
  }
  return report;
}

/** Publie un changement validé : fusion dans l'état publié + historique des statuts. */
async function publishChange(db: D1Database, id: number, events: RaceEvent[], note: string | null): Promise<Response> {
  const row = await db.prepare('SELECT * FROM changes WHERE id = ?').bind(id).first<{ id: number; event_id: string; patch: string; checked_at: string; state: string }>();
  if (!row) return json({ error: 'Changement inconnu' }, 404);
  if (row.state !== 'en_attente') return json({ error: `Changement déjà traité (${row.state})` }, 409);
  const event = events.find((e) => e.id === row.event_id);
  if (!event) return json({ error: 'Épreuve inconnue' }, 404);
  const patch = JSON.parse(row.patch) as EventPatch;
  // Revalidation au moment de publier : l'état a pu changer depuis l'import.
  const recheck = validateChange({ eventId: row.event_id, checkedAt: row.checked_at, summary: 'revalidation', patch }, new Map([[event.id, event]]));
  if (!recheck.ok) return json({ error: 'Changement devenu invalide', details: recheck.errors }, 422);

  const at = now();
  const next = applyPatch(event, patch, { lastCheckedAt: row.checked_at, changedAt: at });
  const existing = await db.prepare('SELECT patch FROM event_overrides WHERE event_id = ?').bind(event.id).first<{ patch: string }>();
  const merged: Override = { ...(existing ? (JSON.parse(existing.patch) as Override) : {}), ...patch, lastCheckedAt: row.checked_at, changedAt: at };
  const statements = [
    db.prepare('INSERT INTO event_overrides (event_id, patch, updated_at) VALUES (?, ?, ?) ON CONFLICT (event_id) DO UPDATE SET patch = excluded.patch, updated_at = excluded.updated_at').bind(event.id, JSON.stringify(merged), at),
    db.prepare("UPDATE changes SET state = 'publie', decided_at = ?, decision_note = ? WHERE id = ? AND state = 'en_attente'").bind(at, note, id),
  ];
  const before = effectiveStatus(event);
  const after = effectiveStatus(next);
  if (before !== after) {
    statements.push(db.prepare('INSERT INTO status_history (event_id, previous_status, new_status, change_id, recorded_at) VALUES (?, ?, ?, ?, ?)').bind(event.id, before, after, id, at));
  }
  await db.batch(statements);
  return json({ published: id, eventId: event.id, previousStatus: before, newStatus: after });
}

async function adminApi(request: Request, url: URL, env: Env, ctx: ExecutionContext): Promise<Response> {
  if (!env.ADMIN_TOKEN) return json({ error: 'Administration désactivée : secret ADMIN_TOKEN non configuré' }, 503);
  if (!checkBearer(request.headers.get('authorization'), env.ADMIN_TOKEN)) return json({ error: 'Non autorisé' }, 401, { 'www-authenticate': 'Bearer' });
  if (!env.DB) return json({ error: 'Base D1 non configurée' }, 503);
  const db = env.DB;
  const { events } = await loadEvents(env);
  const body = async (): Promise<Record<string, unknown>> => {
    try { const b: unknown = await request.json(); return typeof b === 'object' && b !== null ? (b as Record<string, unknown>) : {}; } catch { return {}; }
  };
  const path = url.pathname.replace('/api/admin', '');
  const method = request.method;

  if (method === 'POST' && path === '/import') {
    const b = await body();
    if (!Array.isArray(b.changes) || b.changes.length === 0 || b.changes.length > 200) return json({ error: 'changes : tableau de 1 à 200 propositions attendu' }, 400);
    return json(await importChanges(db, b.changes, 'import', events), 202);
  }
  if (method === 'GET' && path === '/changes') {
    const state = url.searchParams.get('state') ?? 'en_attente';
    const { results } = await db.prepare('SELECT * FROM changes WHERE state = ? ORDER BY id DESC LIMIT 200').bind(state).all();
    return json({ state, changes: results });
  }
  const decision = path.match(/^\/changes\/(\d+)\/(validate|reject)$/);
  if (method === 'POST' && decision) {
    const id = Number(decision[1]);
    const b = await body();
    const note = typeof b.note === 'string' ? b.note : null;
    if (decision[2] === 'validate') return publishChange(db, id, events, note);
    const res = await db.prepare("UPDATE changes SET state = 'rejete', decided_at = ?, decision_note = ? WHERE id = ? AND state = 'en_attente'").bind(now(), note, id).run();
    return res.meta.changes ? json({ rejected: id }) : json({ error: 'Changement inconnu ou déjà traité' }, 409);
  }
  // Correction manuelle : importée puis publiée dans la foulée, avec la même validation.
  const correction = path.match(/^\/events\/([a-z0-9-]+)$/);
  if (method === 'PATCH' && correction) {
    const b = await body();
    const report = await importChanges(db, [{ ...b, eventId: correction[1] }], 'correction', events);
    const id = report.queued[0];
    if (id === undefined) return json({ error: 'Correction non enregistrée', report }, 422);
    return publishChange(db, id, events, 'correction manuelle');
  }
  if (method === 'POST' && path === '/check') {
    ctx.waitUntil(runDailyCheck(env, 'manuel'));
    return json({ started: true }, 202);
  }
  if (method === 'POST' && path === '/watch/report') {
    const b = await body();
    return json(await receiveWatchReport(db, b, events), 202);
  }
  if (method === 'GET' && path === '/alerts') {
    const state = url.searchParams.get('state') ?? 'ouverte';
    const { results } = await db.prepare('SELECT * FROM watch_alerts WHERE state = ? ORDER BY id DESC LIMIT 200').bind(state).all();
    return json({ state, alerts: results, labels: ALERT_LABELS });
  }
  const closeAlert = path.match(/^\/alerts\/(\d+)\/close$/);
  if (method === 'POST' && closeAlert) {
    const b = await body();
    const note = typeof b.note === 'string' ? b.note.slice(0, 500) : null;
    const res = await db.prepare("UPDATE watch_alerts SET state = 'traitee', closed_at = ?, note = ? WHERE id = ? AND state = 'ouverte'").bind(now(), note, Number(closeAlert[1])).run();
    return res.meta.changes ? json({ closed: Number(closeAlert[1]) }) : json({ error: 'Alerte inconnue ou déjà traitée' }, 409);
  }
  if (method === 'GET' && path === '/runs') {
    const runs = (await db.prepare('SELECT * FROM check_runs ORDER BY id DESC LIMIT 20').all()).results;
    const errors = (await db.prepare('SELECT * FROM error_log ORDER BY id DESC LIMIT 100').all()).results;
    return json({ runs, errors });
  }
  return json({ error: 'Route inconnue' }, 404);
}

const str = (v: unknown, max: number): string | null => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
const httpsOrNull = (v: unknown): string | null => { const s = str(v, 1000); return s && /^https?:\/\//.test(s) ? s : null; };

/**
 * Rapport de la veille automatique : les propositions passent par la même validation que l'import manuel
 * et restent « en attente » ; les alertes et l'état des pages sont seulement enregistrés.
 */
async function receiveWatchReport(db: D1Database, b: Record<string, unknown>, events: RaceEvent[]) {
  const checkedAt = str(b.checkedAt, 40) ?? now();
  const started = await db.prepare("INSERT INTO check_runs (started_at, trigger_kind) VALUES (?, 'veille_auto')").bind(checkedAt).run();
  const runId = Number(started.meta.last_row_id);
  const sources = (Array.isArray(b.sources) ? b.sources : []).slice(0, 400) as Record<string, unknown>[];
  const changes = (Array.isArray(b.changes) ? b.changes : []).slice(0, 200);
  const rawAlerts = (Array.isArray(b.alerts) ? b.alerts : []).slice(0, 300) as Record<string, unknown>[];
  const eventIds = new Set(events.map((e) => e.id));
  const groupFirstEvent = new Map<string, string>();
  for (const e of events) if (!groupFirstEvent.has(e.eventGroupId) && e.date >= checkedAt.slice(0, 10)) groupFirstEvent.set(e.eventGroupId, e.id);

  const importReport = await importChanges(db, changes, 'veille_auto', events);

  // Alertes envoyées par la veille, puis alertes déduites de l'état des pages.
  const alerts: { eventId: string | null; kind: AlertKind; message: string; sourceUrl: string | null; quote: string | null }[] = [];
  for (const a of rawAlerts) {
    const kind = str(a.kind, 40) as AlertKind | null;
    const message = str(a.message, 1000);
    if (!kind || !(kind in ALERT_LABELS) || !message) continue;
    const eventId = str(a.eventId, 200);
    alerts.push({ eventId: eventId && eventIds.has(eventId) ? eventId : null, kind, message, sourceUrl: httpsOrNull(a.sourceUrl), quote: str(a.quote, 600) });
  }
  const touchedGroups = new Set<string>();
  for (const c of changes as Record<string, unknown>[]) { const e = events.find((x) => x.id === c.eventId); if (e) touchedGroups.add(e.eventGroupId); }

  const { results: previousRows } = await db.prepare('SELECT url, hash, snippets, failures FROM watch_snapshots').all<{ url: string; hash: string | null; snippets: string; failures: number }>();
  const previous = new Map(previousRows.map((r) => [r.url, r]));
  const writes: D1PreparedStatement[] = [];
  let ok = 0;
  for (const s of sources) {
    const url = httpsOrNull(s.url);
    if (!url) continue;
    const groups = (Array.isArray(s.eventGroupIds) ? s.eventGroupIds : []).filter((g): g is string => typeof g === 'string');
    const firstEvent = groups.map((g) => groupFirstEvent.get(g)).find(Boolean) ?? null;
    const prev = previous.get(url);
    if (s.ok === true && typeof s.hash === 'string') {
      ok += 1;
      const snippets = (Array.isArray(s.snippets) ? s.snippets : []).filter((x): x is string => typeof x === 'string').slice(0, 60).map((x) => x.slice(0, 400));
      if (prev?.hash && prev.hash !== s.hash && !groups.some((g) => touchedGroups.has(g))) {
        let before: string[] = [];
        try { before = JSON.parse(prev.snippets) as string[]; } catch { before = []; }
        const added = snippets.filter((x) => !before.includes(x)).slice(0, 4);
        if (added.length) {
          alerts.push({ eventId: firstEvent, kind: 'page_modifiee', sourceUrl: url, quote: added.join(' … '), message: `Nouveaux passages sur une page officielle (${new URL(url).hostname}) : à relire.` });
        }
      }
      writes.push(db.prepare('INSERT INTO watch_snapshots (url, hash, snippets, http_status, failures, fetched_at) VALUES (?, ?, ?, ?, 0, ?) ON CONFLICT (url) DO UPDATE SET hash = excluded.hash, snippets = excluded.snippets, http_status = excluded.http_status, failures = 0, fetched_at = excluded.fetched_at')
        .bind(url, s.hash, JSON.stringify(snippets), typeof s.status === 'number' ? s.status : null, checkedAt));
    } else {
      const failures = (prev?.failures ?? 0) + 1;
      // Une page muette n'est jamais interprétée comme « fermé » : elle est signalée après trois échecs.
      if (failures === 3) {
        alerts.push({ eventId: firstEvent, kind: 'source_injoignable', sourceUrl: url, quote: str(s.error, 200), message: `La page ${url} ne répond plus depuis trois relevés (${str(s.error, 120) ?? 'erreur'}).` });
      }
      writes.push(db.prepare('INSERT INTO watch_snapshots (url, hash, snippets, http_status, failures, fetched_at) VALUES (?, NULL, \'[]\', ?, ?, ?) ON CONFLICT (url) DO UPDATE SET http_status = excluded.http_status, failures = ?, fetched_at = excluded.fetched_at')
        .bind(url, typeof s.status === 'number' ? s.status : null, failures, checkedAt, failures));
    }
  }
  let newAlerts = 0;
  for (const a of alerts) {
    const key = hashText(`${a.kind}|${a.eventId ?? ''}|${a.sourceUrl ?? ''}|${a.quote ?? a.message}`);
    writes.push(db.prepare('INSERT OR IGNORE INTO watch_alerts (event_id, kind, message, source_url, quote, dedupe_key, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(a.eventId, a.kind, a.message, a.sourceUrl, a.quote, key, now()));
  }
  if (writes.length) {
    const results = await db.batch(writes);
    // Les insertions d'alertes sont les dernières instructions du lot.
    newAlerts = results.slice(results.length - alerts.length).filter((r) => r.meta.changes > 0).length;
  }
  const note = `${importReport.queued.length} proposition(s) en attente, ${newAlerts} nouvelle(s) alerte(s)`;
  await db.prepare("UPDATE check_runs SET finished_at = ?, links_checked = ?, links_failed = ?, state = 'termine', note = ? WHERE id = ?")
    .bind(now(), sources.length, sources.length - ok, note, runId).run();
  return { runId, pages: sources.length, pagesRead: ok, changes: importReport, alerts: { received: alerts.length, created: newAlerts } };
}

/** Contrôle d'un lien officiel : 3 tentatives sur erreur réseau ou 5xx, aucun contournement d'accès. */
async function checkLink(link: string): Promise<{ ok: boolean; message: string; attempts: number }> {
  let message = '';
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const res = await fetch(link, { headers: { 'user-agent': USER_AGENT, accept: 'text/html' }, redirect: 'follow', signal: AbortSignal.timeout(10_000) });
      await res.body?.cancel();
      if (res.ok) return { ok: true, message: `HTTP ${res.status}`, attempts: attempt };
      message = `HTTP ${res.status}`;
      // Accès refusé ou limité : on n'insiste pas et on ne contourne rien.
      if (res.status < 500) return { ok: false, message: `${message} (non réessayé)`, attempts: attempt };
    } catch (err) {
      message = err instanceof Error ? err.message : 'erreur réseau';
    }
    await new Promise((r) => setTimeout(r, 1500 * attempt));
  }
  return { ok: false, message, attempts: 3 };
}

/**
 * Contrôle quotidien : vérifie que les liens officiels publiés répondent encore.
 * Il ne modifie aucun statut : un lien en erreur est journalisé pour vérification humaine,
 * jamais interprété comme « fermé ».
 */
export async function runDailyCheck(env: Env, trigger: 'planifie' | 'manuel'): Promise<void> {
  if (!env.DB) { console.warn('Contrôle ignoré : base D1 non configurée'); return; }
  const db = env.DB;
  const started = await db.prepare('INSERT INTO check_runs (started_at, trigger_kind) VALUES (?, ?)').bind(now(), trigger).run();
  const runId = Number(started.meta.last_row_id);
  try {
    const { events } = await loadEvents(env);
    const links = new Map<string, string>();
    for (const e of events) for (const u of [e.registrationUrl, e.officialUrl]) if (u && !links.has(u)) links.set(u, e.id);
    let failed = 0;
    for (const [link, eventId] of links) {
      const result = await checkLink(link);
      if (!result.ok) {
        failed += 1;
        await db.prepare('INSERT INTO error_log (run_id, event_id, url, message, attempts, occurred_at) VALUES (?, ?, ?, ?, ?, ?)').bind(runId, eventId, link, result.message, result.attempts, now()).run();
      }
      await new Promise((r) => setTimeout(r, 1000)); // cadence volontairement lente
    }
    const note = links.size === 0 ? 'Aucun lien officiel publié à contrôler.' : null;
    await db.prepare("UPDATE check_runs SET finished_at = ?, links_checked = ?, links_failed = ?, state = 'termine', note = ? WHERE id = ?").bind(now(), links.size, failed, note, runId).run();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db.prepare("UPDATE check_runs SET finished_at = ?, state = 'erreur', note = ? WHERE id = ?").bind(now(), message, runId).run();
    await db.prepare('INSERT INTO error_log (run_id, message, occurred_at) VALUES (?, ?, ?)').bind(runId, message, now()).run();
  }
}

const escXml = (value: string): string => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Flux RSS combiné : relevés Git + nouveautés approuvées dans D1. */
async function rssFeed(url: URL, env: Env): Promise<Response> {
  const base = url.origin;
  const entries: { id: string; title: string; summary: string; at: string; link: string }[] = [];
  if (env.DB) {
    try {
      const { results } = await env.DB.prepare(
        "SELECT id, event_id, category, summary, decided_at FROM changes WHERE state = 'publie' ORDER BY decided_at DESC LIMIT 100",
      ).all<{ id: number; event_id: string; category: string; summary: string; decided_at: string }>();
      for (const change of results) {
        entries.push({
          id: `d1-change-${change.id}`,
          title: `${BASE_BY_ID.get(change.event_id)?.name ?? change.event_id} — ${CATEGORY_LABELS[change.category] ?? 'Mise à jour'}`,
          summary: change.summary,
          at: change.decided_at,
          link: `${base}/epreuves/${change.event_id}/`,
        });
      }
    } catch (error) {
      console.error('RSS: lecture D1 indisponible', error);
    }
  }
  for (const survey of surveys) {
    const groupSet = new Set<string>();
    const summaries = survey.changes.filter((c) => {
      const group = BASE_BY_ID.get(c.eventId)?.eventGroupId ?? c.eventId;
      if (groupSet.has(group)) return false;
      groupSet.add(group);
      return true;
    }).map((c) => `${BASE_BY_ID.get(c.eventId)?.name ?? c.eventId} : ${c.summary}`);
    entries.push({ id: survey.id, title: survey.title, summary: `${survey.summary} ${summaries.join(' ')}`.trim(), at: survey.checkedAt, link: `${base}/veille/` });
  }
  entries.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  const items = entries.map((e) => `<item><title>${escXml(e.title)}</title><link>${escXml(e.link)}</link><guid isPermaLink="false">${escXml(e.id)}</guid><pubDate>${new Date(e.at).toUTCString()}</pubDate><description>${escXml(e.summary)}</description></item>`).join('');
  const xml = `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>Veille des inscriptions — Triathlon Pays de la Loire 2027</title><link>${base}/veille/</link><description>Informations vérifiées sur les inscriptions 2027.</description><language>fr</language>${items}</channel></rss>`;
  return new Response(xml, { headers: { 'content-type': 'application/rss+xml; charset=utf-8', 'cache-control': 'no-store' } });
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    try {
      if (url.pathname === '/veille/rss.xml' && (request.method === 'GET' || request.method === 'HEAD')) return await rssFeed(url, env);
      if (url.pathname.startsWith('/api/admin/')) return await adminApi(request, url, env, ctx);
      if (url.pathname.startsWith('/api/')) {
        if (request.method !== 'GET' && request.method !== 'HEAD') return json({ error: 'Méthode non autorisée' }, 405, { allow: 'GET, HEAD' });
        return await publicApi(url, env);
      }
    } catch (err) {
      console.error(err);
      return json({ error: 'Erreur interne' }, 500);
    }
    return env.ASSETS.fetch(request);
  },

  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    // Deux déclenchements UTC chaque jour ; un seul correspond à 08 h 30 à Paris selon la saison.
    if (!isDailySlot(new Date(controller.scheduledTime))) return;
    ctx.waitUntil(runDailyCheck(env, 'planifie'));
  },
} satisfies ExportedHandler<Env>;
