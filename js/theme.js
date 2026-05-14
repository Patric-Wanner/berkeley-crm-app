/**
 * Berkeley CRM — Theme
 * Dark/light mode toggle with localStorage persistence.
 */

let isDark = false;
let lightTiles, darkTiles, map;

export function initTheme(mapInstance, light, dark) {
  map = mapInstance;
  lightTiles = light;
  darkTiles = dark;

  if (localStorage.getItem('berkeley_crm_theme') === 'dark') {
    applyTheme(true);
    return true;
  }
  return false;
}

export function toggleTheme() {
  applyTheme(!isDark);
  return isDark;
}

function applyTheme(dark) {
  isDark = dark;
  if (isDark) {
    map.removeLayer(lightTiles);
    darkTiles.addTo(map);
    document.body.classList.add('dark');
  } else {
    map.removeLayer(darkTiles);
    lightTiles.addTo(map);
    document.body.classList.remove('dark');
  }
  localStorage.setItem('berkeley_crm_theme', isDark ? 'dark' : 'light');
}
