import type { RaceEvent, TransportCode } from './types';

export type AccessCategory = 'direct' | 'correspondance' | 'velo' | 'inconnu';

/**
 * label : définition courte (légendes) ; short : étiquette des cartes d'épreuve ;
 * summary : phrase de réponse affichée en tête de la rubrique transport de la fiche.
 */
export const TRANSPORT_META: Record<TransportCode, { label: string; short: string; summary: string; category: Exclude<AccessCategory, 'velo'> }> = {
  D: { label: 'Train direct jusqu’à la commune', short: 'Train direct', summary: 'Un train relie Nantes à la commune, sans changement.', category: 'direct' },
  C: { label: 'Train avec un changement en route', short: 'Train avec changement', summary: 'Train depuis Nantes, avec un changement en route.', category: 'correspondance' },
  M: { label: 'Train jusqu’à une autre gare, puis bus, car ou vélo', short: 'Train puis bus ou vélo', summary: 'Pas de gare dans la commune : train jusqu’à une gare voisine, puis bus, car ou vélo.', category: 'correspondance' },
  B: { label: 'Car régional direct depuis Nantes', short: 'Car direct', summary: 'Un car régional relie Nantes à la commune.', category: 'correspondance' },
  L: { label: 'Tram, bus ou vélo depuis la gare de Nantes', short: 'Tram, bus ou vélo', summary: 'Proche de Nantes : tram, bus ou vélo depuis la gare.', category: 'correspondance' },
  '?': { label: 'Aucun itinéraire établi', short: 'Accès à préciser', summary: 'Aucun itinéraire en transports en commun n’est établi : trajet à préparer soi-même.', category: 'inconnu' },
};

export const ACCESS_LABEL: Record<AccessCategory, string> = {
  direct: 'Train direct vers la commune',
  correspondance: 'Train avec correspondance, car ou transport local',
  velo: 'Vélo accepté à bord (confirmé)',
  inconnu: 'Trajet pas encore précisé',
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
  { label: 'Calculer mon trajet (SNCF Connect)', url: 'https://www.sncf-connect.com/' },
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

/** Points que la fiche ne peut pas garantir : à vérifier pour la date du déplacement. */
export const TRAVEL_CHECKLIST = [
  'un horaire aller qui arrive avant le départ de la course ;',
  'le dernier retour possible le jour même ;',
  'le lieu exact du départ (la fin de trajet en dépend) ;',
  'les règles d’emport du vélo pour le train ou le car choisi.',
] as const;

/** Période de réservation vélo annoncée pour les TER Aléop (PDF du 13 novembre 2026, p. 16 à 20). */
const BIKE_BOOKING = { from: '2027-05-01', to: '2027-09-30' };

/**
 * Conseil vélo propre à l'épreuve, sans rien affirmer qui ne soit sourcé :
 * règle confirmée si elle existe, sinon ce que le PDF annonce et ce qu'il reste à vérifier.
 */
export function bikeAdvice(e: Pick<RaceEvent, 'transport' | 'journey' | 'lastMile' | 'date' | 'transportBikePolicy'>): { text: string; confirmed: boolean } {
  if (bikeConfirmed(e) && e.transportBikePolicy) return { text: e.transportBikePolicy.summary, confirmed: true };
  const route = `${e.journey} ${e.lastMile}`;
  const byTrain = ['D', 'C', 'M'].includes(e.transport) || /\b(TER|train|TGV)\b/i.test(route);
  const mentionsBike = /vélo/i.test(route);
  const parts: string[] = [];
  if (byTrain) {
    parts.push(e.date >= BIKE_BOOKING.from && e.date <= BIKE_BOOKING.to
      ? 'En train : SNCF annonce la réservation des places vélo dans les TER Aléop de mai à septembre 2027, ce qui concerne cette date. Vérifiez s’il faut réserver pour votre train.'
      : 'En train : vérifiez les règles d’emport du vélo pour votre TER à cette date.');
  }
  if (e.transport === 'B' || /\b(car|Aléop)\b/i.test(route)) parts.push('En car : la possibilité d’emporter un vélo est à vérifier auprès d’Aléop.');
  if (e.transport === 'L') parts.push('Tram et bus : règles vélo à vérifier auprès de l’exploitant.');
  if (mentionsBike) parts.push('L’itinéraire indicatif propose aussi le vélo pour la fin du trajet.');
  if (e.transport === '?') parts.push('Aucun itinéraire établi : l’emport du vélo dépendra du trajet choisi.');
  return { text: parts.join(' '), confirmed: false };
}

/** Mention générale du PDF (p. 16 à 20) : information datée, à confirmer pour chaque trajet. */
export const BIKE_GENERAL_NOTE =
  'D’après le PDF du 13 novembre 2026 : SNCF annonce le retour de la réservation vélo sur les TER Aléop de mai à septembre 2027. Vérifier le train ou le car choisi.';
