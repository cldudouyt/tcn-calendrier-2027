import { describe, expect, it } from 'vitest';
import sourcesFile from '../data/sources.json';
import { events as allEvents } from '../src/lib/events';
import {
  buildProposals, cleanUrl, editionYear, groupKeywords, hashText, isTicketing, matchCalendar, parseFftriCalendar, parseFftriEvent,
  parseFrenchDates, scanPage, type CalendarEntry, type GroupObservation, type SourcePage, type WatchEvent,
} from '../worker/watch';

const events: WatchEvent[] = allEvents.map((e) => ({
  id: e.id, eventGroupId: e.eventGroupId, department: e.department, date: e.date, name: e.name, town: e.town,
  registrationStatus: e.registrationStatus, registrationUrl: e.registrationUrl, officialUrl: e.officialUrl,
}));
const CHECKED_AT = '2026-11-14T08:00:00.000Z';
const page = (url: string, scope: SourcePage['scope'] = 'epreuve'): SourcePage => ({ url, scope });

// Pages synthétiques reproduisant la structure des pages réelles (sans en copier le contenu).
const calendarHtml = (items: object[]): string => `<html><body><script>
var mapEvents = ${JSON.stringify(items)};
</script></body></html>`;
const fftriHtml = (cancelled: boolean, dates: string[], links = ''): string => `<html><body>
<span id="cancelledBadge" class="t2-chip" hidden>Annulé</span>
${dates.map((d) => `<time datetime="${d}">${d}</time>`).join('')}
${links}
<script>const eventData = {
  date: "${dates[0]}",
  cancelled: ${cancelled},
  location: { lat: 47, lon: -1, name: "44 - VILLE" }
};</script></body></html>`;

describe('lecture du calendrier FFTRI', () => {
  it('convertit les dates françaises', () => {
    expect(parseFrenchDates('24 AVRIL 2027 · 25 AVRIL 2027')).toEqual(['2027-04-24', '2027-04-25']);
    expect(parseFrenchDates('1ER FÉVRIER 2027')).toEqual(['2027-02-01']);
    expect(parseFrenchDates('15 AOÛT 2027')).toEqual(['2027-08-15']);
  });
  it('lit la liste structurée des manifestations', () => {
    const entries = parseFftriCalendar(calendarHtml([
      { name: 'Triathlon de Vertou (44)', location: 'VERTOU · 44120', url: 'https:\/\/fftri.t2area.com\/calendrier\/triathlon-de-vertou.html', date: '24 AVRIL 2027 · 25 AVRIL 2027' },
      { name: 'Triathlon de la Baule (44)', location: 'LA BAULE ESCOUBLAC · 44055', url: 'https://fftri.t2area.com/calendrier/triathlon-de-la-baule.html', date: '25 SEPTEMBRE 2027' },
    ]));
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({ department: '44', town: 'VERTOU', dates: ['2027-04-24', '2027-04-25'] });
    expect(entries[1]?.department).toBe('44');
  });
  it('lit l’indicateur d’annulation structuré, jamais le libellé masqué « Annulé »', () => {
    const live = parseFftriEvent(fftriHtml(false, ['2027-09-25', '2027-09-26']), 'https://fftri.t2area.com/calendrier/x.html');
    expect(live.cancelled).toBe(false);
    expect(live.raceDates).toEqual(['2027-09-25', '2027-09-26']);
    expect(parseFftriEvent(fftriHtml(true, ['2027-09-25']), 'https://fftri.t2area.com/x.html').cancelled).toBe(true);
    expect(parseFftriEvent('<html>Annulé</html>', 'https://fftri.t2area.com/x.html').cancelled).toBeNull();
  });
  it('récupère et corrige les liens « Site officiel » et « S’inscrire »', () => {
    const info = parseFftriEvent(fftriHtml(false, ['2027-06-27'],
      '<a href="https://httpwww.ironman.com/races/im-les-sables-dolonne">Site officiel</a><a href="https://www.klikego..com">S&#039;inscrire</a>'), 'https://fftri.t2area.com/x.html');
    expect(info.officialUrl).toBe('https://www.ironman.com/races/im-les-sables-dolonne');
    expect(info.registerUrl).toBeNull();
  });
});

