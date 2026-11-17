// Parcours de la page d'administration dans un navigateur réel, API d'administration simulée :
// aucun jeton réel n'est utilisé et rien n'est écrit dans la base.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';

const events = JSON.parse(readFileSync(new URL('../../data.json', import.meta.url), 'utf8'));

const BASE = process.env.BASE_URL ?? 'http://localhost:4321';
const EVENT = 'pdl-44-2027-06-13-triathlon-de-mesquer-quimiac';
const SOURCE = 'https://www.tri-cote-damour.fr/%C3%A9v%C3%A9nements';
let browser;
before(async () => { browser = await chromium.launch(); });
after(async () => { await browser?.close(); });

const alerts = [
  { id: 11, event_id: EVENT, kind: 'page_modifiee', message: 'Nouveaux passages sur une page officielle : à relire.', source_url: SOURCE, quote: 'Inscriptions 2027', created_at: '2026-11-16T07:00:00Z' },
  { id: 12, event_id: EVENT, kind: 'date_differente', message: 'Le calendrier FFTRI donne une autre date.', source_url: 'https://fftri.t2area.com/calendrier/x.html', quote: null, created_at: '2026-11-16T07:00:00Z' },
  { id: 13, event_id: null, kind: 'manifestation_non_suivie', message: 'Manifestation FFTRI non rapprochée.', source_url: 'https://fftri.t2area.com/calendrier/y.html', quote: null, created_at: '2026-11-16T07:00:00Z' },
];

async function adminPage() {
  const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
  const calls = [];
  const ok = (body, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });
  await page.route('**/api/admin/**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    calls.push({ method: req.method(), path: url.pathname + url.search, body: req.postData() ? JSON.parse(req.postData()) : null });
    if (req.method() === 'GET' && url.pathname.endsWith('/alerts')) {
      return route.fulfill(ok({ alerts: url.searchParams.get('state') === 'ouverte' ? alerts : [], labels: { page_modifiee: 'Page officielle modifiée', date_differente: 'Date différente au calendrier FFTRI', manifestation_non_suivie: 'Manifestation FFTRI non suivie' } }));
    }
    if (url.pathname.endsWith('/changes')) return route.fulfill(ok({ changes: [] }));
    if (url.pathname.endsWith('/reports')) return route.fulfill(ok({ reports: [], labels: {} }));
    if (url.pathname.endsWith('/runs')) return route.fulfill(ok({ runs: [] }));
    if (req.method() === 'PATCH') return route.fulfill(ok({ published: 1, eventId: EVENT, previousStatus: 'non_verifie', newStatus: 'ouvert' }));
    return route.fulfill(ok({ closed: 1 }));
  });
  // Liste publique des épreuves servie telle que le Worker la renvoie (référentiel sans surcharge).
  await page.route('**/api/events', (route) => route.fulfill(ok({ count: events.length, events })));
  await page.goto(`${BASE}/admin/`);
  await page.fill('#token', 'jeton-factice-pour-le-test-e2e');
  await page.click('#login button[type=submit]');
  await page.locator('#alerts li.card').first().waitFor();
  return { page, calls };
}

test('admin : chaque type d’alerte propose une action adaptée', async () => {
  const { page } = await adminPage();
  const cards = page.locator('#alerts li.card');
  assert.equal(await cards.count(), 3);
  assert.ok(await cards.nth(0).getByRole('button', { name: 'Publier une info d’inscription' }).isVisible());
  assert.ok(await cards.nth(0).getByRole('button', { name: 'Rien à publier' }).isVisible());
  assert.ok(await cards.nth(1).getByRole('link', { name: 'Corriger la date sur GitHub' }).isVisible());
  assert.match(await cards.nth(1).innerText(), /ligne \d+ de data\.json/);
  assert.ok(await cards.nth(1).getByRole('button', { name: 'Garder la date du site' }).isVisible());
  assert.ok(await cards.nth(2).getByRole('button', { name: 'Hors périmètre ou déjà suivie' }).isVisible());
  assert.ok(await page.locator('#free-correction form').isVisible(), 'formulaire libre');
  await page.close();
});

test('admin : publier depuis une alerte exige la preuve, envoie la correction puis classe l’alerte', async () => {
  const { page, calls } = await adminPage();
  const card = page.locator('#alerts li.card').first();
  await card.getByRole('button', { name: 'Publier une info d’inscription' }).click();
  const form = card.locator('form');
  assert.equal(await form.getByLabel('Lien officiel où l’information figure').inputValue(), SOURCE, 'lien prérempli avec la source');
  await form.getByRole('button', { name: 'Publier sur le site' }).click();
  assert.match(await form.locator('[role=status]').innerText(), /Recopiez ce que dit la page/);
  await form.getByLabel('Fait vérifié').fill('Inscriptions ouvertes pour l’édition 2027');
  await form.getByRole('button', { name: 'Publier sur le site' }).click();
  assert.match(await form.locator('[role=status]').innerText(), /Cochez la case/);
  assert.equal(calls.filter((c) => c.method === 'PATCH').length, 0, 'rien envoyé tant que la vérification n’est pas confirmée');
  await form.getByRole('checkbox').check();
  await form.getByRole('button', { name: 'Publier sur le site' }).click();
  await page.waitForFunction(() => document.getElementById('admin-status')?.textContent?.startsWith('Publié'));
  const sent = calls.find((c) => c.method === 'PATCH');
  assert.equal(sent.path, `/api/admin/events/${EVENT}`);
  assert.deepEqual(sent.body.patch, { registrationStatus: 'ouvert', registrationEvidence: 'Inscriptions ouvertes pour l’édition 2027', registrationUrl: SOURCE });
  const closed = calls.find((c) => c.path === '/api/admin/alerts/11/close');
  assert.match(closed.body.note, /^Information publiée : Inscriptions ouvertes/);
  await page.close();
});

test('admin : un format complet est publié seul, et un classement garde la note', async () => {
  const { page, calls } = await adminPage();
  const free = page.locator('#free-correction form');
  await free.getByLabel('Épreuve', { exact: true }).selectOption(EVENT);
  await free.getByLabel('Information à publier').selectOption('complet');
  await free.getByLabel('Format concerné').selectOption('XS');
  await free.getByLabel('Lien officiel où l’information figure').fill('https://www.klikego.com/inscription/mesquer-2027/triathlon/1-1');
  await free.getByLabel('Fait vérifié').fill('Format XS : complet');
  await free.getByRole('checkbox').check();
  await free.getByRole('button', { name: 'Publier sur le site' }).click();
  await page.waitForFunction(() => document.getElementById('admin-status')?.textContent?.startsWith('Publié'));
  const sent = calls.find((c) => c.method === 'PATCH');
  assert.deepEqual(Object.keys(sent.body.patch), ['formatAvailability']);
  assert.deepEqual(sent.body.patch.formatAvailability.at(-1), { format: 'XS', status: 'complet', evidence: 'Format XS : complet', sourceUrl: 'https://www.klikego.com/inscription/mesquer-2027/triathlon/1-1' });

  const card = page.locator('#alerts li.card').nth(1);
  await card.getByLabel('Note de classement (facultative)').fill('confirmé avec le club');
  await card.getByRole('button', { name: 'Garder la date du site' }).click();
  await page.waitForFunction(() => document.getElementById('admin-status')?.textContent?.startsWith('Alerte classée'));
  assert.equal(calls.find((c) => c.path === '/api/admin/alerts/12/close').body.note, 'Date du site maintenue — confirmé avec le club');
  await page.close();
});
