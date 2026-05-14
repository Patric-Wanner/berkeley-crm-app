/**
 * Berkeley CRM — App
 * Main entry point. Initializes auth, loads data, wires up UI.
 */

import { sb } from './supabase-client.js';
import { requireAuth, logout, onAuthChange } from './auth.js';
import { loadProfile, getProfile, getRole, hasRole, fetchAllProfiles } from './role.js';
import { fetchCustomers, createCustomer, updateCustomer, deleteCustomer } from './customers.js';
import { fetchAllVisits, registerVisit, deleteVisit, getLastVisit } from './visits.js';
import { addComment, deleteComment, fetchComments } from './comments.js';
import { upsertRevenue, deleteRevenue, fetchRevenue } from './revenue.js';
import { fetchContacts, addContact, updateContact, deleteContact, setPrimaryContact } from './contacts.js';
import { fetchNextVisits, setNextVisit, removeNextVisit } from './next-visits.js';
import { daysSince, formatDate, formatSEK, visitColor, googleMapsUrl, geocodeAddress, haversine } from './helpers.js';
import { HQ, MAP_CENTER, MAP_ZOOM } from './config.js';
import { initMap, buildMarkers, setFilter, flyTo, search, resetView, invalidateSize, getMapInstance, toggleTheme } from './map.js';

/* ── State ──────────────────────────────────────────── */
let customers = [];
let lastVisitMap = {};  // { customerId: Date }
let profiles = [];

/* ── Init ───────────────────────────────────────────── */
async function init() {
  /* Auth guard */
  const session = await requireAuth();
  if (!session) return;

  /* Load profile + role */
  await loadProfile(session.user.id);
  const role = getRole();
  const profile = getProfile();

  /* Show user name */
  document.getElementById('userName').textContent = profile.display_name;

  /* Role-based UI */
  initRoleUI(role);

  /* Init map */
  const { wasDark } = initMap();
  if (wasDark) document.getElementById('themeBtn').textContent = '☀️';

  /* Load data */
  await refreshAll();

  /* Listen for auth changes */
  onAuthChange();

  /* Event bindings */
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
  /* Load customers (RLS auto-filters for salespeople) */
  customers = await fetchCustomers(filterUserId);

  /* Load last visit per customer */
  const allVisits = await fetchAllVisits(filterUserId);
  lastVisitMap = {};
  allVisits.forEach(v => {
    if (!lastVisitMap[v.customer_id] || new Date(v.visited_at) > new Date(lastVisitMap[v.customer_id])) {
      lastVisitMap[v.customer_id] = v.visited_at;
    }
  });

  /* Load profiles for manager/admin filter */
  if (hasRole('manager') && !profiles.length) {
    profiles = await fetchAllProfiles();
    buildSalespersonFilter();
  }

  /* Build map */
  buildMarkers(customers, lastVisitMap, buildPopup);

  /* Update dashboard */
  updateDashboard(allVisits);
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

  /* Salesperson name for manager view */
  const spName = hasRole('manager') && profiles.length
    ? profiles.find(p => p.id === c.assigned_to)?.display_name || ''
    : '';

  return `<div class="customer-popup">
    <h3>${c.name}</h3>
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
    <button onclick="CRM.openCard('${c.id}')" class="popup-btn" style="width:100%;">Öppna kundkort</button>
  </div>`;
}

/* ── Dashboard ──────────────────────────────────────── */
function updateDashboard(allVisits) {
  const now = new Date();
  const thisMonth = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
  const visitsThisMonth = allVisits.filter(v => v.visited_at.startsWith(thisMonth)).length;

  const neverVisited = customers.filter(c => !lastVisitMap[c.id]).length;
  const overdue90 = customers.filter(c => {
    const d = daysSince(lastVisitMap[c.id]);
    return d !== null && d >= 90;
  }).length;

  document.getElementById('statsGrid').innerHTML = `
    <div class="stat-box"><div class="num">${customers.length}</div><div class="label">Kunder</div></div>
    <div class="stat-box"><div class="num">${visitsThisMonth}</div><div class="label">Besök denna månad</div></div>
    <div class="stat-box"><div class="num" style="color:#E74C3C;">${overdue90 + neverVisited}</div><div class="label">Behöver besök</div></div>
    <div class="stat-box"><div class="num">${profiles.length || '—'}</div><div class="label">${hasRole('manager') ? 'Säljare' : 'Kunder'}</div></div>
  `;

  /* Toplist — least recently visited */
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

  /* Date */
  document.getElementById('dashDate').textContent = now.toLocaleDateString('sv-SE', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });
}

/* ── Manager: Salesperson filter ────────────────────── */
function buildSalespersonFilter() {
  const sel = document.getElementById('spFilter');
  if (!sel) return;
  sel.innerHTML = '<option value="all">Alla säljare</option>' +
    profiles.filter(p => p.role === 'salesperson').map(p =>
      `<option value="${p.id}">${p.display_name}</option>`
    ).join('');

  sel.addEventListener('change', () => refreshAll(sel.value));
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

/* ── Global CRM actions (for popup onclick) ─────────── */
window.CRM = {
  async registerVisit(customerId) {
    const input = document.getElementById('vc_' + customerId);
    const comment = input ? input.value.trim() : '';
    await registerVisit(customerId, getProfile().id, comment);
    await refreshAll();
  },

  async openCard(customerId) {
    /* TODO: Open customer card panel */
    flyTo(customerId);
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
    setFilter('all');
    document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
    document.querySelector('.filter-chip[data-filter="all"]')?.classList.add('active');
    refreshAll();
  });

  /* Dashboard toggle */
  document.getElementById('dashBtn').addEventListener('click', () => {
    const sidebar = document.getElementById('sidebar');
    sidebar.classList.toggle('open');
    document.getElementById('dashBtn').classList.toggle('active');
    invalidateSize();
  });

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
    const yr = new Date().getFullYear();
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
