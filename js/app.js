/**
 * Berkeley CRM — App
 * Main entry point. All features.
 */

import { sb } from './supabase-client.js';
import { requireAuth, logout, onAuthChange } from './auth.js';
import { loadProfile, getProfile, getRole, hasRole, fetchAllProfiles } from './role.js';
import { fetchCustomers, createCustomer, updateCustomer, deleteCustomer, reassignCustomers } from './customers.js';
import { fetchAllVisits, fetchVisits, registerVisit, deleteVisit } from './visits.js';
import { addComment, deleteComment, fetchComments } from './comments.js';
import { upsertRevenue, deleteRevenue, fetchRevenue, fetchAllRevenue } from './revenue.js';
import { fetchContacts, addContact, updateContact, deleteContact } from './contacts.js';
import { fetchNextVisits, setNextVisit, removeNextVisit } from './next-visits.js';
import { fetchTodos, addTodo, toggleTodo, deleteTodo } from './todos.js';
import { daysSince, formatDate, formatSEK, visitColor, googleMapsUrl, geocodeAddress, haversine } from './helpers.js';
import { HQ, MAP_CENTER, MAP_ZOOM } from './config.js';
import { initMap, buildMarkers, setFilter, flyTo, search, resetView, invalidateSize, getMapInstance, toggleTheme } from './map.js';

/* ── State ──────────────────────────────────────────── */
let customers = [];
let allCustomers = [];
let lastVisitMap = {};
let allVisitsCache = [];
let profiles = [];
let activeCity = 'all';
let activeStatus = 'all';
let nextVisitsCache = [];
let routeStops = [];
let chartInstances = {};

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

  /* Check if this is a password recovery redirect */
  const hash = window.location.hash;
  if (hash.includes('type=recovery') || hash.includes('type=magiclink')) {
    setTimeout(() => {
      CRM.openChangePw();
      const msg = document.getElementById('changePwMsg');
      msg.textContent = 'Ange ditt nya lösenord.';
      msg.style.color = 'var(--bd)';
      msg.style.display = 'block';
    }, 500);
  }

  /* Also listen for Supabase PASSWORD_RECOVERY event */
  sb.auth.onAuthStateChange((event) => {
    if (event === 'PASSWORD_RECOVERY') {
      CRM.openChangePw();
      const msg = document.getElementById('changePwMsg');
      msg.textContent = 'Ange ditt nya lösenord.';
      msg.style.color = 'var(--bd)';
      msg.style.display = 'block';
    }
  });
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

/* ── Combined filter logic ─────────────────────────── */
function applyFilters() {
  customers = allCustomers;
  if (activeCity !== 'all') customers = customers.filter(c => c.city === activeCity);
  if (activeStatus !== 'all') customers = customers.filter(c => (c.status || 'active') === activeStatus);

  buildMarkers(customers, lastVisitMap, buildPopup);

  const filteredVisits = allVisitsCache.filter(v => customers.some(c => c.id === v.customer_id));
  updateDashboard(filteredVisits);
  updatePlannedVisits();
  updateActivityFeed();
}

