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

/** Formats signalés complets par l'organisateur (disponibilités par format). */
export function fullFormats(e: Pick<RaceEvent, 'formatAvailability'>): string[] {
  return (e.formatAvailability ?? []).filter((f) => f.status === 'complet').map((f) => f.format);
}

/**
 * Libellé affiché : identique au statut, sauf « ouvert » avec des formats complets, qui devient
 * « ouvert en partie » pour ne pas laisser croire que tous les formats sont disponibles.
 */
export function statusDisplay(e: Evidence & Pick<RaceEvent, 'formatAvailability'>): StatusMeta & { status: RegistrationStatus; partial: boolean } {
  const status = effectiveStatus(e);
  const full = status === 'ouvert' ? fullFormats(e) : [];
  if (!full.length) return { ...STATUS_META[status], status, partial: false };
  const list = full.join(', ');
  return {
    status, partial: true, tone: 'success',
    label: `Ouvert en partie · ${list} complet${full.length > 1 ? 's' : ''}`,
    description: `Inscriptions ouvertes pour certains formats seulement : ${list} ${full.length > 1 ? 'sont complets' : 'est complet'} selon l’organisateur.`,
  };
}

/** Le lien d'inscription n'est proposé que s'il est vérifié. */
export function verifiedRegistrationUrl(e: Evidence): string | null {
  return e.registrationStatus === 'ouvert' && hasOfficialEvidence(e) && e.registrationUrl ? e.registrationUrl : null;
}
