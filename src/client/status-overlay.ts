// Met à jour les badges et indicateurs avec les statuts validés côté serveur (API /api/status).
// Sans API (aperçu statique, panne), la page conserve les valeurs du build.
interface ApiStatus { id: string; status: string; label: string; tone: 'success' | 'warning' | 'neutral' | 'dark' }
const TONE_CLASS: Record<ApiStatus['tone'], string> = { success: 'badge-success', warning: 'badge-warning', dark: 'badge-dark', neutral: '' };

const badges = document.querySelectorAll<HTMLElement>('[data-status-for]');
const kpis = document.querySelectorAll<HTMLElement>('[data-kpi]');
if (badges.length || kpis.length) {
  fetch('/api/status', { headers: { accept: 'application/json' } })
    .then((r) => (r.ok && r.headers.get('content-type')?.includes('json') ? (r.json() as Promise<{ statuses: ApiStatus[] }>) : null))
    .then((body) => {
      if (!body) return;
      const byId = new Map(body.statuses.map((s) => [s.id, s]));
      badges.forEach((el) => {
        const s = byId.get(el.dataset.statusFor ?? '');
        if (!s || s.status === el.dataset.status) return;
        el.dataset.status = s.status;
        el.textContent = s.label;
        el.classList.remove('badge-success', 'badge-warning', 'badge-dark');
        if (TONE_CLASS[s.tone]) el.classList.add(TONE_CLASS[s.tone]);
      });
      const count = (status: string): number => body.statuses.filter((s) => s.status === status).length;
      const values: Record<string, number> = { total: body.statuses.length, open: count('ouvert'), announced: count('annonce'), toConfirm: count('non_verifie') };
      kpis.forEach((el) => { const v = values[el.dataset.kpi ?? '']; if (v !== undefined) el.textContent = String(v); });
    })
    .catch(() => { /* API indisponible */ });
}
