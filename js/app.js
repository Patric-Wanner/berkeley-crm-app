/**
 * Berkeley CRM — App
 * Main entry point. Initializes auth, loads data, wires up UI.
 */

import { sb } from './supabase-client.js';
import { requireAuth, logout, onAuthChange } from './auth.js';
import { loadProfile, getProfile, getRole, hasRole, fetchAllProfiles } from './role.js';
import { fetchCustomers, createCustomer, updateCustomer, deleteCustomer, reassignCustomers } from './customers.js';
import { fetchAllVisits, fetchVisits, registerVisit, deleteVisit, getLastVisit } from './visits.js';
import { addComment, deleteComment, fetchComments } from './comments.js';
import { upsertRevenue, deleteRevenue, fetchRevenue, fetchAllRevenue } from './revenue.js';
import { fetchContacts, addContact, updateContact, deleteContact, setPrimaryContact } from './contacts.js';
import { fetchNextVisits, setNextVisit, removeNextVisit } from './next-visits.js';
import { daysSince, formatDate, formatSEK, visitColor, googleMapsUrl, geocodeAddress, haversine } from './helpers.js';
import { HQ, MAP_CENTER, MAP_ZOOM, OSRM_BASE } from './config.js';
import { initMap, buildMarkers, setFilter, flyTo, search, resetView, invalidateSize, getMapInstance, toggleTheme } from './map.js';

/* ── State ──────────────────────────────────────────── */
let customers = [];
let allCustomers = [];
let lastVisitMap = {};
let profiles = [];
let activeCity = 'all';
let nextVisitsCache = [];
let routeStops = [];

/* ── Init ───────────────────────────────────────────── */
async function init() {
  const session = await requireAuth();
  if (!session) return;

  await loadProfile(session.user.id);
  const role = getRole();
  const profile = getProfile();

  document.getElementById('userName').textContent = profile.display_name;
  initRoleUI(role);

  const { wasDark } = initMap();
  if (wasDark) document.getElementById('themeBtn').textContent = '☀️';

  await refreshAll();
  onAuthChange();
  bindEvents();
}

/* ── Role-based UI visibility ───────────────────────── */
function initRoleUI(role) {
  if (role === 'admin') {
    document.querySelectorAll('[data-role="admin"], [data-role="manager"]')
      .forEach(el => el.style.display = '');
  } else if (role === 'manager') {
    document.querySelectorAll('[data-role="manager"]')
      .forEach(el => el.style.display = '');
  }
}

/* ── Data loading ───────────────────────────────────── */
async function refreshAll(filterUserId) {
  allCustomers = await fetchCustomers(filterUserId);

  const allVisits = await fetchAllVisits(filterUserId);
  lastVisitMap = {};
  allVisits.forEach(v => {
    if (!lastVisitMap[v.customer_id] || new Date(v.visited_at) > new Date(lastVisitMap[v.customer_id])) {
      lastVisitMap[v.customer_id] = v.visited_at;
    }
  });

  if (hasRole('manager') && !profiles.length) {
    profiles = await fetchAllProfiles();
    buildSalespersonFilter();
  }

  /* Load planned visits */
  try { nextVisitsCache = await fetchNextVisits(); } catch { nextVisitsCache = []; }

  buildCityFilter(allCustomers);

  customers = activeCity === 'all'
    ? allCustomers
    : allCustomers.filter(c => c.city === activeCity);

  buildMarkers(customers, lastVisitMap, buildPopup);
  updateDashboard(allVisits);
  updatePlannedVisits();
}

/* ── Popup builder ──────────────────────────────────── */
function buildPopup(c, days, lastVisit) {
  const profile = getProfile();
  const isOwner = c.assigned_to === profile.id;
  const canEdit = isOwner || hasRole('admin');

  let statusText = '<span style="color:#EAC435;font-weight:500;">Ej besökt</span>';
  if (days !== null) {
    const col = visitColor(days);
    statusText = `<span style="color:${col};font-weight:500;">${days}d sedan</span> (${formatDate(lastVisit)})`;
  }

  const spName = hasRole('manager') && profiles.length
    ? profiles.find(p => p.id === c.assigned_to)?.display_name || ''
    : '';

  const statusBadge = c.status !== 'active'
    ? `<span class="card-status-badge status-${c.status}" style="font-size:9px;padding:2px 8px;margin-left:8px;">${c.status === 'prospect' ? 'Prospekt' : 'Inaktiv'}</span>`
    : '';

  return `<div class="customer-popup">
    <h3>${c.name}${statusBadge}</h3>
    <p class="kundnr">Kundnr: ${c.customer_nr}</p>
    ${spName ? `<p style="font-size:10px;color:#8a8d91;">Säljare: ${spName}</p>` : ''}
    <p>${c.address || '<em>Adress saknas</em>'}</p>
    <p>${c.zip || ''} ${c.city}</p>
    <a href="${googleMapsUrl(c)}" target="_blank" class="gmaps-link">&#x2197; Öppna i Google Maps</a>

    <hr class="popup-hr">

    <p style="font-size:12px;">Senaste besök: ${statusText}</p>

    ${canEdit ? `
    <div style="margin-top:6px;">
      <input id="vc_${c.id}" type="text" placeholder="Kommentar (valfritt)" class="popup-input" style="margin-bottom:4px;">
      <button onclick="CRM.registerVisit('${c.id}')" class="popup-btn">Registrera besök</button>
    </div>
    ` : ''}

    <hr class="popup-hr">
    <div style="display:flex;gap:6px;">
      <button onclick="CRM.openCard('${c.id}')" class="popup-btn" style="flex:1;">Kundkort</button>
      <button onclick="CRM.addToRoute('${c.id}')" class="popup-btn-outline" style="flex:1;">+ Rutt</button>
    </div>
  </div>`;
}

