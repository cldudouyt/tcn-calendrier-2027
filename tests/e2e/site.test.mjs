// Tests de bout en bout (navigateur réel). Lancer le site puis : npm run test:e2e
//   BASE_URL=http://localhost:4321 (astro preview, par défaut) ou l'URL de « wrangler dev ».
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL ?? 'http://localhost:4321';
let browser;
before(async () => { browser = await chromium.launch(); });
after(async () => { await browser?.close(); });

async function open(path, viewport = { width: 1280, height: 900 }) {
  const context = await browser.newContext({ viewport, locale: 'fr-FR' });
  const page = await context.newPage();
  await page.goto(BASE + path, { waitUntil: 'load' });
  return page;
}
const visibleCards = (page) => page.locator('#view-liste .event-card:visible').count();

test('accueil : 78 rendez-vous et indicateurs calculés', async () => {
  const page = await open('/');
  assert.match(await page.locator('h1').innerText(), /ÉPREUVES MULTISPORTS\s+PAYS DE LA LOIRE 2027/i);
  assert.equal(await page.locator('[data-kpi="total"]').innerText(), '78');
  assert.equal(await page.locator('[data-kpi="open"]').innerText(), '0');
  assert.equal(await page.locator('[data-kpi="toConfirm"]').innerText(), '78');
  assert.match(await page.locator('main').innerText(), /novembre 2026 → novembre 2027/i);
  await page.close();
});

test('charte : couleurs et polices du site Quiberon', async () => {
  const page = await open('/');
  await page.evaluate(() => document.fonts.ready);
  const css = await page.evaluate(() => ({
    bg: getComputedStyle(document.body).backgroundColor,
    ink: getComputedStyle(document.body).color,
    h1: getComputedStyle(document.querySelector('h1')).fontFamily,
    body: getComputedStyle(document.body).fontFamily,
    nav: getComputedStyle(document.querySelector('.nav a')).fontFamily,
    btn: getComputedStyle(document.querySelector('.btn-primary')).backgroundColor,
    kpi: getComputedStyle(document.querySelector('.kpi-value')).color,
    loaded: ['400 16px "Anton"', '400 16px "Barlow"', '700 16px "Barlow Semi Condensed"'].map((f) => document.fonts.check(f)),
  }));
  assert.equal(css.bg, 'rgb(244, 243, 240)');   // #F4F3F0
  assert.equal(css.ink, 'rgb(28, 30, 34)');     // #1C1E22
  assert.equal(css.btn, 'rgb(214, 64, 0)');     // #D64000
  assert.equal(css.kpi, 'rgb(233, 83, 14)');    // #E9530E
  assert.match(css.h1, /Anton/);
  assert.match(css.body, /Barlow/);
  assert.match(css.nav, /Barlow Semi Condensed/);
  assert.deepEqual(css.loaded, [true, true, true]);
  await page.close();
});

test('calendrier : 78 entrées, répartition 20/10/15/13/20, aucun statut inventé', async () => {
  const page = await open('/calendrier/');
  assert.equal(await visibleCards(page), 78);
  await page.locator('#filter-details summary').click(); // filtres repliés par défaut
  assert.equal(await page.locator('#result-count').innerText(), '78');
  for (const [dep, n] of [['44', 20], ['49', 10], ['53', 15], ['72', 13], ['85', 20]]) {
    await page.locator(`input[name="dep"][value="${dep}"]`).check({ force: true });
    assert.equal(await visibleCards(page), n, `département ${dep}`);
    await page.locator(`input[name="dep"][value="${dep}"]`).uncheck({ force: true });
  }
  assert.equal(await page.locator('.event-card .badge-success').count(), 0);
  assert.equal(await page.locator('.event-card [data-status="ferme"]').count(), 0);
  assert.equal(await page.locator('.event-card [data-status="non_verifie"]').count(), 78);
  await page.close();
});

