import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import raw from '../data.json';
import { events, outOfRegion, surveys, computeKpis, groupByWeekend, weekendKey } from '../src/lib/events';
import { EXPECTED_BY_DEPARTMENT, EXPECTED_TOTAL, validateDataset, validateEvent } from '../src/lib/schema';
import { effectiveStatus, verifiedRegistrationUrl } from '../src/lib/status';
import { accessCategories, bikeConfirmed } from '../src/lib/transport';
import type { RaceEvent } from '../src/lib/types';

const sample = (over: Partial<RaceEvent> = {}): RaceEvent => ({ ...events[0]!, ...over });

describe('data.json', () => {
  it('est conforme au schéma', () => {
    expect(validateDataset(raw).errors).toEqual([]);
  });
  it('contient 78 rendez-vous répartis 20/10/15/13/20', () => {
    expect(events).toHaveLength(EXPECTED_TOTAL);
    const counts: Record<string, number> = {};
    for (const e of events) counts[e.department] = (counts[e.department] ?? 0) + 1;
    expect(counts).toEqual(EXPECTED_BY_DEPARTMENT);
  });
  it('a des identifiants uniques et stables, indépendants du tri', () => {
    expect(new Set(events.map((e) => e.id)).size).toBe(78);
    for (const e of events) expect(e.id).toMatch(/^pdl-(44|49|53|72|85)-\d{4}-\d{2}-\d{2}-[a-z0-9-]+$/);
  });
  it('conserve la distinction 2026 / 2027 et couvre novembre 2026 → novembre 2027', () => {
    expect(events.filter((e) => e.date.startsWith('2026')).length).toBe(3);
    expect(events[0]!.date).toBe('2026-11-08');
    expect(events.at(-1)!.date).toBe('2027-11-14');
  });
  it('est trié par date puis nom', () => {
    const sorted = [...events].sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name, 'fr'));
    expect(events.map((e) => e.id)).toEqual(sorted.map((e) => e.id));
  });
  it('conserve les noms accentués', () => {
    const names = events.map((e) => e.name);
    expect(names).toContain('Duathlon Nozéen');
    expect(names).toContain('Bike & Run des Îles de Loire');
    expect(names).toContain('Duathlon de Couëron');
  });
  it('garde les journées d’un même week-end comme entrées distinctes, reliées par eventGroupId', () => {
    const baule = events.filter((e) => e.eventGroupId === 'pdl-44-triathlon-audencia-la-baule');
    expect(baule.map((e) => e.date)).toEqual(['2027-09-25', '2027-09-26']);
  });
  it('signale les trois points de contrôle du PDF', () => {
    for (const id of ['pdl-85-2027-03-28-duathlon-de-lagglomeration-des-sables-dolonne', 'pdl-85-2027-05-29-swimrun-de-xanton', 'pdl-44-2027-10-17-triathlon-de-nantes']) {
      expect(events.find((e) => e.id === id)!.notes.length).toBeGreaterThan(0);
    }
  });
  it('stocke les coordonnées en [latitude, longitude] et comme positions indicatives', () => {
    const located = events.filter((e) => e.coords);
    expect(located.length).toBe(77);
    for (const e of located) {
      expect(e.coords![0]).toBeGreaterThan(46);
      expect(e.coords![0]).toBeLessThan(48.6);
      expect(e.coords![1]).toBeLessThan(1);
      expect(e.locationAccuracy).toBe('centre_commune');
      expect(e.raceStartLatLon).toBeNull();
    }
  });
  it('n’invente ni prix, ni lien, ni statut, ni règle vélo', () => {
    for (const e of events) {
      expect(e.price).toBeNull();
      expect(e.registrationUrl).toBeNull();
      expect(effectiveStatus(e)).toBe('non_verifie');
      expect(bikeConfirmed(e)).toBe(false);
      expect(accessCategories(e)).not.toContain('velo');
    }
  });
  it('garde les 11 rendez-vous hors région séparés', () => {
    expect(outOfRegion).toHaveLength(11);
    const ids = new Set(events.map((e) => e.id));
    for (const o of outOfRegion) {
      expect(ids.has(o.id)).toBe(false);
      expect(['44', '49', '53', '72', '85']).not.toContain(o.department);
    }
  });
  it('a un relevé de veille daté', () => {
    expect(surveys.length).toBeGreaterThan(0);
    expect(Number.isNaN(Date.parse(surveys[0]!.checkedAt))).toBe(false);
  });
});