/* ── Stat detail panel ─────────────────────────────── */
function openStatDetail(stat, allCusts, needsVisitList, visitsThisMonthList) {
  const panel = document.getElementById('statDetail');
  const title = document.getElementById('statDetailTitle');
  const listEl = document.getElementById('statDetailList');
  const searchEl = document.getElementById('statDetailSearch');
  const closeBtn = document.getElementById('statDetailClose');

  let items = [];
  let titleText = '';

  if (stat === 'customers') {
    titleText = `Alla kunder (${allCusts.length})`;
    items = allCusts.map(c => {
      const d = daysSince(lastVisitMap[c.id]);
      const col = d === null ? '#EAC435' : visitColor(d);
      const meta = d === null ? 'Ej besökt' : d + 'd sedan';
      return { id: c.id, name: c.name, city: c.city, meta, col };
    }).sort((a, b) => a.name.localeCompare(b.name, 'sv'));

  } else if (stat === 'visits') {
    titleText = `Besök denna månad (${visitsThisMonthList.length})`;
    items = visitsThisMonthList.map(v => {
      const c = allCusts.find(x => x.id === v.customer_id);
      return {
        id: v.customer_id,
        name: c ? c.name : 'Okänd',
        city: c ? c.city : '',
        meta: formatDate(v.visited_at),
        col: '#2ECC71'
      };
    }).sort((a, b) => a.name.localeCompare(b.name, 'sv'));

  } else if (stat === 'overdue') {
    titleText = `Behöver besök (${needsVisitList.length})`;
    items = needsVisitList.map(c => {
      const d = daysSince(lastVisitMap[c.id]);
      const col = d === null ? '#EAC435' : visitColor(d);
      const meta = d === null ? 'Aldrig besökt' : d + ' dagar';
      return { id: c.id, name: c.name, city: c.city, meta, col };
    }).sort((a, b) => {
      const da = daysSince(lastVisitMap[a.id]) ?? 9999;
      const db = daysSince(lastVisitMap[b.id]) ?? 9999;
      return db - da;
    });

  } else if (stat === 'people') {
    if (hasRole('manager') && profiles.length) {
      titleText = `Säljare (${profiles.filter(p => p.role === 'salesperson').length})`;
      items = profiles.filter(p => p.role === 'salesperson').map(p => {
        const custCount = allCusts.filter(c => c.assigned_to === p.id).length;
        return { id: null, name: p.display_name, city: '', meta: custCount + ' kunder', col: null };
      });
    } else {
      titleText = `Alla kunder (${allCusts.length})`;
      items = allCusts.map(c => ({
        id: c.id, name: c.name, city: c.city, meta: c.city, col: null
      })).sort((a, b) => a.name.localeCompare(b.name, 'sv'));
    }
  }

  title.textContent = titleText;
  searchEl.value = '';
  panel.style.display = 'block';

  function renderList(filter) {
    const q = (filter || '').toLowerCase();
    const filtered = q
      ? items.filter(i => i.name.toLowerCase().includes(q) || (i.city && i.city.toLowerCase().includes(q)))
      : items;

    listEl.innerHTML = filtered.map(i => `
      <div class="stat-detail-item">
        <span class="stat-detail-name" ${i.id ? `onclick="CRM.openCard('${i.id}')"` : ''}>${i.name}${i.city ? ` <span style="color:var(--bm);font-weight:300;">${i.city}</span>` : ''}</span>
        <span class="stat-detail-meta"${i.col ? ` style="color:${i.col}"` : ''}>${i.meta}</span>
      </div>
    `).join('') || '<p style="font-size:12px;color:var(--bm);padding:8px 0;">Inga träffar</p>';
  }

  renderList();
  searchEl.oninput = () => renderList(searchEl.value);
  closeBtn.onclick = () => {
    panel.style.display = 'none';
    document.querySelectorAll('.stat-box').forEach(b => b.classList.remove('active'));
  };
}

/* ── Dashboard ──────────────────────────────────────── */
function updateDashboard(allVisits) {
  const now = new Date();
  const thisMonth = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
  const visitsThisMonth = allVisits.filter(v => v.visited_at.startsWith(thisMonth)).length;

  const needsVisitList = customers.filter(c => {
    const d = daysSince(lastVisitMap[c.id]);
    return d === null || d >= 90;
  });

  const visitsThisMonthList = allVisits.filter(v => v.visited_at.startsWith(thisMonth));

  document.getElementById('statsGrid').innerHTML = `
    <div class="stat-box" data-stat="customers"><div class="num">${customers.length}</div><div class="label">Kunder</div></div>
    <div class="stat-box" data-stat="visits"><div class="num">${visitsThisMonth}</div><div class="label">Besök denna månad</div></div>
    <div class="stat-box" data-stat="overdue"><div class="num" style="color:#E74C3C;">${needsVisitList.length}</div><div class="label">Behöver besök</div></div>
    <div class="stat-box" data-stat="people"><div class="num">${profiles.length || '—'}</div><div class="label">${hasRole('manager') ? 'Säljare' : 'Kunder'}</div></div>
  `;

  document.querySelectorAll('.stat-box[data-stat]').forEach(box => {
    box.addEventListener('click', () => {
      const stat = box.dataset.stat;
      openStatDetail(stat, customers, needsVisitList, visitsThisMonthList);
      document.querySelectorAll('.stat-box').forEach(b => b.classList.remove('active'));
      box.classList.add('active');
    });
  });

  /* Toplist */
  const sorted = customers
    .filter(c => c.lat)
    .map(c => {
      const d = daysSince(lastVisitMap[c.id]);
      return { ...c, days: d === null ? 9999 : d };
    })
    .sort((a, b) => b.days - a.days)
    .slice(0, 10);

  document.getElementById('toplist').innerHTML = sorted.map(c => {
    const col = c.days === 9999 ? '#EAC435' : c.days >= 90 ? '#E74C3C' : c.days >= 60 ? '#E67E22' : '#EAC435';
    const txt = c.days === 9999 ? 'Aldrig' : c.days + 'd';
    return `<div class="toplist-item">
      <span class="toplist-name" onclick="CRM.openCard('${c.id}')">${c.name}</span>
      <span class="toplist-days" style="background:${col}20;color:${col};">${txt}</span>
    </div>`;
  }).join('');

  document.getElementById('dashDate').textContent = now.toLocaleDateString('sv-SE', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });
}