test('calendrier : filtres cumulables, recherche, URL partageable, vue mois', async () => {
  const page = await open('/calendrier/');
  await page.locator('#filter-details summary').click();
  await page.locator('input[name="dep"][value="44"]').check({ force: true });
  await page.locator('input[name="kind"][value="Bike & Run"]').check({ force: true });
  assert.equal(await visibleCards(page), 4);
  assert.match(page.url(), /dep=44/);
  assert.match(page.url(), /kind=Bike/);
  assert.match(await page.locator('a[data-keep-filters="/carte/"]').getAttribute('href'), /^\/carte\/\?.*dep=44/);

  const shared = await open(new URL(page.url()).pathname + new URL(page.url()).search);
  assert.equal(await visibleCards(shared), 4);
  assert.equal(await shared.locator('input[name="dep"][value="44"]').isChecked(), true);
  await shared.close();

  await page.locator('#filters-reset').click();
  await page.waitForFunction(() => document.getElementById('result-count').textContent === '78');
  await page.fill('#q', 'coueron');
  assert.equal(await visibleCards(page), 1);
  await page.fill('#q', 'zzzz');
  assert.equal(await page.locator('#no-result').isVisible(), true);
  await page.fill('#q', '');

  await page.locator('[data-view="mois"]').click();
  assert.equal(await page.locator('#view-mois').isVisible(), true);
  assert.equal(await page.locator('#view-mois section').count(), 13);
  assert.equal(await page.locator('#view-mois li[data-event-id]:visible').count(), 78);
  assert.match(page.url(), /vue=mois/);
  await page.close();
});

test('calendrier : week-end regroupé, entrées distinctes', async () => {
  const page = await open('/calendrier/?q=baule');
  assert.equal(await visibleCards(page), 2);
  assert.match(await page.locator('.weekend-multi:visible .weekend-label').first().innerText(), /WEEK-END DU SAMEDI 25 SEPTEMBRE 2027 AU DIMANCHE 26 SEPTEMBRE 2027/i);
  await page.close();
});

test('carte : positions indicatives, repères et filtres synchronisés avec la liste', async () => {
  const page = await open('/carte/?dep=85');
  assert.match(await page.locator('.notice').first().innerText(), /Positions indicatives/);
  assert.equal(await page.locator('#result-count').innerText(), '20');
  assert.equal(await page.locator('input[name="dep"][value="85"]').isChecked(), true);
  await page.waitForSelector('.leaflet-marker-icon');
  const shown = await page.evaluate(() => [...document.querySelectorAll('.leaflet-marker-icon')].reduce((n, el) => n + (el.querySelector('.cluster') ? Number(el.textContent) : 1), 0));
  assert.ok(shown > 0 && shown <= 20, `repères affichés : ${shown}`);
  assert.match(await page.locator('.leaflet-control-attribution').innerText(), /OpenStreetMap/);
  assert.match(await page.locator('a[data-keep-filters="/calendrier/"]').getAttribute('href'), /dep=85/);
  // Sélection d'un repère au clavier ou au doigt : la fenêtre rappelle le caractère indicatif.
  await page.locator('input[name="dep"][value="85"]').uncheck({ force: true });
  await page.fill('#q', 'Cholet');
  await page.locator('.leaflet-marker-icon').first().click();
  const popup = await page.locator('.leaflet-popup-content').innerText();
  assert.match(popup, /Position indicative/);
  assert.match(popup, /Triathlon de Cholet/);
  assert.match(popup, /Inscriptions non vérifiées/);
  assert.match(popup, /Train direct/);
  assert.equal(await page.locator('.leaflet-popup-content a').getAttribute('href'), '/epreuves/pdl-49-2027-09-19-triathlon-de-cholet/');
  await page.close();
});

