import { describe, expect, it, vi } from 'vitest';
import { events } from '../src/lib/events';
import { effectiveStatus } from '../src/lib/status';
import { applyPatch, isInFuture, checkBearer, dedupeKey, isNoop, isWeeklySlot, mergeOverrides, validateChange } from '../worker/lib';

const base = new Map(events.map((e) => [e.id, e]));
const id = events[0]!.id;
const change = (patch: Record<string, unknown>, over: Record<string, unknown> = {}) => ({ eventId: id, checkedAt: '2026-11-13T09:00:00+01:00', summary: 'Relevé de test', patch, ...over });

describe('planification du lundi 08:30 Europe/Paris', () => {
  it('retient 07:30 UTC en hiver et 06:30 UTC en été', () => {
    expect(isWeeklySlot(new Date('2027-01-04T07:30:00Z'))).toBe(true);  // lundi, heure d’hiver
    expect(isWeeklySlot(new Date('2027-01-04T06:30:00Z'))).toBe(false);
    expect(isWeeklySlot(new Date('2027-07-05T06:30:00Z'))).toBe(true);  // lundi, heure d’été
    expect(isWeeklySlot(new Date('2027-07-05T07:30:00Z'))).toBe(false);
  });
  it('gère les semaines de changement d’heure', () => {
    expect(isWeeklySlot(new Date('2027-03-29T06:30:00Z'))).toBe(true);  // lendemain du passage à l’heure d’été
    expect(isWeeklySlot(new Date('2027-11-01T07:30:00Z'))).toBe(true);  // lendemain du retour à l’heure d’hiver
  });
  it('ignore les autres jours', () => {
    expect(isWeeklySlot(new Date('2027-01-05T07:30:00Z'))).toBe(false);
  });
  it('se déclenche exactement une fois par lundi sur toute la saison', () => {
    for (let d = new Date('2026-11-16T00:00:00Z'); d < new Date('2027-12-01T00:00:00Z'); d.setUTCDate(d.getUTCDate() + 7)) {
      const day = d.toISOString().slice(0, 10);
      const fired = ['06:30', '07:30'].filter((t) => isWeeklySlot(new Date(`${day}T${t}:00Z`)));
      expect(fired, day).toHaveLength(1);
    }
  });
});

describe('validation des changements importés', () => {
  it('refuse « ouvert » sans preuve ni lien officiel', () => {
    const r = validateChange(change({ registrationStatus: 'ouvert' }), base);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(' ')).toMatch(/registrationEvidence.*lien officiel|lien officiel/);
  });
  it('refuse « fermé » faute de page d’inscription', () => {
    expect(validateChange(change({ registrationStatus: 'ferme' }), base).ok).toBe(false);
  });
  it('accepte « ouvert » avec fait vérifié et lien https', () => {
    const r = validateChange(change({ registrationStatus: 'ouvert', registrationEvidence: 'Bouton « S’inscrire » actif', registrationUrl: 'https://exemple.org/inscription' }), base);
    expect(r.ok).toBe(true);
    if (r.ok) { expect(r.change.category).toBe('ouvert_confirme'); expect(r.change.sourceUrl).toBe('https://exemple.org/inscription'); }
  });
  it('refuse les URL non https, les champs inconnus, les épreuves inconnues et les dates futures', () => {
    expect(validateChange(change({ officialUrl: 'http://exemple.org' }), base).ok).toBe(false);
    expect(validateChange(change({ name: 'Autre nom' }), base).ok).toBe(false);
    expect(validateChange(change({ officialUrl: 'https://exemple.org' }, { eventId: 'inconnu' }), base).ok).toBe(false);
    expect(validateChange(change({ officialUrl: 'https://exemple.org' }, { checkedAt: '2999-01-01T00:00:00Z' }), base).ok).toBe(false);
  });
  it('refuse un prix sans source et classe une modification de date', () => {
    expect(validateChange(change({ price: 45 }), base).ok).toBe(false);
    const r = validateChange(change({ date: '2026-11-22' }), base);
    expect(r.ok && r.change.category).toBe('modification');
    expect(validateChange(change({ date: '2027-02-30' }), base).ok).toBe(false);
  });
});

describe('déduplication et fusion', () => {
  it('donne la même clé au même contenu, quel que soit l’ordre des champs', async () => {
    const a = await dedupeKey(id, { officialUrl: 'https://a.example', registrationStatus: 'annonce' });
    const b = await dedupeKey(id, { registrationStatus: 'annonce', officialUrl: 'https://a.example' });
    expect(a).toBe(b);
    expect(await dedupeKey(id, { officialUrl: 'https://b.example' })).not.toBe(a);
    expect(await dedupeKey(events[1]!.id, { officialUrl: 'https://a.example', registrationStatus: 'annonce' })).not.toBe(a);
  });
  it('détecte un changement sans effet', () => {
    expect(isNoop(events[0]!, { registrationStatus: 'non_verifie' })).toBe(true);
    expect(isNoop(events[0]!, { officialUrl: 'https://a.example' })).toBe(false);
  });
  it('fusionne les changements publiés sans perdre d’entrée', () => {
    const merged = mergeOverrides(events, new Map([[id, { registrationStatus: 'ouvert' as const, registrationEvidence: 'vu', registrationUrl: 'https://exemple.org', lastCheckedAt: '2026-11-16T08:30:00+01:00' }]]));
    expect(merged).toHaveLength(78);
    expect(effectiveStatus(merged[0]!)).toBe('ouvert');
    expect(effectiveStatus(merged[1]!)).toBe('non_verifie');
  });
  it('gère un statut contradictoire : le dernier changement validé l’emporte, avec sa preuve', () => {
    const open = applyPatch(events[0]!, { registrationStatus: 'ouvert', registrationEvidence: 'ouvert', registrationUrl: 'https://exemple.org' }, { lastCheckedAt: '2026-11-16', changedAt: '2026-11-16' });
    const full = applyPatch(open, { registrationStatus: 'complet', registrationEvidence: 'Mention « complet » sur la page' }, { lastCheckedAt: '2026-11-23', changedAt: '2026-11-23' });
    expect(effectiveStatus(full)).toBe('complet');
    // Sans preuve conservée, le statut retombe sur « non vérifié » plutôt que d’affirmer.
    expect(effectiveStatus({ ...full, registrationEvidence: null })).toBe('non_verifie');
  });
});

describe('accès administrateur', () => {
  const token = 'un-jeton-de-test-assez-long';
  it('exige le bon jeton', () => {
    expect(checkBearer(`Bearer ${token}`, token)).toBe(true);
    expect(checkBearer(`Bearer ${token}x`, token)).toBe(false);
    expect(checkBearer('Bearer autre-jeton-de-test-long', token)).toBe(false);
    expect(checkBearer(null, token)).toBe(false);
    expect(checkBearer(`Bearer ${token}`, undefined)).toBe(false);
    expect(checkBearer('Bearer court', 'court')).toBe(false);
  });
});

describe('chargement dans le Worker Cloudflare', () => {
  it('ne rejette pas les relevés quand l’horloge est figée à 0 (hors requête)', async () => {
    expect(isInFuture('2026-11-13T22:44:00+01:00', 0)).toBe(false);
    expect(isInFuture('2999-01-01T00:00:00Z', Date.parse('2026-11-13T00:00:00Z'))).toBe(true);
    vi.useFakeTimers();
    vi.setSystemTime(0);
    vi.resetModules();
    try {
      const mod = await import('../src/lib/registration-surveys');
      expect(mod.eventsWithRegistrations).toHaveLength(78);
    } finally {
      vi.useRealTimers();
    }
  });
});
