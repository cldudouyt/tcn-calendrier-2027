import { describe, expect, it } from 'vitest';
import { events } from '../src/lib/events';
import type { RaceEvent } from '../src/lib/types';
import {
  assessReport, buildKnownHosts, explicitOpeningDate, isForbiddenHost, isKnownHost, normalizeReportUrl, reportDedupeKey,
  validateReport, type ReportInput,
} from '../worker/reports';

const byId = new Map(events.map((e) => [e.id, e]));
const nozay = byId.get('pdl-44-2027-04-04-duathlon-nozeen')!;
const sudVendee = byId.get('pdl-85-2027-09-26-triathlon-sud-vendee')!;
const withStatus = (e: RaceEvent, over: Partial<RaceEvent>): RaceEvent => ({ ...e, ...over });
const report = (e: RaceEvent, type: ReportInput['type'], url: string, format = ''): ReportInput => ({ eventId: e.id, type, format, url, host: new URL(url).hostname });
/** Page synthétique d'une longueur réaliste (le texte court est traité comme illisible). */
const page = (body: string): string => `<html><body><header>Club de triathlon</header><main>${body}</main><footer>${'Informations pratiques, parcours, règlement, bénévoles et partenaires. '.repeat(4)}</footer></body></html>`;

describe('adresse fournie par un membre', () => {
  it('accepte une page publique et retire les paramètres de suivi', () => {
    const r = normalizeReportUrl('https://www.Klikego.com/inscription/duathlon-nozeen-2027/triathlon/1-9/?utm_source=fb#top');
    expect(r).toEqual({ ok: true, url: 'https://www.klikego.com/inscription/duathlon-nozeen-2027/triathlon/1-9', host: 'www.klikego.com' });
  });
  it.each([
    ['http://localhost/admin'], ['https://127.0.0.1/'], ['https://10.0.0.5/page'], ['https://[::1]/'], ['https://intranet/'],
    ['https://printer.local/'], ['file:///etc/passwd'], ['javascript:alert(1)'], ['ftp://exemple.fr/x'],
    ['https://user:pass@exemple.fr/'], ['https://exemple.fr:8443/'], [`https://exemple.fr/${'a'.repeat(600)}`], [''], [42],
  ])('refuse %s', (raw) => {
    expect(normalizeReportUrl(raw).ok).toBe(false);
  });
  it('identifie les hôtes interdits', () => {
    expect(isForbiddenHost('169.254.169.254')).toBe(true);
    expect(isForbiddenHost('srv.internal')).toBe(true);
    expect(isForbiddenHost('www.klikego.com')).toBe(false);
  });
  it('ne lit automatiquement que des domaines connus', () => {
    const known = buildKnownHosts(events, ['https://www.triveloce.com/bike-and-run']);
    expect(isKnownHost('www.klikego.com', known)).toBe(true);
    expect(isKnownHost('triveloce.com', known)).toBe(true);
    expect(isKnownHost('triathlon-larochesuryon.fr', known)).toBe(true); // site officiel déjà publié
    expect(isKnownHost('site-inconnu.example', known)).toBe(false);
  });
});

