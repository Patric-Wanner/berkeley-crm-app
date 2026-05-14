/**
 * Berkeley CRM — Map
 * Leaflet map, markers, clustering, search, legend.
 */

import { MAP_CENTER, MAP_ZOOM, HQ } from './config.js';
import { makeMarkerIcon, visitColor, visitCategory, daysSince } from './helpers.js';
import { initTheme, toggleTheme } from './theme.js';
import { getProfile, hasRole } from './role.js';

let map, clusterGroup, lightTiles, darkTiles;
let markerMap = {};
let customerCache = [];
let visitCache = {};
let activeFilter = 'all';
let _searchTimer = null;

/* Berkeley HQ icon */
const hqIcon = L.divIcon({
  html: `<div style="width:36px;height:36px;border-radius:50%;background:#fff;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 6px rgba(0,0,0,.4);border:2px solid #303336;">
    <img src="https://cdn.berkeleycompany.com/preset:sharp/resize:fit:1700:0:0/width:1700/quality:70/gravity:sm/plain/https://api.berkeleycompany.com/storage/berkeley/logo/berkeley-logo-symbol.png" style="width:22px;height:22px;">
  </div>`,
  iconSize: [36, 36], iconAnchor: [18, 18], popupAnchor: [0, -20], className: ''
});

export function initMap() {
  map = L.map('map').setView(MAP_CENTER, MAP_ZOOM);

  lightTiles = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap', maxZoom: 18
  });
  darkTiles = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; OpenStreetMap &copy; CARTO', maxZoom: 18
  });
  lightTiles.addTo(map);

  clusterGroup = L.markerClusterGroup({
    maxClusterRadius: 40, spiderfyOnMaxZoom: true, showCoverageOnHover: false
  });
  map.addLayer(clusterGroup);

  /* Berkeley HQ marker */
  L.marker([HQ.lat, HQ.lng], { icon: hqIcon, zIndexOffset: 1000 })
    .bindPopup('<div class="customer-popup"><h3>Berkeley Company</h3><p>Flöjelbergsgatan 3A</p><p>431 35 Mölndal</p></div>')
    .addTo(map);

  /* Legend */
  const legend = L.control({ position: 'topright' });
  legend.onAdd = () => {
    const div = L.DomUtil.create('div', 'legend');
    const profile = getProfile();
    div.innerHTML = `<h4 id="legendName">${profile?.display_name || ''}</h4>
      <span id="legendCount"></span>
      <div style="margin-top:8px;font-size:12px;">
        <div><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:#2ECC71;margin-right:6px;vertical-align:middle;"></span>0–30d</div>
        <div><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:#EAC435;margin-right:6px;vertical-align:middle;"></span>Inget/31–59d</div>
        <div><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:#E67E22;margin-right:6px;vertical-align:middle;"></span>60–89d</div>
        <div><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:#E74C3C;margin-right:6px;vertical-align:middle;"></span>90+d</div>
      </div>`;
    return div;
  };
  legend.addTo(map);

  /* Theme */
  const wasDark = initTheme(map, lightTiles, darkTiles);
  return { map, wasDark };
}

/* Build markers from customer + visit data */
export function buildMarkers(customers, visits, popupBuilder) {
  clusterGroup.clearLayers();
  markerMap = {};
  customerCache = customers;
  visitCache = visits;

  customers.forEach(c => {
    if (!c.lat) return;
    const lastVisit = visits[c.id];
    const days = daysSince(lastVisit);
    const cat = visitCategory(days);
    if (activeFilter !== 'all' && cat !== activeFilter) return;

    const color = visitColor(days);
    const m = L.marker([c.lat, c.lng], { icon: makeMarkerIcon(color) })
      .bindPopup(popupBuilder(c, days, lastVisit))
      .bindTooltip(`<strong>${c.name}</strong><br>${c.address ? c.address + ', ' : ''}${c.city}`, {
        direction: 'top', offset: [0, -14], className: 'crm-tooltip'
      });
    m.customerId = c.id;
    clusterGroup.addLayer(m);
    markerMap[c.id] = m;
  });

  const countEl = document.getElementById('legendCount');
  if (countEl) countEl.textContent = customers.length + ' kunder';
}

export function setFilter(filter) {
  activeFilter = filter;
}

export function flyTo(customerId) {
  const c = customerCache.find(x => x.id === customerId);
  if (!c) return;
  const marker = markerMap[customerId];
  if (marker) {
    clusterGroup.zoomToShowLayer(marker, () => marker.openPopup());
  } else {
    map.setView([c.lat, c.lng], 14);
  }
}

export function search(query) {
  clearTimeout(_searchTimer);
  const q = query.toLowerCase().trim();
  if (!q) { map.setView(MAP_CENTER, MAP_ZOOM); return; }

  _searchTimer = setTimeout(() => {
    const found =
      customerCache.find(c => c.lat && c.name.toLowerCase().includes(q)) ||
      customerCache.find(c => c.lat && c.customer_nr.toLowerCase().includes(q)) ||
      customerCache.find(c => c.lat && c.city.toLowerCase().includes(q));
    if (!found) return;

    const marker = markerMap[found.id];
    if (marker) {
      clusterGroup.zoomToShowLayer(marker, () => marker.openPopup());
    } else {
      map.setView([found.lat, found.lng], 14);
    }
  }, 250);
}

export function resetView() {
  map.setView(MAP_CENTER, MAP_ZOOM);
}

export function invalidateSize() {
  if (map) setTimeout(() => map.invalidateSize(), 100);
}

export function getMapInstance() { return map; }

export { toggleTheme };