/* ── Data loading ───────────────────────────────────── */
async function refreshAll(filterUserId) {
  allCustomers = await fetchCustomers(filterUserId);

  allVisitsCache = await fetchAllVisits(filterUserId);
  lastVisitMap = {};
  allVisitsCache.forEach(v => {
    if (!lastVisitMap[v.customer_id] || new Date(v.visited_at) > new Date(lastVisitMap[v.customer_id])) {
      lastVisitMap[v.customer_id] = v.visited_at;
    }
  });

  if (hasRole('manager') && !profiles.length) {
    profiles = await fetchAllProfiles();
    buildSalespersonFilter();
  }

  try { nextVisitsCache = await fetchNextVisits(); } catch { nextVisitsCache = []; }

  buildCityFilter(allCustomers);
  applyFilters();
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
    ? profiles.find(p => p.id === c.assigned_to)?.display_name || '' : '';

  const statusBadge = c.status !== 'active'
    ? `<span class="card-status-badge status-${c.status}" style="font-size:9px;padding:2px 8px;margin-left:8px;">${c.status === 'prospect' ? 'Prospekt' : 'Inaktiv'}</span>` : '';

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
    </div>` : ''}
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
      return { id: v.customer_id, name: c ? c.name : 'Okänd', city: c ? c.city : '', meta: formatDate(v.visited_at), col: '#2ECC71' };
    }).sort((a, b) => a.name.localeCompare(b.name, 'sv'));
  } else if (stat === 'overdue') {
    titleText = `Behöver besök (${needsVisitList.length})`;
    items = needsVisitList.map(c => {
      const d = daysSince(lastVisitMap[c.id]);
      const col = d === null ? '#EAC435' : visitColor(d);
      const meta = d === null ? 'Aldrig besökt' : d + ' dagar';
      return { id: c.id, name: c.name, city: c.city, meta, col };
    }).sort((a, b) => (daysSince(lastVisitMap[b.id]) ?? 9999) - (daysSince(lastVisitMap[a.id]) ?? 9999));
  } else if (stat === 'people') {
    if (hasRole('manager') && profiles.length) {
      titleText = `Säljare (${profiles.filter(p => p.role === 'salesperson').length})`;
      items = profiles.filter(p => p.role === 'salesperson').map(p => {
        const custCount = allCusts.filter(c => c.assigned_to === p.id).length;
        return { id: null, name: p.display_name, city: '', meta: custCount + ' kunder', col: null };
      });
    } else {
      titleText = `Alla kunder (${allCusts.length})`;
      items = allCusts.map(c => ({ id: c.id, name: c.name, city: c.city, meta: c.city, col: null })).sort((a, b) => a.name.localeCompare(b.name, 'sv'));
    }
  }

  title.textContent = titleText;
  searchEl.value = '';
  panel.style.display = 'block';

  function renderList(filter) {
    const q = (filter || '').toLowerCase();
    const filtered = q ? items.filter(i => i.name.toLowerCase().includes(q) || (i.city && i.city.toLowerCase().includes(q))) : items;
    listEl.innerHTML = filtered.map(i => `
      <div class="stat-detail-item">
        <span class="stat-detail-name" ${i.id ? `onclick="CRM.openCard('${i.id}')"` : ''}>${i.name}${i.city ? ` <span style="color:var(--bm);font-weight:300;">${i.city}</span>` : ''}</span>
        <span class="stat-detail-meta"${i.col ? ` style="color:${i.col}"` : ''}>${i.meta}</span>
      </div>
    `).join('') || '<p style="font-size:12px;color:var(--bm);padding:8px 0;">Inga träffar</p>';
  }

  renderList();
  searchEl.oninput = () => renderList(searchEl.value);
  closeBtn.onclick = () => { panel.style.display = 'none'; document.querySelectorAll('.stat-box').forEach(b => b.classList.remove('active')); };
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
    <div class="stat-box" data-stat="people"><div class="num">${hasRole('manager') ? profiles.filter(p => p.role === 'salesperson').length || '—' : customers.length}</div><div class="label">${hasRole('manager') ? 'Säljare' : 'Kunder'}</div></div>
  `;

  document.querySelectorAll('.stat-box[data-stat]').forEach(box => {
    box.addEventListener('click', () => {
      openStatDetail(box.dataset.stat, customers, needsVisitList, visitsThisMonthList);
      document.querySelectorAll('.stat-box').forEach(b => b.classList.remove('active'));
      box.classList.add('active');
    });
  });

  /* Toplist */
  const sorted = customers.filter(c => c.lat).map(c => {
    const d = daysSince(lastVisitMap[c.id]);
    return { ...c, days: d === null ? 9999 : d };
  }).sort((a, b) => b.days - a.days).slice(0, 10);

  document.getElementById('toplist').innerHTML = sorted.map(c => {
    const col = c.days === 9999 ? '#EAC435' : c.days >= 90 ? '#E74C3C' : c.days >= 60 ? '#E67E22' : '#EAC435';
    const txt = c.days === 9999 ? 'Aldrig' : c.days + 'd';
    return `<div class="toplist-item">
      <span class="toplist-name" onclick="CRM.openCard('${c.id}')">${c.name}</span>
      <span class="toplist-days" style="background:${col}20;color:${col};">${txt}</span>
    </div>`;
  }).join('');

  document.getElementById('dashDate').textContent = now.toLocaleDateString('sv-SE', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
}

/* ── Planned visits ────────────────────────────────── */
function updatePlannedVisits() {
  const el = document.getElementById('plannedVisits');
  if (!el) return;
  const today = new Date().toISOString().slice(0, 10);
  const customerIds = new Set(customers.map(c => c.id));
  const relevant = nextVisitsCache.filter(nv => customerIds.has(nv.customer_id)).sort((a, b) => a.scheduled_date.localeCompare(b.scheduled_date));

  if (!relevant.length) { el.innerHTML = '<p style="font-size:11px;color:var(--bm);">Inga planerade besök</p>'; return; }

  el.innerHTML = relevant.slice(0, 20).map(nv => {
    const c = customers.find(x => x.id === nv.customer_id);
    const name = c ? c.name : (nv.customers?.name || 'Okänd');
    const d = nv.scheduled_date;
    return `<div class="planned-item">
      <span class="toplist-name" onclick="CRM.openCard('${nv.customer_id}')" style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${name}</span>
      <input type="date" class="planned-date-input" value="${d}" onchange="CRM.dashChangeNextVisit('${nv.customer_id}', this.value)" title="Ändra datum">
      <button class="route-stop-remove" onclick="CRM.dashRemoveNextVisit('${nv.customer_id}')" title="Ta bort">&#x2715;</button>
    </div>`;
  }).join('');
}

/* ── Activity feed ─────────────────────────────────── */
function updateActivityFeed() {
  const el = document.getElementById('activityFeed');
  if (!el) return;

  const customerIds = new Set(customers.map(c => c.id));

  /* Build activity from visits */
  const events = allVisitsCache
    .filter(v => customerIds.has(v.customer_id))
    .map(v => {
      const c = customers.find(x => x.id === v.customer_id);
      return { type: 'visit', customerId: v.customer_id, name: c?.name || 'Okänd', date: v.visited_at, detail: v.comment || '' };
    })
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, 15);

  if (!events.length) { el.innerHTML = '<p style="font-size:11px;color:var(--bm);">Ingen aktivitet</p>'; return; }

  el.innerHTML = events.map(e => {
    const icon = '📍';
    const ago = daysSince(e.date);
    const timeStr = ago === 0 ? 'Idag' : ago === 1 ? 'Igår' : ago + 'd sedan';
    return `<div class="activity-item">
      <span class="activity-icon">${icon}</span>
      <div class="activity-text">
        <strong onclick="CRM.openCard('${e.customerId}')">${e.name}</strong>
        <span style="color:var(--bm);"> — besök</span>
        ${e.detail ? `<p style="font-size:10px;color:var(--bm);margin-top:1px;">${e.detail}</p>` : ''}
      </div>
      <span class="activity-time">${timeStr}</span>
    </div>`;
  }).join('');
}

/* ── Manager: Salesperson filter ────────────────────── */
function buildSalespersonFilter() {
  const sel = document.getElementById('spFilter');
  if (!sel) return;
  sel.innerHTML = '<option value="all">Alla säljare</option>' +
    profiles.filter(p => p.role === 'salesperson').map(p => `<option value="${p.id}">${p.display_name}</option>`).join('');

  sel.addEventListener('change', () => {
    document.getElementById('spFilterClear').style.display = sel.value === 'all' ? 'none' : 'flex';
    refreshAll(sel.value);
  });
  document.getElementById('spFilterClear')?.addEventListener('click', () => {
    sel.value = 'all';
    document.getElementById('spFilterClear').style.display = 'none';
    refreshAll('all');
  });
}

/* ── City filter ───────────────────────────────────── */
let _cityFilterBound = false;
function buildCityFilter(custs) {
  const sel = document.getElementById('cityFilter');
  if (!sel) return;
  const cities = [...new Set(custs.map(c => c.city).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'sv'));
  sel.innerHTML = '<option value="all">Alla orter</option>' + cities.map(city => `<option value="${city}"${city === activeCity ? ' selected' : ''}>${city}</option>`).join('');

  if (!_cityFilterBound) {
    sel.addEventListener('change', () => { activeCity = sel.value; document.getElementById('cityFilterClear').style.display = activeCity === 'all' ? 'none' : 'flex'; applyFilters(); });
    document.getElementById('cityFilterClear')?.addEventListener('click', () => { activeCity = 'all'; sel.value = 'all'; document.getElementById('cityFilterClear').style.display = 'none'; applyFilters(); });
    _cityFilterBound = true;
  }
}

/* ── Status filter ─────────────────────────────────── */
let _statusFilterBound = false;
function bindStatusFilter() {
  if (_statusFilterBound) return;
  const sel = document.getElementById('statusFilter');
  const clearBtn = document.getElementById('statusFilterClear');
  if (!sel) return;

  sel.addEventListener('change', () => { activeStatus = sel.value; if (clearBtn) clearBtn.style.display = activeStatus === 'all' ? 'none' : 'flex'; applyFilters(); });
  clearBtn?.addEventListener('click', () => { activeStatus = 'all'; sel.value = 'all'; clearBtn.style.display = 'none'; applyFilters(); });
  _statusFilterBound = true;
}

/* ── Rapport helpers ──────────────────────────────── */
let _allRevCache = [];