describe('rapprochement avec les épreuves du site', () => {
  const entry = (name: string, town: string, dates: string[], department = '44'): CalendarEntry => ({ name, town, dates, department, url: `https://fftri.t2area.com/calendrier/${encodeURIComponent(name)}.html` });
  it('associe une manifestation de deux jours aux deux épreuves de la même commune', () => {
    const [m] = matchCalendar([entry('Triathlon de Vertou (44)', 'VERTOU', ['2027-04-24', '2027-04-25'])], events);
    expect(m?.eventGroupIds.sort()).toEqual(['pdl-44-aquathlon-de-vertou', 'pdl-44-triathlon-de-vertou']);
  });
  it('départage deux épreuves du même jour par la commune et le nom', () => {
    const [m] = matchCalendar([entry('Triathlon de Noirmoutier (85)', "L'EPINE", ['2027-06-06'], '85')], events);
    expect(m?.eventGroupIds).toEqual(['pdl-85-triathlon-de-noirmoutier']);
  });
  it('retrouve une épreuve dont la date a changé, et laisse de côté une manifestation inconnue', () => {
    const [moved, unknown] = matchCalendar([
      entry('Duathlon Nozéen - Nozay (44)', 'NOZAY', ['2027-04-11']),
      entry('Aquathlon des Lacs (44)', 'BLAIN', ['2027-05-08']),
    ], events);
    expect(moved?.eventGroupIds).toEqual(['pdl-44-duathlon-nozeen']);
    expect(unknown?.eventGroupIds).toEqual([]);
  });
});

describe('lecture des pages des organisateurs', () => {
  it('repère un lien de billetterie 2027 et ignore adhésions et bourse aux dossards', () => {
    const scan = scanPage(`<main><h2>Édition 2027</h2><p>Inscriptions ouvertes !</p>
      <a href="https://in.inscriptions-tiel.com/course-20271791963694991">Je m’inscris</a>
      <a href="https://www.helloasso.com/associations/club/adhesions/adhesion-2027">Adhérer</a>
      <a href="https://www.swika.co/course/">Bourse aux dossards</a></main>`, 'https://club.example.fr/course');
    expect(scan.ticketing.map((t) => t.url)).toEqual(['https://in.inscriptions-tiel.com/course-20271791963694991']);
    expect(scan.ticketing[0]?.mentions2027).toBe(true);
  });
  it('écarte un lien de l’édition 2026 resté sur une page 2027', () => {
    const scan = scanPage('<h1>Triathlon 2027</h1><p>Ouverture des inscriptions : décembre 2026</p><a href="https://www.klikego.com/inscription/triathlon-2026/triathlon/1700025627600-3">Inscription</a>', 'https://club.example.fr/2027/');
    expect(scan.ticketing[0]?.mentions2027).toBe(false);
    expect(editionYear('https://www.klikego.com/inscription/triathlon-2026/triathlon/1-3')).toBe(2026);
    expect(editionYear('https://in.inscriptions-tiel.com/triathlon-sud-vendee-20261790260765381')).toBeNull();
    expect(editionYear('https://in.inscriptions-tiel.com/bikerun-des-iles-de-loire-20271791963694991')).toBeNull();
    expect(editionYear('https://www.klikego.com/inscription/x-2027/triathlon/1-9')).toBe(2027);
  });
  it('relève une annonce d’ouverture et des places complètes pour 2027', () => {
    const scan = scanPage('<p>Triathlon 2027 : ouverture des inscriptions le 1er décembre.</p><p>Format M : cette épreuve est complète pour l’édition 2027</p>', 'https://club.example.fr/');
    expect(scan.announcements[0]?.quote).toMatch(/ouverture des inscriptions le 1er décembre/);
    expect(scan.fullNotices[0]?.quote).toMatch(/complète pour l’édition 2027/);
  });
  it('ignore les annonces sans rapport avec 2027 et le menu de navigation', () => {
    const scan = scanPage('<nav><a href="/">Inscriptions à partir du 1er mars 2027</a></nav><p>Inscriptions à partir du 1er mars 2025.</p>', 'https://club.example.fr/');
    expect(scan.announcements).toEqual([]);
  });
  it('produit une empreinte stable', () => {
    const html = '<p>Inscriptions 2027 bientôt</p><script>var t = Math.random()</script>';
    expect(scanPage(html, 'https://a.fr/').hash).toBe(scanPage(html.replace('random', 'floor'), 'https://a.fr/').hash);
    expect(hashText('a')).not.toBe(hashText('b'));
  });
  it('reconnaît les billetteries et nettoie les adresses', () => {
    expect(isTicketing('https://www.klikego.com/inscription/course-2027/triathlon/1-1')).toBe(true);
    expect(isTicketing('https://www.ironman.com/races/im-les-sables-dolonne/register')).toBe(true);
    expect(isTicketing('https://www.ironman.com/races/im-les-sables-dolonne')).toBe(false);
    expect(isTicketing('https://www.klikego.com/resultats/course-2026/1')).toBe(false);
    expect(cleanUrl('javascript:alert(1)')).toBeNull();
    expect(cleanUrl('/inscription', 'https://club.fr/page')).toBe('https://club.fr/inscription');
  });
});