/* ── Planned visits ────────────────────────────────── */
function updatePlannedVisits() {
  const el = document.getElementById('plannedVisits');
  if (!el) return;
  const today = new Date().toISOString().slice(0, 10);

  /* Filter to visible customers */
  const customerIds = new Set(customers.map(c => c.id));
  const relevant = nextVisitsCache
    .filter(nv => customerIds.has(nv.customer_id))
    .sort((a, b) => a.scheduled_date.localeCompare(b.scheduled_date));

  if (!relevant.length) {
    el.innerHTML = '<p style="font-size:11px;color:var(--bm);">Inga planerade besök</p>';
    return;
  }

  el.innerHTML = relevant.slice(0, 15).map(nv => {
    const c = customers.find(x => x.id === nv.customer_id);
    const name = c ? c.name : (nv.customers?.name || 'Okänd');
    const d = nv.scheduled_date;
    let cls = 'upcoming';
    if (d < today) cls = 'overdue';
    else if (d === today) cls = 'today';
    const label = d === today ? 'Idag' : formatDate(d);
    return `<div class="planned-item">
      <span class="toplist-name" onclick="CRM.openCard('${nv.customer_id}')">${name}</span>
      <span class="planned-date ${cls}">${label}</span>
    </div>`;
  }).join('');
}

/* ── Manager: Salesperson filter ────────────────────── */
function buildSalespersonFilter() {
  const sel = document.getElementById('spFilter');
  if (!sel) return;
  sel.innerHTML = '<option value="all">Alla säljare</option>' +
    profiles.filter(p => p.role === 'salesperson').map(p =>
      `<option value="${p.id}">${p.display_name}</option>`
    ).join('');

  sel.addEventListener('change', () => {
    const clearBtn = document.getElementById('spFilterClear');
    if (clearBtn) clearBtn.style.display = sel.value === 'all' ? 'none' : 'flex';
    refreshAll(sel.value);
  });

  const clearBtn = document.getElementById('spFilterClear');
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      sel.value = 'all';
      clearBtn.style.display = 'none';
      refreshAll('all');
    });
  }
}

/* ── City filter (all roles) ───────────────────────── */
let _cityFilterBound = false;
function applyCityFilter() {
  const sel = document.getElementById('cityFilter');
  const clearBtn = document.getElementById('cityFilterClear');
  if (!sel) return;

  customers = activeCity === 'all'
    ? allCustomers
    : allCustomers.filter(c => c.city === activeCity);
  buildMarkers(customers, lastVisitMap, buildPopup);

  if (clearBtn) clearBtn.style.display = activeCity === 'all' ? 'none' : 'flex';

  const filteredVisits = Object.keys(lastVisitMap)
    .filter(cid => customers.some(c => c.id === cid))
    .map(cid => ({ customer_id: cid, visited_at: lastVisitMap[cid] }));
  updateDashboard(filteredVisits);
  updatePlannedVisits();
}

function buildCityFilter(custs) {
  const sel = document.getElementById('cityFilter');
  if (!sel) return;

  const cities = [...new Set(custs.map(c => c.city).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'sv'));
  sel.innerHTML = '<option value="all">Alla orter</option>' +
    cities.map(city => `<option value="${city}"${city === activeCity ? ' selected' : ''}>${city}</option>`).join('');

  if (!_cityFilterBound) {
    sel.addEventListener('change', () => {
      activeCity = sel.value;
      applyCityFilter();
    });

    const clearBtn = document.getElementById('cityFilterClear');
    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        activeCity = 'all';
        sel.value = 'all';
        applyCityFilter();
      });
    }
    _cityFilterBound = true;
  }
}

/* ── Comparison stats (manager/admin) ───────────────── */
function updateComparison(allVisits) {
  if (!hasRole('manager')) return;
  const now = new Date();
  const thisMonth = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');

  const stats = profiles.filter(p => p.role === 'salesperson').map(p => {
    const custCount = customers.filter(c => c.assigned_to === p.id).length;
    const monthVisits = allVisits.filter(v => v.user_id === p.id && v.visited_at.startsWith(thisMonth)).length;
    return { name: p.display_name, custCount, monthVisits };
  });

  const table = document.getElementById('comparisonTable');
  if (!table) return;
  table.innerHTML = `<table style="width:100%;font-size:11px;">
    <tr style="color:var(--bm);"><td>Säljare</td><td>Kunder</td><td>Besök/mån</td></tr>
    ${stats.map(s => `<tr><td>${s.name}</td><td>${s.custCount}</td><td>${s.monthVisits}</td></tr>`).join('')}
  </table>`;
}

