import { describe, expect, it } from 'vitest';
import { events } from '../src/lib/events';
import { announcedOpening, statusDisplay } from '../src/lib/status';
import { validateChange } from '../worker/lib';

const byId = new Map(events.map((e) => [e.id, e]));
const angers = byId.get('pdl-49-2027-05-16-triathlon-dangers')!;
const noirmoutier = byId.get('pdl-85-2027-06-06-triathlon-de-noirmoutier')!;

describe('ouverture annoncée', () => {
  it('affiche la période sourcée dans le statut (relevés publiés)', () => {
    expect(statusDisplay(angers).label).toBe('Ouverture annoncée\u00a0: décembre 2026');
    expect(statusDisplay(angers).description).toMatch(/jour non précisé/);
    expect(statusDisplay(noirmoutier).label).toBe('Ouverture annoncée\u00a0: dans le courant de 2027');
  });
  it('préfère un jour exact, au format français', () => {
    const e = { ...angers, registrationOpenAt: '2026-12-01' };
    expect(announcedOpening(e)).toEqual({ text: '1 décembre 2026', exact: true });
    expect(statusDisplay(e).label).toBe('Ouverture le 1 décembre 2026');
  });
  it('ne montre aucune date quand le statut n’est pas « annoncé » ou n’est pas sourcé', () => {
    expect(statusDisplay({ ...angers, registrationStatus: 'ouvert', registrationUrl: 'https://x.fr/2027' }).label).toBe('Inscriptions ouvertes');
    expect(statusDisplay({ ...angers, registrationEvidence: null }).label).toBe('Inscriptions non vérifiées');
    expect(statusDisplay({ ...angers, registrationOpenWindow: null }).label).toBe('Ouverture annoncée');
  });
  it('valide la période reçue par l’admin ou la veille', () => {
    const base = { eventId: angers.id, checkedAt: '2026-11-14T10:00:00Z', summary: 'Ouverture annoncée' };
    expect(validateChange({ ...base, patch: { registrationOpenWindow: 'décembre 2026' } }, byId).ok).toBe(true);
    expect(validateChange({ ...base, patch: { registrationOpenWindow: '' } }, byId).ok).toBe(false);
    expect(validateChange({ ...base, patch: { registrationOpenWindow: 'x'.repeat(81) } }, byId).ok).toBe(false);
  });
});