describe('propositions', () => {
  const group = (eventGroupId: string, over: Partial<GroupObservation> = {}): GroupObservation => ({
    eventGroupId, calendar: null, fftri: null, pages: [], keywords: groupKeywords(events.filter((e) => e.eventGroupId === eventGroupId)), ...over,
  });
  const nozay = events.filter((e) => e.eventGroupId === 'pdl-44-duathlon-nozeen');

  it('propose « ouvert » avec la billetterie quand une page dédiée publie un lien 2027', () => {
    const scan = scanPage('<h1>Duathlon 2027</h1><a href="https://www.klikego.com/inscription/duathlon-nozeen-2027/triathlon/1-9">S’inscrire</a>', 'https://duathlon.example.fr/');
    const { changes } = buildProposals(CHECKED_AT, events, [group('pdl-44-duathlon-nozeen', { pages: [{ page: page(scan.url), scan }] })], []);
    expect(changes).toHaveLength(nozay.length);
    expect(changes[0]?.patch).toMatchObject({ registrationStatus: 'ouvert', registrationUrl: 'https://www.klikego.com/inscription/duathlon-nozeen-2027/triathlon/1-9', officialUrl: 'https://duathlon.example.fr/' });
  });
  it('n’attribue pas à une épreuve le lien d’une autre épreuve du même club', () => {
    const scan = scanPage('<h2>Bike &amp; Run 2027</h2><a href="https://in.inscriptions-tiel.com/bikerun-2027">Inscriptions</a><p>…</p><h2>Triathlon de Vertou</h2><p>Rendez-vous les 24 et 25 avril 2027. Plus d’infos à venir.</p>', 'https://club.example.fr/');
    const { changes } = buildProposals(CHECKED_AT, events, [group('pdl-44-triathlon-de-vertou', { pages: [{ page: page(scan.url, 'club'), scan }] })], []);
    expect(changes).toEqual([]);
  });
  it('propose « annoncé » à partir d’une phrase d’annonce, sans billetterie', () => {
    const scan = scanPage('<p>Duathlon Nozéen 2027 : ouverture des inscriptions le 5 janvier.</p>', 'https://duathlon.example.fr/');
    const { changes } = buildProposals(CHECKED_AT, events, [group('pdl-44-duathlon-nozeen', { pages: [{ page: page(scan.url), scan }] })], []);
    expect(changes[0]?.patch.registrationStatus).toBe('annonce');
    expect(changes[0]?.patch.registrationEvidence).toContain('ouverture des inscriptions le 5 janvier');
  });
  it('propose « annulé » seulement sur l’indicateur structuré de la fiche FFTRI', () => {
    const url = 'https://fftri.t2area.com/calendrier/duathlon-nozeen.html';
    const cancelled = buildProposals(CHECKED_AT, events, [group('pdl-44-duathlon-nozeen', { fftri: parseFftriEvent(fftriHtml(true, ['2027-04-04']), url) })], []);
    expect(cancelled.changes.map((c) => c.patch.registrationStatus)).toEqual(['annule']);
    const live = buildProposals(CHECKED_AT, events, [group('pdl-44-duathlon-nozeen', { fftri: parseFftriEvent(fftriHtml(false, ['2027-04-04']), url) })], []);
    expect(live.changes).toEqual([]);
  });
  it('ne repropose rien pour une épreuve déjà ouverte', () => {
    const scan = scanPage('<h1>Triathlon 2027</h1><a href="https://www.timepulse.fr/inscription/2027">S’inscrire</a>', 'https://triathlon-larochesuryon.fr/');
    const { changes } = buildProposals(CHECKED_AT, events, [group('pdl-85-triathlon-de-la-roche-sur-yon', { pages: [{ page: page(scan.url), scan }] })], []);
    expect(changes).toEqual([]);
  });
  it('signale une date différente et une manifestation inconnue, sans rien proposer', () => {
    const calendar: CalendarEntry = { name: 'Duathlon Nozéen (44)', town: 'NOZAY', dates: ['2027-04-11'], department: '44', url: 'https://fftri.t2area.com/calendrier/n.html' };
    const unknown: CalendarEntry = { name: 'Aquathlon des Lacs (44)', town: 'BLAIN', dates: ['2027-05-08'], department: '44', url: 'https://fftri.t2area.com/calendrier/a.html' };
    const { changes, alerts } = buildProposals(CHECKED_AT, events, [group('pdl-44-duathlon-nozeen', { calendar })], [unknown]);
    expect(changes).toEqual([]);
    expect(alerts.map((a) => a.kind)).toEqual(['date_differente', 'manifestation_non_suivie']);
  });
  it('signale les formats complets en alerte, sans changer le statut', () => {
    const scan = scanPage('<p>Open S : cette épreuve est complète pour l’édition 2027</p>', 'https://triathlonsudvendee.fr/epreuve/open-distance-s/');
    const { changes, alerts } = buildProposals(CHECKED_AT, events, [group('pdl-85-triathlon-sud-vendee', { pages: [{ page: page(scan.url), scan }] })], []);
    expect(changes).toEqual([]);
    expect(alerts.map((a) => a.kind)).toEqual(['formats_complets']);
  });
  it('ignore les épreuves déjà passées', () => {
    const scan = scanPage('<h1>Bike 2027</h1><a href="https://www.klikego.com/inscription/x-2027/1">S’inscrire</a>', 'https://x.example.fr/');
    const { changes } = buildProposals('2027-12-01T08:00:00Z', events, [group('pdl-44-duathlon-nozeen', { pages: [{ page: page(scan.url), scan }] })], []);
    expect(changes).toEqual([]);
  });
});

describe('data/sources.json', () => {
  const groups = new Set(allEvents.map((e) => e.eventGroupId));
  it('ne référence que des groupes existants et des pages https hors réseaux sociaux', () => {
    for (const s of sourcesFile.sources) {
      expect(groups.has(s.eventGroupId), s.eventGroupId).toBe(true);
      for (const p of s.pages) {
        expect(p.url).toMatch(/^https:\/\//);
        expect(p.url).not.toMatch(/facebook|instagram/);
        expect(['epreuve', 'club']).toContain(p.scope);
        if (p.scope === 'club') expect(groupKeywords(allEvents.filter((e) => e.eventGroupId === s.eventGroupId), (s as { keywords?: string[] }).keywords ?? []).length).toBeGreaterThan(0);
      }
    }
  });
});
