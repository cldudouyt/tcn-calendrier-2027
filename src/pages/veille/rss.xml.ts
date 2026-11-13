import type { APIRoute } from 'astro';
import { surveys } from '../../lib/events';

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Liens relatifs au site : l'URL publique n'est connue qu'après le déploiement.
export const GET: APIRoute = ({ site }) => {
  const base = site ? site.origin : '';
  const items = surveys.map((s) => `    <item>
      <title>${esc(s.title)}</title>
      <link>${base}/veille/</link>
      <guid isPermaLink="false">${esc(s.id)}</guid>
      <pubDate>${new Date(s.checkedAt).toUTCString()}</pubDate>
      <description>${esc(`${s.summary} ${s.changes.map((c) => c.summary).join(' ')}`.trim())}</description>
    </item>`).join('\n');
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
    <title>Veille des inscriptions — Multisports Pays de la Loire 2027</title>
    <link>${base}/veille/</link>
    <description>Relevés des inscriptions aux épreuves multisports des Pays de la Loire.</description>
    <language>fr</language>
${items}
</channel></rss>
`;
  return new Response(xml, { headers: { 'content-type': 'application/rss+xml; charset=utf-8' } });
};