describe('statuts', () => {
  it('calcule les indicateurs depuis les données', () => {
    const k = computeKpis(events);
    expect(k.total).toBe(78);
    expect(k.open + k.announced + k.toConfirm + k.byStatus.complet + k.byStatus.ferme + k.byStatus.annule).toBe(78);
    const withOpen = [sample({ registrationStatus: 'ouvert', registrationEvidence: 'Page d’inscription en ligne', lastCheckedAt: '2026-11-16T08:30:00+01:00', registrationUrl: 'https://exemple.org/inscription' }), ...events.slice(1)];
    expect(computeKpis(withOpen).open).toBe(1);
  });
  it('n’affiche « ouvert » que si une source officielle l’atteste', () => {
    expect(effectiveStatus(sample({ registrationStatus: 'ouvert' }))).toBe('non_verifie');
    expect(effectiveStatus(sample({ registrationStatus: 'ouvert', registrationEvidence: 'vu', lastCheckedAt: '2026-11-16', registrationUrl: 'http://non-securise.example' }))).toBe('non_verifie');
    const ok = sample({ registrationStatus: 'ouvert', registrationEvidence: 'vu', lastCheckedAt: '2026-11-16', registrationUrl: 'https://exemple.org' });
    expect(effectiveStatus(ok)).toBe('ouvert');
    expect(verifiedRegistrationUrl(ok)).toBe('https://exemple.org');
  });
  it('ne conclut jamais « fermé » sans preuve', () => {
    expect(effectiveStatus(sample({ registrationStatus: 'ferme' }))).toBe('non_verifie');
    expect(validateEvent(sample({ registrationStatus: 'ferme' })).length).toBeGreaterThan(0);
  });
  it('refuse des coordonnées au format GeoJSON [longitude, latitude]', () => {
    expect(validateEvent(sample({ coords: [-1.55, 47.2] })).join(' ')).toContain('latitude');
  });
});

describe('regroupement par week-end', () => {
  it('rassemble vendredi, samedi et dimanche sans fusionner les entrées', () => {
    expect(weekendKey('2027-06-05')).toBe('2027-06-05');
    expect(weekendKey('2027-06-06')).toBe('2027-06-05');
    expect(weekendKey('2027-06-25')).toBe('2027-06-26'); // vendredi
    expect(weekendKey('2027-06-16')).toBe('2027-06-16'); // mercredi
    const groups = groupByWeekend(events);
    expect(groups.reduce((n, g) => n + g.events.length, 0)).toBe(78);
    const june5 = groups.find((g) => g.key === '2027-06-05')!;
    expect(june5.events.length).toBeGreaterThan(2);
    expect(june5.label).toContain('Week-end');
  });
});

describe('charte graphique', () => {
  const css = readFileSync(new URL('../src/styles/tokens.css', import.meta.url), 'utf8').toLowerCase();
  it('reprend les valeurs source du site Quiberon', () => {
    for (const [token, value] of Object.entries({ '--orange': '#e9530e', '--orange-deep': '#d64000', '--ink': '#1c1e22', '--paper': '#f4f3f0', '--orange-deeper': '#b83a00', '--success': '#176039', '--warning': '#7a5800' })) {
      expect(css).toContain(`${token}: ${value}`);
    }
    for (const font of ['anton', 'barlow semi condensed', "'barlow'"]) expect(css).toContain(font);
  });
  it('ne disperse aucune couleur hexadécimale hors des jetons', () => {
    const files = ['../src/styles/global.css', '../src/components/EventCard.astro', '../src/components/Filters.astro', '../src/layouts/Base.astro', '../src/pages/index.astro', '../src/pages/calendrier.astro', '../src/pages/carte.astro', '../src/pages/epreuves/[slug].astro', '../src/pages/veille/index.astro', '../src/client/map.ts'];
    for (const f of files) expect(readFileSync(new URL(f, import.meta.url), 'utf8'), f).not.toMatch(/#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b(?![0-9a-zA-Z-])/);
  });
  // Contraste WCAG AA (4,5:1) des couples texte/fond utilisés.
  const hex = (name: string): string => new RegExp(`--${name}: (#[0-9a-f]{6})`).exec(css)![1]!;
  const lum = (h: string): number => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)) as [number, number, number];
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const ratio = (a: string, b: string): number => { const [x, y] = [lum(hex(a)), lum(hex(b))].sort((p, q) => q - p) as [number, number]; return (x + 0.05) / (y + 0.05); };
  it.each([
    ['ink', 'paper'], ['body', 'paper'], ['muted', 'white'], ['muted', 'sunk'], ['orange-deeper', 'white'], ['orange-deeper', 'paper'],
    ['white', 'orange-deep'], ['white', 'ink'], ['success', 'success-bg'], ['warning', 'warning-bg'],
    ['white', 'dep-44'], ['white', 'dep-49'], ['white', 'dep-53'], ['white', 'dep-72'], ['white', 'dep-85'],
  ])('contraste %s sur %s ≥ 4,5', (fg, bg) => {
    expect(ratio(fg, bg)).toBeGreaterThanOrEqual(4.5);
  });
});