async function buildRapport() {
  const isManager = hasRole('manager');

  /* Destroy old charts */
  Object.values(chartInstances).forEach(c => c.destroy());
  chartInstances = {};

  /* Load revenue data */
  try { _allRevCache = await fetchAllRevenue(); } catch { _allRevCache = []; }

  const isDark = document.body.classList.contains('dark');
  const textColor = isDark ? '#f2f2f2' : '#303336';
  const gridColor = isDark ? 'rgba(255,255,255,.08)' : 'rgba(0,0,0,.08)';

  document.getElementById('rapportTitle').textContent = isManager ? 'Rapport — Alla säljare' : 'Min rapport';

  /* ── Visits chart ── */
  if (isManager && profiles.length) {
    const now = new Date();
    const thisMonth = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
    const salespeople = profiles.filter(p => p.role === 'salesperson');
    const names = salespeople.map(p => p.display_name);
    const visitCounts = salespeople.map(p => allVisitsCache.filter(v => v.user_id === p.id && v.visited_at.startsWith(thisMonth)).length);

    chartInstances.visits = new Chart(document.getElementById('chartVisits'), {
      type: 'bar',
      data: { labels: names, datasets: [{ label: 'Besök denna månad', data: visitCounts, backgroundColor: '#303336', borderRadius: 2 }] },
      options: { responsive: true, plugins: { legend: { display: false }, datalabels: { display: false } }, scales: { y: { beginAtZero: true, ticks: { color: textColor, stepSize: 1 }, grid: { color: gridColor } }, x: { ticks: { color: textColor }, grid: { display: false } } } }
    });
  } else {
    const months = [], visitCounts = [], now = new Date();
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
      months.push(d.toLocaleDateString('sv-SE', { month: 'short' }));
      visitCounts.push(allVisitsCache.filter(v => v.visited_at.startsWith(key)).length);
    }
    chartInstances.visits = new Chart(document.getElementById('chartVisits'), {
      type: 'bar',
      data: { labels: months, datasets: [{ label: 'Besök', data: visitCounts, backgroundColor: '#303336', borderRadius: 2 }] },
      options: { responsive: true, plugins: { legend: { display: false }, datalabels: { display: false } }, scales: { y: { beginAtZero: true, ticks: { color: textColor, stepSize: 1 }, grid: { color: gridColor } }, x: { ticks: { color: textColor }, grid: { display: false } } } }
    });
  }

  /* ── Revenue filter setup ── */
  const years = [...new Set(_allRevCache.map(r => r.year))].sort((a, b) => b - a);
  const yearSel = document.getElementById('revYearFilter');
  if (yearSel) {
    const curYear = new Date().getFullYear();
    if (!years.length) years.push(curYear);
    yearSel.innerHTML = years.map(y => `<option value="${y}"${y === curYear ? ' selected' : ''}>${y}</option>`).join('');
  }

  buildRevenueChart();
}

function buildRevenueChart() {
  if (chartInstances.revenue) { chartInstances.revenue.destroy(); delete chartInstances.revenue; }

  const isDark = document.body.classList.contains('dark');
  const textColor = isDark ? '#f2f2f2' : '#303336';
  const gridColor = isDark ? 'rgba(255,255,255,.08)' : 'rgba(0,0,0,.08)';
  const isManager = hasRole('manager');

  const periodType = document.getElementById('revPeriodType')?.value || 'year';
  const selYear = parseInt(document.getElementById('revYearFilter')?.value) || new Date().getFullYear();
  const selQuarter = document.getElementById('revQuarterFilter')?.value || 'all';
  const selMonth = document.getElementById('revMonthFilter')?.value || 'all';
  const showCompare = document.getElementById('revCompare')?.checked || false;
  const dateFrom = document.getElementById('revDateFrom')?.value || '';
  const dateTo = document.getElementById('revDateTo')?.value || '';

  /* Filter revenue data */
  function filterRev(rev, year, qtr, mon, pType, from, to) {
    let filtered = rev.filter(r => r.year === year);
    if (pType === 'quarter' && qtr !== 'all') {
      const q = parseInt(qtr);
      const m1 = (q - 1) * 3 + 1, m2 = q * 3;
      filtered = filtered.filter(r => r.month && r.month >= m1 && r.month <= m2);
    } else if (pType === 'month' && mon !== 'all') {
      filtered = filtered.filter(r => r.month === parseInt(mon));
    } else if (pType === 'custom' && from && to) {
      /* For custom, match year/month combos */
      const fd = new Date(from), td = new Date(to);
      filtered = rev.filter(r => {
        const rDate = new Date(r.year, (r.month || 1) - 1, 1);
        return rDate >= fd && rDate <= td;
      });
    }
    return filtered;
  }

  const currentRev = filterRev(_allRevCache, selYear, selQuarter, selMonth, periodType, dateFrom, dateTo);
  let prevRev = [];
  if (showCompare) {
    prevRev = filterRev(_allRevCache, selYear - 1, selQuarter, selMonth, periodType, dateFrom, dateTo);
  }

  /* Build chart data */
  let labels = [], currentData = [], prevData = [];

  if (isManager && profiles.length) {
    const salespeople = profiles.filter(p => p.role === 'salesperson');
    labels = salespeople.map(p => p.display_name);

    currentData = salespeople.map(p => {
      const custIds = allCustomers.filter(c => c.assigned_to === p.id).map(c => c.id);
      return currentRev.filter(r => custIds.includes(r.customer_id)).reduce((s, r) => s + (r.amount || 0), 0);
    });

    if (showCompare) {
      prevData = salespeople.map(p => {
        const custIds = allCustomers.filter(c => c.assigned_to === p.id).map(c => c.id);
        return prevRev.filter(r => custIds.includes(r.customer_id)).reduce((s, r) => s + (r.amount || 0), 0);
      });
    }
  } else {
    /* Salesperson: show by month or year */
    if (periodType === 'year') {
      const custIds = new Set(allCustomers.map(c => c.id));
      const myRev = _allRevCache.filter(r => custIds.has(r.customer_id));
      const yrs = [...new Set(myRev.map(r => r.year))].sort();
      labels = yrs.map(String);
      currentData = yrs.map(y => myRev.filter(r => r.year === y).reduce((s, r) => s + (r.amount || 0), 0));
    } else {
      const monthNames = ['Jan','Feb','Mar','Apr','Maj','Jun','Jul','Aug','Sep','Okt','Nov','Dec'];
      const custIds = new Set(allCustomers.map(c => c.id));
      for (let m = 1; m <= 12; m++) {
        labels.push(monthNames[m - 1]);
        currentData.push(currentRev.filter(r => custIds.has(r.customer_id) && r.month === m).reduce((s, r) => s + (r.amount || 0), 0));
        if (showCompare) {
          prevData.push(prevRev.filter(r => custIds.has(r.customer_id) && r.month === m).reduce((s, r) => s + (r.amount || 0), 0));
        }
      }
    }
  }

  /* Period label */
  const monthNames = ['','Januari','Februari','Mars','April','Maj','Juni','Juli','Augusti','September','Oktober','November','December'];
  let periodLabel = String(selYear);
  if (periodType === 'quarter' && selQuarter !== 'all') periodLabel = `Q${selQuarter} ${selYear}`;
  if (periodType === 'month' && selMonth !== 'all') periodLabel = `${monthNames[parseInt(selMonth)]} ${selYear}`;
  if (periodType === 'custom') periodLabel = `${dateFrom || '?'} — ${dateTo || '?'}`;

  /* Summary cards */
  const totalCurrent = currentData.reduce((s, v) => s + v, 0);
  const totalPrev = showCompare ? prevData.reduce((s, v) => s + v, 0) : 0;
  const summaryEl = document.getElementById('revSummary');

  let diffHtml = '';
  if (showCompare && totalPrev > 0) {
    const pct = ((totalCurrent - totalPrev) / totalPrev * 100).toFixed(1);
    const arrow = pct >= 0 ? '↑' : '↓';
    const col = pct >= 0 ? '#2ECC71' : '#E74C3C';
    diffHtml = `<div class="rapport-summary-card"><div class="num" style="color:${col};">${arrow} ${Math.abs(pct)}%</div><div class="label">Förändring</div></div>`;
  }

  summaryEl.innerHTML = `
    <div class="rapport-summary-card"><div class="num">${formatSEK(totalCurrent)}</div><div class="label">Försäljning ${periodLabel}</div></div>
    ${showCompare ? `<div class="rapport-summary-card"><div class="num" style="color:var(--bm);">${formatSEK(totalPrev)}</div><div class="label">Försäljning ${selYear - 1}</div></div>` : ''}
    ${diffHtml}
  `;

  /* Build datasets */
  const datasets = [{
    label: `Försäljning ${periodLabel}`,
    data: currentData,
    backgroundColor: '#303336',
    borderRadius: 2
  }];

  if (showCompare && prevData.length) {
    datasets.push({
      label: `Försäljning ${selYear - 1}`,
      data: prevData,
      backgroundColor: '#E8634A',
      borderRadius: 2
    });
  }

  chartInstances.revenue = new Chart(document.getElementById('chartRevenue'), {
    type: 'bar',
    data: { labels, datasets },
    plugins: [ChartDataLabels],
    options: {
      responsive: true,
      plugins: {
        legend: { display: showCompare, labels: { color: textColor, font: { family: 'Raleway', size: 11 } } },
        tooltip: { callbacks: { label: ctx => ctx.dataset.label + ': ' + formatSEK(ctx.raw) } },
        datalabels: {
          anchor: 'end',
          align: 'end',
          color: textColor,
          font: { family: 'Raleway', size: 11, weight: 500 },
          formatter: v => v ? formatSEK(v) : '',
          display: ctx => ctx.dataset.data[ctx.dataIndex] > 0
        }
      },
      scales: {
        y: {
          beginAtZero: true,
          ticks: { color: textColor, callback: v => formatSEK(v) },
          grid: { color: gridColor },
          grace: '15%'
        },
        x: { ticks: { color: textColor }, grid: { display: false } }
      }
    }
  });
}

