import { describe, expect, it } from 'vitest';
import { computeKpis, events, toFilterable } from '../src/lib/events';
import { applyFilters, countLabel, emptyFilters, parseFilters, serializeFilters, activeFilterCount } from '../src/lib/filters';
import { buildIcs } from '../src/lib/ics';
import { formatDay, formatParis, listMonths, normalizeText, parisToday } from '../src/lib/format';

const all = events.map(toFilterable);
const f = (over: Partial<ReturnType<typeof emptyFilters>>) => ({ ...emptyFilters(), ...over });

describe('filtres', () => {
  it('sans filtre, retourne les 78 rendez-vous', () => {
    expect(applyFilters(all, emptyFilters())).toHaveLength(78);
  });
  it('filtre par département', () => {
    expect(applyFilters(all, f({ dep: ['44'] }))).toHaveLength(20);
    expect(applyFilters(all, f({ dep: ['49', '53'] }))).toHaveLength(25);
  });
  it('cumule les critères (ET) et les valeurs (OU)', () => {
    const r = applyFilters(all, f({ dep: ['44'], kind: ['Bike & Run'] }));
    expect(r.length).toBe(4);
    expect(r.every((e) => e.department === '44' && e.kind === 'Bike & Run')).toBe(true);
    expect(applyFilters(all, f({ dep: ['44'], kind: ['Endurathlon'] }))).toHaveLength(0);
  });
  it('filtre par format, mois et accès', () => {
    expect(applyFilters(all, f({ format: ['XXL'] })).map((e) => e.name)).toEqual(['IRONMAN Les Sables-d’Olonne']);
    expect(applyFilters(all, f({ month: ['2027-06'] }))).toHaveLength(19);
    expect(applyFilters(all, f({ access: ['direct'] }))).toHaveLength(31);
    expect(applyFilters(all, f({ access: ['inconnu'] }))).toHaveLength(12);
    expect(applyFilters(all, f({ access: ['correspondance'] }))).toHaveLength(35);
    expect(applyFilters(all, f({ access: ['velo'] }))).toHaveLength(0);
  });
  it('filtre par statut sans jamais inventer de statut', () => {
    const { byStatus } = computeKpis(events);
    for (const status of ['non_verifie', 'ouvert', 'ferme'] as const) {
      expect(applyFilters(all, f({ status: [status] }))).toHaveLength(byStatus[status]);
    }
  });
  it('recherche par nom et commune, sans accents ni casse', () => {
    expect(applyFilters(all, f({ q: 'coueron' })).map((e) => e.name)).toEqual(['Duathlon de Couëron']);
    expect(applyFilters(all, f({ q: 'ILES de loire' }))).toHaveLength(1);
    expect(applyFilters(all, f({ q: 'sables d\'olonne' })).length).toBeGreaterThan(3);
    expect(applyFilters(all, f({ q: 'vertou' }))).toHaveLength(2);
  });
  it('sérialise et relit une URL partageable', () => {
    const filters = f({ q: 'tri', dep: ['44', '85'], month: ['2027-06'] });
    const qs = serializeFilters(filters).toString();
    expect(parseFilters(new URLSearchParams(qs))).toEqual(filters);
    expect(activeFilterCount(filters)).toBe(4);
    expect(parseFilters(new URLSearchParams('dep=44&dep=49'))).toEqual(f({ dep: ['44', '49'] }));
  });
});

describe('formats', () => {
  it('affiche les dates en français', () => {
    expect(formatDay('2027-06-27')).toBe('dimanche 27 juin 2027');
    expect(formatDay('2026-11-15')).toBe('dimanche 15 novembre 2026');
  });
  it('affiche les horodatages à l’heure de Paris, été comme hiver', () => {
    expect(formatParis('2027-01-04T07:30:00Z')).toContain('08:30');
    expect(formatParis('2027-07-05T06:30:00Z')).toContain('08:30');
  });
  it('liste les 13 mois de la saison', () => {
    expect(listMonths('2026-11', '2027-11')).toHaveLength(13);
  });
  it('normalise la recherche', () => {
    expect(normalizeText('L’Épine–Île')).toBe('l epine ile');
  });
});

describe('export .ics', () => {
  it('produit un évènement par rendez-vous, sur la journée entière', () => {
    const ics = buildIcs(events.map((e) => ({ id: e.id, date: e.date, name: e.name, town: e.town, formats: e.formats, url: `https://exemple.org/epreuves/${e.id}/` })), new Date('2026-11-13T12:00:00Z'));
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(78);
    expect(ics).toContain('DTSTART;VALUE=DATE:20270627');
    expect(ics).toContain('DTEND;VALUE=DATE:20270628');
    expect(ics.split('\r\n').every((l) => l.length <= 75)).toBe(true);
  });
});

describe('épreuves passées', () => {
  it('les masque à partir du lendemain de leur date, sauf demande explicite', () => {
    const day = '2026-11-15';
    const shown = applyFilters(all, f({ today: day }));
    expect(shown.every((e) => e.date >= day)).toBe(true);
    expect(shown.length).toBe(all.filter((e) => e.date >= day).length);
    expect(shown.some((e) => e.date === day)).toBe(true);
    expect(applyFilters(all, f({ today: day, past: true }))).toHaveLength(78);
    expect(applyFilters(all, f({ today: '' }))).toHaveLength(78);
  });
  it('mémorise le choix dans l’URL partageable, jamais la date du jour', () => {
    const qs = serializeFilters(f({ past: true, today: '2027-01-01' })).toString();
    expect(qs).toBe('passees=1');
    expect(parseFilters(new URLSearchParams(qs)).past).toBe(true);
    expect(parseFilters(new URLSearchParams('')).past).toBe(false);
  });
  it('libelle le compteur selon le mode', () => {
    const day = '2027-06-01';
    const upcoming = all.filter((e) => e.date >= day).length;
    expect(countLabel(upcoming, f({ today: day }), all)).toBe('rendez-vous à venir');
    expect(countLabel(3, f({ today: day }), all)).toBe(`rendez-vous à venir sur ${upcoming}`);
    expect(countLabel(78, f({ today: day, past: true }), all)).toBe('rendez-vous régionaux');
  });
  it('donne la date du jour à Paris, y compris autour de minuit', () => {
    expect(parisToday(new Date('2026-11-14T23:30:00Z'))).toBe('2026-11-15');
    expect(parisToday(new Date('2027-07-01T21:59:00Z'))).toBe('2027-07-01');
    expect(parisToday(new Date('2027-07-01T22:01:00Z'))).toBe('2027-07-02');
  });
});
