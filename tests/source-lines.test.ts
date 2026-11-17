import { describe, expect, it } from 'vitest';
import raw from '../data/sources.json?raw';
import sourcesFile from '../data/sources.json';
import { eventDateLines, sourceLines } from '../src/lib/source-lines';
import dataRaw from '../data.json?raw';
import data from '../data.json';

describe('lignes de data/sources.json', () => {
  const lines = sourceLines(raw);
  const text = raw.split('\n');
  it('pointe chaque adresse et chaque groupe vers la bonne ligne', () => {
    for (const s of sourcesFile.sources) {
      expect(text[lines.groups[s.eventGroupId]! - 1]).toContain(s.eventGroupId);
      for (const p of s.pages) for (const n of lines.urls[p.url]!) expect(text[n - 1]).toContain(p.url);
    }
  });
  it('retrouve toutes les lignes d’une page partagée par plusieurs groupes', () => {
    const shared = Object.values(lines.urls).find((n) => n.length > 1);
    expect(shared?.length).toBeGreaterThan(1);
  });
});

describe('lignes de date de data.json', () => {
  it('pointe la date de chacune des 78 épreuves', () => {
    const lines = eventDateLines(dataRaw);
    const text = dataRaw.split('\n');
    expect(Object.keys(lines)).toHaveLength(78);
    for (const e of data as { id: string; date: string }[]) expect(text[lines[e.id]! - 1]).toContain(`"date": "${e.date}"`);
  });
});
