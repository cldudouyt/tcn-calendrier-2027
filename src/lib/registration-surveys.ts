import rawEvents from '../../data.json';
import rawReports from '../../data/veille-inscriptions.json';
import { applyPatch, isNoop, validateChange, type EventPatch } from '../../worker/lib';
import { effectiveStatus, STATUS_META } from './status';
import type { RaceEvent, Survey, SurveyChange } from './types';

export const REGISTRATION_FIELDS = [
  'registrationStatus', 'registrationEvidence', 'registrationUrl', 'officialUrl', 'registrationOpenAt', 'price',
] as const satisfies readonly (keyof EventPatch)[];

const eventsById = new Map((rawEvents as RaceEvent[]).map((event) => [event.id, event]));
const surveys: Survey[] = [];
let previousDate = -Infinity;

for (const report of rawReports) {
  const reportDate = Date.parse(report.checkedAt);
  if (!Number.isFinite(reportDate) || reportDate <= previousDate || reportDate > Date.now() + 60_000) {
    throw new Error(`Date de relevé invalide ou hors ordre : ${report.checkedAt}`);
  }
  previousDate = reportDate;
  const seen = new Set<string>();
  const changes: SurveyChange[] = [];
  for (const item of report.changes) {
    const result = validateChange({ ...item, checkedAt: report.checkedAt }, eventsById);
    if (!result.ok) throw new Error(`${item.eventId} : ${result.errors.join(', ')}`);
    const change = result.change;
    const status = change.patch.registrationStatus;
    if (seen.has(change.eventId) || !status || status === 'non_verifie' ||
        typeof change.patch.registrationEvidence !== 'string' || !change.patch.registrationEvidence.trim() ||
        ![change.patch.officialUrl, change.patch.registrationUrl].some(Boolean) ||
        Object.keys(change.patch).some((field) => !REGISTRATION_FIELDS.some((allowed) => allowed === field))) {
      throw new Error(`Statut sourcé unique attendu par épreuve : ${change.eventId}`);
    }
    seen.add(change.eventId);
    const event = eventsById.get(change.eventId)!;
    if (isNoop(event, change.patch)) continue;
    eventsById.set(change.eventId, {
      ...applyPatch(event, change.patch, { lastCheckedAt: report.checkedAt, changedAt: report.checkedAt }),
      statusDetail: '',
    });
    changes.push({
      eventId: change.eventId, category: change.category as SurveyChange['category'], summary: change.summary,
      evidence: change.evidence, sourceUrl: change.patch.registrationUrl ?? change.patch.officialUrl ?? null,
      previous: STATUS_META[effectiveStatus(event)].label,
    });
  }
  surveys.push({
    id: `inscriptions-${report.checkedAt}`, checkedAt: report.checkedAt,
    checkedAtPrecision: report.checkedAt.length === 10 ? 'date' : 'minute', kind: 'quotidien',
    title: 'Relevé des inscriptions', summary: '', source: null, changes,
  });
}

export const eventsWithRegistrations = [...eventsById.values()];
export const registrationSurveys = surveys;
