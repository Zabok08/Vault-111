// ==UserScript==
// @name         Vault 111 Organized Crime Planner
// @namespace    https://www.torn.com/
// @version      3.0.0-alpha.13
// @description  Backend-connected Vault 111 OC planner with secure shared data and self-only crime-stat synchronization.
// @author       Vault 111
// @homepageURL  https://github.com/Zabok08/Vault-111
// @downloadURL  https://raw.githubusercontent.com/Zabok08/Vault-111/main/Vault-111-Control-Center.user.js
// @updateURL    https://raw.githubusercontent.com/Zabok08/Vault-111/main/Vault-111-Control-Center.user.js
// @match        https://www.torn.com/*
// @connect      vault111-control-center.onrender.com
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_addStyle
// @run-at       document-idle
// ==/UserScript==

(() => {
  'use strict';

  const INSTANCE_MARKER_ID = 'v111-control-center-singleton';
  if (document.getElementById(INSTANCE_MARKER_ID)) return;
  const instanceMarker = document.createElement('meta');
  instanceMarker.id = INSTANCE_MARKER_ID;
  instanceMarker.dataset.version = '3.0.0-alpha.13';
  (document.head || document.documentElement).appendChild(instanceMarker);

  // Replace this value and the matching @connect entry with the HTTPS production host before faction-wide release.
  const BACKEND_API = 'https://vault111-control-center.onrender.com';
  const STORE = {
    cache: 'v111_ocp_cache_v1',
    settings: 'v111_ocp_settings_v1',
    overrides: 'v111_ocp_overrides_v2',
    backendAccess: 'v111_v3_access_token',
    backendRefresh: 'v111_v3_refresh_token',
    backendExpires: 'v111_v3_access_expires_at',
    backendStatsLastAutoSync: 'v111_v3_stats_last_auto_sync'
  };
  const STATS_AUTO_SYNC_INTERVAL_MS = 5 * 60 * 1000;
  const CRIME_URL = 'https://www.torn.com/factions.php?step=your&type=1#/tab=crimes';
  const TAB_IDS = ['dashboard', 'plan', 'members', 'backend', 'settings'];
  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  let state = {
    cache: load(STORE.cache, { members: [], crimes: [], syncedAt: 0 }),
    settings: load(STORE.settings, { collapsed: false, collapsedPosition: null, planningOpen: true, showBreakdown: true, filter: 'all', autoRefresh: false, refreshMinutes: 5, compact: false }),
    overrides: load(STORE.overrides, {}),
    backend: {
      connected: false,
      loading: false,
      user: null,
      error: '',
      sync: null,
      assignments: new Map(),
      crimeVersions: new Map()
    },
    ui: {
      activeTab: 'dashboard',
      scrollByTab: {},
      memberSearch: '',
      dashboardStatus: null,
      plannerStatus: null,
      backendStatus: null,
      settingsStatus: null,
      busyLabel: '',
      modalMemberId: null
    }
  };

  state.settings = Object.assign({ collapsed:false, collapsedPosition:null, planningOpen:true, showBreakdown:true, filter:'all', autoRefresh:false, refreshMinutes:5, compact:false }, state.settings || {});
  // Remove obsolete locally stored API keys from pre-backend releases.
  GM_deleteValue('v111_ocp_keys_v1');
  // Always open the planner with the complete crime list visible.
  state.settings.filter = 'all';
  addStyles();
  let root = null;
  let lastUrl = location.href;
  let autoRefreshTimer = null;
  let dismissedUntilReload = false;
  let modalReturnFocusKey = null;
  let backendAwakeUntil = 0;
  let backendWakePromise = null;

  syncMountToPage();
  configureAutoRefresh();
  restoreBackendSession();
  window.addEventListener('hashchange', syncMountToPage);
  window.addEventListener('popstate', syncMountToPage);
  window.addEventListener('resize', () => applyCollapsedPosition(true));
  setInterval(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      syncMountToPage();
    }
  }, 500);
  setInterval(updateCrimeCountdowns, 1000);

  function isFactionPage() {
    return /^\/factions\.php$/i.test(location.pathname);
  }

  function syncMountToPage() {
    if (isFactionPage() && !dismissedUntilReload) {
      const existingRoot = document.getElementById('v111-ocp');
      if (existingRoot && existingRoot !== root) return;
      if (!root || !root.isConnected) {
        root = document.createElement('section');
        root.id = 'v111-ocp';
        root.setAttribute('role', 'region');
        root.setAttribute('aria-label', 'Vault 111 Organized Crime Planner');
        document.body.appendChild(root);
        render();
      }
    } else if (root?.isConnected) {
      state.ui.modalMemberId = null;
      modalReturnFocusKey = null;
      root.remove();
      root = null;
    }
  }

  function getScrollContainer() {
    return root?.querySelector('main') || root?.querySelector('#v111-body');
  }

  function render() {
    if (!root || !root.isConnected) return;
    const renderedTab = root.querySelector('[role="tab"][aria-selected="true"]')?.dataset.tab;
    const previousScroller = getScrollContainer();
    if (renderedTab && previousScroller) state.ui.scrollByTab[renderedTab] = previousScroller.scrollTop;
    const focusKey = state.ui.modalMemberId ? null : captureFocusKey(document.activeElement);
    if (!TAB_IDS.includes(state.ui.activeTab)) state.ui.activeTab = 'dashboard';
    const isActive = tab => state.ui.activeTab === tab;
    const tabAttributes = tab => `id="v111-tab-${tab}" role="tab" aria-selected="${isActive(tab)}" aria-controls="v111-pane-${tab}" tabindex="${isActive(tab) ? '0' : '-1'}"`;
    const paneAttributes = tab => `id="v111-pane-${tab}" role="tabpanel" aria-labelledby="v111-tab-${tab}" tabindex="0"${isActive(tab) ? '' : ' hidden'}`;
    const { members = [], crimes = [], syncedAt = 0 } = state.cache;
    const plans = buildPlan(members, crimes);
    const metrics = getDashboardMetrics(plans, members);
    root.classList.toggle('collapsed', !!state.settings.collapsed);
    root.classList.toggle('compact', !!state.settings.compact);
    root.classList.toggle('is-busy', !!state.backend.loading);
    root.setAttribute('aria-busy', String(!!state.backend.loading));
    root.innerHTML = `
      <header data-drag-handle${state.settings.collapsed ? ' tabindex="0" aria-label="Collapsed planner. Drag or use arrow keys to move."' : ''}>
        <div>
          <strong>Vault 111 OC Planner</strong>
          <small>v3.0 alpha.13 · ${state.backend.connected ? '<b class="backend-label">BACKEND CONNECTED</b> · ' : ''}${syncedAt ? `Synced ${new Date(syncedAt).toLocaleString()}` : 'Not synced'}</small>
        </div>
        <div class="head-actions">
          <button data-act="collapse" aria-label="${state.settings.collapsed ? 'Expand planner' : 'Collapse planner'}" aria-expanded="${!state.settings.collapsed}" aria-controls="v111-body" title="${state.settings.collapsed ? 'Expand' : 'Collapse'}">${state.settings.collapsed ? '▣' : '—'}</button>
          <button data-act="close" aria-label="Hide planner until page reload" title="Hide until page reload">×</button>
        </div>
      </header>
      <div class="body" id="v111-body">
        <div class="tabs" role="tablist" aria-label="Planner sections">
          <button class="${isActive('dashboard') ? 'active' : ''}" data-tab="dashboard" ${tabAttributes('dashboard')}>Dashboard</button>
          <button class="${isActive('plan') ? 'active' : ''}" data-tab="plan" ${tabAttributes('plan')}>Planner</button>
          <button class="${isActive('members') ? 'active' : ''}" data-tab="members" ${tabAttributes('members')}>Members</button>
          <button class="${isActive('backend') ? 'active' : ''}" data-tab="backend" ${tabAttributes('backend')} aria-label="API Key${state.backend.connected ? ', connected' : ', disconnected'}">API Key ${state.backend.connected ? '<span class="backend-dot" aria-hidden="true">●</span>' : ''}</button>
          <button class="${isActive('settings') ? 'active' : ''}" data-tab="settings" ${tabAttributes('settings')}>Settings</button>
        </div>
        ${state.backend.loading ? `<div class="activity-bar" role="status" aria-live="polite" aria-atomic="true"><span class="spinner" aria-hidden="true"></span>${esc(state.ui.busyLabel || 'Working…')}</div>` : ''}
        <main>
          <section data-pane="dashboard" ${paneAttributes('dashboard')}>
            ${renderDashboard(metrics, plans)}
          </section>
          <section data-pane="plan" ${paneAttributes('plan')}>
            <div class="toolbar">
              <button class="primary" data-act="sync"${busyAttributes()}>Sync & Build Plan</button>
              <button data-act="reoptimize"${busyAttributes()}>Optimize All Crimes</button>
              <a class="button" href="${CRIME_URL}" target="_blank" rel="noopener">Open Torn OCs</a>
              <button data-act="export">Copy Plan</button>
            </div>
            ${renderStatusRegion('v111-status', state.ui.plannerStatus)}
            <div class="planner-controls">
              <label>Show
                <select id="v111-filter">
                  <option value="all" ${state.settings.filter === 'all' ? 'selected' : ''}>All crimes</option>
                  <option value="planning" ${state.settings.filter === 'planning' ? 'selected' : ''}>Planning only</option>
                  <option value="ready" ${state.settings.filter === 'ready' ? 'selected' : ''}>Ready / strong</option>
                  <option value="weak" ${state.settings.filter === 'weak' ? 'selected' : ''}>Needs attention</option>
                  <option value="unfilled" ${state.settings.filter === 'unfilled' ? 'selected' : ''}>Missing players</option>
                  <option value="mine" ${state.settings.filter === 'mine' ? 'selected' : ''}>My assignments</option>
                </select>
              </label>
              <span>${plans.length} crimes · ${metrics.available} eligible members with stats · ${metrics.occupied} occupied</span>
            </div>
            <div class="plans">${renderPlans(plans)}</div>
          </section>
          <section data-pane="members" ${paneAttributes('members')}>
            <div class="member-tools">
              <label class="sr-only" for="v111-member-search">Search faction members</label>
              <input id="v111-member-search" type="search" value="${esc(state.ui.memberSearch)}" placeholder="Search faction members" aria-controls="v111-member-list">
              <span>${members.filter(m => m.apiStatus === 'ok').length} members with synced stats</span>
            </div>
            <div class="member-list" id="v111-member-list">${renderMemberList(members, plans)}</div>
          </section>
          <section data-pane="backend" ${paneAttributes('backend')}>
            ${renderBackendPanel()}
          </section>
          <section data-pane="settings" ${paneAttributes('settings')}>
            <div class="optimizer-panel">
              <h3>Optimizer & Display</h3>
              <label class="setting-row"><input type="checkbox" id="v111-show-breakdown" ${state.settings.showBreakdown !== false ? 'checked' : ''}> Show scoring breakdowns</label>
              <label class="setting-row"><input type="checkbox" id="v111-compact" ${state.settings.compact ? 'checked' : ''}> Compact role cards</label>
              <label class="setting-row"><input type="checkbox" id="v111-auto-refresh" ${state.settings.autoRefresh ? 'checked' : ''}> Auto-refresh while on faction pages</label>
              <label class="setting-row">Refresh interval
                <select id="v111-refresh-minutes">
                  ${[3,5,10,15].map(n => `<option value="${n}" ${Number(state.settings.refreshMinutes) === n ? 'selected' : ''}>${n} minutes</option>`).join('')}
                </select>
              </label>
              <div class="toolbar">
                <button class="primary" data-act="reoptimize"${busyAttributes()}>Rebuild Best Crew</button>
                <button class="danger" data-act="clear-overrides"${busyAttributes()}>Clear Local Locks</button>
              </div>
              ${renderStatusRegion('v111-settings-status', state.ui.settingsStatus)}
              <p class="notice">Display settings remain local to this browser. Shared assignments and permissions are stored and enforced by the backend.</p>
            </div>
          </section>
        </main>
      </div>
      <div id="v111-modal" hidden></div>
      <div id="v111-announcer" class="sr-only" role="status" aria-live="polite" aria-atomic="true"></div>`;

    applyCollapsedPosition();
    bindEvents();
    applyMemberSearch();
    updateCrimeCountdowns();
    if (state.ui.modalMemberId) openMemberModal(state.ui.modalMemberId, true);
    requestAnimationFrame(() => {
      const scroller = getScrollContainer();
      if (scroller) scroller.scrollTop = Number(state.ui.scrollByTab[state.ui.activeTab] || 0);
      if (focusKey && !state.ui.modalMemberId) restoreFocusKey(focusKey);
    });
  }

  function getDashboardMetrics(plans, members) {
    const planning = plans.filter(isPlanningCrime);
    const openSlots = planning.flatMap(c => c.slots).filter(s => !s.existing);
    const filled = openSlots.filter(s => s.assigned);
    const unfilled = openSlots.filter(s => !s.assigned).length;
    const readinessValues = planning.map(crimeReadiness);
    const avgReadiness = readinessValues.length ? Math.round(readinessValues.reduce((a,b)=>a+b,0) / readinessValues.length) : 0;
    const ready = readinessValues.filter(v => v >= 80).length;
    const occupied = members.filter(m => m.isInOc).length;
    const available = members.filter(m => m.apiStatus === 'ok' && !m.isInOc).length;
    const bestIndex = readinessValues.length ? readinessValues.indexOf(Math.max(...readinessValues)) : -1;
    return { planning: planning.length, openRoles: openSlots.length, filled: filled.length, unfilled, avgReadiness, ready, occupied, available, bestCrime: bestIndex >= 0 ? planning[bestIndex] : null };
  }

  function renderDashboard(metrics, plans) {
    const queue = plans.filter(isPlanningCrime).sort((a,b) => crimeReadiness(b) - crimeReadiness(a));
    return `
      <div class="dashboard-grid">
        <div class="metric"><b>${metrics.planning}</b><span>Planning crimes</span></div>
        <div class="metric"><b>${metrics.ready}</b><span>Strong / ready</span></div>
        <div class="metric"><b>${metrics.available}</b><span>Available with stats</span></div>
        <div class="metric"><b>${metrics.unfilled}</b><span>Unfilled roles</span></div>
        <div class="metric wide"><b>${metrics.avgReadiness}%</b><span>Average readiness</span></div>
      </div>
      <div class="dashboard-actions toolbar">
        <button class="primary" data-act="sync"${busyAttributes()}>Sync Data</button>
        <button data-jump="plan">Open Planner</button>
        <button data-act="export">Copy Plan</button>
      </div>
      ${renderStatusRegion('v111-dashboard-status', state.ui.dashboardStatus)}
      ${metrics.bestCrime ? renderBestNextCrime(metrics.bestCrime) : ''}
      <h3 class="section-title">Planning queue</h3>
      <div class="queue-list">${queue.length ? queue.map(c => {
        const ready = crimeReadiness(c);
        const missing = c.slots.filter(s => !s.existing && !s.assigned).length;
        const readyAt = timestampMs(c.readyAt);
        return `<button class="queue-row" data-jump-crime="${esc(c.id)}">
          <span><b>${esc(c.name)}</b><small>${missing ? `${missing} missing role${missing === 1 ? '' : 's'}` : 'Crew filled'}</small></span>
          <span class="queue-right">
            <span class="queue-timer ${readyAt && readyAt <= Date.now() ? 'ready' : ''}" data-ready-at="${readyAt || 0}" aria-live="off" title="${readyAt ? `Ready ${esc(new Date(readyAt).toLocaleString())}` : 'Ready time unavailable'}">${formatCrimeCountdown(readyAt)}</span>
            <span class="queue-score ${readinessClass(ready)}">${ready}%</span>
          </span>
        </button>`;
      }).join('') : '<div class="empty">No planning-stage crimes found.</div>'}</div>`;
  }

  function timestampMs(value) {
    if (!value) return 0;
    if (typeof value === 'number') return value < 1e12 ? value * 1000 : value;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function formatCrimeCountdown(readyAt) {
    if (!readyAt) return 'Timer unavailable';
    const seconds = Math.max(0, Math.ceil((readyAt - Date.now()) / 1000));
    if (seconds === 0) return 'Ready';
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainder = seconds % 60;
    const clock = [hours, minutes, remainder].map(value => String(value).padStart(2, '0')).join(':');
    return `Ready in ${days ? `${days}d ` : ''}${clock}`;
  }

  function updateCrimeCountdowns() {
    if (!root?.isConnected) return;
    root.querySelectorAll('[data-ready-at]').forEach(element => {
      const readyAt = Number(element.dataset.readyAt || 0);
      element.textContent = formatCrimeCountdown(readyAt);
      element.classList.toggle('ready', Boolean(readyAt && readyAt <= Date.now()));
    });
  }


  function renderBestNextCrime(crime) {
    const readiness = crimeReadiness(crime);
    return `<div class="highlight-card">
      <small>Best next crime</small>
      <div class="highlight-title"><h3>${esc(crime.name)}</h3><span class="readiness-badge ${readinessClass(readiness)}">${readiness}%</span></div>
      <div class="toolbar"><a class="button primary" href="${esc(crime.url)}" target="_blank" rel="noopener">Open Crime</a><button data-jump-crime="${esc(crime.id)}">View in Planner</button></div>
    </div>`;
  }

  function renderMemberList(members, plans) {
    const assignments = new Map();
    plans.forEach(c => c.slots.forEach(s => {
      if (s.assigned?.id) assignments.set(Number(s.assigned.id), { crime: c.name, role: s.role, existing: s.existing });
    }));
    const ordered = [...members].sort((a,b) => {
      const aReady = a.apiStatus === 'ok' ? 1 : 0;
      const bReady = b.apiStatus === 'ok' ? 1 : 0;
      return bReady - aReady || String(a.name).localeCompare(String(b.name));
    });
    return ordered.map(member => {
      const best = bestRolesForMember(member, plans).slice(0,3);
      const assignment = assignments.get(Number(member.id));
      return `<button class="member-row" data-member-id="${member.id}" data-member-name="${esc(String(member.name).toLowerCase())}" aria-haspopup="dialog">
        <span><b>${esc(member.name)} [${member.id}]</b><small>${member.position || 'Member'} · ${member.apiStatus === 'ok' ? 'Stats loaded' : 'No stats synced'}${member.isInOc ? ' · In OC' : ''}</small></span>
        <span class="member-tags">${assignment ? `<i>${esc(assignment.role)}</i>` : best.map(x => `<i>${esc(x.role)}</i>`).join('')}</span>
      </button>`;
    }).join('');
  }

  function bestRolesForMember(member, plans) {
    if (member.apiStatus !== 'ok') return [];
    const roles = [];
    for (const crime of plans) for (const slot of crime.slots) {
      if (slot.existing) continue;
      const result = roleScoreDetailed(member, slot, crime);
      roles.push({ role: slot.role, crime: crime.name, score: result.score });
    }
    const deduped = new Map();
    roles.sort((a,b)=>b.score-a.score).forEach(r => { if (!deduped.has(r.role)) deduped.set(r.role, r); });
    return [...deduped.values()];
  }

  function openMemberModal(memberId, restoring = false) {
    const member = (state.cache.members || []).find(m => Number(m.id) === Number(memberId));
    if (!member) {
      state.ui.modalMemberId = null;
      return;
    }
    if (!restoring) modalReturnFocusKey = captureFocusKey(document.activeElement);
    state.ui.modalMemberId = Number(member.id);
    const plans = buildPlan(state.cache.members || [], state.cache.crimes || []);
    const roles = bestRolesForMember(member, plans).slice(0,6);
    const totals = Object.entries(member.totals || {}).sort((a,b)=>b[1]-a[1]).slice(0,6);
    const modal = root.querySelector('#v111-modal');
    modal.hidden = false;
    modal.innerHTML = `<div class="modal-backdrop" data-close-modal aria-hidden="true"></div><article class="member-modal" role="dialog" aria-modal="true" aria-labelledby="v111-member-modal-title" tabindex="-1">
      <div class="modal-head"><div><h3 id="v111-member-modal-title">${esc(member.name)} [${member.id}]</h3><small>${esc(member.position || 'Faction member')} · Level ${member.level || '?'}</small></div><button data-close-modal aria-label="Close member profile" title="Close">×</button></div>
      <div class="profile-status ${member.isInOc ? 'busy' : 'free'}">${member.isInOc ? 'Currently in an OC' : 'Available for planning'}</div>
      <h4>Best tracked roles</h4>
      <div class="profile-roles">${roles.length ? roles.map(r => `<div><b>${esc(r.role)}</b><span>${esc(r.crime)} · score ${Math.round(r.score)}</span></div>`).join('') : '<p>No personal stats loaded.</p>'}</div>
      <h4>Strongest tracked categories</h4>
      <div class="stat-bars">${totals.map(([k,v]) => `<div><span>${esc(k)}</span><b>${formatNumber(v)}</b></div>`).join('') || '<p>No tracked stats.</p>'}</div>
      <div class="toolbar"><a class="button primary" href="https://www.torn.com/profiles.php?XID=${member.id}" target="_blank" rel="noopener">Open profile</a></div>
    </article>`;
    modal.querySelectorAll('[data-close-modal]').forEach(element => element.addEventListener('click', closeMemberModal));
    modal.addEventListener('keydown', trapModalFocus);
    requestAnimationFrame(() => modal.querySelector('[data-close-modal]')?.focus({ preventScroll: true }));
  }

  function closeMemberModal() {
    const modal = root?.querySelector('#v111-modal');
    state.ui.modalMemberId = null;
    if (modal) {
      modal.hidden = true;
      modal.innerHTML = '';
    }
    if (modalReturnFocusKey) restoreFocusKey(modalReturnFocusKey);
    modalReturnFocusKey = null;
  }

  function trapModalFocus(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeMemberModal();
      return;
    }
    if (event.key !== 'Tab') return;
    const dialog = event.currentTarget.querySelector('[role="dialog"]');
    const focusable = [...dialog.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])')];
    if (!focusable.length) {
      event.preventDefault();
      dialog.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function crimeReadiness(crime) {
    const relevant = (crime.slots || []).filter(s => !s.existing);
    if (!relevant.length) return 100;
    const values = relevant.map(s => s.assigned ? Number(s.confidence || 50) : 0);
    const average = values.reduce((a,b)=>a+b,0) / values.length;
    const fillRate = relevant.filter(s => s.assigned).length / relevant.length;
    return Math.max(0, Math.min(100, Math.round(average * .7 + fillRate * 30)));
  }

  function readinessClass(value) {
    return value >= 80 ? 'excellent' : value >= 65 ? 'good' : value >= 45 ? 'fair' : 'poor';
  }

  function renderPlans(plans) {
    if (!plans.length) return '<div class="empty">Connect to the Vault 111 backend, then press <b>Sync & Build Plan</b>.</div>';

    const myTornId = Number(state.backend.user?.tornId || 0);
    const filter = state.settings.filter || 'all';
    const filtered = plans.filter(crime => {
      const readiness = crimeReadiness(crime);
      const unfilled = crime.slots.some(s => !s.existing && !s.assigned);
      const mine = crime.slots.some(s => s.assigned && myTornId > 0 && Number(s.assigned.id) === myTornId);
      if (filter === 'planning') return isPlanningCrime(crime);
      if (filter === 'ready') return readiness >= 80;
      if (filter === 'weak') return readiness < 65;
      if (filter === 'unfilled') return unfilled;
      if (filter === 'mine') return mine;
      return true;
    });
    if (!filtered.length) return '<div class="empty">No crimes match the selected filter.</div>';

    const renderCrimeCard = (crime, crimeIndex) => {
      const readiness = crimeReadiness(crime);
      const missing = crime.slots.filter(s => !s.existing && !s.assigned).length;
      return `<article class="crime-card" data-crime-id="${esc(crime.id)}" tabindex="-1" aria-labelledby="v111-crime-title-${esc(crime.id)}">
        <div class="crime-title">
          <div><h3 id="v111-crime-title-${esc(crime.id)}">${esc(crime.name)}</h3><small>Difficulty ${crime.difficulty || '?'} · ${esc(crime.status || 'available')} · ${missing ? `${missing} role${missing === 1 ? '' : 's'} missing` : 'crew filled'}</small></div>
          <div class="crime-title-actions"><span class="readiness-badge ${readinessClass(readiness)}">${readiness}%</span><a class="button primary" href="${esc(crime.url)}" target="_blank" rel="noopener">Open Crime</a></div>
        </div>
        <div class="crime-readiness" role="progressbar" aria-label="${esc(`${crime.name} readiness`)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${readiness}"><i class="${readinessClass(readiness)}" style="width:${readiness}%"></i></div>
        <div class="role-grid">
          ${crime.slots.map(slot => `
            <div class="role-card ${slot.existing ? 'existing' : ''} ${slot.manual ? 'manual' : ''}">
              <div class="role-heading"><div class="role-name">${esc(slot.role)}</div>${slot.shared ? '<span class="lock-badge shared">SHARED</span>' : (slot.manual ? '<span class="lock-badge">LOCKED</span>' : '')}</div>
              ${slot.assigned ? `
                <button class="player-link" data-member-id="${slot.assigned.id}" aria-haspopup="dialog">${esc(slot.assigned.name)} [${slot.assigned.id}]</button>
                <div class="score">${slot.existing ? `Confirmed assignment · Fit ${Math.round(slot.score || 0)} · Confidence ${slot.confidence}%` : `Fit ${Math.round(slot.score)} · Confidence ${slot.confidence}%`}</div>
                <div class="confidence" role="progressbar" aria-label="${esc(`${slot.assigned.name} confidence for ${slot.role}`)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${slot.confidence}"><i style="width:${slot.confidence}%"></i></div>
                <div class="reason">${esc(slot.reason)}</div>
                ${state.settings.showBreakdown !== false && slot.breakdown ? `<div class="breakdown">${slot.breakdown.map(x => `${esc(x.label)} ${x.value >= 0 ? '+' : ''}${Math.round(x.value)}`).join(' · ')}</div>` : ''}
                ${!slot.existing && state.backend.connected && backendCanAssign() ? `<label class="candidate-select-label">Shared assignment
                  <select data-role-select="${esc(slot.key)}" data-crime-id="${esc(crime.id)}"${busyAttributes()}>
                    <option value="">Automatic best fit</option>
                    ${(slot.candidatePool || []).map(a => `<option value="${a.id}" ${slot.manual && Number(slot.assigned.id) === Number(a.id) ? 'selected' : ''}>${esc(a.name)} [${a.id}] · ${Math.round(a.score)}</option>`).join('')}
                  </select>
                </label>` : ''}
                ${slot.alternatives?.length ? `<div class="alts">Backups: ${slot.alternatives.map(a => `${esc(a.name)} (${Math.round(a.score)})`).join(', ')}</div>` : ''}
                <div class="role-actions">
                  <a class="mini primary" href="${esc(crime.url)}" target="_blank" rel="noopener">Join screen</a>
                  <button class="mini" data-copy-assignment="${esc(`${slot.assigned.name} [${slot.assigned.id}] → ${crime.name} / ${slot.role}`)}">Copy</button>
                </div>` : '<div class="unfilled">No eligible member</div>'}
            </div>`).join('')}
        </div>
      </article>`;
    };

    const planning = [];
    const other = [];
    filtered.forEach((crime, index) => (isPlanningCrime(crime) ? planning : other).push({ crime, index }));

    const planningOpen = !!state.settings.planningOpen;
    const planningContentId = 'v111-planning-crimes';
    const planningMarkup = planning.length ? `
      <section class="planning-group ${planningOpen ? 'is-open' : ''}">
        <button type="button" class="planning-group-summary" data-act="toggle-planning" aria-expanded="${planningOpen}" aria-controls="${planningContentId}">
          <span><b>Planning-stage crimes</b><small>${planning.length} crime${planning.length === 1 ? '' : 's'} · optimized as one crew board</small></span>
          <span class="dropdown-icon" aria-hidden="true">${planningOpen ? '⌃' : '⌄'}</span>
        </button>
        <div class="planning-group-content" id="${planningContentId}"${planningOpen ? '' : ' hidden'}>
          ${planning.map(({ crime, index }) => renderCrimeCard(crime, index)).join('')}
        </div>
      </section>` : '';

    const groupedOther = Object.values(other.reduce((groups, item) => {
      const label = String(item.crime.status?.name || item.crime.status || 'Other crimes').trim() || 'Other crimes';
      (groups[label] ||= { label, items: [] }).items.push(item);
      return groups;
    }, {})).map(group => `
      <section class="status-group">
        <div class="status-group-heading"><b>${esc(group.label)} crimes</b><small>${group.items.length} crime${group.items.length === 1 ? '' : 's'} · current crew and recommendations</small></div>
        <div class="status-group-content">${group.items.map(({ crime, index }) => renderCrimeCard(crime, index)).join('')}</div>
      </section>`).join('');

    return planningMarkup + groupedOther;
  }

  function isPlanningCrime(crime) {
    const status = String(crime?.status?.name || crime?.status?.state || crime?.status || crime?.state || '').trim().toLowerCase();
    return status === 'planning' || status === 'planned' || status === 'assembling' || status.includes('planning');
  }

  function renderBackendPanel() {
    const backendFeedback = state.backend.error ? { text: state.backend.error, error: true } : state.ui.backendStatus;
    if (state.backend.connected && state.backend.user) {
      const user = state.backend.user;
      const sync = state.backend.sync;
      const lastSync = sync?.lastSuccessAt
        ? new Date(sync.lastSuccessAt).toLocaleString()
        : 'Not synchronized yet';
      const ownMember = (state.cache.members || []).find(member => Number(member.id) === Number(user.tornId));
      const personalStats = ownMember?.apiStatus === 'ok'
        ? (ownMember.statsSyncedAt ? `Synced ${new Date(ownMember.statsSyncedAt).toLocaleString()}` : 'Synced')
        : 'Not synced yet';
      return `
        <div class="backend-card">
          <div class="backend-state connected"><b>Secure backend connected</b><small>${esc(BACKEND_API)}</small></div>
          <p class="notice api-key-reminder">Enter only your own Torn API key. The first connection may take about a minute while the free Render server wakes up. Your crime stats refresh automatically when you connect and when you return to this screen.</p>
          <dl>
            <div><dt>Player</dt><dd>${esc(user.name)} [${esc(user.tornId)}]</dd></div>
            <div><dt>Control Center role</dt><dd>${esc(user.role)}</dd></div>
            <div><dt>Faction position</dt><dd>${esc(user.factionPosition || 'Member')}</dd></div>
            <div><dt>Shared data</dt><dd>${esc(lastSync)}</dd></div>
            <div><dt>Snapshot</dt><dd>${Number(sync?.memberCount || 0)} members · ${Number(sync?.crimeCount || 0)} crimes</dd></div>
            <div><dt>My crime stats</dt><dd>${esc(personalStats)}</dd></div>
          </dl>
          <div class="toolbar">
            ${backendCanSync() ? `<button class="primary" data-act="backend-sync"${busyAttributes()}>Sync Vault 111 from Torn</button>` : ''}
            <button class="primary" data-act="backend-sync-stats"${busyAttributes()}>Sync My Crime Stats</button>
            <button data-act="load-shared"${busyAttributes()}>Refresh Shared Data</button>
            <button data-act="backend-logout"${busyAttributes()}>Disconnect</button>
          </div>
          ${renderStatusRegion('v111-backend-status', backendFeedback)}
          <p class="notice">${backendCanSync() ? 'Faction synchronization uses your encrypted key and requires Torn faction API permission. ' : 'Your role can read the latest shared snapshot. '}Your own crime stats are normalized for planner scoring and shared with the faction planner; unrelated personal stats are not collected.</p>
        </div>`;
    }
    return `
      <div class="backend-card">
        <div class="backend-state"><b>Connect to Vault 111</b><small>${esc(BACKEND_API)}</small></div>
        <p class="notice api-key-reminder" id="v111-key-help">Enter only your own Torn API key. The first connection may take about a minute while the free Render server wakes up. Your key is sent to the configured Vault 111 backend for identity and faction verification, stored encrypted by the server, and never saved by the userscript. Connecting automatically imports only your crime-category stats for shared planner scoring.</p>
        <form id="v111-backend-form">
          <label for="v111-backend-key">Your Torn API key</label>
          <input id="v111-backend-key" name="torn-api-key" type="password" autocomplete="off" spellcheck="false" placeholder="Enter your API key" aria-describedby="v111-key-help" maxlength="256" required${busyAttributes()}>
          <button class="primary" type="submit"${busyAttributes()}>Connect Securely</button>
        </form>
        ${renderStatusRegion('v111-backend-status', backendFeedback)}
        <small class="security-note">Production connections must use HTTPS. Plain HTTP is accepted only for localhost development.</small>
      </div>`;
  }

  function clampCollapsedPosition(position) {
    if (!root?.isConnected) return null;
    const margin = 8;
    const width = Math.max(1, root.offsetWidth || 300);
    const height = Math.max(1, root.offsetHeight || 48);
    const maxLeft = Math.max(margin, window.innerWidth - width - margin);
    const maxTop = Math.max(margin, window.innerHeight - height - margin);
    return {
      left: Math.round(Math.min(maxLeft, Math.max(margin, Number(position?.left) || margin))),
      top: Math.round(Math.min(maxTop, Math.max(margin, Number(position?.top) || margin)))
    };
  }

  function applyCollapsedPosition(persist = false) {
    if (!root?.isConnected) return;
    if (!state.settings.collapsed || !state.settings.collapsedPosition) {
      for (const property of ['left', 'top', 'right', 'transform']) root.style.removeProperty(property);
      return;
    }
    const position = clampCollapsedPosition(state.settings.collapsedPosition);
    if (!position) return;
    state.settings.collapsedPosition = position;
    root.style.setProperty('left', `${position.left}px`, 'important');
    root.style.setProperty('top', `${position.top}px`, 'important');
    root.style.setProperty('right', 'auto', 'important');
    root.style.setProperty('transform', 'none', 'important');
    if (persist) save(STORE.settings, state.settings);
  }

  function moveCollapsedPlanner(left, top, persist = false) {
    if (!state.settings.collapsed || !root?.isConnected) return;
    state.settings.collapsedPosition = clampCollapsedPosition({ left, top });
    applyCollapsedPosition(persist);
  }

  function bindCollapsedDrag() {
    const handle = root?.querySelector('[data-drag-handle]');
    if (!handle) return;

    handle.addEventListener('pointerdown', event => {
      const target = event.target instanceof Element ? event.target : null;
      if (!state.settings.collapsed || event.button !== 0 || target?.closest('button,a,input,select,textarea')) return;
      event.preventDefault();
      const startingRect = root.getBoundingClientRect();
      const startingX = event.clientX;
      const startingY = event.clientY;
      root.classList.add('dragging');
      handle.setPointerCapture?.(event.pointerId);

      const move = pointerEvent => {
        if (pointerEvent.pointerId !== event.pointerId) return;
        moveCollapsedPlanner(
          startingRect.left + pointerEvent.clientX - startingX,
          startingRect.top + pointerEvent.clientY - startingY
        );
      };
      const finish = pointerEvent => {
        if (pointerEvent.pointerId !== event.pointerId) return;
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', finish);
        window.removeEventListener('pointercancel', finish);
        root?.classList.remove('dragging');
        handle.releasePointerCapture?.(event.pointerId);
        applyCollapsedPosition(true);
      };

      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', finish);
      window.addEventListener('pointercancel', finish);
    });

    handle.addEventListener('keydown', event => {
      if (!state.settings.collapsed || event.target !== handle) return;
      const directions = {
        ArrowLeft: [-1, 0],
        ArrowRight: [1, 0],
        ArrowUp: [0, -1],
        ArrowDown: [0, 1]
      };
      const direction = directions[event.key];
      if (!direction) return;
      event.preventDefault();
      const rect = root.getBoundingClientRect();
      const distance = event.shiftKey ? 1 : 12;
      moveCollapsedPlanner(rect.left + direction[0] * distance, rect.top + direction[1] * distance, true);
    });
  }

  function bindEvents() {
    bindCollapsedDrag();
    const tabs = [...root.querySelectorAll('[role="tab"]')];
    tabs.forEach((button, index) => {
      button.addEventListener('click', () => activateTab(button.dataset.tab));
      button.addEventListener('keydown', event => {
        let targetIndex = null;
        if (event.key === 'ArrowRight') targetIndex = (index + 1) % tabs.length;
        if (event.key === 'ArrowLeft') targetIndex = (index - 1 + tabs.length) % tabs.length;
        if (event.key === 'Home') targetIndex = 0;
        if (event.key === 'End') targetIndex = tabs.length - 1;
        if (targetIndex === null) return;
        event.preventDefault();
        activateTab(tabs[targetIndex].dataset.tab, true);
      });
    });

    root.querySelector('[data-act="collapse"]')?.addEventListener('click', () => {
      state.settings.collapsed = !state.settings.collapsed;
      save(STORE.settings, state.settings);
      render();
    });
    root.querySelector('[data-act="close"]')?.addEventListener('click', () => {
      dismissedUntilReload = true;
      state.ui.modalMemberId = null;
      modalReturnFocusKey = null;
      root.remove();
      root = null;
    });
    root.querySelectorAll('[data-act="sync"]').forEach(button => button.addEventListener('click', () => syncAll(false)));
    root.querySelector('[data-act="export"]')?.addEventListener('click', copyPlan);
    root.querySelectorAll('[data-act="reoptimize"]').forEach(button => button.addEventListener('click', () => {
      state.ui.activeTab = 'plan';
      state.ui.plannerStatus = { text: 'Best available crew rebuilt.', error: false };
      render();
    }));
    root.querySelector('[data-act="clear-overrides"]')?.addEventListener('click', () => {
      if (!Object.keys(state.overrides).length) {
        state.ui.settingsStatus = { text: 'There are no local manual locks to clear.', error: false };
        setStatus(root.querySelector('#v111-settings-status'), 'There are no local manual locks to clear.');
        return;
      }
      if (!window.confirm('Clear every local manual role lock? Shared backend assignments will not be changed.')) return;
      state.overrides = {};
      save(STORE.overrides, state.overrides);
      state.ui.activeTab = 'settings';
      state.ui.settingsStatus = { text: 'Local manual locks cleared. Shared assignments were not changed.', error: false };
      render();
    });
    root.querySelector('#v111-show-breakdown')?.addEventListener('change', event => {
      state.settings.showBreakdown = event.target.checked;
      save(STORE.settings, state.settings);
      state.ui.activeTab = 'settings';
      render();
    });
    root.querySelectorAll('[data-role-select]').forEach(select => select.addEventListener('change', () => updateRoleSelection(select)));
    root.querySelector('[data-act="toggle-planning"]')?.addEventListener('click', event => {
      const button = event.currentTarget;
      const group = button.closest('.planning-group');
      const content = group?.querySelector('.planning-group-content');
      const icon = button.querySelector('.dropdown-icon');
      state.settings.planningOpen = !state.settings.planningOpen;
      save(STORE.settings, state.settings);
      group?.classList.toggle('is-open', state.settings.planningOpen);
      button.setAttribute('aria-expanded', String(state.settings.planningOpen));
      if (content) content.hidden = !state.settings.planningOpen;
      if (icon) icon.textContent = state.settings.planningOpen ? '⌃' : '⌄';
    });
    root.querySelector('#v111-backend-form')?.addEventListener('submit', connectBackend);
    root.querySelector('[data-act="backend-logout"]')?.addEventListener('click', disconnectBackend);
    root.querySelector('[data-act="backend-sync"]')?.addEventListener('click', () => syncBackendFaction(false, true));
    root.querySelector('[data-act="backend-sync-stats"]')?.addEventListener('click', () => syncBackendPersonalStats());
    root.querySelector('[data-act="load-shared"]')?.addEventListener('click', refreshSharedData);
    root.querySelectorAll('[data-copy-assignment]').forEach(button => button.addEventListener('click', async () => {
      await copyText(button.dataset.copyAssignment);
      const original = button.textContent;
      button.textContent = 'Copied';
      announce('Assignment copied.');
      setTimeout(() => { button.textContent = original; }, 1200);
    }));
    root.querySelector('#v111-filter')?.addEventListener('change', event => {
      state.settings.filter = event.target.value;
      save(STORE.settings, state.settings);
      state.ui.activeTab = 'plan';
      render();
    });
    root.querySelector('#v111-compact')?.addEventListener('change', event => {
      state.settings.compact = event.target.checked;
      save(STORE.settings, state.settings);
      state.ui.activeTab = 'settings';
      render();
    });
    root.querySelector('#v111-auto-refresh')?.addEventListener('change', event => {
      state.settings.autoRefresh = event.target.checked;
      save(STORE.settings, state.settings);
      configureAutoRefresh();
      state.ui.activeTab = 'settings';
      render();
    });
    root.querySelector('#v111-refresh-minutes')?.addEventListener('change', event => {
      state.settings.refreshMinutes = Number(event.target.value) || 5;
      save(STORE.settings, state.settings);
      configureAutoRefresh();
    });
    root.querySelectorAll('[data-jump]').forEach(button => button.addEventListener('click', () => switchTab(button.dataset.jump)));
    root.querySelectorAll('[data-jump-crime]').forEach(button => button.addEventListener('click', () => {
      state.settings.filter = 'planning';
      state.settings.planningOpen = true;
      state.ui.activeTab = 'plan';
      save(STORE.settings, state.settings);
      render();
      setTimeout(() => {
        const crime = root.querySelector(`[data-crime-id="${CSS.escape(button.dataset.jumpCrime)}"]`);
        crime?.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' });
        crime?.focus({ preventScroll: true });
      }, 50);
    }));
    root.querySelectorAll('[data-member-id]').forEach(button => button.addEventListener('click', event => {
      if (event.target.closest('select,a')) return;
      openMemberModal(button.dataset.memberId);
    }));
    root.querySelector('#v111-member-search')?.addEventListener('input', event => {
      state.ui.memberSearch = event.target.value;
      applyMemberSearch();
    });
  }

  function activateTab(tab, focusTab = false) {
    if (!TAB_IDS.includes(tab) || !root?.isConnected) return;
    const scroller = getScrollContainer();
    if (scroller) state.ui.scrollByTab[state.ui.activeTab] = scroller.scrollTop;
    state.ui.activeTab = tab;
    root.querySelectorAll('[role="tab"]').forEach(button => {
      const active = button.dataset.tab === tab;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', String(active));
      button.tabIndex = active ? 0 : -1;
    });
    root.querySelectorAll('[role="tabpanel"]').forEach(panel => {
      panel.hidden = panel.dataset.pane !== tab;
    });
    if (scroller) scroller.scrollTop = Number(state.ui.scrollByTab[tab] || 0);
    if (focusTab) root.querySelector(`[data-tab="${CSS.escape(tab)}"]`)?.focus();
    if (tab === 'backend') {
      setTimeout(() => {
        if (state.ui.activeTab === 'backend') syncBackendPersonalStats({ automatic: true });
      }, 0);
    }
  }

  function captureFocusKey(element) {
    if (!(element instanceof Element) || !root?.contains(element)) return null;
    if (element.id) return `#${CSS.escape(element.id)}`;
    const pane = element.closest('[data-pane]')?.dataset.pane;
    for (const attribute of ['data-tab', 'data-role-select', 'data-member-id', 'data-jump-crime', 'data-act']) {
      const value = element.getAttribute(attribute);
      if (value === null) continue;
      const scope = pane ? `[data-pane="${CSS.escape(pane)}"] ` : '';
      return `${scope}[${attribute}="${CSS.escape(value)}"]`;
    }
    return null;
  }

  function restoreFocusKey(selector) {
    if (!selector || !root?.isConnected) return;
    try {
      root.querySelector(selector)?.focus({ preventScroll: true });
    } catch {
      // The interface remains usable if a refreshed control no longer exists.
    }
  }

  function applyMemberSearch() {
    if (!root?.isConnected) return;
    const query = String(state.ui.memberSearch || '').trim().toLowerCase();
    root.querySelectorAll('.member-row').forEach(row => {
      row.style.display = !query || row.dataset.memberName.includes(query) || row.textContent.toLowerCase().includes(query) ? 'flex' : 'none';
    });
  }

  function busyAttributes() {
    return state.backend.loading ? ' disabled aria-disabled="true"' : '';
  }

  function renderStatusRegion(id, feedback) {
    const text = feedback?.text || '';
    const error = Boolean(feedback?.error);
    return `<div id="${id}" class="${text ? `status ${error ? 'error' : 'ok'}` : 'status-region'}" role="${error ? 'alert' : 'status'}" aria-live="${error ? 'assertive' : 'polite'}" aria-atomic="true">${esc(text)}</div>`;
  }

  function announce(text) {
    const region = root?.querySelector('#v111-announcer');
    if (!region) return;
    region.textContent = '';
    requestAnimationFrame(() => { if (region.isConnected) region.textContent = text; });
  }

  function feedbackKeyForTab(tab) {
    if (tab === 'dashboard') return 'dashboardStatus';
    if (tab === 'backend') return 'backendStatus';
    if (tab === 'settings') return 'settingsStatus';
    return 'plannerStatus';
  }

  function setFeedback(tab, text, error = false) {
    state.ui[feedbackKeyForTab(tab)] = { text, error };
    announce(text);
  }

  function beginBackendWork(label, tab = state.ui.activeTab, renderBusy = true) {
    if (state.backend.loading) return false;
    state.backend.loading = true;
    state.ui.busyLabel = label;
    if (TAB_IDS.includes(tab)) state.ui.activeTab = tab;
    if (renderBusy) render();
    return true;
  }

  function finishBackendWork() {
    state.backend.loading = false;
    state.ui.busyLabel = '';
  }

  function configureAutoRefresh() {
    if (autoRefreshTimer) clearInterval(autoRefreshTimer);
    autoRefreshTimer = null;
    if (!state.settings.autoRefresh) return;
    const minutes = Math.max(3, Number(state.settings.refreshMinutes) || 5);
    autoRefreshTimer = setInterval(() => {
      if (isFactionPage() && state.backend.connected && !document.hidden) syncAll(true);
    }, minutes * 60 * 1000);
  }

  async function syncAll(silent = false) {
    if (state.backend.connected) {
      return syncBackendFaction(silent, false);
    }
    if (silent) return;
    state.backend.error = 'Connect to the Vault 111 backend before synchronizing.';
    state.ui.backendStatus = { text: state.backend.error, error: true };
    state.ui.activeTab = 'backend';
    render();
  }

  function buildPlan(members, crimes) {
    const globallyOccupied = new Set();
    for (const crime of crimes) for (const slot of crime.slots || []) {
      const id = Number(slot.userId || 0);
      if (id) globallyOccupied.add(id);
    }

    const eligible = members.filter(member =>
      member.apiStatus === 'ok' && member.isInOc !== true &&
      !globallyOccupied.has(Number(member.id)) &&
      !/federal|fallen/i.test(String(member.status))
    );

    const plans = crimes.map(crime => ({
      ...crime,
      url: `${CRIME_URL}&v111crime=${encodeURIComponent(crime.id)}`,
      slots: (crime.slots || []).map((slot, index) => ({ ...slot, key: roleKey(crime, slot, index) }))
    }));

    const reserved = new Set(globallyOccupied);
    const openSlots = [];

    for (const crime of plans) {
      crime.slots.forEach((slot, index) => {
        if (Number(slot.userId || 0)) {
          const assigned = members.find(m => Number(m.id) === Number(slot.userId)) || { id: slot.userId, name: slot.userName || 'Assigned player', totals: {}, apiStatus: 'not_registered' };
          const detail = assigned.apiStatus === 'ok' ? roleScoreDetailed(assigned, slot, crime) : { score: Number(slot.successChance || 0), breakdown: [] };
          const confidence = Number(slot.successChance || 0) > 0 ? Math.max(1, Math.min(100, Math.round(Number(slot.successChance)))) : (assigned.apiStatus === 'ok' ? 85 : 100);
          Object.assign(slot, {
            assigned, existing: true, manual: false, score: detail.score, breakdown: detail.breakdown,
            confidence,
            reason: assigned.apiStatus === 'ok' ? `Confirmed in Torn. ${roleReason(assigned, slot.role)}` : 'Confirmed assignment in Torn; detailed stats are not loaded for this member.',
            alternatives: [], candidatePool: []
          });
          return;
        }
        const pool = eligible.map(member => {
          const detail = roleScoreDetailed(member, slot, crime);
          return { member, score: detail.score, breakdown: detail.breakdown };
        }).sort((a, b) => b.score - a.score);
        slot._pool = pool;
        const hasSharedAssignment = state.backend.assignments.has(slot.key);
        const sharedAssignment = hasSharedAssignment ? state.backend.assignments.get(slot.key) : null;
        const overrideId = Number(hasSharedAssignment ? (sharedAssignment?.assignedTornId || 0) : (state.overrides[slot.key] || 0));
        if (overrideId) {
          const pick = pool.find(x => Number(x.member.id) === overrideId && !reserved.has(overrideId));
          if (pick) {
            reserved.add(overrideId);
            finalizeSlot(slot, pick, pool, true);
            slot.shared = hasSharedAssignment;
            return;
          }
          if (hasSharedAssignment) {
            const assigned = members.find(member => Number(member.id) === overrideId);
            if (assigned) {
              reserved.add(overrideId);
              Object.assign(slot, {
                assigned,
                existing: false,
                manual: true,
                shared: true,
                score: 0,
                breakdown: [],
                confidence: 50,
                reason: 'Shared assignment from the Vault 111 backend; detailed stats are not loaded in this browser.',
                alternatives: [],
                candidatePool: pool.slice(0, 20).map(x => ({ id: x.member.id, name: x.member.name, score: x.score }))
              });
              return;
            }
          }
          if (!hasSharedAssignment) delete state.overrides[slot.key];
        }
        openSlots.push({ crime, slot, index });
      });
    }
    save(STORE.overrides, state.overrides);

    // Regret-based global optimization: fill the role that loses the most quality if its best candidate is taken elsewhere.
    while (openSlots.length) {
      let bestIndex = -1;
      let bestRegret = -Infinity;
      for (let i = 0; i < openSlots.length; i++) {
        const available = openSlots[i].slot._pool.filter(x => !reserved.has(Number(x.member.id)));
        const regret = available.length ? available[0].score - (available[1]?.score ?? 0) : -1;
        const difficultyBoost = Number(openSlots[i].crime.difficulty || 0) * 0.25;
        const statusText = String(openSlots[i].crime.status?.name || openSlots[i].crime.status || '').toLowerCase();
        const recruitingBoost = statusText.includes('recruit') ? 50 : 0;
        if (regret + difficultyBoost + recruitingBoost > bestRegret) { bestRegret = regret + difficultyBoost + recruitingBoost; bestIndex = i; }
      }
      const item = openSlots.splice(bestIndex < 0 ? 0 : bestIndex, 1)[0];
      const available = item.slot._pool.filter(x => !reserved.has(Number(x.member.id)));
      const pick = available[0];
      if (pick) reserved.add(Number(pick.member.id));
      finalizeSlot(item.slot, pick, item.slot._pool, false);
    }

    for (const crime of plans) for (const slot of crime.slots) delete slot._pool;
    return plans;
  }

  function roleKey(crime, slot, index) {
    return `${crime.id}:${index}:${String(slot.role || 'role').replace(/[^a-z0-9]+/gi, '_')}`;
  }

  function finalizeSlot(slot, pick, fullPool, manual) {
    if (!pick) {
      Object.assign(slot, { assigned: null, score: null, confidence: 0, manual, reason: 'No member with synced stats is currently eligible.', alternatives: [], candidatePool: [] });
      return;
    }
    const availablePool = fullPool.filter(x => x.member && x.member.apiStatus === 'ok');
    const second = availablePool.find(x => Number(x.member.id) !== Number(pick.member.id));
    const gap = pick.score - (second?.score ?? 0);
    const confidence = Math.max(35, Math.min(99, Math.round(55 + gap * 1.8)));
    Object.assign(slot, {
      assigned: pick.member, score: pick.score, breakdown: pick.breakdown, confidence, manual,
      reason: manual ? `Manually locked. ${roleReason(pick.member, slot.role)}` : roleReason(pick.member, slot.role),
      alternatives: availablePool.filter(x => Number(x.member.id) !== Number(pick.member.id)).slice(0, 3).map(x => ({ id: x.member.id, name: x.member.name, score: x.score })),
      candidatePool: availablePool.slice(0, 20).map(x => ({ id: x.member.id, name: x.member.name, score: x.score }))
    });
  }

  function roleScoreDetailed(member, slot, crime) {
    const t = member.totals || {};
    const role = String(slot.role || '').toLowerCase();
    const breakdown = [];
    let score = 0;
    const addOne = (label, raw, weight) => {
      const value = Math.log10(1 + Number(raw || 0)) * weight;
      score += value;
      if (value > 0.5) breakdown.push({ label, value });
    };
    addOne('Crime history', t.crimes, 30);
    const levelValue = Number(member.level || 0) * 0.8;
    score += levelValue;
    breakdown.push({ label: 'Level', value: levelValue });
    const add = (keys, weight) => keys.forEach(k => addOne(k[0].toUpperCase() + k.slice(1), t[k], weight));
    if (/hack|tech|engineer|cyber|computer/.test(role)) add(['hacking', 'fraud'], 26);
    else if (/thief|burglar|pick|lock|infiltrat|lookout|scout/.test(role)) add(['theft', 'jail', 'busts'], 23);
    else if (/con|fraud|negotiat|inside|social|driver|distraction/.test(role)) add(['fraud', 'racing'], 21);
    else if (/muscle|enforcer|gun|sniper|bomber|combat|demolition/.test(role)) add(['violence'], 29);
    else if (/drug|chemist|smuggl|cook/.test(role)) add(['drugs'], 27);
    else add(['theft', 'fraud', 'hacking', 'violence', 'drugs'], 8);
    const penalty = Math.max(0, Number(crime.difficulty || 0) * 6 - Number(member.level || 0)) * 1.5;
    score -= penalty;
    if (penalty) breakdown.push({ label: 'Difficulty penalty', value: -penalty });
    const chance = Number(slot.candidates?.[member.id]?.successChance || 0);
    if (chance) { score += chance * 2; breakdown.push({ label: 'Torn chance', value: chance * 2 }); }
    breakdown.sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
    return { score, breakdown: breakdown.slice(0, 4) };
  }

  function roleScore(member, slot, crime) {
    return roleScoreDetailed(member, slot, crime).score;
  }

  function roleReason(member, role) {
    const entries = Object.entries(member.totals || {}).filter(([k]) => k !== 'crimes').sort((a, b) => b[1] - a[1]);
    const best = entries[0];
    return `${best ? `Strongest tracked category: ${best[0]} (${formatNumber(best[1])}). ` : ''}Weighted for the “${role}” role.`;
  }

  async function copyPlan() {
    const plans = buildPlan(state.cache.members || [], state.cache.crimes || []);
    const text = plans.map(c => [
      `${c.name} (Difficulty ${c.difficulty || '?'})`,
      ...c.slots.map(s => `• ${s.role}: ${s.assigned ? `${s.assigned.name} [${s.assigned.id}]` : 'UNFILLED'}`),
      CRIME_URL
    ].join('\n')).join('\n\n');
    if (!text) return setStatus(root.querySelector('#v111-status'), 'There is no plan to copy yet.', true);
    await copyText(text);
    setStatus(root.querySelector('#v111-status'), 'Plan copied to clipboard.');
  }

  function normalizeMembers(raw) {
    const source = raw.members || raw.faction?.members || [];
    const arr = Array.isArray(source) ? source : Object.entries(source).map(([id, value]) => ({ id, ...value }));
    return arr.map(m => {
      const stats = m.stats && typeof m.stats === 'object' && !Array.isArray(m.stats) ? m.stats : {};
      const totals = m.totals && typeof m.totals === 'object' && !Array.isArray(m.totals) ? m.totals : {};
      const hasStats = m.apiStatus === 'ok' || Object.keys(stats).length > 0;
      return {
        id: Number(m.id || m.user_id || m.player_id),
        name: m.name || m.player_name || `Player ${m.id}`,
        level: Number(m.level || 0),
        position: m.position || m.position_name || '',
        status: m.status?.state || m.status || '',
        isInOc: Boolean(m.is_in_oc ?? m.isInOc ?? m.organized_crime?.id ?? m.organizedCrime?.id ?? false),
        apiStatus: hasStats ? 'ok' : 'not_registered',
        stats,
        totals,
        statsSyncedAt: m.statsSyncedAt || null
      };
    }).filter(m => m.id);
  }

  function normalizeCrimes(raw) {
    const source = raw?.crimes || raw?.organized_crimes || raw?.data?.crimes || raw?.data?.organized_crimes || [];
    const arr = Array.isArray(source) ? source : Object.values(source || {});
    return arr.map(c => {
      const status = c?.status?.name || c?.status?.state || c?.status || c?.state || 'available';
      return {
        id: c.id ?? c.crime_id,
        name: c.name || c.scenario?.name || c.crime_name || 'Organized Crime',
        difficulty: Number(c.difficulty || c.level || c.scenario?.difficulty || 0),
        status: String(status),
        readyAt: timestampMs(c.ready_at ?? c.readyAt),
        slots: normalizeSlots(c.slots || c.roles || c.participants || c.scenario?.roles || [])
      };
    }).filter(c => c.id != null && c.slots.length);
  }

  function firstNumericId(...values) {
    for (const value of values) {
      const n = Number(value);
      if (Number.isFinite(n) && n > 0) return n;
    }
    return null;
  }

  function normalizeSlots(source) {
    const arr = Array.isArray(source) ? source : Object.values(source || {});
    return arr.map((s, index) => {
      const options = s.options || s.members || s.candidates || s.available_users || [];
      const candidates = {};
      const optionArr = Array.isArray(options) ? options : Object.entries(options || {}).map(([id, value]) => ({ id, ...value }));
      optionArr.forEach(o => {
        const id = firstNumericId(o.id, o.user_id, o.player_id, o.user?.id, o.user?.user_id, o.member?.id);
        if (id) candidates[id] = { successChance: Number(o.success_chance || o.successChance || o.chance || o.cpr || 0) };
      });

      const position = s.position_info || s.position || {};
      const roleBase = position.label || position.name || s.role || s.name || (typeof s.position === 'string' ? s.position : '') || `Role ${index + 1}`;
      const roleNumber = position.number || s.position_number || '';
      const role = roleNumber && !String(roleBase).includes(String(roleNumber)) ? `${roleBase} ${roleNumber}` : roleBase;

      const userId = firstNumericId(
        s.user_id,
        s.player_id,
        s.member_id,
        s.user?.id,
        s.user?.user_id,
        s.user?.player_id,
        s.member?.id,
        s.member?.user_id,
        s.participant?.id,
        s.participant?.user_id,
        s.assigned_user?.id,
        s.assigned_user?.user_id
      );
      const userName = s.user?.name || s.member?.name || s.participant?.name || s.assigned_user?.name || null;

      return {
        index,
        id: position.id || s.slot_id || s.id || index,
        role,
        userId,
        userName,
        successChance: Number(s.success_chance || s.successChance || s.chance || s.cpr || s.checkpoint_pass_rate || 0) || null,
        candidates
      };
    });
  }

  function backendCanAssign() {
    return ['OWNER', 'ADMIN', 'OC_PLANNER'].includes(String(state.backend.user?.role || '').toUpperCase());
  }

  function backendCanSync() {
    return ['OWNER', 'ADMIN', 'OC_PLANNER'].includes(String(state.backend.user?.role || '').toUpperCase());
  }

  function validatedBackendBase() {
    const url = new URL(BACKEND_API);
    const local = ['127.0.0.1', 'localhost'].includes(url.hostname);
    if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) {
      throw new Error('The Vault 111 backend must use HTTPS outside localhost development.');
    }
    return url.origin;
  }

  function backendRequest(method, route, { body, token, timeoutMs = 15000 } = {}) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method,
        url: `${validatedBackendBase()}${route}`,
        headers: {
          Accept: 'application/json',
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        data: body !== undefined ? JSON.stringify(body) : undefined,
        timeout: timeoutMs,
        onload: response => {
          let data = null;
          try { data = response.responseText ? JSON.parse(response.responseText) : null; }
          catch { return reject(new Error('The Vault 111 backend returned an unreadable response.')); }
          if (response.status >= 200 && response.status < 300) return resolve(data);
          const error = new Error(data?.error || `Vault 111 backend error ${response.status}`);
          error.status = response.status;
          error.data = data;
          reject(error);
        },
        onerror: () => reject(new Error('Could not reach the Vault 111 backend.')),
        ontimeout: () => reject(new Error('The Vault 111 backend request timed out.'))
      });
    });
  }

  async function ensureBackendAwake(force = false) {
    if (!force && Date.now() < backendAwakeUntil) return;
    if (backendWakePromise) return backendWakePromise;

    const previousLabel = state.ui.busyLabel;
    if (state.backend.loading) {
      state.ui.busyLabel = 'Waking the secure backend… This can take about a minute on free hosting.';
      render();
    }

    backendWakePromise = (async () => {
      validatedBackendBase();
      const deadline = Date.now() + 90000;
      let lastError = null;

      while (Date.now() < deadline) {
        const remaining = deadline - Date.now();
        try {
          const health = await backendRequest('GET', '/health', {
            timeoutMs: Math.min(65000, Math.max(5000, remaining))
          });
          if (health?.ok !== true || health?.database !== 'connected') {
            throw new Error('The Vault 111 backend or database is not ready yet.');
          }
          backendAwakeUntil = Date.now() + 10 * 60 * 1000;
          return;
        } catch (error) {
          lastError = error;
          if (Date.now() + 2500 >= deadline) break;
          await new Promise(resolve => setTimeout(resolve, 2500));
        }
      }

      const reason = friendly(lastError);
      throw new Error(`The free hosting service did not become ready within 90 seconds. Try again in a moment.${reason ? ` Last response: ${reason}` : ''}`);
    })().finally(() => {
      backendWakePromise = null;
      if (state.backend.loading) {
        state.ui.busyLabel = previousLabel;
        render();
      }
    });

    return backendWakePromise;
  }

  function saveBackendSession(session) {
    save(STORE.backendAccess, session.accessToken);
    save(STORE.backendRefresh, session.refreshToken);
    save(STORE.backendExpires, Date.now() + Math.max(30, Number(session.expiresIn || 900) - 30) * 1000);
  }

  function clearBackendSession() {
    GM_deleteValue(STORE.backendAccess);
    GM_deleteValue(STORE.backendRefresh);
    GM_deleteValue(STORE.backendExpires);
    state.backend.connected = false;
    state.backend.user = null;
    state.backend.sync = null;
    state.backend.assignments = new Map();
    state.backend.crimeVersions = new Map();
  }

  async function backendAccessToken() {
    const accessToken = load(STORE.backendAccess, '');
    if (accessToken && Date.now() < Number(load(STORE.backendExpires, 0))) return accessToken;
    const refreshToken = load(STORE.backendRefresh, '');
    if (!refreshToken) throw new Error('Connect to the Vault 111 backend first.');
    try {
      const session = await backendRequest('POST', '/v1/auth/refresh', { body: { refreshToken } });
      saveBackendSession(session);
      return session.accessToken;
    } catch (error) {
      clearBackendSession();
      throw error;
    }
  }

  async function backendApi(method, route, body) {
    await ensureBackendAwake();
    let token = await backendAccessToken();
    try {
      return await backendRequest(method, route, { body, token });
    } catch (error) {
      if (error.status !== 401) throw error;
      save(STORE.backendExpires, 0);
      token = await backendAccessToken();
      return backendRequest(method, route, { body, token });
    }
  }

  function personalStatsAutoSyncDue() {
    const lastSync = Number(load(STORE.backendStatsLastAutoSync, 0)) || 0;
    return Date.now() - lastSync >= STATS_AUTO_SYNC_INTERVAL_MS;
  }

  async function syncOwnCrimeStats(force = false) {
    if (!force && !personalStatsAutoSyncDue()) return false;
    await backendApi('POST', '/v1/me/crime-stats/sync', {});
    save(STORE.backendStatsLastAutoSync, Date.now());
    return true;
  }

  async function connectBackend(event) {
    event.preventDefault();
    if (state.backend.loading) return;
    const input = root.querySelector('#v111-backend-key');
    const key = input?.value.trim() || '';
    if (!/^[A-Za-z0-9_-]{8,256}$/.test(key)) {
      return setStatus(root.querySelector('#v111-backend-status'), 'That does not look like a valid Torn API key.', true);
    }
    state.backend.error = '';
    state.ui.backendStatus = null;
    if (!beginBackendWork('Connecting securely…', 'backend')) return;
    let sessionEstablished = false;
    let warning = '';
    try {
      await ensureBackendAwake();
      const session = await backendRequest('POST', '/v1/auth/login', { body: { apiKey: key } });
      saveBackendSession(session);
      state.backend.connected = true;
      state.backend.user = session.user;
      sessionEstablished = true;
      try {
        await syncOwnCrimeStats(true);
      } catch (error) {
        warning = `Connected, but your crime stats could not be synced: ${friendly(error)}`;
      }
      try {
        await loadSharedPlan();
      } catch (error) {
        warning ||= `Connected, but shared data could not be loaded: ${friendly(error)}`;
      }
      state.backend.error = warning;
      setFeedback('backend', warning || 'Connected securely. Your shared planner data is ready.', Boolean(warning));
    } catch (error) {
      if (!sessionEstablished) clearBackendSession();
      state.backend.error = friendly(error);
      setFeedback('backend', state.backend.error, true);
    } finally {
      finishBackendWork();
      if (input) input.value = '';
      render();
    }
  }

  async function restoreBackendSession() {
    if (!load(STORE.backendRefresh, '')) return;
    if (!beginBackendWork('Restoring secure session…', state.ui.activeTab)) return;
    try {
      const result = await backendApi('GET', '/v1/me');
      state.backend.connected = true;
      state.backend.user = result.user;
      let warning = '';
      try {
        await syncOwnCrimeStats();
      } catch (error) {
        warning = `Connected, but your automatic crime-stat refresh failed: ${friendly(error)}`;
      }
      try {
        await loadSharedPlan();
      } catch (error) {
        warning ||= `Connected, but shared data could not be loaded: ${friendly(error)}`;
      }
      state.backend.error = warning;
      state.ui.backendStatus = warning ? { text: warning, error: true } : null;
    } catch (error) {
      clearBackendSession();
      state.backend.error = friendly(error);
      state.ui.backendStatus = { text: state.backend.error, error: true };
    } finally {
      finishBackendWork();
      render();
    }
  }

  async function loadSharedPlan() {
    const result = await backendApi('GET', '/v1/oc/snapshot');
    const assignments = new Map();
    const versions = new Map();
    for (const crime of result?.crimes || []) {
      versions.set(String(crime.id), Number(crime.version || 1));
      for (const assignment of crime.assignments || []) {
        assignments.set(String(assignment.roleKey), assignment);
      }
    }
    state.backend.sync = result?.sync || null;
    state.backend.assignments = assignments;
    state.backend.crimeVersions = versions;
    if (result?.sync?.lastSuccessAt) {
      const members = normalizeMembers({ members: result.members || [] });
      const crimes = normalizeCrimes({ crimes: result.crimes || [] });
      state.cache = {
        members,
        crimes,
        syncedAt: new Date(result.sync.lastSuccessAt).getTime()
      };
      save(STORE.cache, state.cache);
    }
    return result;
  }

  async function syncBackendFaction(silent = false, returnToBackend = false) {
    if (state.backend.loading) return;
    const returnTab = returnToBackend ? 'backend' : state.ui.activeTab;
    const label = backendCanSync() ? 'Synchronizing Vault 111 from Torn…' : 'Refreshing shared faction data…';
    state.backend.error = '';
    state.ui.backendStatus = null;
    if (!beginBackendWork(label, returnTab, !silent)) return;
    try {
      if (backendCanSync()) await backendApi('POST', '/v1/faction/sync', {});
      await syncOwnCrimeStats(true);
      const result = await loadSharedPlan();
      const memberCount = Number(result?.sync?.memberCount || result?.members?.length || 0);
      const crimeCount = Number(result?.sync?.crimeCount || result?.crimes?.length || 0);
      if (!silent) {
        setFeedback(returnTab, `Your crime stats were updated. Shared data loaded: ${memberCount} members and ${crimeCount} available crimes.`);
      }
    } catch (error) {
      state.backend.error = friendly(error);
      if (!silent) setFeedback(returnTab, state.backend.error, true);
    } finally {
      finishBackendWork();
      state.ui.activeTab = returnTab;
      render();
    }
  }

  async function syncBackendPersonalStats({ automatic = false } = {}) {
    if (state.backend.loading) return;
    if (!state.backend.connected || (automatic && !personalStatsAutoSyncDue())) return;
    state.backend.error = '';
    state.ui.backendStatus = null;
    if (!beginBackendWork('Synchronizing your crime stats…', 'backend')) return;
    try {
      await syncOwnCrimeStats(!automatic);
      await loadSharedPlan();
      state.backend.error = '';
      setFeedback('backend', automatic
        ? 'Your crime stats were refreshed automatically.'
        : 'Your crime stats were synchronized successfully.');
    } catch (error) {
      state.backend.error = friendly(error);
      setFeedback('backend', state.backend.error, true);
    } finally {
      finishBackendWork();
      render();
    }
  }

  async function refreshSharedData() {
    if (state.backend.loading) return;
    state.backend.error = '';
    state.ui.backendStatus = null;
    if (!beginBackendWork('Refreshing shared planner data…', 'backend')) return;
    try {
      const result = await loadSharedPlan();
      const memberCount = Number(result?.sync?.memberCount || result?.members?.length || 0);
      const crimeCount = Number(result?.sync?.crimeCount || result?.crimes?.length || 0);
      setFeedback('backend', `Shared data refreshed: ${memberCount} members and ${crimeCount} crimes.`);
    } catch (error) {
      state.backend.error = friendly(error);
      setFeedback('backend', state.backend.error, true);
    } finally {
      finishBackendWork();
      render();
    }
  }

  async function updateRoleSelection(select) {
    if (state.backend.loading) return;
    const key = select.dataset.roleSelect;
    const selectedId = select.value ? Number(select.value) : null;
    const hadPrevious = Object.prototype.hasOwnProperty.call(state.overrides, key);
    const previousId = state.overrides[key];
    if (selectedId) state.overrides[key] = selectedId;
    else delete state.overrides[key];
    save(STORE.overrides, state.overrides);
    state.backend.error = '';
    state.ui.backendStatus = null;
    if (!beginBackendWork('Saving shared assignment…', 'plan')) return;
    try {
      if (state.backend.connected) await saveSharedAssignment(select.dataset.crimeId, key, selectedId);
      state.backend.error = '';
      setFeedback('plan', selectedId ? 'Shared assignment saved.' : 'Shared assignment returned to automatic best fit.');
    } catch (error) {
      if (hadPrevious) state.overrides[key] = previousId;
      else delete state.overrides[key];
      save(STORE.overrides, state.overrides);
      state.backend.error = friendly(error);
      setFeedback('plan', state.backend.error, true);
    } finally {
      finishBackendWork();
      render();
    }
  }

  async function saveSharedAssignment(crimeId, roleKey, assignedTornId) {
    if (!backendCanAssign()) throw Object.assign(new Error('Your Control Center role is read-only.'), { status: 403 });
    const expectedVersion = state.backend.crimeVersions.get(String(crimeId));
    if (!expectedVersion) throw new Error('This crime has not been synchronized to the backend yet.');
    await backendApi('PUT', `/v1/oc/crimes/${encodeURIComponent(crimeId)}/roles/${encodeURIComponent(roleKey)}`, {
      assignedTornId,
      locked: assignedTornId !== null,
      expectedVersion
    });
    await loadSharedPlan();
  }

  async function disconnectBackend() {
    if (!beginBackendWork('Disconnecting securely…', 'backend')) return;
    const refreshToken = load(STORE.backendRefresh, '');
    try {
      if (refreshToken) await backendRequest('POST', '/v1/auth/logout', { body: { refreshToken } });
    } catch {
      // Local disconnect still succeeds if the backend is unavailable.
    } finally {
      clearBackendSession();
      state.backend.error = '';
      state.ui.backendStatus = { text: 'Disconnected. The cached shared plan remains available in this browser.', error: false };
      finishBackendWork();
      render();
    }
  }

  function switchTab(tab) {
    activateTab(tab);
  }
  function setStatus(element, text, error = false) {
    if (element?.id === 'v111-dashboard-status') state.ui.dashboardStatus = { text, error };
    if (element?.id === 'v111-status') state.ui.plannerStatus = { text, error };
    if (element?.id === 'v111-backend-status') state.ui.backendStatus = { text, error };
    if (element?.id === 'v111-settings-status') state.ui.settingsStatus = { text, error };
    if (element) {
      element.textContent = text;
      element.className = error ? 'status error' : 'status ok';
      element.setAttribute('role', error ? 'alert' : 'status');
      element.setAttribute('aria-live', error ? 'assertive' : 'polite');
    }
    announce(text);
  }
  function friendly(error) { return String(error?.message || error || 'Unknown error').slice(0, 300); }
  function formatNumber(n) { return Number(n || 0).toLocaleString(); }
  function load(key, fallback) { try { return GM_getValue(key, fallback); } catch { return fallback; } }
  function save(key, value) { GM_setValue(key, value); }
  async function copyText(text) {
    if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text);
    const area = document.createElement('textarea'); area.value = text; document.body.appendChild(area); area.select(); document.execCommand('copy'); area.remove();
  }

  function addStyles() {
    GM_addStyle(`
      #v111-ocp {
        --v111-gold: #f2c94c;
        position: fixed !important;
        right: 12px !important;
        top: 50% !important;
        bottom: auto !important;
        transform: translateY(-50%) !important;
        width: min(560px, calc(100vw - 32px)) !important;
        max-height: 82vh !important;
        z-index: 2147483646 !important;
        display: block !important;
        background: #111820 !important;
        color: #eef5ff !important;
        border: 1px solid #2d5d91 !important;
        border-radius: 12px !important;
        box-shadow: 0 16px 50px rgba(0,0,0,.72) !important;
        font: 14px/1.45 system-ui,-apple-system,"Segoe UI",Arial,sans-serif !important;
        text-align: left !important;
        overflow: hidden !important;
        isolation: isolate !important;
      }
      #v111-ocp, #v111-ocp * { box-sizing: border-box !important; }
      #v111-ocp .sr-only { position:absolute !important; width:1px !important; height:1px !important; padding:0 !important; margin:-1px !important; overflow:hidden !important; clip:rect(0,0,0,0) !important; white-space:nowrap !important; border:0 !important; }
      #v111-ocp header {
        display: flex !important;
        justify-content: space-between !important;
        align-items: center !important;
        gap: 12px !important;
        min-height: 48px !important;
        padding: 11px 13px !important;
        margin: 0 !important;
        background: linear-gradient(135deg,#174b7e,#102b48) !important;
        border: 0 !important;
        border-bottom: 1px solid #49779d !important;
      }
      #v111-ocp header strong { display:block !important; font-size:15px !important; color:#fff !important; }
      #v111-ocp header small, #v111-ocp small { display:block !important; color:#b7c8d9 !important; font-size:12px !important; }
      #v111-ocp.collapsed header[data-drag-handle] { cursor:grab !important; touch-action:none !important; user-select:none !important; }
      #v111-ocp.collapsed.dragging header[data-drag-handle] { cursor:grabbing !important; }
      #v111-ocp button, #v111-ocp a.button, #v111-ocp a.mini {
        appearance: none !important;
        -webkit-appearance: none !important;
        display: inline-flex !important;
        align-items: center !important;
        justify-content: center !important;
        width: auto !important;
        min-width: 0 !important;
        min-height: 32px !important;
        margin: 0 !important;
        border: 1px solid #43617d !important;
        background: #1d2a38 !important;
        color: #eaf4ff !important;
        border-radius: 6px !important;
        padding: 7px 10px !important;
        text-decoration: none !important;
        text-transform: none !important;
        letter-spacing: normal !important;
        line-height: 1.15 !important;
        white-space: nowrap !important;
        cursor: pointer !important;
        font-family: system-ui,-apple-system,"Segoe UI",Arial,sans-serif !important;
        font-size: 12px !important;
        font-weight: 700 !important;
        box-shadow: none !important;
        filter: none !important;
        transition: filter .15s ease, background-color .15s ease, border-color .15s ease, color .15s ease !important;
      }
      #v111-ocp button:hover, #v111-ocp a.button:hover, #v111-ocp a.mini:hover { filter: brightness(1.16) !important; }
      #v111-ocp button:focus-visible, #v111-ocp a:focus-visible, #v111-ocp input:focus-visible, #v111-ocp select:focus-visible, #v111-ocp [tabindex]:focus-visible { outline:3px solid var(--v111-gold) !important; outline-offset:2px !important; }
      #v111-ocp button:disabled, #v111-ocp select:disabled, #v111-ocp input:disabled { cursor:wait !important; opacity:.58 !important; filter:none !important; }
      #v111-ocp .primary { background:#176db2 !important; border-color:#3795dc !important; color:#fff !important; }
      #v111-ocp .danger { background:#5c2028 !important; border-color:#a84450 !important; color:#fff !important; }
      #v111-ocp .mini { min-height:26px !important; padding:4px 7px !important; font-size:11px !important; }
      #v111-ocp .head-actions { display:flex !important; gap:5px !important; flex:0 0 auto !important; }
      #v111-ocp .head-actions button { min-width:32px !important; min-height:28px !important; padding:2px 8px !important; font-size:18px !important; }
      #v111-ocp .body { display:flex !important; flex-direction:column !important; min-height:0 !important; max-height:calc(82vh - 48px) !important; overflow:hidden !important; }
      #v111-ocp.collapsed .body { display:none !important; }
      #v111-ocp.collapsed { width:300px !important; }
      #v111-ocp .tabs { position:relative !important; top:auto !important; z-index:20 !important; flex:0 0 auto !important; display:flex !important; margin:0 !important; overflow-x:auto !important; scrollbar-width:thin !important; background:#0d131a !important; border-bottom:1px solid #26384a !important; box-shadow:0 4px 10px rgba(0,0,0,.35) !important; isolation:isolate !important; }
      #v111-ocp .tabs button { flex:1 0 76px !important; border:0 !important; border-radius:0 !important; background:transparent !important; color:#aebed0 !important; }
      #v111-ocp .tabs button.active { color:#fff !important; background:#1a2734 !important; box-shadow:inset 0 -3px 0 var(--v111-gold) !important; }
      #v111-ocp .tabs .backend-dot { margin-left:4px !important; color:#7ee2a8 !important; font-size:10px !important; }
      #v111-ocp .activity-bar { display:flex !important; flex:0 0 auto !important; align-items:center !important; gap:8px !important; padding:8px 12px !important; background:#1a2c3b !important; border-bottom:1px solid #36536b !important; color:#eef7ff !important; font-weight:700 !important; }
      #v111-ocp .spinner { width:15px !important; height:15px !important; flex:0 0 15px !important; border:2px solid rgba(255,255,255,.28) !important; border-top-color:var(--v111-gold) !important; border-radius:50% !important; animation:v111-spin .8s linear infinite !important; }
      @keyframes v111-spin { to { transform:rotate(360deg); } }
      #v111-ocp main { display:block !important; flex:1 1 auto !important; min-height:0 !important; padding:12px !important; margin:0 !important; overflow-y:auto !important; overflow-x:hidden !important; overscroll-behavior:contain !important; scrollbar-width:thin !important; scrollbar-color:#56748f #111820 !important; }
      #v111-ocp main > section { display:block; margin:0 !important; padding:0 !important; }
      #v111-ocp main > section[hidden] { display:none !important; }
      #v111-ocp .toolbar { display:flex !important; align-items:center !important; gap:7px !important; flex-wrap:wrap !important; margin:0 !important; }
      #v111-ocp .toolbar > * { flex:0 0 auto !important; }
      #v111-ocp .summary { display:flex !important; gap:8px !important; flex-wrap:wrap !important; margin:10px 0 !important; }
      #v111-ocp .summary span { display:inline-block !important; background:#182432 !important; border:1px solid #2b4258 !important; border-radius:7px !important; padding:6px 9px !important; color:#eef5ff !important; }
      #v111-ocp .status { margin:9px 0 !important; padding:8px !important; border-radius:6px !important; }
      #v111-ocp .status-region:empty { display:block !important; height:0 !important; overflow:hidden !important; }
      #v111-ocp .status.ok { background:#153927 !important; color:#b9f2d0 !important; }
      #v111-ocp .status.error { background:#4b2025 !important; color:#ffd4d8 !important; }
      #v111-ocp .crime-card { display:block !important; background:#151f2a !important; border:1px solid #2b4155 !important; border-radius:9px !important; margin:10px 0 !important; padding:0 !important; overflow:hidden !important; }
      #v111-ocp .crime-title { display:flex !important; justify-content:space-between !important; gap:10px !important; align-items:center !important; padding:10px !important; margin:0 !important; background:#1b2a39 !important; }
      #v111-ocp .crime-title > div { min-width:0 !important; flex:1 1 auto !important; }
      #v111-ocp .crime-title h3 { margin:0 !important; padding:0 !important; font-size:15px !important; line-height:1.25 !important; color:#fff !important; }
      #v111-ocp .crime-title a.button { flex:0 0 auto !important; }
      #v111-ocp .role-grid { display:grid !important; grid-template-columns:minmax(0,1fr) minmax(0,1fr) !important; gap:8px !important; padding:8px !important; margin:0 !important; }
      #v111-ocp .role-card { display:block !important; min-width:0 !important; background:#101820 !important; border:1px solid #263b4d !important; border-radius:7px !important; padding:8px !important; margin:0 !important; }
      #v111-ocp .role-card.existing { border-color:#567546 !important; }
      #v111-ocp .role-name { font-weight:800 !important; color:#73bcf2 !important; overflow-wrap:anywhere !important; }
      #v111-ocp a.player { display:block !important; color:#fff !important; font-weight:800 !important; margin-top:4px !important; text-decoration:none !important; overflow-wrap:anywhere !important; }
      #v111-ocp .score, #v111-ocp .reason, #v111-ocp .alts, #v111-ocp .unfilled { font-size:11px !important; margin-top:4px !important; color:#b6c7d8 !important; overflow-wrap:anywhere !important; }
      #v111-ocp .alts { color:#91a8be !important; }
      #v111-ocp .role-actions { display:flex !important; align-items:center !important; gap:5px !important; flex-wrap:wrap !important; margin-top:7px !important; }
      #v111-ocp .notice, #v111-ocp .empty { padding:10px !important; margin:0 0 10px !important; background:#172635 !important; border:1px solid #2d4962 !important; border-radius:7px !important; color:#dce9f6 !important; }
      #v111-ocp .backend-label, #v111-ocp .backend-dot { color:#7ee2a8 !important; }
      #v111-ocp .backend-card { padding:12px !important; border:1px solid #31516d !important; border-radius:9px !important; background:#101923 !important; }
      #v111-ocp .backend-state { margin-bottom:10px !important; padding:10px !important; border-left:3px solid #66809a !important; background:#172635 !important; }
      #v111-ocp .backend-state.connected { border-left-color:#59b982 !important; }
      #v111-ocp .backend-state b, #v111-ocp .backend-state small { display:block !important; }
      #v111-ocp .backend-card dl { margin:10px 0 !important; }
      #v111-ocp .backend-card dl div { display:flex !important; justify-content:space-between !important; gap:12px !important; padding:7px 0 !important; border-bottom:1px solid #293a4a !important; }
      #v111-ocp .backend-card dt { color:#a9bdd2 !important; }
      #v111-ocp .backend-card dd { margin:0 !important; color:#fff !important; font-weight:700 !important; text-align:right !important; }
      #v111-ocp #v111-backend-form { display:grid !important; grid-template-columns:minmax(0,1fr) auto !important; gap:7px !important; margin:10px 0 !important; }
      #v111-ocp #v111-backend-form label { grid-column:1 / -1 !important; color:#dce9f6 !important; font-weight:700 !important; }
      #v111-ocp #v111-backend-form input { min-width:0 !important; height:38px !important; margin:0 !important; background:#0e151d !important; color:#fff !important; border:1px solid #405a72 !important; border-radius:6px !important; padding:9px !important; font:13px system-ui,-apple-system,"Segoe UI",Arial,sans-serif !important; }
      #v111-ocp .security-note { margin-top:10px !important; }
      @media(max-width:600px) {
        #v111-ocp:not(.collapsed) { right:6px !important; top:50% !important; bottom:auto !important; transform:translateY(-50%) !important; width:min(88vw,360px) !important; max-height:40vh !important; font-size:12px !important; }
        #v111-ocp:not(.collapsed) .body { max-height:calc(40vh - 40px) !important; }
        #v111-ocp.collapsed { width:min(240px,calc(100vw - 24px)) !important; max-height:40px !important; }
        #v111-ocp header { min-height:40px !important; padding:6px 8px !important; }
        #v111-ocp header strong { font-size:13px !important; }
        #v111-ocp header small, #v111-ocp small { font-size:10px !important; }
        #v111-ocp .head-actions button { min-width:27px !important; min-height:27px !important; padding:2px 6px !important; font-size:15px !important; }
        #v111-ocp main { padding:5px !important; }
        #v111-ocp .tabs button { flex-basis:54px !important; min-height:32px !important; padding:4px 5px !important; font-size:10px !important; }
        #v111-ocp .role-grid { grid-template-columns:minmax(0,1fr) !important; }
        #v111-ocp .crime-title { align-items:stretch !important; flex-direction:column !important; }
        #v111-ocp #v111-backend-form { grid-template-columns:minmax(0,1fr) !important; }
        #v111-ocp #v111-backend-form button { width:100% !important; }
      }

      #v111-ocp .planning-group { display:block !important; margin:10px 0 !important; padding:0 !important; border:1px solid #31516d !important; border-radius:8px !important; overflow:hidden !important; background:#101923 !important; }
      #v111-ocp button.planning-group-summary { display:flex !important; width:100% !important; min-height:48px !important; justify-content:space-between !important; align-items:center !important; gap:12px !important; border:0 !important; border-radius:0 !important; padding:10px 12px !important; background:#182a3a !important; text-align:left !important; }
      #v111-ocp button.planning-group-summary > span:first-child { display:block !important; min-width:0 !important; }
      #v111-ocp button.planning-group-summary b { display:block !important; color:#fff !important; }
      #v111-ocp .planning-group-content { display:block !important; padding:10px !important; }
      #v111-ocp .planning-group-content[hidden] { display:none !important; }
      #v111-ocp .planning-group-content .crime-card { display:block !important; visibility:visible !important; opacity:1 !important; margin:8px 0 0 !important; }
      #v111-ocp .status-group { margin:10px 0 !important; border:1px solid #36536b !important; border-radius:9px !important; overflow:hidden !important; background:#101820 !important; }
      #v111-ocp .status-group-heading { display:flex !important; justify-content:space-between !important; gap:10px !important; align-items:center !important; padding:10px 12px !important; background:#1c3143 !important; }
      #v111-ocp .status-group-heading b, #v111-ocp .status-group-heading small { display:block !important; }
      #v111-ocp .status-group-content { padding:0 10px 10px !important; }
      #v111-ocp .status-group-content .crime-card { margin:10px 0 0 !important; }
      #v111-ocp .dropdown-icon { flex:0 0 auto !important; font-size:18px !important; line-height:1 !important; color:var(--v111-gold) !important; transition:transform .18s ease !important; }

      #v111-ocp .role-heading{display:flex;align-items:center;justify-content:space-between;gap:8px}
      #v111-ocp .lock-badge{font-size:10px;font-weight:800;letter-spacing:.5px;padding:2px 5px;border-radius:4px;background:#315f87;color:#fff}
      #v111-ocp .lock-badge.shared{background:#26734c}
      #v111-ocp .confidence{height:5px;background:rgba(255,255,255,.1);border-radius:99px;overflow:hidden;margin:6px 0}
      #v111-ocp .confidence i{display:block;height:100%;background:linear-gradient(90deg,#a85b30,#e7b34c,#65b76e);border-radius:99px}
      #v111-ocp .breakdown{font-size:11px;line-height:1.5;color:#bbc5cf;margin:6px 0;padding:6px;background:rgba(0,0,0,.16);border-radius:5px}
      #v111-ocp .candidate-select-label{display:block;font-size:11px;color:#c4cfda;margin:7px 0}
      #v111-ocp .candidate-select-label select{display:block;width:100%;margin-top:3px;background:#18222b;color:#eef3f7;border:1px solid #526577;border-radius:5px;padding:7px;font-size:12px}
      #v111-ocp .role-card.manual{box-shadow:inset 3px 0 0 #4d8fc8}
      #v111-ocp .optimizer-panel h3{margin:0 0 8px}
      #v111-ocp .setting-row{display:flex;gap:8px;align-items:center;margin:12px 0}

      #v111-ocp .dashboard-grid { display:grid !important; grid-template-columns:repeat(4,minmax(0,1fr)) !important; gap:8px !important; margin-bottom:10px !important; }
      #v111-ocp .metric { background:#172432 !important; border:1px solid #2c455b !important; border-radius:8px !important; padding:10px !important; text-align:center !important; }
      #v111-ocp .metric.wide { grid-column:span 2 !important; }
      #v111-ocp .metric b { display:block !important; font-size:22px !important; color:#fff !important; }
      #v111-ocp .metric span { display:block !important; font-size:11px !important; color:#b7c8d9 !important; }
      #v111-ocp .highlight-card { margin:10px 0 !important; padding:12px !important; border:1px solid #3f789e !important; border-radius:9px !important; background:linear-gradient(135deg,#19334a,#152330) !important; }
      #v111-ocp .highlight-card h3 { margin:3px 0 !important; color:#fff !important; }

      #v111-ocp .highlight-title { display:flex !important; align-items:center !important; justify-content:space-between !important; gap:10px !important; }
      #v111-ocp .next-best-assignment { display:grid !important; grid-template-columns:auto 1fr !important; gap:3px 10px !important; margin:9px 0 !important; padding:8px !important; background:#101d28 !important; border-radius:7px !important; }
      #v111-ocp .next-best-assignment span:last-child { grid-column:2 !important; color:#b9cce0 !important; }
      #v111-ocp .section-title { margin:12px 0 6px !important; font-size:13px !important; }
      #v111-ocp .queue-list { display:grid !important; gap:6px !important; }
      #v111-ocp button.queue-row { display:flex !important; justify-content:space-between !important; width:100% !important; text-align:left !important; padding:9px !important; }
      #v111-ocp .queue-row > span:first-child { min-width:0 !important; }
      #v111-ocp .queue-right { display:flex !important; align-items:center !important; justify-content:flex-end !important; gap:7px !important; flex:0 0 auto !important; }
      #v111-ocp .queue-timer { min-width:112px !important; color:#b9d8f2 !important; font:700 11px/1.2 ui-monospace,SFMono-Regular,Consolas,monospace !important; text-align:right !important; white-space:nowrap !important; }
      #v111-ocp .queue-timer.ready { color:#9ce0b3 !important; }
      #v111-ocp .queue-score, #v111-ocp .readiness-badge { flex:0 0 auto !important; padding:4px 7px !important; border-radius:999px !important; font-weight:800 !important; font-size:11px !important; }
      #v111-ocp .excellent { background:#215f3b !important; color:#c8f4d8 !important; }
      #v111-ocp .good { background:#28527a !important; color:#d7edff !important; }
      #v111-ocp .fair { background:#705a25 !important; color:#fff0b7 !important; }
      #v111-ocp .poor { background:#722f38 !important; color:#ffd5da !important; }
      #v111-ocp .planner-controls, #v111-ocp .member-tools { display:flex !important; justify-content:space-between !important; align-items:center !important; gap:8px !important; margin:10px 0 !important; flex-wrap:wrap !important; }
      #v111-ocp select, #v111-ocp .member-tools input { background:#101820 !important; color:#eef5ff !important; border:1px solid #405a72 !important; border-radius:6px !important; padding:7px !important; }
      #v111-ocp .crime-title-actions { display:flex !important; align-items:center !important; gap:7px !important; flex:0 0 auto !important; }
      #v111-ocp .crime-readiness { height:4px !important; background:#0b1117 !important; overflow:hidden !important; }
      #v111-ocp .crime-readiness i { display:block !important; height:100% !important; }
      #v111-ocp button.player-link { display:block !important; padding:0 !important; min-height:0 !important; margin-top:4px !important; border:0 !important; background:transparent !important; color:#fff !important; font-weight:800 !important; text-align:left !important; }
      #v111-ocp .member-list { display:grid !important; gap:5px !important; }
      #v111-ocp button.member-row { display:flex !important; justify-content:space-between !important; align-items:center !important; width:100% !important; padding:8px !important; text-align:left !important; }
      #v111-ocp .member-tags { display:flex !important; gap:4px !important; flex-wrap:wrap !important; justify-content:flex-end !important; }
      #v111-ocp .member-tags i { font-style:normal !important; font-size:10px !important; background:#24415a !important; border-radius:5px !important; padding:3px 5px !important; }
      #v111-ocp #v111-modal[hidden] { display:none !important; }
      #v111-ocp #v111-modal { position:fixed !important; inset:0 !important; z-index:2147483647 !important; display:block !important; }
      #v111-ocp .modal-backdrop { position:absolute !important; inset:0 !important; background:rgba(0,0,0,.75) !important; }
      #v111-ocp .member-modal { position:absolute !important; right:18px !important; top:50% !important; transform:translateY(-50%) !important; width:min(430px,calc(100vw - 36px)) !important; max-height:80vh !important; overflow:auto !important; background:#111a23 !important; border:1px solid #3b709b !important; border-radius:10px !important; padding:12px !important; box-shadow:0 20px 60px rgba(0,0,0,.8) !important; }
      #v111-ocp .modal-head { display:flex !important; justify-content:space-between !important; align-items:flex-start !important; gap:10px !important; }
      #v111-ocp .modal-head h3 { margin:0 !important; }
      #v111-ocp .profile-status { margin:10px 0 !important; padding:7px !important; border-radius:6px !important; font-weight:800 !important; }
      #v111-ocp .profile-status.free { background:#173b29 !important; color:#c4f3d5 !important; }
      #v111-ocp .profile-status.busy { background:#49262b !important; color:#ffd7dc !important; }
      #v111-ocp .profile-roles, #v111-ocp .stat-bars { display:grid !important; gap:5px !important; }
      #v111-ocp .profile-roles div, #v111-ocp .stat-bars div { display:flex !important; justify-content:space-between !important; gap:10px !important; padding:7px !important; background:#182531 !important; border-radius:6px !important; }
      #v111-ocp.compact .reason, #v111-ocp.compact .breakdown, #v111-ocp.compact .alts { display:none !important; }
      #v111-ocp.compact .role-card { padding:6px !important; }
      @media(max-width:600px) {
        #v111-ocp:not(.collapsed) { font-size:11px !important; }
        #v111-ocp button, #v111-ocp a.button, #v111-ocp a.mini { min-height:32px !important; padding:5px 7px !important; font-size:10px !important; }
        #v111-ocp .mini { min-height:28px !important; padding:4px 6px !important; }
        #v111-ocp .toolbar { display:grid !important; grid-template-columns:repeat(2,minmax(0,1fr)) !important; gap:4px !important; }
        #v111-ocp .toolbar > * { width:100% !important; white-space:normal !important; }
        #v111-ocp .activity-bar { gap:5px !important; padding:5px 7px !important; font-size:10px !important; }
        #v111-ocp .spinner { width:12px !important; height:12px !important; flex-basis:12px !important; }
        #v111-ocp .dashboard-grid { grid-template-columns:repeat(2,minmax(0,1fr)) !important; }
        #v111-ocp .metric.wide { grid-column:span 2 !important; }
        #v111-ocp .dashboard-grid { gap:4px !important; margin-bottom:5px !important; }
        #v111-ocp .metric { padding:6px 4px !important; border-radius:6px !important; }
        #v111-ocp .metric b { font-size:16px !important; }
        #v111-ocp .metric span { font-size:9px !important; line-height:1.2 !important; }
        #v111-ocp .highlight-card { margin:5px 0 !important; padding:7px !important; }
        #v111-ocp .highlight-card h3 { font-size:12px !important; }
        #v111-ocp .section-title { margin:7px 0 4px !important; font-size:11px !important; }
        #v111-ocp .queue-list, #v111-ocp .member-list { gap:3px !important; }
        #v111-ocp button.queue-row, #v111-ocp button.member-row { padding:5px 6px !important; }
        #v111-ocp .queue-right { gap:3px !important; }
        #v111-ocp .queue-timer { min-width:96px !important; font-size:9px !important; }
        #v111-ocp .queue-score, #v111-ocp .readiness-badge { padding:3px 5px !important; font-size:9px !important; }
        #v111-ocp .planner-controls, #v111-ocp .member-tools { gap:4px !important; margin:5px 0 !important; }
        #v111-ocp select, #v111-ocp input { min-height:34px !important; padding:5px !important; font-size:11px !important; }
        #v111-ocp .notice, #v111-ocp .empty, #v111-ocp .status { padding:6px !important; margin-bottom:5px !important; }
        #v111-ocp .crime-card { margin:5px 0 !important; border-radius:7px !important; }
        #v111-ocp .crime-title { gap:5px !important; padding:6px !important; }
        #v111-ocp .crime-title h3 { font-size:12px !important; }
        #v111-ocp .crime-title-actions { width:100% !important; justify-content:space-between !important; }
        #v111-ocp .role-grid { gap:4px !important; padding:4px !important; }
        #v111-ocp .role-card { padding:5px !important; }
        #v111-ocp .score, #v111-ocp .reason, #v111-ocp .alts, #v111-ocp .unfilled, #v111-ocp .breakdown, #v111-ocp .candidate-select-label { font-size:9px !important; }
        #v111-ocp .breakdown { margin:4px 0 !important; padding:4px !important; }
        #v111-ocp .role-actions { gap:3px !important; margin-top:4px !important; }
        #v111-ocp button.planning-group-summary { min-height:38px !important; padding:6px 7px !important; }
        #v111-ocp .planning-group, #v111-ocp .status-group { margin:5px 0 !important; }
        #v111-ocp .planning-group-content { padding:5px !important; }
        #v111-ocp .status-group-heading { gap:5px !important; padding:6px 7px !important; }
        #v111-ocp .status-group-content { padding:0 5px 5px !important; }
        #v111-ocp .backend-card { padding:7px !important; }
        #v111-ocp .backend-state { margin-bottom:5px !important; padding:6px !important; }
        #v111-ocp .backend-card dl { margin:5px 0 !important; }
        #v111-ocp .backend-card dl div { gap:6px !important; padding:4px 0 !important; }
        #v111-ocp #v111-backend-form { gap:4px !important; margin:5px 0 !important; }
        #v111-ocp #v111-backend-form input { height:34px !important; padding:5px !important; font-size:11px !important; }
        #v111-ocp .setting-row { gap:5px !important; margin:6px 0 !important; }
        #v111-ocp .member-tags i { padding:2px 4px !important; font-size:8px !important; }
        #v111-ocp .queue-row { align-items:flex-start !important; }
        #v111-ocp .queue-right { align-items:flex-end !important; flex-direction:column !important; }
        #v111-ocp .member-modal { right:6vw !important; width:min(88vw,360px) !important; max-height:40vh !important; padding:7px !important; font-size:10px !important; }
        #v111-ocp .profile-status { margin:5px 0 !important; padding:5px !important; }
        #v111-ocp .profile-roles div, #v111-ocp .stat-bars div { gap:5px !important; padding:5px !important; }
      }
      @media(pointer:coarse) and (min-width:601px) {
        #v111-ocp button, #v111-ocp a.button { min-height:44px !important; }
        #v111-ocp .mini { min-height:40px !important; }
        #v111-ocp input, #v111-ocp select { min-height:44px !important; }
      }
      @media(prefers-reduced-motion:reduce) {
        #v111-ocp *, #v111-ocp *::before, #v111-ocp *::after { animation-duration:.01ms !important; animation-iteration-count:1 !important; transition-duration:.01ms !important; scroll-behavior:auto !important; }
        #v111-ocp .spinner { animation:none !important; border-color:var(--v111-gold) !important; }
      }
    `);
  }})();