/* ── Customer card rendering ───────────────────────── */
async function renderCard(customerId) {
  /* Search across allCustomers so card works even when filtered */
  const c = allCustomers.find(x => x.id === customerId) || customers.find(x => x.id === customerId);
  if (!c) return;

  const profile = getProfile();
  const isOwner = c.assigned_to === profile.id;
  const canEdit = isOwner || hasRole('admin');

  const [visits, contacts, comments, revenue] = await Promise.all([
    fetchVisits(customerId),
    fetchContacts(customerId),
    fetchComments(customerId),
    fetchRevenue(customerId)
  ]);

  const days = daysSince(lastVisitMap[c.id]);
  const col = days === null ? '#EAC435' : visitColor(days);
  const statusTxt = days === null ? 'Ej besökt' : days + ' dagar sedan';

  const spName = profiles.length
    ? profiles.find(p => p.id === c.assigned_to)?.display_name || '—'
    : '';

  const revTotal = revenue.reduce((s, r) => s + (r.amount || 0), 0);

  /* Status label */
  const statusLabels = { active: 'Aktiv', prospect: 'Prospekt', inactive: 'Inaktiv' };
  const statusClass = `status-${c.status || 'active'}`;

  /* Next visit */
  const nv = nextVisitsCache.find(n => n.customer_id === customerId);
  const nvDate = nv ? nv.scheduled_date : '';

  const html = `
    <!-- Top info -->
    <div class="card-top">
      <div style="flex:1;">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:4px;">
          <h2 class="card-title">${c.name}</h2>
          <span class="card-status-badge ${statusClass}">${statusLabels[c.status] || 'Aktiv'}</span>
        </div>
        <p class="card-subtitle">Kundnr: ${c.customer_nr}</p>
        <p class="card-subtitle">${c.address || ''}</p>
        <p class="card-subtitle">${c.zip || ''} ${c.city}</p>
        ${spName ? `<p class="card-subtitle">Säljare: ${spName}</p>` : ''}
        <a href="${googleMapsUrl(c)}" target="_blank" class="card-link">&#x2197; Google Maps</a>
        ${canEdit ? `<button class="card-add-btn" style="margin-top:8px;margin-left:8px;" onclick="CRM.openEditCustomer('${c.id}')">Redigera</button>` : ''}
      </div>
    </div>

    <!-- Stats row -->
    <div class="card-stats">
      <div class="card-stat">
        <div class="card-stat-num" style="color:${col};">${days === null ? '—' : days + 'd'}</div>
        <div class="card-stat-label">Sedan besök</div>
      </div>
      <div class="card-stat">
        <div class="card-stat-num">${visits.length}</div>
        <div class="card-stat-label">Besök totalt</div>
      </div>
      <div class="card-stat">
        <div class="card-stat-num">${contacts.length}</div>
        <div class="card-stat-label">Kontakter</div>
      </div>
      <div class="card-stat">
        <div class="card-stat-num">${revTotal ? formatSEK(revTotal) : '—'}</div>
        <div class="card-stat-label">Omsättning</div>
      </div>
    </div>

    <!-- Register visit + schedule next -->
    ${canEdit ? `
    <div class="card-section">
      <div class="card-section-header"><h3>Registrera besök</h3></div>
      <div style="display:flex;gap:8px;margin-bottom:8px;">
        <input id="cardVisitComment" class="card-input" placeholder="Kommentar (valfritt)" style="flex:1;">
        <button class="card-action-btn" onclick="CRM.cardRegisterVisit('${c.id}')">Registrera</button>
      </div>
      <div style="display:flex;gap:8px;align-items:center;">
        <label style="font-size:10px;text-transform:uppercase;letter-spacing:.5px;color:var(--bm);white-space:nowrap;margin:0;">Nästa besök:</label>
        <input id="cardNextVisit" type="date" class="card-input" value="${nvDate}" style="flex:1;">
        <button class="card-add-btn" onclick="CRM.cardSetNextVisit('${c.id}')" style="white-space:nowrap;">${nvDate ? 'Uppdatera' : 'Planera'}</button>
        ${nvDate ? `<button class="route-stop-remove" onclick="CRM.cardRemoveNextVisit('${c.id}')" title="Ta bort">&#x2715;</button>` : ''}
      </div>
    </div>
    ` : ''}

    <!-- Visit history -->
    <div class="card-section">
      <div class="card-section-header"><h3>Besökshistorik</h3></div>
      ${visits.length ? visits.slice(0, 20).map(v => `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid var(--bb);">
          <div>
            <span style="font-size:12px;font-weight:500;">${formatDate(v.visited_at)}</span>
            ${v.comment ? `<span style="font-size:11px;color:var(--bm);margin-left:8px;">${v.comment}</span>` : ''}
          </div>
          ${canEdit ? `<button onclick="CRM.cardDeleteVisit('${v.id}','${c.id}')" style="background:none;border:none;color:#E74C3C;cursor:pointer;font-size:11px;padding:4px 8px;">Ta bort</button>` : ''}
        </div>
      `).join('') : '<p style="font-size:12px;color:var(--bm);">Inga besök registrerade</p>'}
    </div>

    <!-- Contacts -->
    <div class="card-section">
      <div class="card-section-header">
        <h3>Kontakter</h3>
        ${canEdit ? `<button class="card-add-btn" onclick="CRM.toggleAddContact('${c.id}')">+ Lägg till</button>` : ''}
      </div>
      <div id="addContactForm" style="display:none;margin-bottom:10px;">
        <input id="contactName" class="card-input" placeholder="Namn" style="margin-bottom:4px;">
        <input id="contactRole" class="card-input" placeholder="Roll/Titel" style="margin-bottom:4px;">
        <input id="contactPhone" class="card-input" placeholder="Telefon" style="margin-bottom:4px;">
        <input id="contactEmail" class="card-input" placeholder="E-post" style="margin-bottom:4px;">
        <button class="card-action-btn" onclick="CRM.cardAddContact('${c.id}')">Spara kontakt</button>
      </div>
      ${contacts.length ? contacts.map(ct => `
        <div style="padding:8px 0;border-bottom:1px solid var(--bb);">
          <div style="display:flex;justify-content:space-between;align-items:start;">
            <div>
              <span style="font-size:13px;font-weight:500;">${ct.name || ct.person_name}</span>
              ${ct.is_primary ? '<span style="font-size:9px;background:var(--bd);color:var(--bl);padding:1px 6px;margin-left:6px;text-transform:uppercase;letter-spacing:.5px;">Primär</span>' : ''}
              ${ct.role ? `<p style="font-size:11px;color:var(--bm);margin-top:2px;">${ct.role}</p>` : ''}
            </div>
            ${canEdit ? `<button onclick="CRM.cardDeleteContact('${ct.id}','${c.id}')" style="background:none;border:none;color:#E74C3C;cursor:pointer;font-size:11px;padding:4px 8px;">Ta bort</button>` : ''}
          </div>
          <div style="margin-top:4px;font-size:12px;">
            ${ct.phone ? `<a href="tel:${ct.phone}" style="color:var(--bd);text-decoration:none;margin-right:12px;">${ct.phone}</a>` : ''}
            ${ct.email ? `<a href="mailto:${ct.email}" style="color:var(--bd);text-decoration:none;">${ct.email}</a>` : ''}
          </div>
        </div>
      `).join('') : '<p style="font-size:12px;color:var(--bm);">Inga kontakter</p>'}
    </div>

    <!-- Comments -->
    <div class="card-section">
      <div class="card-section-header"><h3>Kommentarer</h3></div>
      ${canEdit ? `
      <div style="display:flex;gap:8px;margin-bottom:10px;">
        <input id="cardCommentText" class="card-input" placeholder="Skriv en kommentar..." style="flex:1;">
        <button class="card-action-btn" onclick="CRM.cardAddComment('${c.id}')">Lägg till</button>
      </div>
      ` : ''}
      ${comments.length ? comments.map(cm => `
        <div style="padding:6px 0;border-bottom:1px solid var(--bb);">
          <div style="display:flex;justify-content:space-between;">
            <span style="font-size:12px;">${cm.body || cm.text}</span>
            ${canEdit ? `<button onclick="CRM.cardDeleteComment('${cm.id}','${c.id}')" style="background:none;border:none;color:#E74C3C;cursor:pointer;font-size:11px;padding:4px 8px;">Ta bort</button>` : ''}
          </div>
          <p style="font-size:10px;color:var(--bm);margin-top:2px;">${formatDate(cm.created_at)}</p>
        </div>
      `).join('') : '<p style="font-size:12px;color:var(--bm);">Inga kommentarer</p>'}
    </div>

    <!-- Revenue -->
    <div class="card-section">
      <div class="card-section-header">
        <h3>Omsättning</h3>
        ${canEdit ? `<button class="card-add-btn" onclick="CRM.toggleAddRevenue('${c.id}')">+ Lägg till</button>` : ''}
      </div>
      <div id="addRevenueForm" style="display:none;margin-bottom:10px;">
        <div style="display:flex;gap:8px;">
          <input id="revYear" class="card-input" type="number" placeholder="År" value="${new Date().getFullYear()}" style="width:80px;">
          <input id="revAmount" class="card-input" type="number" placeholder="Belopp (SEK)" style="flex:1;">
          <button class="card-action-btn" onclick="CRM.cardAddRevenue('${c.id}')">Spara</button>
        </div>
      </div>
      ${revenue.length ? `
        <table style="width:100%;font-size:12px;border-collapse:collapse;">
          <tr style="color:var(--bm);font-size:10px;text-transform:uppercase;letter-spacing:.5px;">
            <td style="padding:4px 0;">År</td><td style="text-align:right;padding:4px 0;">Belopp</td>
            ${canEdit ? '<td></td>' : ''}
          </tr>
          ${revenue.map(r => `
            <tr style="border-bottom:1px solid var(--bb);">
              <td style="padding:6px 0;">${r.year}</td>
              <td style="text-align:right;padding:6px 0;">${formatSEK(r.amount)}</td>
              ${canEdit ? `<td style="text-align:right;"><button onclick="CRM.cardDeleteRevenue('${r.id}','${c.id}')" style="background:none;border:none;color:#E74C3C;cursor:pointer;font-size:11px;padding:4px;">Ta bort</button></td>` : ''}
            </tr>
          `).join('')}
        </table>
      ` : '<p style="font-size:12px;color:var(--bm);">Ingen omsättning registrerad</p>'}
    </div>

    <!-- Delete customer (admin only) -->
    ${hasRole('admin') ? `
    <div class="card-section" style="border-bottom:none;">
      <button class="popup-btn-danger" onclick="CRM.cardDeleteCustomer('${c.id}')">Ta bort kund</button>
    </div>
    ` : ''}
  `;

  document.getElementById('cardContent').innerHTML = html;
}