describe('validation du formulaire', () => {
  it('n’accepte que les épreuves du référentiel, trois types et les formats de l’épreuve', () => {
    expect(validateReport({ eventId: nozay.id, type: 'complet', format: 'S', url: 'https://www.klikego.com/x-2027' }, byId).ok).toBe(true);
    expect(validateReport({ eventId: 'hr-10-2027-04-04', type: 'complet', url: 'https://a.fr/' }, byId).ok).toBe(false); // hors région
    expect(validateReport({ eventId: nozay.id, type: 'annule', url: 'https://a.fr/' }, byId).ok).toBe(false);
    expect(validateReport({ eventId: nozay.id, type: 'complet', format: 'XXL', url: 'https://a.fr/' }, byId).ok).toBe(false);
    expect(validateReport({ eventId: nozay.id, type: 'inscriptions_ouvertes', format: 'S', url: 'https://a.fr/' }, byId).ok).toBe(false);
    expect(validateReport({ eventId: nozay.id, type: 'complet', url: 'http://192.168.1.1/' }, byId).ok).toBe(false);
  });
  it('ne permet aucune modification de date, de format ou de lieu', () => {
    const r = validateReport({ eventId: nozay.id, type: 'inscriptions_ouvertes', url: 'https://a.fr/', date: '2027-05-01', town: 'Ailleurs', formats: 'XXL' }, byId);
    expect(r.ok && Object.keys(r.report).sort()).toEqual(['eventId', 'format', 'host', 'type', 'url']);
  });
  it('déduplique par épreuve, type, format et adresse normalisée', () => {
    const a = reportDedupeKey(nozay.id, 'complet', 'S', 'https://www.klikego.com/x');
    expect(reportDedupeKey(nozay.id, 'complet', 'S', 'http://klikego.com/x')).toBe(a);
    expect(reportDedupeKey(nozay.id, 'complet', 'M', 'https://www.klikego.com/x')).not.toBe(a);
    expect(reportDedupeKey(nozay.id, 'inscriptions_ouvertes', 'S', 'https://www.klikego.com/x')).not.toBe(a);
  });
});