/* ── CSV import helpers ──────────────────────────── */
let _importRows = [];
function parseCSV(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return [];
  /* Skip header */
  return lines.slice(1).map(line => {
    const cols = line.split(';').map(c => c.replace(/^"|"$/g, '').trim());
    return { name: cols[0] || '', customer_nr: cols[1] || '', address: cols[2] || '', zip: cols[3] || '', city: cols[4] || '', status: cols[5] || 'active' };
  }).filter(r => r.name && r.city);
}

/* ── Customer card rendering ───────────────────────── */
async function renderCard(customerId) {
  const c = allCustomers.find(x => x.id === customerId) || customers.find(x => x.id === customerId);
  if (!c) return;

  const profile = getProfile();
  const isOwner = c.assigned_to === profile.id;
  const canEdit = isOwner || hasRole('admin');

  const [visits, contacts, comments, revenue, todos] = await Promise.all([
    fetchVisits(customerId), fetchContacts(customerId), fetchComments(customerId), fetchRevenue(customerId),
    fetchTodos(customerId).catch(() => [])
  ]);

  const days = daysSince(lastVisitMap[c.id]);
  const col = days === null ? '#EAC435' : visitColor(days);
  const spName = profiles.length ? profiles.find(p => p.id === c.assigned_to)?.display_name || '—' : '';
  const revTotal = revenue.reduce((s, r) => s + (r.amount || 0), 0);
  const statusLabels = { active: 'Aktiv', prospect: 'Prospekt', inactive: 'Inaktiv' };
  const statusClass = `status-${c.status || 'active'}`;
  const nv = nextVisitsCache.find(n => n.customer_id === customerId);
  const nvDate = nv ? nv.scheduled_date : '';

  const html = `
    <div class="card-top">
      <div style="flex:1;">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:4px;flex-wrap:wrap;">
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

    <div class="card-stats">
      <div class="card-stat"><div class="card-stat-num" style="color:${col};">${days === null ? '—' : days + 'd'}</div><div class="card-stat-label">Sedan besök</div></div>
      <div class="card-stat"><div class="card-stat-num">${visits.length}</div><div class="card-stat-label">Besök totalt</div></div>
      <div class="card-stat"><div class="card-stat-num">${contacts.length}</div><div class="card-stat-label">Kontakter</div></div>
      <div class="card-stat"><div class="card-stat-num">${revTotal ? formatSEK(revTotal) : '—'}</div><div class="card-stat-label">Omsättning</div></div>
    </div>

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
    </div>` : ''}

    <!-- Todos -->
    <div class="card-section">
      <div class="card-section-header">
        <h3>Att göra</h3>
      </div>
      ${canEdit ? `
      <div style="display:flex;gap:8px;margin-bottom:8px;">
        <input id="cardTodoText" class="card-input" placeholder="Ny uppgift..." style="flex:1;">
        <button class="card-action-btn" onclick="CRM.cardAddTodo('${c.id}')">Lägg till</button>
      </div>` : ''}
      ${todos.length ? todos.map(t => `
        <div class="todo-item ${t.done ? 'done' : ''}">
          <input type="checkbox" ${t.done ? 'checked' : ''} onchange="CRM.cardToggleTodo('${t.id}', this.checked, '${c.id}')">
          <span class="todo-text">${t.text}</span>
          ${canEdit ? `<button class="route-stop-remove" onclick="CRM.cardDeleteTodo('${t.id}','${c.id}')">&#x2715;</button>` : ''}
        </div>
      `).join('') : '<p style="font-size:12px;color:var(--bm);">Inga uppgifter</p>'}
    </div>

    <div class="card-section">
      <div class="card-section-header"><h3>Besökshistorik</h3></div>
      ${visits.length ? visits.slice(0, 20).map(v => `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid var(--bb);">
          <div><span style="font-size:12px;font-weight:500;">${formatDate(v.visited_at)}</span>${v.comment ? `<span style="font-size:11px;color:var(--bm);margin-left:8px;">${v.comment}</span>` : ''}</div>
          ${canEdit ? `<button onclick="CRM.cardDeleteVisit('${v.id}','${c.id}')" style="background:none;border:none;color:#E74C3C;cursor:pointer;font-size:11px;padding:4px 8px;">Ta bort</button>` : ''}
        </div>
      `).join('') : '<p style="font-size:12px;color:var(--bm);">Inga besök registrerade</p>'}
    </div>

    <div class="card-section">
      <div class="card-section-header"><h3>Kontakter</h3>${canEdit ? `<button class="card-add-btn" onclick="CRM.toggleAddContact()">+ Lägg till</button>` : ''}</div>
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
            <div><span style="font-size:13px;font-weight:500;">${ct.name || ct.person_name}</span>${ct.is_primary ? '<span style="font-size:9px;background:var(--bd);color:var(--bl);padding:1px 6px;margin-left:6px;text-transform:uppercase;letter-spacing:.5px;">Primär</span>' : ''}${ct.role ? `<p style="font-size:11px;color:var(--bm);margin-top:2px;">${ct.role}</p>` : ''}</div>
            ${canEdit ? `<button onclick="CRM.cardDeleteContact('${ct.id}','${c.id}')" style="background:none;border:none;color:#E74C3C;cursor:pointer;font-size:11px;padding:4px 8px;">Ta bort</button>` : ''}
          </div>
          <div style="margin-top:4px;font-size:12px;">${ct.phone ? `<a href="tel:${ct.phone}" style="color:var(--bd);text-decoration:none;margin-right:12px;">${ct.phone}</a>` : ''}${ct.email ? `<a href="mailto:${ct.email}" style="color:var(--bd);text-decoration:none;">${ct.email}</a>` : ''}</div>
        </div>
      `).join('') : '<p style="font-size:12px;color:var(--bm);">Inga kontakter</p>'}
    </div>

    <div class="card-section">
      <div class="card-section-header"><h3>Kommentarer</h3></div>
      ${canEdit ? `<div style="display:flex;gap:8px;margin-bottom:10px;"><input id="cardCommentText" class="card-input" placeholder="Skriv en kommentar..." style="flex:1;"><button class="card-action-btn" onclick="CRM.cardAddComment('${c.id}')">Lägg till</button></div>` : ''}
      ${comments.length ? comments.map(cm => `
        <div style="padding:6px 0;border-bottom:1px solid var(--bb);">
          <div style="display:flex;justify-content:space-between;"><span style="font-size:12px;">${cm.body || cm.text}</span>${canEdit ? `<button onclick="CRM.cardDeleteComment('${cm.id}','${c.id}')" style="background:none;border:none;color:#E74C3C;cursor:pointer;font-size:11px;padding:4px 8px;">Ta bort</button>` : ''}</div>
          <p style="font-size:10px;color:var(--bm);margin-top:2px;">${formatDate(cm.created_at)}</p>
        </div>
      `).join('') : '<p style="font-size:12px;color:var(--bm);">Inga kommentarer</p>'}
    </div>

    <div class="card-section">
      <div class="card-section-header"><h3>Omsättning</h3>${canEdit ? `<button class="card-add-btn" onclick="CRM.toggleAddRevenue()">+ Lägg till</button>` : ''}</div>
      <div id="addRevenueForm" style="display:none;margin-bottom:10px;">
        <div style="display:flex;gap:8px;flex-wrap:wrap;"><input id="revYear" class="card-input" type="number" placeholder="År" value="${new Date().getFullYear()}" style="width:70px;"><select id="revMonth" class="card-input" style="width:100px;"><option value="">Helår</option><option value="1">Jan</option><option value="2">Feb</option><option value="3">Mar</option><option value="4">Apr</option><option value="5">Maj</option><option value="6">Jun</option><option value="7">Jul</option><option value="8">Aug</option><option value="9">Sep</option><option value="10">Okt</option><option value="11">Nov</option><option value="12">Dec</option></select><input id="revAmount" class="card-input" type="number" placeholder="Belopp (SEK)" style="flex:1;min-width:100px;"><button class="card-action-btn" onclick="CRM.cardAddRevenue('${c.id}')">Spara</button></div>
      </div>
      ${revenue.length ? (() => { const mNames = ['','Jan','Feb','Mar','Apr','Maj','Jun','Jul','Aug','Sep','Okt','Nov','Dec']; return `<table style="width:100%;font-size:12px;border-collapse:collapse;"><tr style="color:var(--bm);font-size:10px;text-transform:uppercase;letter-spacing:.5px;"><td style="padding:4px 0;">Period</td><td style="text-align:right;padding:4px 0;">Belopp</td>${canEdit ? '<td></td>' : ''}</tr>${revenue.map(r => `<tr style="border-bottom:1px solid var(--bb);"><td style="padding:6px 0;">${r.month ? mNames[r.month] + ' ' : ''}${r.year}</td><td style="text-align:right;padding:6px 0;">${formatSEK(r.amount)}</td>${canEdit ? `<td style="text-align:right;"><button onclick="CRM.cardDeleteRevenue('${r.id}','${c.id}')" style="background:none;border:none;color:#E74C3C;cursor:pointer;font-size:11px;padding:4px;">Ta bort</button></td>` : ''}</tr>`).join('')}</table>`; })() : '<p style="font-size:12px;color:var(--bm);">Ingen omsättning registrerad</p>'}
    </div>

    ${hasRole('admin') ? `<div class="card-section" style="border-bottom:none;"><button class="popup-btn-danger" onclick="CRM.cardDeleteCustomer('${c.id}')">Ta bort kund</button></div>` : ''}
  `;

  document.getElementById('cardContent').innerHTML = html;
}

/* ── Route planner helpers ─────────────────────────── */
function renderRouteStops() {
  const el = document.getElementById('routeStops');
  const countEl = document.getElementById('routeCount');
  if (!el) return;
  countEl.textContent = routeStops.length;
  if (!routeStops.length) { el.innerHTML = '<p style="font-size:11px;color:var(--bm);">Inga stopp valda</p>'; return; }
  el.innerHTML = routeStops.map((id, i) => {
    const c = allCustomers.find(x => x.id === id);
    if (!c) return '';
    return `<div class="route-stop"><span class="route-stop-num">${i + 1}</span><span class="route-stop-name">${c.name} <span style="color:var(--bm);font-size:10px;">${c.city}</span></span><button class="route-stop-remove" onclick="CRM.removeFromRoute('${id}')">&#x2715;</button></div>`;
  }).join('');
}

