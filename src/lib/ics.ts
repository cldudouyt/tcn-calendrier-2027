import { addDays } from './format';

export interface IcsEvent { id: string; date: string; name: string; town: string | null; formats: string; url: string }

const esc = (s: string): string => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

/** Pliage RFC 5545 : lignes de 75 octets au plus, sans couper un caractère multi-octets. */
export function fold(line: string): string {
  const encoder = new TextEncoder();
  const parts: string[] = [];
  let current = '';
  let size = 0;
  for (const ch of line) {
    const bytes = encoder.encode(ch).length;
    const limit = parts.length === 0 ? 75 : 74; // la ligne de continuation commence par une espace
    if (size + bytes > limit) { parts.push(current); current = ''; size = 0; }
    current += ch;
    size += bytes;
  }
  parts.push(current);
  return parts.join('\r\n ');
}

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
      `SUMMARY:${esc(e.name)}`,
      ...(e.town ? [`LOCATION:${esc(e.town)}`] : []),
      `DESCRIPTION:${esc(`${e.formats}\nDate issue du calendrier de la Ligue (PDF du 13/11/2026), à confirmer auprès de l’organisateur.\n${e.url}`)}`,
      `URL:${e.url}`,
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}