/* ── Route planner helpers ─────────────────────────── */
function renderRouteStops() {
  const el = document.getElementById('routeStops');
  const countEl = document.getElementById('routeCount');
  if (!el) return;
  countEl.textContent = routeStops.length;

  if (!routeStops.length) {
    el.innerHTML = '<p style="font-size:11px;color:var(--bm);">Inga stopp valda</p>';
    return;
  }

  el.innerHTML = routeStops.map((id, i) => {
    const c = allCustomers.find(x => x.id === id);
    if (!c) return '';
    return `<div class="route-stop">
      <span class="route-stop-num">${i + 1}</span>
      <span class="route-stop-name">${c.name} <span style="color:var(--bm);font-size:10px;">${c.city}</span></span>
      <button class="route-stop-remove" onclick="CRM.removeFromRoute('${id}')">&#x2715;</button>
    </div>`;
  }).join('');
}

function renderRouteSearch(query) {
  const el = document.getElementById('routeSearchResults');
  if (!el || !query) { if (el) el.innerHTML = ''; return; }

  const q = query.toLowerCase();
  const results = allCustomers
    .filter(c => c.lat && !routeStops.includes(c.id) &&
      (c.name.toLowerCase().includes(q) || c.city.toLowerCase().includes(q) || c.customer_nr.toLowerCase().includes(q)))
    .slice(0, 8);

  el.innerHTML = results.map(c =>
    `<div class="route-search-item" onclick="CRM.addToRoute('${c.id}')">${c.name} <span style="color:var(--bm);font-size:10px;">${c.city}</span></div>`
  ).join('') || '<p style="font-size:11px;color:var(--bm);padding:4px;">Inga resultat</p>';
}

