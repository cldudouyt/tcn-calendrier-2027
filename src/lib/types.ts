export type Department = '44' | '49' | '53' | '72' | '85';
export type TransportCode = 'D' | 'C' | 'M' | 'B' | 'L' | '?';
export type RegistrationStatus = 'non_verifie' | 'ouvert' | 'annonce' | 'a_confirmer' | 'complet' | 'ferme' | 'annule';
export type LocationAccuracy = 'non_geocode' | 'centre_commune' | 'depart_verifie';

/** Règle d'emport du vélo, renseignée uniquement après vérification auprès de l'opérateur. */
export interface BikePolicy {
  summary: string;
  sourceUrl: string;
  checkedAt: string;
  /** true seulement si la règle est confirmée pour la date de l'épreuve. */
  confirmedForDate: boolean;
}

/** Un statut sourcé indépendamment pour une distance ou catégorie. */
export interface FormatAvailability { format: string; status: 'ouvert' | 'complet' | 'non_verifie'; evidence: string; sourceUrl: string }
export interface ConflictingSource { label: string; url: string }
export interface RaceEvent {
  id: string;
  eventGroupId: string;
  department: Department;
  /** Date ISO YYYY-MM-DD (jour civil, Europe/Paris). */
  date: string;
  name: string;
  formats: string;
  formatTags: string[];
  town: string | null;
  kind: string;
  transport: TransportCode;
  journey: string;
  lastMile: string;
  transportOrigin: string;
  transportSourcePage: number;
  transportLastCheckedAt: string | null;
  transportBikePolicy: BikePolicy | null;
  status: string;
  statusDetail: string;
  registrationStatus: RegistrationStatus;
  registrationOpenAt: string | null;
  registrationUrl: string | null;
  officialUrl: string | null;
  price: number | null;
  currency: string;
  sourceUrl: string;
  lastCheckedAt: string | null;
  changedAt: string | null;
  registrationEvidence: string | null;
  formatAvailability?: FormatAvailability[];
  sourceConflict?: ConflictingSource | null;
  /** [latitude, longitude] — attention, ordre inverse de GeoJSON. */
  coords: [number, number] | null;
  coordsSource: string | null;
  communeCode: string | null;
  locationAccuracy: LocationAccuracy;
  raceStartLocation: string | null;
  raceStartLatLon: [number, number] | null;
  sourcePage: number;
  sourceReferenceDate: string;
  notes: string[];
}

export interface OutOfRegionEvent {
  id: string;
  date: string;
  endDate: string | null;
  name: string;
  town: string;
  department: string;
  formats: string | null;
  transport: TransportCode;
  journey: string;
  lastMile: string;
  transportOrigin: string;
  transportLastCheckedAt: string;
  sourcePage: number;
  transportSourcePage: number;
  registrationStatus: RegistrationStatus;
}

export type ChangeCategory =
  | 'ouvert_confirme' | 'ouverture_annoncee' | 'non_confirme' | 'source_contradictoire' | 'complet' | 'ferme' | 'annule' | 'modification';

export interface SurveyChange {
  eventId: string;
  category: ChangeCategory;
  summary: string;
  evidence: string | null;
  sourceUrl: string | null;
  previous: string | null;
}

export interface Survey {
  id: string;
  /** Horodatage ISO avec décalage, affiché en Europe/Paris. */
  checkedAt: string;
  /** 'date' si seule la journée du relevé est connue. */
  checkedAtPrecision: 'date' | 'minute';
  kind: 'initial' | 'hebdomadaire' | 'quotidien' | 'correction';
  title: string;
  summary: string;
  source: { label: string; url: string } | null;
  changes: SurveyChange[];
}
