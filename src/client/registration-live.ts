// Harmonise les informations d'inscription de la fiche avec les changements publiés dans D1.
// Le HTML statique reste utilisable si l'API est indisponible.
import { formatParis } from '../lib/format';
import { effectiveStatus, statusDisplay, verifiedRegistrationUrl } from '../lib/status';
import type { RaceEvent } from '../lib/types';

const panel = document.getElementById('registration-panel') as HTMLElement | null;
const eventId = panel?.dataset.eventId;

function externalLink(url: string | null | undefined, label: string): HTMLAnchorElement | null {
  if (!url || !url.startsWith('https://')) return null;
  const a = document.createElement('a');
  a.href = url;
  a.rel = 'noopener';
  a.textContent = label;
  return a;
}

function fact(list: HTMLElement, label: string, value: string, detail?: string): void {
  const row = document.createElement('div');
  const term = document.createElement('dt');
  const description = document.createElement('dd');
  term.textContent = label;
  description.textContent = value;
  if (detail) {
    description.append(document.createElement('br'));
    const note = document.createElement('span');
    note.className = 'small muted';
    note.textContent = detail;
    description.append(note);
  }
  row.append(term, description);
  list.append(row);
}

export function updateRegistrationPanel(event: RaceEvent): void {
  if (!panel || panel.dataset.eventId !== event.id) return;
  const facts = document.getElementById('registration-facts');
  const links = document.getElementById('registration-actions');
  const availability = document.getElementById('registration-availability');
  const conflict = document.getElementById('registration-conflict');
  const detail = document.getElementById('registration-detail');
  if (!facts || !links || !availability || !conflict) return;

  const display = statusDisplay(event);
  const status = effectiveStatus(event);
  const registrationUrl = verifiedRegistrationUrl(event);

  const newFacts = document.createDocumentFragment();
  fact(newFacts as unknown as HTMLElement, 'Statut', display.label, display.description);
  fact(newFacts as unknown as HTMLElement, 'Dernière vérification', event.lastCheckedAt ? formatParis(event.lastCheckedAt) : 'Jamais vérifié');
  if (event.registrationOpenAt && status === 'annonce') {
    fact(newFacts as unknown as HTMLElement, 'Ouverture annoncée', formatParis(event.registrationOpenAt));
  }
  const hasPriceInEvidence = /\d\s?€/.test(event.registrationEvidence ?? '');
  const tariff = event.price !== null && registrationUrl
    ? String(event.price) + ' ' + event.currency
    : hasPriceInEvidence && status !== 'non_verifie'
      ? 'Selon le format : voir le fait vérifié ci-dessous et la billetterie'
      : 'Non communiqué (aucun tarif sourcé)';
  fact(newFacts as unknown as HTMLElement, 'Tarif', tariff);
  if (event.registrationEvidence && status !== 'non_verifie') fact(newFacts as unknown as HTMLElement, 'Fait vérifié', event.registrationEvidence);
  facts.replaceChildren(newFacts);

  const newLinks = document.createDocumentFragment();
  const primary = registrationUrl
    ? externalLink(registrationUrl, 'S’inscrire (site officiel)')
    : status === 'annonce'
      ? externalLink(event.officialUrl, 'Voir l’annonce de l’organisateur')
      : null;
  if (primary) {
    primary.className = registrationUrl ? 'btn btn-primary' : 'btn btn-secondary';
    newLinks.append(primary);
  } else {
    const unavailable = document.createElement('span');
    unavailable.className = 'btn btn-secondary';
    unavailable.setAttribute('aria-disabled', 'true');
    unavailable.style.cursor = 'default';
    unavailable.textContent = 'Lien d’inscription non vérifié';
    newLinks.append(unavailable);
  }
  const organiser = externalLink(event.officialUrl, 'Site de l’organisateur');
  if (organiser) { organiser.className = 'btn btn-secondary'; newLinks.append(organiser); }
  links.replaceChildren(newLinks);

  const newAvailability = document.createDocumentFragment();
  if (event.formatAvailability?.length) {
    const title = document.createElement('h3');
    title.textContent = 'Disponibilité par format';
    title.style.fontSize = '1.15rem';
    title.style.marginTop = '14px';
    const ul = document.createElement('ul');
    for (const entry of event.formatAvailability) {
      const li = document.createElement('li');
      const bold = document.createElement('strong');
      const label = entry.status === 'complet' ? 'Complet' : entry.status === 'ouvert' ? 'Inscriptions ouvertes' : 'À vérifier';
      bold.textContent = entry.format + ' : ' + label;
      li.append(bold);
      const source = externalLink(entry.sourceUrl, 'Voir l’information officielle');
      if (source) li.append(' — ', source);
      ul.append(li);
    }
    newAvailability.append(title, ul);
  }
  availability.replaceChildren(newAvailability);

  const newConflict = document.createDocumentFragment();
  if (event.sourceConflict) {
    const box = document.createElement('div');
    box.className = 'notice';
    box.style.marginTop = '12px';
    const p = document.createElement('p');
    const strong = document.createElement('strong');
    strong.textContent = 'Les sources se contredisent. ';
    p.append(strong, 'Avant de vous inscrire, vérifiez le maintien de la course auprès de l’organisateur. ');
    const other = externalLink(event.sourceConflict.url, 'Autre source : ' + event.sourceConflict.label);
    if (other) p.append(other);
    box.append(p);
    newConflict.append(box);
  }
  conflict.replaceChildren(newConflict);
  if (detail) detail.textContent = event.statusDetail;
}

if (eventId) {
  fetch('/api/events/' + encodeURIComponent(eventId), { headers: { accept: 'application/json' }, cache: 'no-store' })
    .then((response) => response.ok && response.headers.get('content-type')?.includes('json')
      ? response.json() as Promise<{ event?: RaceEvent }>
      : null)
    .then((body) => { if (body?.event?.id === eventId) updateRegistrationPanel(body.event); })
    .catch(() => { /* conserver le contenu statique en cas de panne */ });
}