test('fiche : transports séparant commune, départ et vélo, sans rien garantir', async () => {
  const page = await open('/epreuves/pdl-44-2027-06-13-triathlon-de-mesquer-quimiac/');
  const text = await page.locator('main').innerText();
  for (const expected of [/dimanche 13 juin 2027/, /Atteindre la commune/i, /Dernier kilomètre jusqu’au départ exact/i, /Atteindre le départ avec un vélo/i,
    /Emport du vélo non confirmé/, /Horaires à vérifier/, /Retour le même jour/i, /indicatif/i, /pas un horaire 2027 validé/, /position indicative/i,
    /Lien d’inscription non vérifié/i, /Aucun tarif sourcé/i, /Jamais vérifié/]) assert.match(text, expected);
  assert.equal(await page.locator('a:has-text("S’inscrire")').count(), 0);
  assert.doesNotMatch(text, /\d+\s?(€|EUR)|\d+\s?min\b|\d{1,2}\s?h\s?\d{2}/); // ni tarif, ni durée, ni horaire
  await page.close();

  const unknown = await open('/epreuves/pdl-85-2027-03-28-duathlon-de-lagglomeration-des-sables-dolonne/');
  const t2 = await unknown.locator('main').innerText();
  assert.match(t2, /Itinéraire à préciser — non garanti/);
  assert.match(t2, /Points à recouper/);
  assert.match(t2, /Non localisé/);
  await unknown.close();
});

test('veille, documents et hors région', async () => {
  const veille = await open('/veille/');
  assert.match(await veille.locator('#last-check').innerText(), /13 novembre 2026/);
  assert.match(await veille.locator('#timeline').innerText(), /Relevé initial/);
  assert.doesNotMatch(await veille.locator('main').innerText(), /ChatGPT/);
  await veille.close();

  const docs = await open('/documents/');
  const href = await docs.locator('a.btn-primary').getAttribute('href');
  const res = await docs.request.get(BASE + href);
  assert.equal(res.status(), 200);
  assert.match(res.headers()['content-type'], /pdf/);
  assert.match(await docs.locator('main').innerText(), /13 novembre 2026/);
  await docs.close();

  const hr = await open('/hors-region/');
  assert.equal(await hr.locator('#hors-region-list > li').count(), 11);
  assert.match(await hr.locator('main').innerText(), /pas comptés/);
  await hr.close();
});

test('mobile : pas de défilement horizontal, cibles tactiles, carte utilisable', async () => {
  for (const path of ['/', '/calendrier/', '/calendrier/?vue=mois', '/carte/', '/veille/', '/documents/', '/hors-region/', '/epreuves/pdl-85-2027-06-27-ironman-les-sables-dolonne/']) {
    const page = await open(path, { width: 360, height: 740 });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(overflow <= 1, `${path} déborde de ${overflow}px`);
    const small = await page.evaluate(() => [...document.querySelectorAll('.btn, .nav a, .tabs button, .chip span, .filters summary')]
      .filter((el) => el.offsetParent !== null && el.getBoundingClientRect().height < 40).map((el) => el.textContent.trim()));
    assert.deepEqual(small, [], `${path} : cibles tactiles trop petites`);
    await page.close();
  }
  const map = await open('/carte/', { width: 360, height: 740 });
  await map.waitForSelector('.leaflet-marker-icon');
  assert.ok((await map.locator('#map').boundingBox()).height >= 380);
  await map.close();
});

test('clavier : lien d’évitement, focus visible, filtres actionnables', async () => {
  const page = await open('/calendrier/');
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement.className), 'skip');
  await page.locator('#q').focus();
  const outline = await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle);
  assert.notEqual(outline, 'none');
  await page.locator('#filter-details summary').focus();
  if (!(await page.locator('#filter-details').evaluate((d) => d.open))) await page.keyboard.press('Enter');
  await page.locator('input[name="dep"][value="72"]').focus();
  await page.keyboard.press('Space');
  assert.equal(await visibleCards(page), 13);
  await page.close();
});