/* ── Admin panel helpers ──────────────────────────── */
async function renderAdminUsers() {
  const el = document.getElementById('adminUsersList');
  if (!el) return;

  if (!profiles.length) profiles = await fetchAllProfiles();

  el.innerHTML = profiles.map(p => `
    <div class="admin-user-row">
      <span class="admin-user-name">${p.display_name}</span>
      <span class="admin-user-email">${p.email}</span>
      <span class="admin-user-role">
        <select onchange="CRM.changeRole('${p.id}', this.value)" ${p.id === getProfile().id ? 'disabled' : ''}>
          <option value="salesperson" ${p.role === 'salesperson' ? 'selected' : ''}>Säljare</option>
          <option value="manager" ${p.role === 'manager' ? 'selected' : ''}>Chef</option>
          <option value="admin" ${p.role === 'admin' ? 'selected' : ''}>Admin</option>
        </select>
      </span>
    </div>
  `).join('');
}

function renderReassignDropdowns() {
  const opts = profiles.filter(p => p.role === 'salesperson').map(p =>
    `<option value="${p.id}">${p.display_name}</option>`
  ).join('');

  document.getElementById('reassignFrom').innerHTML = '<option value="">Välj...</option>' + opts;
  document.getElementById('reassignTo').innerHTML = '<option value="">Välj...</option>' + opts;

  document.getElementById('reassignFrom').onchange = () => renderReassignList();
}

function renderReassignList() {
  const fromId = document.getElementById('reassignFrom').value;
  const el = document.getElementById('reassignList');
  if (!fromId || !el) { if (el) el.innerHTML = ''; return; }

  const custs = allCustomers.filter(c => c.assigned_to === fromId);
  el.innerHTML = custs.length ? custs.map(c => `
    <div class="reassign-item">
      <label><input type="checkbox" value="${c.id}" checked> ${c.name} <span style="color:var(--bm);font-size:10px;">(${c.city})</span></label>
    </div>
  `).join('') : '<p style="font-size:12px;color:var(--bm);">Inga kunder</p>';
}

