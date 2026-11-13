import type { APIRoute } from 'astro';
import { events, surveys } from '../../lib/events';

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Liens relatifs au site : l'URL publique n'est connue qu'après le déploiement.
export const GET: APIRoute = ({ site }) => {
  const base = site ? site.origin : '';
  const groups = new Map(events.map(e => [e.id, e.eventGroupId]));
  const items = surveys.map((s) => `    <item>
      <title>${esc(s.title)}</title>
      <link>${base}/veille/</link>
      <guid isPermaLink="false">${esc(s.id)}</guid>
      <pubDate>${new Date(s.checkedAt).toUTCString()}</pubDate>
      <description>${esc(`${s.summary} ${s.changes.filter((c, i, all) => all.findIndex(x => (groups.get(x.eventId) ?? x.eventId) === (groups.get(c.eventId) ?? c.eventId)) === i).map((c) => `${events.find(e => e.id === c.eventId)?.name ?? c.eventId} : ${c.summary}`).join(" ")}`.trim())}</description>
    </item>`).join('\n');
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
    <title>Veille des inscriptions — Triathlon Pays de la Loire 2027</title>
    <link>${base}/veille/</link>
    <description>Relevés des inscriptions aux épreuves de triathlon et disciplines associées des Pays de la Loire.</description>
    <language>fr</language>
${items}
</channel></rss>
`;
  return new Response(xml, { headers: { 'content-type': 'application/rss+xml; charset=utf-8' } });
};
