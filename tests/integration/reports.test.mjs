// Tests d'intégration Worker + D1 des signalements communautaires.
// Lancer « npm run worker:test » : construit le site, crée une base D1 locale vierge, démarre wrangler dev et exécute ces tests.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const BASE = process.env.BASE_URL ?? 'http://localhost:8799';
const TOKEN = process.env.ADMIN_TOKEN ?? 'jeton-local-de-test-0123456789';
const EVENT = 'pdl-44-2027-04-04-duathlon-nozeen';
let ipCounter = 0;
const freshIp = () => `203.0.113.${(ipCounter += 1)}`;

async function report(body, ip = freshIp()) {
  const res = await fetch(`${BASE}/api/reports`, { method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': ip }, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
}
async function admin(path) {
  const res = await fetch(`${BASE}/api/admin${path}`, { headers: { authorization: `Bearer ${TOKEN}` } });
  return res.json();
}
async function waitFor(fn, timeout = 8000) {
  const end = Date.now() + timeout;
  for (;;) {
    const value = await fn();
    if (value || Date.now() > end) return value;
    await new Promise((r) => setTimeout(r, 250));
  }
}

test('refuse les épreuves inconnues, les types et adresses non autorisés', async () => {
  for (const body of [
    { eventId: 'inconnue', type: 'complet', url: 'https://www.klikego.com/x-2027' },
    { eventId: 'hr-10-2027-04-04', type: 'complet', url: 'https://www.klikego.com/x-2027' },
    { eventId: EVENT, type: 'modifier_date', url: 'https://www.klikego.com/x-2027' },
    { eventId: EVENT, type: 'complet', url: 'http://127.0.0.1/admin' },
    { eventId: EVENT, type: 'complet', url: 'https://localhost/' },
    { eventId: EVENT, type: 'complet', url: 'file:///etc/passwd' },
    { eventId: EVENT, type: 'complet', format: 'XXL', url: 'https://www.klikego.com/x-2027' },
  ]) {
    const r = await report(body);
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.equal(r.body.result, 'impossible');
  }
  const big = await fetch(`${BASE}/api/reports`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: 'x'.repeat(5000) });
  assert.equal(big.status, 413);
  assert.equal((await fetch(`${BASE}/api/reports`)).status, 405);
});

test('accuse réception, puis place un domaine inconnu « à vérifier » sans le lire ni rien publier', async () => {
  const url = `https://site-inconnu-${Date.now()}.example/duathlon-2027`;
  const r = await report({ eventId: EVENT, type: 'inscriptions_ouvertes', url });
  assert.equal(r.status, 202);
  assert.equal(r.body.result, 'recu');
  assert.doesNotMatch(r.body.message, /confirm/i);
  const pending = await waitFor(async () => (await admin('/reports?state=a_verifier')).reports.find((x) => x.source_url === url));
  assert.ok(pending, 'signalement passé « à vérifier »');
  assert.match(pending.reason, /Domaine non reconnu/);
  const status = (await (await fetch(`${BASE}/api/status`)).json()).statuses.find((s) => s.id === EVENT);
  assert.equal(status.status, 'non_verifie');
});

test('un signalement en double ne crée pas de seconde entrée', async () => {
  const url = `https://autre-${Date.now()}.example/2027`;
  const first = await report({ eventId: EVENT, type: 'complet', url });
  const again = await report({ eventId: EVENT, type: 'complet', url: `${url}/?utm_source=whatsapp` }, freshIp());
  assert.equal(first.body.result, 'recu');
  assert.equal(again.body.result, 'deja_signale');
  const all = [...(await admin('/reports?state=a_verifier')).reports, ...(await admin('/reports?state=en_attente')).reports];
  assert.equal(all.filter((x) => x.source_url.startsWith(url)).length, 1);
});

test('champ piège rempli : accusé neutre, rien n’est enregistré', async () => {
  const url = `https://robot-${Date.now()}.example/2027`;
  const r = await report({ eventId: EVENT, type: 'complet', url, website: 'http://spam.example' });
  assert.equal(r.body.result, 'recu');
  await new Promise((res) => setTimeout(res, 800));
  const all = [...(await admin('/reports?state=a_verifier')).reports, ...(await admin('/reports?state=en_attente')).reports];
  assert.equal(all.some((x) => x.source_url.startsWith(url)), false);
});

test('limite le nombre de signalements par connexion', async () => {
  const ip = freshIp();
  const results = [];
  for (let i = 0; i < 6; i += 1) results.push((await report({ eventId: EVENT, type: 'ouverture_annoncee', url: `https://limite-${Date.now()}-${i}.example/2027` }, ip)).status);
  assert.deepEqual(results.slice(0, 5), [202, 202, 202, 202, 202]);
  assert.equal(results[5], 429);
});

test('impossible de modifier date, distance ou lieu par ce canal', async () => {
  const before = (await (await fetch(`${BASE}/api/events/${EVENT}`)).json()).event;
  await report({ eventId: EVENT, type: 'inscriptions_ouvertes', url: `https://x-${Date.now()}.example/2027`, date: '2027-12-25', town: 'Ailleurs', formats: 'XXL', formatTags: ['XXL'] });
  const after = (await (await fetch(`${BASE}/api/events/${EVENT}`)).json()).event;
  assert.deepEqual([after.date, after.town, after.formats], [before.date, before.town, before.formats]);
  assert.equal((await (await fetch(`${BASE}/api/events`)).json()).count, 78);
});