describe('évaluation d’une page officielle', () => {
  const url2027 = 'https://www.klikego.com/inscription/duathlon-nozeen-2027/triathlon/1-9';

  it('confirme une ouverture explicite pour l’édition 2027 de la bonne épreuve', () => {
    const a = assessReport(nozay, report(nozay, 'inscriptions_ouvertes', url2027), page('<h1>Duathlon Nozéen 2027</h1><p>Dimanche 4 avril 2027 à Nozay</p><p>Inscriptions ouvertes jusqu’au 1er avril 2027.</p>'));
    expect(a.outcome).toBe('confirme');
    expect(a.patch).toMatchObject({ registrationStatus: 'ouvert', registrationUrl: url2027 });
  });
  it('refuse un simple bouton sans état de disponibilité', () => {
    const a = assessReport(nozay, report(nozay, 'inscriptions_ouvertes', url2027), page('<h1>Duathlon Nozéen 2027</h1><a href="#">S’inscrire</a>'));
    expect(a.outcome).toBe('a_verifier');
  });
  it('refuse une page de l’édition 2026', () => {
    const a = assessReport(nozay, report(nozay, 'inscriptions_ouvertes', 'https://www.klikego.com/inscription/duathlon-nozeen-2026/triathlon/1-8'), page('<h1>Duathlon Nozéen</h1><p>Inscriptions ouvertes</p><p>2027</p>'));
    expect(a.outcome).toBe('a_verifier');
    expect(a.reason).toContain('2026');
  });
  it('refuse une page sans 2027, une autre épreuve ou une autre date', () => {
    const neutral = 'https://duathlon.example.fr/inscriptions';
    expect(assessReport(nozay, report(nozay, 'inscriptions_ouvertes', neutral), page('<h1>Duathlon Nozéen</h1><p>Inscriptions ouvertes</p>')).outcome).toBe('a_verifier');
    expect(assessReport(nozay, report(nozay, 'inscriptions_ouvertes', neutral), page('<h1>Triathlon de Laval 2027</h1><p>Inscriptions ouvertes</p>')).reason).toMatch(/pas reconnue/);
    expect(assessReport(nozay, report(nozay, 'inscriptions_ouvertes', neutral), page('<h1>Duathlon Nozéen</h1><p>Dimanche 11 avril 2027</p><p>Inscriptions ouvertes</p>')).reason).toMatch(/dates 2027/);
  });
  it('signale une contradiction plutôt que de publier', () => {
    const a = assessReport(nozay, report(nozay, 'inscriptions_ouvertes', url2027), page('<h1>Duathlon Nozéen 2027</h1><p>Inscriptions ouvertes.</p><p>Format S : complet.</p>'));
    expect(a.outcome).toBe('a_verifier');
    const published = withStatus(nozay, { registrationStatus: 'complet' });
    expect(assessReport(published, report(published, 'inscriptions_ouvertes', url2027), page('<h1>Duathlon Nozéen 2027</h1><p>Inscriptions ouvertes.</p>')).outcome).toBe('a_verifier');
  });
  it('ne change rien quand l’information est déjà publiée', () => {
    const open = withStatus(nozay, { registrationStatus: 'ouvert' });
    expect(assessReport(open, report(open, 'inscriptions_ouvertes', url2027), page('<h1>Duathlon Nozéen 2027</h1><p>Inscriptions ouvertes.</p>')).outcome).toBe('sans_effet');
    expect(assessReport(open, report(open, 'ouverture_annoncee', url2027), page('<h1>Duathlon Nozéen 2027</h1><p>Ouverture des inscriptions le 1er décembre 2026.</p>')).outcome).toBe('sans_effet');
  });

  it('« complet » par format : met à jour ce seul format, jamais toute la manifestation', () => {
    const url = 'https://triathlonsudvendee.fr/epreuve/open-distance-s';
    const e = withStatus(sudVendee, { formatAvailability: [] });
    const a = assessReport(e, report(e, 'complet', url, 'S'), page('<h1>Triathlon Sud Vendée 2027</h1><p>Open distance S : cette épreuve est complète pour l’édition 2027</p><p>Dimanche 26 septembre 2027</p>'));
    expect(a.outcome).toBe('confirme');
    expect(a.patch?.registrationStatus).toBeUndefined();
    expect(a.patch?.formatAvailability).toEqual([expect.objectContaining({ format: 'S', status: 'complet', sourceUrl: url })]);
  });
  it('« complet » sans format sur une épreuve à plusieurs formats : à vérifier', () => {
    const a = assessReport(sudVendee, report(sudVendee, 'complet', 'https://triathlonsudvendee.fr/'), page('<h1>Triathlon Sud Vendée 2027</h1><p>Open S : complet</p><p>Dimanche 26 septembre 2027</p>'));
    expect(a.outcome).toBe('a_verifier');
  });
  it('« fermé » n’est pas « complet »', () => {
    const a = assessReport(nozay, report(nozay, 'complet', url2027), page('<h1>Duathlon Nozéen 2027</h1><p>Les inscriptions sont fermées.</p>'));
    expect(a.outcome).toBe('a_verifier');
    expect(a.reason).toMatch(/Fermé/);
  });
  it('« complet » pour toute l’épreuve quand la page le dit explicitement', () => {
    const a = assessReport(nozay, report(nozay, 'complet', url2027), page('<h1>Duathlon Nozéen 2027</h1><p>Toutes les épreuves sont complètes.</p>'));
    expect(a.outcome).toBe('confirme');
    expect(a.patch?.registrationStatus).toBe('complet');
  });

  it('ouverture annoncée : date reprise seulement si elle est écrite en entier', () => {
    const withDate = assessReport(nozay, report(nozay, 'ouverture_annoncee', 'https://duathlon.example.fr/2027'), page('<h1>Duathlon Nozéen 2027</h1><p>Ouverture des inscriptions le 1er décembre 2026 à 20 h.</p>'));
    expect(withDate.outcome).toBe('confirme');
    expect(withDate.patch).toMatchObject({ registrationStatus: 'annonce', registrationOpenAt: '2026-12-01' });
    const vague = assessReport(nozay, report(nozay, 'ouverture_annoncee', 'https://duathlon.example.fr/2027'), page('<h1>Duathlon Nozéen 2027</h1><p>Ouverture des inscriptions en décembre.</p>'));
    expect(vague.patch?.registrationOpenAt).toBeUndefined();
    expect(explicitOpeningDate('à partir du 15/01/2027')).toBe('2027-01-15');
    expect(explicitOpeningDate('à partir du 15 janvier')).toBeNull();
  });
  it('traite une page dynamique illisible comme « à vérifier »', () => {
    expect(assessReport(nozay, report(nozay, 'inscriptions_ouvertes', url2027), '<html><body><div id="app"></div></body></html>').outcome).toBe('a_verifier');
  });
});