function renderRouteSearch(query) {
  const el = document.getElementById('routeSearchResults');
  if (!el || !query) { if (el) el.innerHTML = ''; return; }
  const q = query.toLowerCase();
  const results = allCustomers.filter(c => c.lat && !routeStops.includes(c.id) && (c.name.toLowerCase().includes(q) || c.city.toLowerCase().includes(q) || c.customer_nr.toLowerCase().includes(q))).slice(0, 8);
  el.innerHTML = results.map(c => `<div class="route-search-item" onclick="CRM.addToRoute('${c.id}')">${c.name} <span style="color:var(--bm);font-size:10px;">${c.city}</span></div>`).join('') || '<p style="font-size:11px;color:var(--bm);padding:4px;">Inga resultat</p>';
}

/* ── Admin panel helpers ──────────────────────────── */
async function renderAdminUsers() {
  const el = document.getElementById('adminUsersList');
  if (!el) return;
  if (!profiles.length) profiles = await fetchAllProfiles();
  el.innerHTML = profiles.map(p => `<div class="admin-user-row"><span class="admin-user-name">${p.display_name}</span><span class="admin-user-email">${p.email}</span><span class="admin-user-role"><select onchange="CRM.changeRole('${p.id}', this.value)" ${p.id === getProfile().id ? 'disabled' : ''}><option value="salesperson" ${p.role === 'salesperson' ? 'selected' : ''}>Säljare</option><option value="manager" ${p.role === 'manager' ? 'selected' : ''}>Chef</option><option value="admin" ${p.role === 'admin' ? 'selected' : ''}>Admin</option></select></span></div>`).join('');
}

