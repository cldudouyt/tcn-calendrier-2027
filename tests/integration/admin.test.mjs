// Tests d'intégration Worker + D1 des actions de la page d'administration :
// publication d'une information d'inscription, refus motivés, publication par format, classement d'alerte avec note.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const BASE = process.env.BASE_URL ?? 'http://localhost:8799';
const TOKEN = process.env.ADMIN_TOKEN ?? 'jeton-local-de-test-0123456789';
const EVENT = 'pdl-44-2027-06-13-triathlon-de-mesquer-quimiac';
const URL_2027 = 'https://www.klikego.com/inscription/triathlon-de-mesquer-2027/triathlon/1-1';

async function admin(path, init = {}) {
  const res = await fetch(`${BASE}/api/admin${path}`, { ...init, headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' } });
  return { status: res.status, body: await res.json() };
}
const patch = (p, summary = 'Correction administrateur de test') =>
  admin(`/events/${EVENT}`, { method: 'PATCH', body: JSON.stringify({ checkedAt: new Date().toISOString(), summary, patch: p }) });
const publicEvent = async () => (await (await fetch(`${BASE}/api/events/${EVENT}`)).json()).event;

test('refuse une publication sans fait vérifié, avec la raison', async () => {
  const r = await patch({ registrationStatus: 'ouvert', registrationUrl: URL_2027 });
  assert.equal(r.status, 422);
  assert.ok(r.body.details.some((d) => /registrationEvidence/.test(d)), JSON.stringify(r.body.details));
  assert.equal((await publicEvent()).registrationStatus ?? 'non_verifie', 'non_verifie');
});

test('publie un format complet sans rendre toute l’épreuve complète', async () => {
  const r = await patch({ formatAvailability: [{ format: 'XS', status: 'complet', evidence: 'XS : complet pour l’édition 2027', sourceUrl: URL_2027 }] });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const e = await publicEvent();
  assert.deepEqual(e.formatAvailability.map((f) => [f.format, f.status]), [['XS', 'complet']]);
  assert.notEqual(e.registrationStatus, 'complet');
});

test('publie des inscriptions ouvertes, puis explique pourquoi la même publication est refusée', async () => {
  const p = { registrationStatus: 'ouvert', registrationUrl: URL_2027, registrationEvidence: 'Inscriptions ouvertes pour l’édition 2027' };
  const first = await patch(p);
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.equal(first.body.newStatus, 'ouvert');
  const e = await publicEvent();
  assert.equal(e.registrationStatus, 'ouvert');
  assert.equal(e.registrationUrl, URL_2027);
  const again = await patch(p, 'Même correction');
  assert.equal(again.status, 422);
  assert.ok(again.body.details.length > 0, 'raison fournie');
  const updates = (await (await fetch(`${BASE}/api/updates`)).json()).updates.filter((u) => u.eventId === EVENT);
  assert.ok(updates.some((u) => /Inscriptions ouvertes/.test(u.summary) || u.category === 'ouvert_confirme'), 'visible dans la veille');
});

test('classe une alerte avec la note de l’administrateur', async () => {
  const r = await admin('/watch/report', { method: 'POST', body: JSON.stringify({
    checkedAt: new Date().toISOString(), sources: [], changes: [],
    alerts: [{ kind: 'date_differente', eventId: EVENT, message: `Alerte de test ${Date.now()}`, sourceUrl: 'https://fftri.t2area.com/calendrier/x.html' }],
  }) });
  assert.equal(r.status, 202);
  const open = (await admin('/alerts?state=ouverte')).body.alerts.find((a) => a.event_id === EVENT && a.kind === 'date_differente');
  assert.ok(open, 'alerte créée');
  const close = await admin(`/alerts/${open.id}/close`, { method: 'POST', body: JSON.stringify({ note: 'Date du site maintenue — vérifiée sur la page du club' }) });
  assert.equal(close.status, 200);
  const done = (await admin('/alerts?state=traitee')).body.alerts.find((a) => a.id === open.id);
  assert.equal(done.note, 'Date du site maintenue — vérifiée sur la page du club');
  assert.equal((await admin(`/alerts/${open.id}/close`, { method: 'POST', body: '{}' })).status, 409);
});
