/**
 * Repère, dans le texte de data/sources.json, la ligne de chaque adresse surveillée et de chaque groupe d'épreuves,
 * pour indiquer à l'administrateur où corriger une adresse après une alerte « source injoignable ».
 */
export interface SourceLines {
  /** Adresse → numéros de ligne (une même page peut servir à plusieurs groupes). */
  urls: Record<string, number[]>;
  /** Groupe d'épreuves → numéro de la ligne « eventGroupId ». */
  groups: Record<string, number>;
}

export function sourceLines(raw: string): SourceLines {
  const urls: Record<string, number[]> = {};
  const groups: Record<string, number> = {};
  raw.split('\n').forEach((line, i) => {
    const url = /"(?:url|fftri)":\s*"([^"]+)"/.exec(line)?.[1];
    if (url) (urls[url] ??= []).push(i + 1);
    const group = /"eventGroupId":\s*"([^"]+)"/.exec(line)?.[1];
    if (group) groups[group] = i + 1;
  });
  return { urls, groups };
}

export const SOURCES_EDIT_URL = 'https://github.com/cldudouyt/tcn-calendrier-2027/edit/main/data/sources.json';
