import type { RaceEvent, RegistrationStatus, ChangeCategory } from './types';

export interface StatusMeta { label: string; tone: 'success' | 'warning' | 'neutral' | 'dark'; description: string }

export const STATUS_META: Record<RegistrationStatus, StatusMeta> = {
  ouvert: { label: 'Inscriptions ouvertes', tone: 'success', description: 'Ouverture attestée par une source officielle identifiée.' },
  a_confirmer: { label: 'Sources contradictoires', tone: 'warning', description: 'Deux sources ne donnent pas la même information. Vérifiez auprès de l’organisateur avant toute inscription.' },
  annonce: { label: 'Ouverture annoncée', tone: 'warning', description: 'Une date ou une fenêtre d’ouverture est annoncée par l’organisateur.' },
  non_verifie: { label: 'Inscriptions non vérifiées', tone: 'neutral', description: 'Aucune vérification n’a encore été faite : cela ne veut pas dire « fermé ».' },
  complet: { label: 'Complet', tone: 'dark', description: 'L’organisateur indique que l’épreuve est complète.' },
  ferme: { label: 'Inscriptions fermées', tone: 'dark', description: 'Fermeture attestée par une source officielle.' },
  annule: { label: 'Épreuve annulée', tone: 'dark', description: 'Annulation attestée par une source officielle.' },
};

export const CATEGORY_LABEL: Record<ChangeCategory, string> = {
  ouvert_confirme: 'Ouvert confirmé',
  ouverture_annoncee: 'Ouverture annoncée',
  non_confirme: 'Non confirmé',
  source_contradictoire: 'Sources contradictoires',
  complet: 'Complet',
  ferme: 'Fermé',
  annule: 'Annulé',
  modification: 'Modification de date ou de format',
};

type Evidence = Pick<RaceEvent, 'registrationStatus' | 'registrationEvidence' | 'lastCheckedAt' | 'officialUrl' | 'registrationUrl'>;

/** Une affirmation n'est recevable qu'avec une preuve, une date de vérification et un lien officiel https. */
export function hasOfficialEvidence(e: Evidence): boolean {
  const link = e.registrationUrl ?? e.officialUrl;
  return Boolean(e.registrationEvidence && e.lastCheckedAt && link && link.startsWith('https://'));
}

/**
 * Statut réellement affiché. Tout statut affirmé sans source officielle retombe sur
 * « non vérifié » : jamais « ouvert » ni « fermé » sur simple supposition.
 */
export function effectiveStatus(e: Evidence): RegistrationStatus {
  if (e.registrationStatus === 'non_verifie') return 'non_verifie';
  return hasOfficialEvidence(e) ? e.registrationStatus : 'non_verifie';
}

/** Le lien d'inscription n'est proposé que s'il est vérifié. */
export function verifiedRegistrationUrl(e: Evidence): string | null {
  return e.registrationStatus === 'ouvert' && hasOfficialEvidence(e) && e.registrationUrl ? e.registrationUrl : null;
}
