import type { RaceEvent, TransportCode } from './types';

export type AccessCategory = 'direct' | 'correspondance' | 'velo' | 'inconnu';

export const TRANSPORT_META: Record<TransportCode, { label: string; short: string; category: Exclude<AccessCategory, 'velo'> }> = {
  D: { label: 'Train direct jusqu’à la commune', short: 'Train direct', category: 'direct' },
  C: { label: 'Train avec correspondance', short: 'Train + correspondance', category: 'correspondance' },
  M: { label: 'Train puis autre mode ou trajet vers une autre commune', short: 'Train + autre mode', category: 'correspondance' },
  B: { label: 'Car direct depuis Nantes', short: 'Car direct', category: 'correspondance' },
  L: { label: 'Transports urbains ou locaux depuis Nantes', short: 'Transports locaux', category: 'correspondance' },
  '?': { label: 'Itinéraire à préciser', short: 'Itinéraire à préciser', category: 'inconnu' },
};

export const ACCESS_LABEL: Record<AccessCategory, string> = {
  direct: 'Train direct',
  correspondance: 'Transport public possible (correspondance, car ou réseau local)',
  velo: 'Avec vélo (règle confirmée)',
  inconnu: 'Accès inconnu',
};

/** « Vélo autorisé » uniquement après confirmation de la règle applicable à la date. */
export const bikeConfirmed = (e: Pick<RaceEvent, 'transportBikePolicy'>): boolean =>
  e.transportBikePolicy !== null && e.transportBikePolicy.confirmedForDate === true;

export function accessCategories(e: Pick<RaceEvent, 'transport' | 'transportBikePolicy'>): AccessCategory[] {
  const cats: AccessCategory[] = [TRANSPORT_META[e.transport].category];
  if (bikeConfirmed(e)) cats.push('velo');
  return cats;
}

export interface OperatorLink { label: string; url: string }

const BASE_LINKS: OperatorLink[] = [
  { label: 'SNCF Connect — recherche d’itinéraire', url: 'https://www.sncf-connect.com/' },
  { label: 'TER Pays de la Loire', url: 'https://www.ter.sncf.com/pays-de-la-loire' },
  { label: 'Aléop — cars régionaux', url: 'https://aleop.paysdelaloire.fr/' },
];
const CONTEXT_LINKS: { pattern: RegExp; link: OperatorLink }[] = [
  { pattern: /naolib|tram/i, link: { label: 'Naolib — réseau nantais', url: 'https://naolib.fr/' } },
  { pattern: /irigo/i, link: { label: 'Irigo — réseau d’Angers', url: 'https://www.irigo.fr/' } },
  { pattern: /stran/i, link: { label: 'STRAN — réseau de Saint-Nazaire', url: 'https://www.stran.fr/' } },
];

/** Liens de comparaison : opérateurs cités dans l'itinéraire indicatif, sans horaires inventés. */
export function operatorLinks(e: Pick<RaceEvent, 'journey' | 'lastMile' | 'transport'>): OperatorLink[] {
  const text = `${e.journey} ${e.lastMile}`;
  const extra = CONTEXT_LINKS.filter((c) => c.pattern.test(text) || (e.transport === 'L' && /naolib/i.test(c.link.label))).map((c) => c.link);
  return [...BASE_LINKS, ...extra];
}

/** Mention générale du PDF (p. 16 à 20) : information datée, à confirmer pour chaque trajet. */
export const BIKE_GENERAL_NOTE =
  'D’après le PDF du 13 novembre 2026 : SNCF annonce le retour de la réservation vélo sur les TER Aléop de mai à septembre 2027. Vérifier le train ou le car choisi.';
