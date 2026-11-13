// Carte isolée du reste du site : seul module à dépendre de Leaflet et d'OpenStreetMap.
import L from 'leaflet';
import 'leaflet.markercluster';
import 'leaflet/dist/leaflet.css';
import 'leaflet.markercluster/dist/MarkerCluster.css';

export interface MapPoint {
  id: string; name: string; town: string | null; dep: string; date: string; formats: string;
  /** Libellé affiché et clé du statut d'inscription (ouvert, annonce, non_verifie, complet, ferme, annule). */
  status: string; statusKey: string; transport: string; url: string;
  /** [latitude, longitude] */
  coords: [number, number] | null;
  verified: boolean;
}

export type StatusGroup = 'ouvert' | 'annonce' | 'non_verifie' | 'clos';
/** Regroupement pour la carte : complet, fermé et annulé partagent le même symbole (le libellé exact reste dans la fenêtre). */
export const statusGroup = (key: string): StatusGroup =>
  key === 'ouvert' || key === 'annonce' || key === 'non_verifie' ? key : 'clos';
export const STATUS_GROUPS: Record<StatusGroup, { symbol: string; label: string }> = {
  ouvert: { symbol: '✓', label: 'Inscriptions ouvertes' },
  annonce: { symbol: '…', label: 'Ouverture annoncée' },
  non_verifie: { symbol: '?', label: 'Inscriptions non vérifiées' },
  clos: { symbol: '×', label: 'Complet, fermé ou annulé' },
};
const ORDER: StatusGroup[] = ['ouvert', 'annonce', 'non_verifie', 'clos'];
/** Statut mis en avant pour un repère regroupant plusieurs épreuves : le plus favorable. */
const leadGroup = (group: MapPoint[]): StatusGroup => ORDER.find((g) => group.some((p) => statusGroup(p.statusKey) === g)) ?? 'non_verifie';
const statusBadge = (g: StatusGroup, text = STATUS_GROUPS[g].symbol): string => `<i class="st st-${g}" aria-hidden="true">${text}</i>`;

const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const REGION_BOUNDS: L.LatLngBoundsExpression = [[46.25, -2.65], [48.6, 0.95]];

function popupHtml(group: MapPoint[]): string {
  const first = group[0]!;
  const items = group.map((p) => `<li><h3><a href="${p.url}">${esc(p.name)}</a></h3>
    <p>${esc(p.date)}</p><p>${esc(p.formats)}</p>
    <p><strong>${esc(p.status)}</strong> · ${esc(p.transport)}</p></li>`).join('');
  const where = first.verified ? 'Départ vérifié' : 'Position indicative : centre de la commune, pas le départ';
  return `<p><strong>${esc(first.town ?? '')}</strong> · ${where}</p><ul>${items}</ul>`;
}

export function createMap(el: HTMLElement, points: MapPoint[]): { show: (visible: Set<string>) => void } {
  const groupOf = new WeakMap<L.Marker, MapPoint[]>();
  const map = L.map(el, { scrollWheelZoom: false }).fitBounds(REGION_BOUNDS);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 18,
    attribution: '&copy; contributeurs <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> · positions indicatives (centres de communes, API Géo)',
  }).addTo(map);
  map.on('focus click', () => map.scrollWheelZoom.enable());

  const cluster = L.markerClusterGroup({
    showCoverageOnHover: false,
    maxClusterRadius: 45,
    iconCreateFunction: (c) => {
      // Le regroupement indique combien d'épreuves ont des inscriptions ouvertes ou annoncées.
      const inside = c.getAllChildMarkers().flatMap((m) => groupOf.get(m) ?? []);
      const count = (g: StatusGroup): number => inside.filter((p) => statusGroup(p.statusKey) === g).length;
      const open = count('ouvert');
      const announced = count('annonce');
      const badge = open ? statusBadge('ouvert', String(open)) : announced ? statusBadge('annonce', String(announced)) : '';
      const title = `${inside.length} rendez-vous : ${ORDER.map((g) => [count(g), STATUS_GROUPS[g].label] as const).filter(([n]) => n > 0).map(([n, l]) => `${n} ${l.toLowerCase()}`).join(', ')}`;
      return L.divIcon({ html: `<span class="pin-wrap" title="${esc(title)}"><span class="cluster">${inside.length}</span>${badge}</span>`, className: '', iconSize: [42, 42] });
    },
  });
  map.addLayer(cluster);

  return {
    show(visible) {
      cluster.clearLayers();
      // Un repère par commune : les épreuves d'une même commune partagent le même centre.
      const byPlace = new Map<string, MapPoint[]>();
      for (const p of points) {
        if (!p.coords || !visible.has(p.id)) continue;
        const key = p.coords.join(',');
        byPlace.set(key, [...(byPlace.get(key) ?? []), p]);
      }
      for (const group of byPlace.values()) {
        const p = group[0]!;
        const lead = leadGroup(group);
        const label = `${p.town ?? p.name} — ${group.length} rendez-vous, ${STATUS_GROUPS[lead].label.toLowerCase()}, position indicative`;
        const marker = L.marker(p.coords!, {
          title: label, alt: label, keyboard: true,
          icon: L.divIcon({ html: `<span class="pin-wrap"><span class="pin pin-${p.dep}"><b>${p.dep}</b></span>${statusBadge(lead)}</span>`, className: '', iconSize: [32, 32], iconAnchor: [16, 30], popupAnchor: [0, -26] }),
        });
        marker.bindPopup(popupHtml(group), { maxWidth: 300, maxHeight: 320 });
        groupOf.set(marker, group);
        cluster.addLayer(marker);
      }
    },
  };
}
