import { describe, expect, it } from 'vitest';
import raw from '../data/sources.json?raw';
import sourcesFile from '../data/sources.json';
import { sourceLines } from '../src/lib/source-lines';

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
