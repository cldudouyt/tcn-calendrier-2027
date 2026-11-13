import { MULTI_KEYS, activeFilterCount, emptyFilters, parseFilters, serializeFilters, type Filterable, type Filters } from '../lib/filters';

export function readEventsData(): Filterable[] {
  const el = document.getElementById('events-data');
  return el?.textContent ? (JSON.parse(el.textContent) as Filterable[]) : [];
}

function readForm(form: HTMLFormElement): Filters {
  const f = emptyFilters();
  f.q = (form.elements.namedItem('q') as HTMLInputElement | null)?.value ?? '';
  for (const key of MULTI_KEYS) {
    f[key] = [...form.querySelectorAll<HTMLInputElement>(`input[name="${key}"]:checked`)].map((i) => i.value);
  }
  return f;
}

function writeForm(form: HTMLFormElement, f: Filters): void {
  const q = form.elements.namedItem('q') as HTMLInputElement | null;
  if (q) q.value = f.q;
  for (const key of MULTI_KEYS) {
    form.querySelectorAll<HTMLInputElement>(`input[name="${key}"]`).forEach((i) => { i.checked = f[key].includes(i.value); });
  }
}

/** Conserve les paramètres étrangers aux filtres (ex. la vue) et synchronise l'URL partageable. */
function syncUrl(f: Filters): void {
  const current = new URLSearchParams(location.search);
  const next = serializeFilters(f);
  const view = current.get('vue');
  if (view) next.set('vue', view);
  const qs = next.toString();
  history.replaceState(null, '', `${location.pathname}${qs ? `?${qs}` : ''}${location.hash}`);
  // Les liens liste ↔ carte emportent la sélection en cours.
  const filterQs = serializeFilters(f).toString();
  document.querySelectorAll<HTMLAnchorElement>('a[data-keep-filters]').forEach((a) => {
    const base = a.dataset.keepFilters ?? a.pathname;
    a.href = `${base}${filterQs ? `?${filterQs}` : ''}`;
  });
}

export function initFilters(onChange: (f: Filters) => void): void {
  const form = document.getElementById('filters') as HTMLFormElement | null;
  if (!form) return;
  const details = document.getElementById('filter-details') as HTMLDetailsElement | null;
  const badge = document.getElementById('filter-count');
  const feedback = document.getElementById('share-feedback');

  const update = (): void => {
    const f = readForm(form);
    const n = activeFilterCount(f) - (f.q.trim() ? 1 : 0);
    if (badge) { badge.hidden = n === 0; badge.textContent = `${n} choix`; }
    syncUrl(f);
    onChange(f);
  };

  const initial = parseFilters(new URLSearchParams(location.search));
  writeForm(form, initial);
  // Replié par défaut pour laisser la liste ou la carte visible ; ouvert si une sélection est active.
  if (details && activeFilterCount(initial) - (initial.q ? 1 : 0) > 0) details.open = true;

  form.addEventListener('input', update);
  form.addEventListener('reset', () => setTimeout(update, 0));
  document.getElementById('share-url')?.addEventListener('click', async () => {
    const url = location.href;
    try {
      if (navigator.share) await navigator.share({ title: document.title, url });
      else { await navigator.clipboard.writeText(url); if (feedback) feedback.textContent = 'Lien copié dans le presse-papiers.'; }
    } catch { if (feedback) feedback.textContent = `Lien à copier : ${url}`; }
  });
  update();
}
