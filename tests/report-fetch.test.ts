import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchKnownPage } from '../worker/index';

afterEach(() => vi.unstubAllGlobals());

describe('sécurité de la lecture des pages signalées', () => {
  it('rejette une page HTML dépassant la limite plutôt que vérifier son contenu tronqué', async () => {
    const html = '<html><body>' + 'x'.repeat(2_000_100) + '</body></html>';
    const fake = vi.fn().mockResolvedValue(new Response(html, {
      status: 200, headers: { 'content-type': 'text/html; charset=utf-8' },
    }));
    vi.stubGlobal('fetch', fake);
    const result = await fetchKnownPage('https://www.klikego.com/inscription/duathlon-nozeen-2027/triathlon/1-9');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/volumineuse/);
    expect(fake).toHaveBeenCalledTimes(1);
  });

  it('rejette une redirection vers une destination non autorisée', async () => {
    const fake = vi.fn().mockResolvedValue(new Response(null, {
      status: 302, headers: { location: 'http://127.0.0.1/secret' },
    }));
    vi.stubGlobal('fetch', fake);
    const result = await fetchKnownPage('https://www.klikego.com/inscription/duathlon-nozeen-2027/triathlon/1-9');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/refusée/);
    expect(fake).toHaveBeenCalledTimes(1);
  });
});
