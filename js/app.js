/**
 * Berkeley CRM — App
 * Main entry point. Initializes auth, loads data, wires up UI.
 */

import { sb } from './supabase-client.js';
import { requireAuth, logout, onAuthChange } from './auth.js';
import { loadProfile, getProfile, getRole, hasRole, fetchAllProfiles } from './role.js';
import { fetchCustomers, createCustomer, updateCustomer, deleteCustomer } from './customers.js';
import { fetchAllVisits, fetchVisits, registerVisit, deleteVisit, getLastVisit } from './visits.js';
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

  /* Sync fixed-header offset on mobile */
  syncHeaderOffset();
  window.addEventListener('resize', syncHeaderOffset);
}

/* ── Mobile: sync main-wrap padding to header height ── */
function syncHeaderOffset() {
  if (window.innerWidth > 768) return;
  const header = document.querySelector('.header');
  const wrap = document.querySelector('.main-wrap');
  if (header && wrap) {
    const h = header.offsetHeight;
    wrap.style.paddingTop = h + 'px';
    /* Sidebar must not extend behind the header */
    const sidebar = document.getElementById('sidebar');
    if (sidebar) sidebar.style.maxHeight = `calc(100dvh - ${h + 8}px)`;
  }

  /* Block pull-to-refresh / overscroll on header (Safari needs this) */
  if (!header._touchBlocked) {
    header.addEventListener('touchmove', e => e.preventDefault(), { passive: false });
    header._touchBlocked = true;
  }
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

/* ── Customer card rendering ───────────────────────── */
async function renderCard(customerId) {
  const c = customers.find(x => x.id === customerId);
  if (!c) return;

  const profile = getProfile();
  const isOwner = c.assigned_to === profile.id;
  const canEdit = isOwner || hasRole('admin');

  /* Load all card data in parallel */
  const [visits, contacts, comments, revenue] = await Promise.all([
    fetchVisits(customerId),
    fetchContacts(customerId),
    fetchComments(customerId),
    fetchRevenue(customerId)
  ]);

  const days = daysSince(lastVisitMap[c.id]);
  const col = days === null ? '#EAC435' : visitColor(days);
  const statusTxt = days === null ? 'Ej besökt' : days + ' dagar sedan';

  /* Salesperson name */
  const spName = profiles.length
    ? profiles.find(p => p.id === c.assigned_to)?.display_name || '—'
    : '';

  /* Revenue total */
  const revTotal = revenue.reduce((s, r) => s + (r.amount || 0), 0);

  const html = `
    <!-- Top info -->
    <div class="card-top">
      <div style="flex:1;">
        <h2 class="card-title">${c.name}</h2>
        <p class="card-subtitle">Kundnr: ${c.customer_nr}</p>
        <p class="card-subtitle">${c.address || ''}</p>
        <p class="card-subtitle">${c.zip || ''} ${c.city}</p>
        ${spName ? `<p class="card-subtitle">Säljare: ${spName}</p>` : ''}
        <a href="${googleMapsUrl(c)}" target="_blank" class="card-link">&#x2197; Google Maps</a>
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

    <!-- Register visit -->
    ${canEdit ? `
    <div class="card-section">
      <div class="card-section-header"><h3>Registrera besök</h3></div>
      <div style="display:flex;gap:8px;">
        <input id="cardVisitComment" class="card-input" placeholder="Kommentar (valfritt)" style="flex:1;">
        <button class="card-action-btn" onclick="CRM.cardRegisterVisit('${c.id}')">Registrera</button>
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
              <span style="font-size:13px;font-weight:500;">${ct.name}</span>
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
            <span style="font-size:12px;">${cm.text}</span>
            ${canEdit ? `<button onclick="CRM.cardDeleteComment('${cm.id}','${c.id}')" style="background:none;border:none;color:#E74C3C;cursor:pointer;font-size:11px;padding:4px 8px;">Ta bort</button>` : ''}
          </div>
          <p style="font-size:10px;color:var(--bm);margin-top:2px;">${formatDate(cm.created_at)}</p>
        </div>
      `).join('') : '<p style="font-size:12px;color:var(--bm);">Inga kommentarer</p>'}
    </div>

    <!-- Revenue -->
    <div class="card-section" style="border-bottom:none;">
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
  `;

  document.getElementById('cardContent').innerHTML = html;
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
    document.getElementById('customerCard').classList.add('open');
    document.getElementById('cardOverlay').classList.add('open');
    document.getElementById('cardContent').innerHTML = '<p style="padding:40px;text-align:center;color:var(--bm);">Laddar...</p>';

    /* Close sidebar on mobile so card is visible */
    const sidebar = document.getElementById('sidebar');
    if (sidebar.classList.contains('open')) {
      sidebar.classList.remove('open');
      document.getElementById('dashBtn').classList.remove('active');
      invalidateSize();
    }

    /* Close any open popup */
    getMapInstance()?.closePopup();

    await renderCard(customerId);
  },

  closeCard() {
    document.getElementById('customerCard').classList.remove('open');
    document.getElementById('cardOverlay').classList.remove('open');
  },

  /* Card-level visit registration */
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

  /* Sidebar close button (mobile) */
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

  /* Also close sidebar when tapping the backdrop */
  document.getElementById('sidebarBackdrop').addEventListener('click', closeSidebar);

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