function renderReassignDropdowns() {
  const opts = profiles.filter(p => p.role === 'salesperson').map(p => `<option value="${p.id}">${p.display_name}</option>`).join('');
  document.getElementById('reassignFrom').innerHTML = '<option value="">Välj...</option>' + opts;
  document.getElementById('reassignTo').innerHTML = '<option value="">Välj...</option>' + opts;
  document.getElementById('reassignFrom').onchange = () => renderReassignList();

  /* Import assign dropdown */
  const importSel = document.getElementById('importAssign');
  if (importSel) importSel.innerHTML = profiles.map(p => `<option value="${p.id}">${p.display_name}</option>`).join('');
}

function renderReassignList() {
  const fromId = document.getElementById('reassignFrom').value;
  const el = document.getElementById('reassignList');
  if (!fromId || !el) { if (el) el.innerHTML = ''; return; }
  const custs = allCustomers.filter(c => c.assigned_to === fromId);
  el.innerHTML = custs.length ? custs.map(c => `<div class="reassign-item"><label><input type="checkbox" value="${c.id}" checked> ${c.name} <span style="color:var(--bm);font-size:10px;">(${c.city})</span></label></div>`).join('') : '<p style="font-size:12px;color:var(--bm);">Inga kunder</p>';
}

/* ── Global CRM actions ───────────────────────────── */
window.CRM = {
  async registerVisit(customerId) {
    const input = document.getElementById('vc_' + customerId);
    await registerVisit(customerId, getProfile().id, input ? input.value.trim() : '');
    await refreshAll();
  },

  async openCard(customerId) {
    document.getElementById('customerCard').classList.add('open');
    document.getElementById('cardOverlay').classList.add('open');
    document.getElementById('cardContent').innerHTML = '<p style="padding:40px;text-align:center;color:var(--bm);">Laddar...</p>';
    const sidebar = document.getElementById('sidebar');
    if (sidebar.classList.contains('open')) { sidebar.classList.remove('open'); document.getElementById('dashBtn').classList.remove('active'); invalidateSize(); }
    getMapInstance()?.closePopup();
    await renderCard(customerId);
  },

  closeCard() { document.getElementById('customerCard').classList.remove('open'); document.getElementById('cardOverlay').classList.remove('open'); },

  async cardRegisterVisit(cid) { const i = document.getElementById('cardVisitComment'); await registerVisit(cid, getProfile().id, i ? i.value.trim() : ''); await refreshAll(); await renderCard(cid); },
  async cardDeleteVisit(vid, cid) { await deleteVisit(vid); await refreshAll(); await renderCard(cid); },
  async cardSetNextVisit(cid) { const d = document.getElementById('cardNextVisit')?.value; if (!d) return; await setNextVisit(cid, d); try { nextVisitsCache = await fetchNextVisits(); } catch {} updatePlannedVisits(); await renderCard(cid); },
  async cardRemoveNextVisit(cid) { await removeNextVisit(cid); try { nextVisitsCache = await fetchNextVisits(); } catch {} updatePlannedVisits(); await renderCard(cid); },
  async dashChangeNextVisit(cid, d) { if (!d) return; await setNextVisit(cid, d); try { nextVisitsCache = await fetchNextVisits(); } catch {} updatePlannedVisits(); },
  async dashRemoveNextVisit(cid) { await removeNextVisit(cid); try { nextVisitsCache = await fetchNextVisits(); } catch {} updatePlannedVisits(); },

  /* Todos */
  async cardAddTodo(cid) { const i = document.getElementById('cardTodoText'); const t = i?.value.trim(); if (!t) return; await addTodo(cid, getProfile().id, t); await renderCard(cid); },
  async cardToggleTodo(tid, done, cid) { await toggleTodo(tid, done); await renderCard(cid); },
  async cardDeleteTodo(tid, cid) { await deleteTodo(tid); await renderCard(cid); },

  toggleAddContact() { const f = document.getElementById('addContactForm'); f.style.display = f.style.display === 'none' ? 'block' : 'none'; },
  async cardAddContact(cid) { const n = document.getElementById('contactName').value.trim(); if (!n) return; await addContact(cid, { name: n, role: document.getElementById('contactRole').value.trim() || null, phone: document.getElementById('contactPhone').value.trim() || null, email: document.getElementById('contactEmail').value.trim() || null }); await renderCard(cid); },
  async cardDeleteContact(ctid, cid) { await deleteContact(ctid); await renderCard(cid); },
  async cardAddComment(cid) { const t = document.getElementById('cardCommentText')?.value.trim(); if (!t) return; await addComment(cid, getProfile().id, t); await renderCard(cid); },
  async cardDeleteComment(cmid, cid) { await deleteComment(cmid); await renderCard(cid); },
  toggleAddRevenue() { const f = document.getElementById('addRevenueForm'); f.style.display = f.style.display === 'none' ? 'block' : 'none'; },
  async cardAddRevenue(cid) { const y = parseInt(document.getElementById('revYear').value); const a = parseFloat(document.getElementById('revAmount').value); const m = document.getElementById('revMonth')?.value; if (!y || !a) return; await upsertRevenue(cid, y, a, m ? parseInt(m) : null); await renderCard(cid); },
  async cardDeleteRevenue(rid, cid) { await deleteRevenue(rid); await renderCard(cid); },
  async cardDeleteCustomer(cid) { if (!confirm('Vill du verkligen ta bort denna kund? Allt data raderas permanent.')) return; await deleteCustomer(cid); CRM.closeCard(); await refreshAll(); },

  /* Add customer */
  openAddCustomer() {
    document.getElementById('addCustModal').classList.add('active');
    ['acName','acNr','acAddress','acZip','acCity'].forEach(id => document.getElementById(id).value = '');
    document.getElementById('acStatus').value = 'active';
    document.getElementById('acError').style.display = 'none';
    if (hasRole('admin') && profiles.length) {
      const sel = document.getElementById('acAssign');
      sel.innerHTML = `<option value="${getProfile().id}">${getProfile().display_name} (jag)</option>` + profiles.filter(p => p.id !== getProfile().id).map(p => `<option value="${p.id}">${p.display_name}</option>`).join('');
    }
  },
  closeAddCustomer() { document.getElementById('addCustModal').classList.remove('active'); },
  async saveNewCustomer() {
    const name = document.getElementById('acName').value.trim();
    const city = document.getElementById('acCity').value.trim();
    const err = document.getElementById('acError');
    if (!name || !city) { err.textContent = 'Företagsnamn och ort krävs.'; err.style.display = 'block'; return; }
    err.style.display = 'none';
    const address = document.getElementById('acAddress').value.trim();
    const zip = document.getElementById('acZip').value.trim();
    const coords = await geocodeAddress([address, zip, city].filter(Boolean).join(', '));
    try {
      await createCustomer({ name, customer_nr: document.getElementById('acNr').value.trim(), address, zip, city, status: document.getElementById('acStatus').value, assigned_to: hasRole('admin') ? document.getElementById('acAssign').value : getProfile().id, lat: coords?.lat || null, lng: coords?.lng || null });
      CRM.closeAddCustomer(); await refreshAll();
    } catch (e) { err.textContent = 'Kunde inte spara: ' + (e.message || e); err.style.display = 'block'; }
  },

  /* Edit customer */
  openEditCustomer(cid) {
    const c = allCustomers.find(x => x.id === cid); if (!c) return;
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
      document.getElementById('ecAssign').innerHTML = profiles.map(p => `<option value="${p.id}" ${p.id === c.assigned_to ? 'selected' : ''}>${p.display_name}</option>`).join('');
    }
  },
  closeEditCustomer() { document.getElementById('editCustModal').classList.remove('active'); },
  async saveEditCustomer() {
    const id = document.getElementById('ecId').value;
    const name = document.getElementById('ecName').value.trim();
    const city = document.getElementById('ecCity').value.trim();
    const err = document.getElementById('ecError');
    if (!name || !city) { err.textContent = 'Företagsnamn och ort krävs.'; err.style.display = 'block'; return; }
    err.style.display = 'none';
    const address = document.getElementById('ecAddress').value.trim();
    const zip = document.getElementById('ecZip').value.trim();
    const old = allCustomers.find(x => x.id === id);
    let lat = old?.lat, lng = old?.lng;
    if (old && (address !== old.address || zip !== old.zip || city !== old.city)) {
      const coords = await geocodeAddress([address, zip, city].filter(Boolean).join(', '));
      if (coords) { lat = coords.lat; lng = coords.lng; }
    }
    const updates = { name, customer_nr: document.getElementById('ecNr').value.trim(), address, zip, city, status: document.getElementById('ecStatus').value, lat, lng };
    if (hasRole('admin')) updates.assigned_to = document.getElementById('ecAssign').value;
    try { await updateCustomer(id, updates); CRM.closeEditCustomer(); await refreshAll(); await renderCard(id); }
    catch (e) { err.textContent = 'Kunde inte spara: ' + (e.message || e); err.style.display = 'block'; }
  },

  /* Admin */
  openAdmin() { document.getElementById('adminModal').classList.add('active'); renderAdminUsers(); renderReassignDropdowns(); },
  closeAdmin() { document.getElementById('adminModal').classList.remove('active'); },
  adminTab(tab) {
    document.querySelectorAll('#adminModal .admin-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
    document.getElementById('adminUsersTab').style.display = tab === 'users' ? 'block' : 'none';
    document.getElementById('adminReassignTab').style.display = tab === 'reassign' ? 'block' : 'none';
    document.getElementById('adminImportTab').style.display = tab === 'import' ? 'block' : 'none';
  },
  async changeRole(uid, role) {
    const { error } = await sb.from('profiles').update({ role }).eq('id', uid);
    if (error) { alert('Fel: ' + error.message); return; }
    profiles = await fetchAllProfiles(); renderAdminUsers();
  },
  async executeReassign() {
    const toId = document.getElementById('reassignTo').value;
    if (!toId) { alert('Välj en mottagande säljare.'); return; }
    const ids = [...document.querySelectorAll('#reassignList input:checked')].map(cb => cb.value);
    if (!ids.length) { alert('Inga kunder valda.'); return; }
    try { await reassignCustomers(ids, toId); await refreshAll(); renderReassignList(); alert(`${ids.length} kund(er) flyttade.`); }
    catch (e) { alert('Fel: ' + (e.message || e)); }
  },

  /* Admin CSV import */
  async runAdminImport() {
    const assignTo = document.getElementById('importAssign').value;
    const msgEl = document.getElementById('adminImportMsg');
    if (!_importRows.length) return;
    msgEl.style.display = 'block'; msgEl.style.color = 'var(--bm)'; msgEl.textContent = `Importerar ${_importRows.length} kunder...`;

    let ok = 0, fail = 0;
    for (const r of _importRows) {
      try {
        const coords = await geocodeAddress([r.address, r.zip, r.city].filter(Boolean).join(', '));
        await createCustomer({ ...r, assigned_to: assignTo, lat: coords?.lat || null, lng: coords?.lng || null });
        ok++;
      } catch { fail++; }
    }
    msgEl.style.color = '#2ECC71';
    msgEl.textContent = `Klart! ${ok} importerade${fail ? `, ${fail} misslyckades` : ''}.`;
    _importRows = [];
    document.getElementById('adminImportBtn').style.display = 'none';
    await refreshAll();
  },

  /* Rapport */
  async openRapport() {
    document.getElementById('rapportModal').classList.add('active');
    CRM.rapportTab('visits');
    await buildRapport();
  },
  closeRapport() {
    document.getElementById('rapportModal').classList.remove('active');
    Object.values(chartInstances).forEach(c => c.destroy());
    chartInstances = {};
  },
  rapportTab(tab) {
    document.querySelectorAll('#rapportTabs .admin-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
    document.getElementById('rapportVisitsTab').style.display = tab === 'visits' ? 'block' : 'none';
    document.getElementById('rapportRevenueTab').style.display = tab === 'revenue' ? 'block' : 'none';
  },
  revFilterChanged() {
    const pType = document.getElementById('revPeriodType').value;
    document.getElementById('revYearGroup').style.display = pType !== 'custom' ? '' : 'none';
    document.getElementById('revQuarterGroup').style.display = pType === 'quarter' ? '' : 'none';
    document.getElementById('revMonthGroup').style.display = pType === 'month' ? '' : 'none';
    document.getElementById('revCustomGroup').style.display = pType === 'custom' ? '' : 'none';
    document.getElementById('revCustomGroupTo').style.display = pType === 'custom' ? '' : 'none';
    document.getElementById('revCompareGroup').style.display = pType !== 'custom' ? '' : 'none';
    buildRevenueChart();
  },

  /* Change password */
  openChangePw() {
    document.getElementById('changePwModal').classList.add('active');
    document.getElementById('newPw').value = '';
    document.getElementById('confirmPw').value = '';
    const msg = document.getElementById('changePwMsg');
    msg.style.display = 'none';
  },
  closeChangePw() { document.getElementById('changePwModal').classList.remove('active'); },
  async saveChangePw() {
    const pw = document.getElementById('newPw').value;
    const confirm = document.getElementById('confirmPw').value;
    const msg = document.getElementById('changePwMsg');
    if (!pw || pw.length < 6) { msg.textContent = 'Lösenordet måste vara minst 6 tecken.'; msg.style.color = '#c0392b'; msg.style.display = 'block'; return; }
    if (pw !== confirm) { msg.textContent = 'Lösenorden matchar inte.'; msg.style.color = '#c0392b'; msg.style.display = 'block'; return; }
    const { error } = await sb.auth.updateUser({ password: pw });
    if (error) { msg.textContent = 'Kunde inte byta: ' + error.message; msg.style.color = '#c0392b'; msg.style.display = 'block'; return; }
    msg.textContent = 'Lösenord ändrat!'; msg.style.color = '#2ECC71'; msg.style.display = 'block';
    setTimeout(() => CRM.closeChangePw(), 1500);
  },

  /* Route planner */
  openRoutePanel() { document.getElementById('routePanel').style.display = 'block'; renderRouteStops(); },
  closeRoutePanel() { document.getElementById('routePanel').style.display = 'none'; },
  addToRoute(cid) {
    if (routeStops.includes(cid)) return;
    const c = allCustomers.find(x => x.id === cid);
    if (!c || !c.lat) return;
    routeStops.push(cid); renderRouteStops();
    document.getElementById('routePanel').style.display = 'block';
    const s = document.getElementById('routeSearch'); if (s) { s.value = ''; renderRouteSearch(''); }
  },
  removeFromRoute(cid) { routeStops = routeStops.filter(id => id !== cid); renderRouteStops(); },
  clearRoute() { routeStops = []; renderRouteStops(); },
  optimizeRoute() {
    if (routeStops.length < 2) { if (routeStops.length === 1) { const c = allCustomers.find(x => x.id === routeStops[0]); if (c) window.open(googleMapsUrl(c), '_blank'); } return; }
    const stops = routeStops.map(id => allCustomers.find(x => x.id === id)).filter(Boolean);
    const optimized = [stops[0]]; const remaining = stops.slice(1);
    while (remaining.length) { const last = optimized[optimized.length - 1]; let nearest = 0, minDist = Infinity; remaining.forEach((c, i) => { const d = haversine(last.lat, last.lng, c.lat, c.lng); if (d < minDist) { minDist = d; nearest = i; } }); optimized.push(remaining.splice(nearest, 1)[0]); }
    const origin = `${optimized[0].address || ''}, ${optimized[0].zip || ''} ${optimized[0].city}`;
    const dest = `${optimized[optimized.length - 1].address || ''}, ${optimized[optimized.length - 1].zip || ''} ${optimized[optimized.length - 1].city}`;
    const waypoints = optimized.slice(1, -1).map(c => encodeURIComponent(`${c.address || ''}, ${c.zip || ''} ${c.city}`)).join('|');
    window.open(`https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(dest)}&waypoints=${waypoints}&travelmode=driving`, '_blank');
    routeStops = optimized.map(c => c.id); renderRouteStops();
  }
};

/* ── Event bindings ─────────────────────────────────── */
function bindEvents() {
  document.getElementById('search').addEventListener('input', e => search(e.target.value));

  document.getElementById('homeBtn').addEventListener('click', () => {
    resetView(); document.getElementById('search').value = '';
    const sb = document.getElementById('sidebar');
    if (sb.classList.contains('open')) { sb.classList.remove('open'); document.getElementById('dashBtn').classList.remove('active'); invalidateSize(); }
  });

  document.getElementById('dashBtn').addEventListener('click', () => {
    const sb = document.getElementById('sidebar'); sb.classList.toggle('open'); document.getElementById('dashBtn').classList.toggle('active'); invalidateSize();
  });

  const closeSidebar = () => { document.getElementById('sidebar').classList.remove('open'); document.getElementById('dashBtn').classList.remove('active'); invalidateSize(); };
  document.getElementById('sidebarCloseBtn').addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); closeSidebar(); });
  document.getElementById('sidebarBackdrop').addEventListener('click', closeSidebar);

  document.getElementById('addCustBtn').addEventListener('click', () => CRM.openAddCustomer());
  document.getElementById('routeBtn').addEventListener('click', () => {
    const p = document.getElementById('routePanel');
    p.style.display === 'none' || !p.style.display ? CRM.openRoutePanel() : CRM.closeRoutePanel();
  });
  document.getElementById('routeSearch')?.addEventListener('input', e => renderRouteSearch(e.target.value));
  document.getElementById('adminBtn').addEventListener('click', () => CRM.openAdmin());
  document.getElementById('rapportBtn').addEventListener('click', () => CRM.openRapport());
  document.getElementById('changePwBtn').addEventListener('click', () => CRM.openChangePw());
  document.getElementById('changePwSave').addEventListener('click', () => CRM.saveChangePw());

  /* Admin CSV file input */
  document.getElementById('adminCsvFile')?.addEventListener('change', e => {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      _importRows = parseCSV(reader.result);
      const preview = document.getElementById('adminImportPreview');
      const btn = document.getElementById('adminImportBtn');
      if (_importRows.length) {
        preview.innerHTML = `<p style="margin-bottom:6px;"><strong>${_importRows.length} kunder hittade</strong></p>` +
          _importRows.slice(0, 5).map(r => `<div style="padding:3px 0;border-bottom:1px solid var(--bb);">${r.name} — ${r.city}</div>`).join('') +
          (_importRows.length > 5 ? `<p style="color:var(--bm);margin-top:4px;">...och ${_importRows.length - 5} till</p>` : '');
        btn.style.display = '';
      } else {
        preview.innerHTML = '<p style="color:#c0392b;">Kunde inte tolka CSV. Kontrollera format.</p>';
        btn.style.display = 'none';
      }
    };
    reader.readAsText(file, 'UTF-8');
  });

  /* Status filter */
  bindStatusFilter();

  document.getElementById('themeBtn').addEventListener('click', function () { this.textContent = toggleTheme() ? '☀️' : '🌙'; });
  document.getElementById('logoutBtn').addEventListener('click', () => logout());

  document.querySelectorAll('.filter-chip').forEach(chip => {
    chip.addEventListener('click', function () {
      document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
      this.classList.add('active');
      setFilter(this.dataset.filter);
      applyFilters();
    });
  });

  document.getElementById('exportBtn').addEventListener('click', () => {
    const header = '"Kundnr";"Företagsnamn";"Adress";"Postnr";"Ort";"Status";"Senaste besök"';
    const rows = customers.map(c => { const lv = lastVisitMap[c.id] ? formatDate(lastVisitMap[c.id]) : ''; return `"${c.customer_nr}";"${c.name}";"${c.address || ''}";"${c.zip || ''}";"${c.city}";"${c.status}";"${lv}"`; });
    const blob = new Blob(['﻿' + header + '\n' + rows.join('\n') + '\n'], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'berkeley_crm_export.csv'; a.click();
  });
}

/* ── Start ──────────────────────────────────────────── */
init();
