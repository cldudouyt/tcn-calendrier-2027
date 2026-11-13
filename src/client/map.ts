// Carte isolée du reste du site : seul module à dépendre de Leaflet et d'OpenStreetMap.
import L from 'leaflet';
import 'leaflet.markercluster';
import 'leaflet/dist/leaflet.css';
import 'leaflet.markercluster/dist/MarkerCluster.css';

export interface MapPoint {
  id: string; name: string; town: string | null; dep: string; date: string; formats: string;
  status: string; transport: string; url: string;
  /** [latitude, longitude] */
  coords: [number, number] | null;
  verified: boolean;
}

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
  const map = L.map(el, { scrollWheelZoom: false }).fitBounds(REGION_BOUNDS);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 18,
    attribution: '&copy; contributeurs <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> · positions indicatives (centres de communes, API Géo)',
  }).addTo(map);
  map.on('focus click', () => map.scrollWheelZoom.enable());

  const cluster = L.markerClusterGroup({
    showCoverageOnHover: false,
    maxClusterRadius: 45,
    iconCreateFunction: (c) => L.divIcon({ html: `<span class="cluster">${c.getChildCount()}</span>`, className: '', iconSize: [42, 42] }),
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
        const label = `${p.town ?? p.name} — ${group.length} rendez-vous, position indicative`;
        const marker = L.marker(p.coords!, {
          title: label, alt: label, keyboard: true,
          icon: L.divIcon({ html: `<span class="pin pin-${p.dep}"><b>${p.dep}</b></span>`, className: '', iconSize: [32, 32], iconAnchor: [16, 30], popupAnchor: [0, -26] }),
        });
        marker.bindPopup(popupHtml(group), { maxWidth: 300, maxHeight: 320 });
        cluster.addLayer(marker);
      }
    },
  };
}
