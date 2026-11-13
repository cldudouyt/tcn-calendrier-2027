import { addDays } from './format';

export interface IcsEvent { id: string; date: string; name: string; town: string | null; formats: string; url: string }

const esc = (s: string): string => s.replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const fold = (line: string): string => line.match(/.{1,60}/gu)?.join('\r\n ') ?? line;

/** Calendrier iCalendar : évènements sur la journée entière, sans horaire (non connus). */
export function buildIcs(events: IcsEvent[], stamp: Date = new Date()): string {
  const dtstamp = stamp.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//TCN//Calendrier multisports PDL 2027//FR', 'CALSCALE:GREGORIAN'];
  for (const e of events) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${e.id}@tcn-calendrier-2027`,
      `DTSTAMP:${dtstamp}`,
      `DTSTART;VALUE=DATE:${e.date.replace(/-/g, '')}`,
      `DTEND;VALUE=DATE:${addDays(e.date, 1).replace(/-/g, '')}`,
      fold(`SUMMARY:${esc(e.name)}`),
      ...(e.town ? [fold(`LOCATION:${esc(e.town)}`)] : []),
      fold(`DESCRIPTION:${esc(`${e.formats}\nDate issue du calendrier de la Ligue (PDF du 13/11/2026), à confirmer auprès de l’organisateur.\n${e.url}`)}`),
      fold(`URL:${e.url}`),
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}