/* ── Global CRM actions (for onclick handlers) ────── */
window.CRM = {
  /* Visit registration */
  async registerVisit(customerId) {
    const input = document.getElementById('vc_' + customerId);
    const comment = input ? input.value.trim() : '';
    await registerVisit(customerId, getProfile().id, comment);
    await refreshAll();
  },

  /* Card open/close */
  async openCard(customerId) {
    document.getElementById('customerCard').classList.add('open');
    document.getElementById('cardOverlay').classList.add('open');
    document.getElementById('cardContent').innerHTML = '<p style="padding:40px;text-align:center;color:var(--bm);">Laddar...</p>';

    const sidebar = document.getElementById('sidebar');
    if (sidebar.classList.contains('open')) {
      sidebar.classList.remove('open');
      document.getElementById('dashBtn').classList.remove('active');
      invalidateSize();
    }
    getMapInstance()?.closePopup();
    await renderCard(customerId);
  },

  closeCard() {
    document.getElementById('customerCard').classList.remove('open');
    document.getElementById('cardOverlay').classList.remove('open');
  },

  /* Card actions */
  async cardRegisterVisit(customerId) {
    const input = document.getElementById('cardVisitComment');
    const comment = input ? input.value.trim() : '';
    await registerVisit(customerId, getProfile().id, comment);
    await refreshAll();
    await renderCard(customerId);
  },

  async cardDeleteVisit(visitId, customerId) {
    await deleteVisit(visitId);
    await refreshAll();
    await renderCard(customerId);
  },

  /* Next visit scheduling */
  async cardSetNextVisit(customerId) {
    const input = document.getElementById('cardNextVisit');
    const date = input ? input.value : '';
    if (!date) return;
    await setNextVisit(customerId, date);
    try { nextVisitsCache = await fetchNextVisits(); } catch { /* */ }
    updatePlannedVisits();
    await renderCard(customerId);
  },

  async cardRemoveNextVisit(customerId) {
    await removeNextVisit(customerId);
    try { nextVisitsCache = await fetchNextVisits(); } catch { /* */ }
    updatePlannedVisits();
    await renderCard(customerId);
  },

  /* Contacts */
  toggleAddContact() {
    const form = document.getElementById('addContactForm');
    form.style.display = form.style.display === 'none' ? 'block' : 'none';
  },

  async cardAddContact(customerId) {
    const name = document.getElementById('contactName').value.trim();
    if (!name) return;
    await addContact(customerId, {
      name,
      role: document.getElementById('contactRole').value.trim() || null,
      phone: document.getElementById('contactPhone').value.trim() || null,
      email: document.getElementById('contactEmail').value.trim() || null
    });
    await renderCard(customerId);
  },

  async cardDeleteContact(contactId, customerId) {
    await deleteContact(contactId);
    await renderCard(customerId);
  },

  /* Comments */
  async cardAddComment(customerId) {
    const input = document.getElementById('cardCommentText');
    const text = input ? input.value.trim() : '';
    if (!text) return;
    await addComment(customerId, getProfile().id, text);
    await renderCard(customerId);
  },

  async cardDeleteComment(commentId, customerId) {
    await deleteComment(commentId);
    await renderCard(customerId);
  },

  /* Revenue */
  toggleAddRevenue() {
    const form = document.getElementById('addRevenueForm');
    form.style.display = form.style.display === 'none' ? 'block' : 'none';
  },

  async cardAddRevenue(customerId) {
    const year = parseInt(document.getElementById('revYear').value);
    const amount = parseFloat(document.getElementById('revAmount').value);
    if (!year || !amount) return;
    await upsertRevenue(customerId, year, amount);
    await renderCard(customerId);
  },

  async cardDeleteRevenue(revenueId, customerId) {
    await deleteRevenue(revenueId);
    await renderCard(customerId);
  },

  /* Delete customer */
  async cardDeleteCustomer(customerId) {
    if (!confirm('Vill du verkligen ta bort denna kund? Allt data (besök, kontakter, kommentarer, omsättning) raderas permanent.')) return;
    await deleteCustomer(customerId);
    CRM.closeCard();
    await refreshAll();
  },

  /* ── Add customer ─────────────────────────────────── */
  openAddCustomer() {
    document.getElementById('addCustModal').classList.add('active');
    document.getElementById('acName').value = '';
    document.getElementById('acNr').value = '';
    document.getElementById('acAddress').value = '';
    document.getElementById('acZip').value = '';
    document.getElementById('acCity').value = '';
    document.getElementById('acStatus').value = 'active';
    document.getElementById('acError').style.display = 'none';

    /* Populate assign dropdown for admin */
    if (hasRole('admin') && profiles.length) {
      const sel = document.getElementById('acAssign');
      sel.innerHTML = `<option value="${getProfile().id}">${getProfile().display_name} (jag)</option>` +
        profiles.filter(p => p.id !== getProfile().id).map(p =>
          `<option value="${p.id}">${p.display_name}</option>`
        ).join('');
    }
  },

  closeAddCustomer() {
    document.getElementById('addCustModal').classList.remove('active');
  },

  async saveNewCustomer() {
    const name = document.getElementById('acName').value.trim();
    const city = document.getElementById('acCity').value.trim();
    const errEl = document.getElementById('acError');

    if (!name || !city) {
      errEl.textContent = 'Företagsnamn och ort krävs.';
      errEl.style.display = 'block';
      return;
    }

    errEl.style.display = 'none';

    const address = document.getElementById('acAddress').value.trim();
    const zip = document.getElementById('acZip').value.trim();
    const geoQuery = [address, zip, city].filter(Boolean).join(', ');
    const coords = await geocodeAddress(geoQuery);

    const customer = {
      name,
      customer_nr: document.getElementById('acNr').value.trim(),
      address,
      zip,
      city,
      status: document.getElementById('acStatus').value,
      assigned_to: hasRole('admin') ? document.getElementById('acAssign').value : getProfile().id,
      lat: coords?.lat || null,
      lng: coords?.lng || null
    };

    try {
      await createCustomer(customer);
      CRM.closeAddCustomer();
      await refreshAll();
    } catch (e) {
      errEl.textContent = 'Kunde inte spara: ' + (e.message || e);
      errEl.style.display = 'block';
    }
  },

  /* ── Edit customer ────────────────────────────────── */
  openEditCustomer(customerId) {
    const c = allCustomers.find(x => x.id === customerId);
    if (!c) return;

    document.getElementById('editCustModal').classList.add('active');
    document.getElementById('ecId').value = c.id;
    document.getElementById('ecName').value = c.name;
    document.getElementById('ecNr').value = c.customer_nr || '';
    document.getElementById('ecAddress').value = c.address || '';
    document.getElementById('ecZip').value = c.zip || '';
    document.getElementById('ecCity').value = c.city || '';
    document.getElementById('ecStatus').value = c.status || 'active';
    document.getElementById('ecError').style.display = 'none';

    if (hasRole('admin') && profiles.length) {
      const sel = document.getElementById('ecAssign');
      sel.innerHTML = profiles.map(p =>
        `<option value="${p.id}" ${p.id === c.assigned_to ? 'selected' : ''}>${p.display_name}</option>`
      ).join('');
    }
  },

  closeEditCustomer() {
    document.getElementById('editCustModal').classList.remove('active');
  },

  async saveEditCustomer() {
    const id = document.getElementById('ecId').value;
    const name = document.getElementById('ecName').value.trim();
    const city = document.getElementById('ecCity').value.trim();
    const errEl = document.getElementById('ecError');

    if (!name || !city) {
      errEl.textContent = 'Företagsnamn och ort krävs.';
      errEl.style.display = 'block';
      return;
    }

    errEl.style.display = 'none';

    const address = document.getElementById('ecAddress').value.trim();
    const zip = document.getElementById('ecZip').value.trim();

    /* Re-geocode if address changed */
    const old = allCustomers.find(x => x.id === id);
    let lat = old?.lat, lng = old?.lng;
    if (old && (address !== old.address || zip !== old.zip || city !== old.city)) {
      const geoQuery = [address, zip, city].filter(Boolean).join(', ');
      const coords = await geocodeAddress(geoQuery);
      if (coords) { lat = coords.lat; lng = coords.lng; }
    }

    const updates = {
      name,
      customer_nr: document.getElementById('ecNr').value.trim(),
      address,
      zip,
      city,
      status: document.getElementById('ecStatus').value,
      lat,
      lng
    };

    if (hasRole('admin')) {
      updates.assigned_to = document.getElementById('ecAssign').value;
    }

    try {
      await updateCustomer(id, updates);
      CRM.closeEditCustomer();
      await refreshAll();
      await renderCard(id);
    } catch (e) {
      errEl.textContent = 'Kunde inte spara: ' + (e.message || e);
      errEl.style.display = 'block';
    }
  },

  /* ── Admin panel ──────────────────────────────────── */
  openAdmin() {
    document.getElementById('adminModal').classList.add('active');
    renderAdminUsers();
    renderReassignDropdowns();
  },

  closeAdmin() {
    document.getElementById('adminModal').classList.remove('active');
  },

  adminTab(tab) {
    document.querySelectorAll('.admin-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
    document.getElementById('adminUsersTab').style.display = tab === 'users' ? 'block' : 'none';
    document.getElementById('adminReassignTab').style.display = tab === 'reassign' ? 'block' : 'none';
  },

  async changeRole(userId, newRole) {
    const { error } = await sb
      .from('profiles')
      .update({ role: newRole })
      .eq('id', userId);
    if (error) { alert('Kunde inte ändra roll: ' + error.message); return; }
    /* Refresh profiles */
    profiles = await fetchAllProfiles();
    renderAdminUsers();
  },

  async executeReassign() {
    const toId = document.getElementById('reassignTo').value;
    if (!toId) { alert('Välj en mottagande säljare.'); return; }

    const checkboxes = document.querySelectorAll('#reassignList input[type="checkbox"]:checked');
    const ids = [...checkboxes].map(cb => cb.value);
    if (!ids.length) { alert('Inga kunder valda.'); return; }

    try {
      await reassignCustomers(ids, toId);
      await refreshAll();
      renderReassignList();
      alert(`${ids.length} kund(er) flyttade.`);
    } catch (e) {
      alert('Fel: ' + (e.message || e));
    }
  },

  /* ── Route planner ────────────────────────────────── */
  openRoutePanel() {
    document.getElementById('routePanel').style.display = 'block';
    renderRouteStops();
  },

  closeRoutePanel() {
    document.getElementById('routePanel').style.display = 'none';
  },

  addToRoute(customerId) {
    if (routeStops.includes(customerId)) return;
    const c = allCustomers.find(x => x.id === customerId);
    if (!c || !c.lat) return;
    routeStops.push(customerId);
    renderRouteStops();
    /* Open panel if not visible */
    document.getElementById('routePanel').style.display = 'block';
    /* Clear search */
    const searchEl = document.getElementById('routeSearch');
    if (searchEl) { searchEl.value = ''; renderRouteSearch(''); }
  },

  removeFromRoute(customerId) {
    routeStops = routeStops.filter(id => id !== customerId);
    renderRouteStops();
  },

  clearRoute() {
    routeStops = [];
    renderRouteStops();
  },

  optimizeRoute() {
    if (routeStops.length < 2) {
      /* Single stop — just open Google Maps directions */
      if (routeStops.length === 1) {
        const c = allCustomers.find(x => x.id === routeStops[0]);
        if (c) window.open(googleMapsUrl(c), '_blank');
      }
      return;
    }

    /* Simple nearest-neighbor optimization */
    const stops = routeStops.map(id => allCustomers.find(x => x.id === id)).filter(Boolean);
    const optimized = [stops[0]];
    const remaining = stops.slice(1);

    while (remaining.length) {
      const last = optimized[optimized.length - 1];
      let nearest = 0;
      let minDist = Infinity;
      remaining.forEach((c, i) => {
        const d = haversine(last.lat, last.lng, c.lat, c.lng);
        if (d < minDist) { minDist = d; nearest = i; }
      });
      optimized.push(remaining.splice(nearest, 1)[0]);
    }

    /* Build Google Maps multi-stop URL */
    const origin = `${optimized[0].address || ''}, ${optimized[0].zip || ''} ${optimized[0].city}`;
    const dest = `${optimized[optimized.length - 1].address || ''}, ${optimized[optimized.length - 1].zip || ''} ${optimized[optimized.length - 1].city}`;
    const waypoints = optimized.slice(1, -1).map(c =>
      encodeURIComponent(`${c.address || ''}, ${c.zip || ''} ${c.city}`)
    ).join('|');

    const url = `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(dest)}&waypoints=${waypoints}&travelmode=driving`;
    window.open(url, '_blank');

    /* Update stop order */
    routeStops = optimized.map(c => c.id);
    renderRouteStops();
  }
};

/* ── Event bindings ─────────────────────────────────── */
function bindEvents() {
  /* Search */
  document.getElementById('search').addEventListener('input', e => search(e.target.value));

  /* Home */
  document.getElementById('homeBtn').addEventListener('click', () => {
    resetView();
    document.getElementById('search').value = '';
    const sidebar = document.getElementById('sidebar');
    if (sidebar.classList.contains('open')) {
      sidebar.classList.remove('open');
      document.getElementById('dashBtn').classList.remove('active');
      invalidateSize();
    }
  });

  /* Dashboard toggle */
  document.getElementById('dashBtn').addEventListener('click', () => {
    const sidebar = document.getElementById('sidebar');
    sidebar.classList.toggle('open');
    document.getElementById('dashBtn').classList.toggle('active');
    invalidateSize();
  });

  /* Sidebar close */
  const closeSidebar = () => {
    document.getElementById('sidebar').classList.remove('open');
    document.getElementById('dashBtn').classList.remove('active');
    invalidateSize();
  };

  document.getElementById('sidebarCloseBtn').addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    closeSidebar();
  });

  document.getElementById('sidebarBackdrop').addEventListener('click', closeSidebar);

  /* Add customer button */
  document.getElementById('addCustBtn').addEventListener('click', () => CRM.openAddCustomer());

  /* Route planner button */
  document.getElementById('routeBtn').addEventListener('click', () => {
    const panel = document.getElementById('routePanel');
    if (panel.style.display === 'none' || !panel.style.display) {
      CRM.openRoutePanel();
    } else {
      CRM.closeRoutePanel();
    }
  });

  /* Route search */
  document.getElementById('routeSearch')?.addEventListener('input', e => renderRouteSearch(e.target.value));

  /* Admin button */
  document.getElementById('adminBtn').addEventListener('click', () => CRM.openAdmin());

  /* Theme */
  document.getElementById('themeBtn').addEventListener('click', function () {
    const dark = toggleTheme();
    this.textContent = dark ? '☀️' : '🌙';
  });

  /* Logout */
  document.getElementById('logoutBtn').addEventListener('click', () => logout());

  /* Filters */
  document.querySelectorAll('.filter-chip').forEach(chip => {
    chip.addEventListener('click', function () {
      document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
      this.classList.add('active');
      setFilter(this.dataset.filter);
      refreshAll();
    });
  });

  /* Export CSV */
  document.getElementById('exportBtn').addEventListener('click', () => {
    const header = '"Kundnr";"Företagsnamn";"Adress";"Postnr";"Ort";"Status";"Senaste besök"';
    const rows = customers.map(c => {
      const lv = lastVisitMap[c.id] ? formatDate(lastVisitMap[c.id]) : '';
      return `"${c.customer_nr}";"${c.name}";"${c.address || ''}";"${c.zip || ''}";"${c.city}";"${c.status}";"${lv}"`;
    });
    const csv = '﻿' + header + '\n' + rows.join('\n') + '\n';
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'berkeley_crm_export.csv';
    a.click();
  });
}

/* ── Start ──────────────────────────────────────────── */
init();
