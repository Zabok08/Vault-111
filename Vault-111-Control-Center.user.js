// ==UserScript==
// @name         Vault 111 Control Center
// @namespace    https://www.torn.com/
// @version      3.3.0-alpha.2
// @description  Vault 111 OC planning, war tracking, payouts, and privacy-aware member analytics.
// @author       Vault 111
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
  instanceMarker.dataset.version = '3.3.0-alpha.2';
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
  const WAR_URL = 'https://www.torn.com/factions.php?step=your&type=1#/tab=war/rank';
  const FACTION_PAYOUT_URL = 'https://www.torn.com/factions.php?step=your#/tab=controls&option=give-to-user';
  const TAB_IDS = ['dashboard', 'plan', 'members', 'war', 'payouts', 'backend', 'settings'];
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
      memberOverview: null,
      memberWarHistory: new Map(),
      memberWarHistoryLoading: new Set(),
      warSnapshot: null,
      payoutSnapshot: null,
      assignments: new Map(),
      crimeVersions: new Map()
    },
    ui: {
      activeTab: 'dashboard',
      scrollByTab: {},
      memberSearch: '',
      memberFilter: 'all',
      warTargetSearch: '',
      warTargetFilter: 'all',
      dashboardStatus: null,
      plannerStatus: null,
      memberStatus: null,
      warStatus: null,
      payoutStatus: null,
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
        root.setAttribute('aria-label', 'Vault 111 Control Center');
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
    const directoryMembers = mergeMemberOverview(members);
    const metrics = getDashboardMetrics(plans, members);
    root.classList.toggle('collapsed', !!state.settings.collapsed);
    root.classList.toggle('compact', !!state.settings.compact);
    root.classList.toggle('is-busy', !!state.backend.loading);
    root.setAttribute('aria-busy', String(!!state.backend.loading));
    root.innerHTML = `
      <header data-drag-handle${state.settings.collapsed ? ' tabindex="0" aria-label="Collapsed planner. Drag or use arrow keys to move."' : ''}>
        <div>
          <strong>Vault 111 Control Center</strong>
          <small>v3.3 alpha.2 · ${state.backend.connected ? '<b class="backend-label">BACKEND CONNECTED</b> · ' : ''}${syncedAt ? `Synced ${new Date(syncedAt).toLocaleString()}` : 'Not synced'}</small>
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
          <button class="${isActive('war') ? 'active' : ''}" data-tab="war" ${tabAttributes('war')}>War</button>
          <button class="${isActive('payouts') ? 'active' : ''}" data-tab="payouts" ${tabAttributes('payouts')}>Payouts</button>
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
            ${renderMemberSummary(directoryMembers)}
            <div class="member-tools">
              <label class="sr-only" for="v111-member-search">Search faction members</label>
              <input id="v111-member-search" type="search" value="${esc(state.ui.memberSearch)}" placeholder="Search faction members" aria-controls="v111-member-list">
              <label>Show
                <select id="v111-member-filter">
                  <option value="all" ${state.ui.memberFilter === 'all' ? 'selected' : ''}>All members</option>
                  <option value="analytics" ${state.ui.memberFilter === 'analytics' ? 'selected' : ''}>Analytics shared</option>
                  <option value="available" ${state.ui.memberFilter === 'available' ? 'selected' : ''}>Available</option>
                  <option value="hospital" ${state.ui.memberFilter === 'hospital' ? 'selected' : ''}>Hospitalized</option>
                  <option value="travel" ${state.ui.memberFilter === 'travel' ? 'selected' : ''}>Traveling</option>
                  <option value="inactive" ${state.ui.memberFilter === 'inactive' ? 'selected' : ''}>Inactive</option>
                </select>
              </label>
              <button class="primary" data-act="member-refresh"${busyAttributes()}>Refresh Overview</button>
              ${state.backend.user?.analyticsConsentAt ? `<button data-act="member-sync-self"${busyAttributes()}>Sync My Analytics</button>` : ''}
            </div>
            ${renderStatusRegion('v111-member-status', state.ui.memberStatus)}
            <div class="member-list" id="v111-member-list">${renderMemberList(directoryMembers, plans)}</div>
          </section>
          <section data-pane="war" ${paneAttributes('war')}>
            ${renderWarPanel()}
          </section>
          <section data-pane="payouts" ${paneAttributes('payouts')}>
            ${renderPayoutPanel()}
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
    applyWarTargetFilter();
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
    updateWarCountdowns();
  }


  function renderBestNextCrime(crime) {
    const readiness = crimeReadiness(crime);
    return `<div class="highlight-card">
      <small>Best next crime</small>
      <div class="highlight-title"><h3>${esc(crime.name)}</h3><span class="readiness-badge ${readinessClass(readiness)}">${readiness}%</span></div>
      <div class="toolbar"><a class="button primary" href="${esc(crime.url)}" target="_blank" rel="noopener">Open Crime</a><button data-jump-crime="${esc(crime.id)}">View in Planner</button></div>
    </div>`;
  }

  function mergeMemberOverview(members) {
    const baseById = new Map(members.map(member => [Number(member.id), member]));
    const overviewById = new Map(
      (state.backend.memberOverview?.members || []).map(member => [Number(member.id), member])
    );
    const ids = new Set([...baseById.keys(), ...overviewById.keys()]);
    return [...ids].map(id => {
      const base = baseById.get(id) || {};
      return {
        ...base,
        ...(overviewById.get(id) || {}),
        id,
        stats: base.stats || {},
        totals: base.totals || {},
        apiStatus: base.apiStatus || 'not_registered'
      };
    });
  }

  function memberStatusGroup(member) {
    const status = String(member.status || '').toLowerCase();
    if (/hospital/.test(status)) return 'hospital';
    if (/travel|abroad/.test(status)) return 'travel';
    const lastAction = timestampMs(member.lastActionAt);
    if (lastAction && Date.now() - lastAction > 3 * 24 * 60 * 60 * 1000) return 'inactive';
    return member.isInOc ? 'occupied' : 'available';
  }

  function renderMemberSummary(members) {
    const summary = state.backend.memberOverview?.summary;
    const values = summary || {
      members: members.length,
      connected: 0,
      analyticsShared: 0,
      inOc: members.filter(member => member.isInOc).length,
      hospitalized: members.filter(member => memberStatusGroup(member) === 'hospital').length,
      traveling: members.filter(member => memberStatusGroup(member) === 'travel').length
    };
    return `<div class="member-summary" aria-label="Faction member overview">
      <div><b>${formatNumber(values.members)}</b><span>Members</span></div>
      <div><b>${formatNumber(values.analyticsShared)}</b><span>Analytics shared</span></div>
      <div><b>${formatNumber(values.inOc)}</b><span>In an OC</span></div>
      <div><b>${formatNumber(Number(values.hospitalized || 0) + Number(values.traveling || 0))}</b><span>Hospital / travel</span></div>
    </div>
    <p class="member-privacy">${state.backend.memberOverview?.privacy?.canReadAllAnalytics
      ? 'Administrator view: exact opt-in analytics are visible.'
      : 'Exact battle and drug analytics are visible only to you, the Vault 111 Owner, and Administrators.'}</p>`;
  }

  function formatLargeInteger(value) {
    if (value === null || value === undefined || value === '') return '—';
    try {
      return BigInt(String(value)).toLocaleString();
    } catch {
      return formatNumber(value);
    }
  }

  function formatRelativeDate(value) {
    const time = timestampMs(value);
    if (!time) return 'Unknown';
    const seconds = Math.max(0, Math.floor((Date.now() - time) / 1000));
    if (seconds < 60) return 'Now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    return `${Math.floor(seconds / 86400)}d ago`;
  }

  function formatCooldown(seconds) {
    const value = Math.max(0, Number(seconds || 0));
    if (!value) return 'Ready';
    const hours = Math.floor(value / 3600);
    const minutes = Math.ceil((value % 3600) / 60);
    return `${hours ? `${hours}h ` : ''}${minutes}m`;
  }

  function formatGain(value) {
    if (value === null || value === undefined) return '—';
    const text = String(value);
    return `${text.startsWith('-') || text === '0' ? '' : '+'}${formatLargeInteger(text)}`;
  }

  function renderAnalyticsGains(analytics) {
    const periods = [
      ['Previous sync', analytics?.gains?.previous],
      ['24 hours', analytics?.gains?.day],
      ['7 days', analytics?.gains?.week],
      ['30 days', analytics?.gains?.month]
    ];
    return `<div class="analytics-trends">${periods.map(([label, gain]) => `
      <div>
        <b>${label}</b>
        <span>Battle ${formatGain(gain?.battleTotal)}</span>
        <span>Drugs ${formatGain(gain?.drugTotal)}</span>
        <span>Xanax ${formatGain(gain?.xanax)}</span>
      </div>`).join('')}</div>`;
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
      const group = memberStatusGroup(member);
      const analyticsShared = ['exact', 'private'].includes(member.analyticsAccess);
      const analytics = member.analytics;
      return `<button class="member-row" data-member-id="${member.id}" data-member-name="${esc(String(member.name).toLowerCase())}" data-member-status="${group}" data-member-analytics="${analyticsShared}" aria-haspopup="dialog">
        <span class="member-identity"><b>${esc(member.name)} [${member.id}]</b><small>${esc(member.position || 'Member')} · ${esc(member.status || 'Status unknown')} · ${formatRelativeDate(member.lastActionAt)}</small></span>
        <span class="member-tags">
          ${analytics?.battle?.total ? `<i class="analytics-tag">BS ${formatLargeInteger(analytics.battle.total)}</i>` : ''}
          ${analytics?.drugs?.xanax !== null && analytics?.drugs?.xanax !== undefined ? `<i class="analytics-tag">Xanax ${formatNumber(analytics.drugs.xanax)}</i>` : ''}
          ${member.analyticsAccess === 'private' ? '<i>Analytics private</i>' : ''}
          ${assignment ? `<i>${esc(assignment.role)}</i>` : best.slice(0,2).map(x => `<i>${esc(x.role)}</i>`).join('')}
        </span>
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

  function formatWarHistoryDate(value) {
    const time = timestampMs(value);
    if (!time) return 'Date unavailable';
    return new Date(time).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  }

  function renderMemberWarHistory(memberId) {
    const history = state.backend.memberWarHistory.get(Number(memberId));
    const loading = state.backend.memberWarHistoryLoading.has(Number(memberId));
    if (!state.backend.connected) {
      return `<section class="member-history-section">
        <h4>War &amp; payout history</h4>
        <p class="notice">Connect on the API Key screen to load shared ranked-war history.</p>
      </section>`;
    }
    if (loading || !history) {
      return `<section class="member-history-section" aria-busy="true">
        <div class="analytics-heading"><h4>War &amp; payout history</h4><small>Last five wars</small></div>
        <p class="notice">Loading ranked-war history…</p>
      </section>`;
    }
    if (history.error) {
      return `<section class="member-history-section">
        <div class="analytics-heading"><h4>War &amp; payout history</h4><small>Last five wars</small></div>
        <p class="notice">${esc(history.error)}</p>
        <button class="mini" data-retry-member-history="${Number(memberId)}">Try again</button>
      </section>`;
    }
    const rows = history.wars || [];
    if (!rows.length) {
      return `<section class="member-history-section">
        <div class="analytics-heading"><h4>War &amp; payout history</h4><small>Last five wars</small></div>
        <p class="notice">No synchronized ranked-war history is available yet.</p>
      </section>`;
    }
    return `<section class="member-history-section">
      <div class="analytics-heading"><h4>War &amp; payout history</h4><small>Last ${formatNumber(rows.length)} synchronized war${rows.length === 1 ? '' : 's'}</small></div>
      <div class="history-summary">
        <div><span>Successful hits</span><b>${formatNumber(history.summary?.successfulHits)}</b></div>
        <div><span>Payout points</span><b>${formatNumber(history.summary?.points)}</b></div>
        <div><span>Finalized pay</span><b>${formatMoney(history.summary?.finalizedPayoutTotal || '0')}</b></div>
      </div>
      <div class="member-war-list">${rows.map(war => {
        const performance = war.performance || {};
        const payout = war.payout;
        const payoutText = payout?.status === 'FINALIZED'
          ? `Final payout ${formatMoney(payout.finalAmount || '0')}`
          : payout?.status === 'DRAFT'
            ? 'Payout draft not finalized'
            : 'No payout report';
        return `<article class="member-war-row">
          <div class="member-war-head">
            <b>vs ${esc(war.opponentName || `Faction ${war.opponentFactionId}`)}</b>
            <i class="history-outcome ${esc(war.outcome || 'completed')}">${esc(war.outcome || 'completed')}</i>
          </div>
          <small>${formatWarHistoryDate(war.startsAt)} · War #${Number(war.id)}</small>
          <div class="member-war-metrics">
            <span><b>${formatNumber(performance.warHits)}</b> war</span>
            <span><b>${formatNumber(performance.chainHits)}</b> OOW chain</span>
            <span><b>${formatNumber(performance.outsideChainHits)}</b> OOW other</span>
            <span><b>${formatNumber(performance.points)}</b> pts</span>
          </div>
          <div class="member-war-payout ${payout?.status === 'FINALIZED' ? 'finalized' : ''}">${esc(payoutText)}</div>
        </article>`;
      }).join('')}</div>
    </section>`;
  }

  async function loadMemberWarHistory(memberId, force = false) {
    const id = Number(memberId);
    if (!id || !state.backend.connected || state.backend.memberWarHistoryLoading.has(id)) return;
    if (!force && state.backend.memberWarHistory.has(id)) return;
    state.backend.memberWarHistoryLoading.add(id);
    if (force) state.backend.memberWarHistory.delete(id);
    if (state.ui.modalMemberId === id) openMemberModal(id, true);
    try {
      const result = await backendApi('GET', `/v1/members/${encodeURIComponent(id)}/war-history`);
      state.backend.memberWarHistory.set(id, result);
    } catch (error) {
      state.backend.memberWarHistory.set(id, { error: friendly(error), wars: [] });
    } finally {
      state.backend.memberWarHistoryLoading.delete(id);
      if (state.ui.modalMemberId === id) openMemberModal(id, true);
    }
  }

  function openMemberModal(memberId, restoring = false) {
    const member = mergeMemberOverview(state.cache.members || []).find(m => Number(m.id) === Number(memberId));
    if (!member) {
      state.ui.modalMemberId = null;
      return;
    }
    if (!restoring) modalReturnFocusKey = captureFocusKey(document.activeElement);
    state.ui.modalMemberId = Number(member.id);
    const plans = buildPlan(state.cache.members || [], state.cache.crimes || []);
    const roles = bestRolesForMember(member, plans).slice(0,6);
    const totals = Object.entries(member.totals || {}).sort((a,b)=>b[1]-a[1]).slice(0,6);
    const analytics = member.analytics;
    const battle = analytics?.battle;
    const drugs = analytics?.drugs;
    const analyticsBody = analytics ? `
      <section class="member-analytics-section">
        <div class="analytics-heading"><h4>Battle stats</h4><small>Updated ${formatRelativeDate(analytics.battleSyncedAt)}</small></div>
        ${battle ? `<div class="battle-stat-grid">
          <div><span>Strength</span><b>${formatLargeInteger(battle.strength)}</b></div>
          <div><span>Defense</span><b>${formatLargeInteger(battle.defense)}</b></div>
          <div><span>Speed</span><b>${formatLargeInteger(battle.speed)}</b></div>
          <div><span>Dexterity</span><b>${formatLargeInteger(battle.dexterity)}</b></div>
          <div class="wide"><span>Total battle stats</span><b>${formatLargeInteger(battle.total)}</b></div>
        </div>` : '<p class="notice">Battle stats were not returned. Add the user:battlestats selection to the API key.</p>'}
      </section>
      <section class="member-analytics-section">
        <div class="analytics-heading"><h4>Drug activity</h4><small>Updated ${formatRelativeDate(analytics.drugsSyncedAt)}</small></div>
        ${drugs ? `<div class="drug-summary">
          <div><span>Total used</span><b>${formatNumber(drugs.total)}</b></div>
          <div><span>Xanax</span><b>${formatNumber(drugs.xanax)}</b></div>
          <div><span>Overdoses</span><b>${formatNumber(drugs.overdoses)}</b></div>
          <div><span>Rehabilitations</span><b>${formatNumber(drugs.rehabilitations?.amount)}</b></div>
        </div>
        <details class="drug-breakdown"><summary>All tracked drugs</summary><div>
          ${['cannabis','ecstasy','ketamine','lsd','opium','pcp','shrooms','speed','vicodin','xanax'].map(name => `<span><b>${esc(name)}</b>${formatNumber(drugs[name])}</span>`).join('')}
        </div></details>` : '<p class="notice">Drug totals were not returned. Add user:personalstats to the API key.</p>'}
        <div class="cooldown-card"><span>Current drug cooldown</span><b>${analytics.cooldowns ? formatCooldown(analytics.cooldowns.drug) : 'Permission unavailable'}</b></div>
      </section>
      <section class="member-analytics-section">
        <h4>Tracked growth</h4>
        ${renderAnalyticsGains(analytics)}
      </section>` : `
      <p class="notice">${member.analyticsAccess === 'private'
        ? 'This member has shared analytics, but exact values are private for your Control Center role.'
        : member.analyticsAccess === 'consent_required'
          ? 'Enable analytics tracking from the API Key screen to import your battle stats and drug totals.'
          : member.analyticsAccess === 'not_synced'
            ? 'Analytics sharing is enabled, but the first synchronization has not completed.'
            : 'This member has not enabled battle-stat and drug tracking.'}</p>`;
    const modal = root.querySelector('#v111-modal');
    modal.hidden = false;
    modal.innerHTML = `<div class="modal-backdrop" data-close-modal aria-hidden="true"></div><article class="member-modal" role="dialog" aria-modal="true" aria-labelledby="v111-member-modal-title" tabindex="-1">
      <div class="modal-head"><div><h3 id="v111-member-modal-title">${esc(member.name)} [${member.id}]</h3><small>${esc(member.position || 'Faction member')} · Level ${member.level || '?'}</small></div><button data-close-modal aria-label="Close member profile" title="Close">×</button></div>
      <div class="profile-status ${member.isInOc ? 'busy' : 'free'}">${member.isInOc ? 'Currently in an OC' : 'Available for planning'}</div>
      <div class="member-live-status"><span>${esc(member.status || 'Status unknown')}</span><span>Last action ${formatRelativeDate(member.lastActionAt)}</span></div>
      ${analyticsBody}
      ${renderMemberWarHistory(member.id)}
      <h4>Best tracked roles</h4>
      <div class="profile-roles">${roles.length ? roles.map(r => `<div><b>${esc(r.role)}</b><span>${esc(r.crime)} · score ${Math.round(r.score)}</span></div>`).join('') : '<p>No personal stats loaded.</p>'}</div>
      <h4>Strongest tracked categories</h4>
      <div class="stat-bars">${totals.map(([k,v]) => `<div><span>${esc(k)}</span><b>${formatNumber(v)}</b></div>`).join('') || '<p>No tracked stats.</p>'}</div>
      <div class="toolbar"><a class="button primary" href="https://www.torn.com/profiles.php?XID=${member.id}" target="_blank" rel="noopener">Open profile</a></div>
    </article>`;
    modal.querySelectorAll('[data-close-modal]').forEach(element => element.addEventListener('click', closeMemberModal));
    modal.querySelector('[data-retry-member-history]')?.addEventListener('click', buttonEvent => {
      loadMemberWarHistory(buttonEvent.currentTarget.dataset.retryMemberHistory, true);
    });
    modal.addEventListener('keydown', trapModalFocus);
    if (!restoring) {
      requestAnimationFrame(() => modal.querySelector('[data-close-modal]')?.focus({ preventScroll: true }));
    }
    if (
      state.backend.connected &&
      !state.backend.memberWarHistory.has(Number(member.id)) &&
      !state.backend.memberWarHistoryLoading.has(Number(member.id))
    ) {
      loadMemberWarHistory(member.id);
    }
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

  function warCountdownLabel(war) {
    if (!war) return '';
    const start = timestampMs(war.startsAt);
    const end = timestampMs(war.endsAt);
    const now = Date.now();
    const target = start > now ? start : (end > now ? end : 0);
    if (!target && war.winnerFactionId) {
      return Number(war.winnerFactionId) === Number(war.factionId)
        ? 'Vault 111 won'
        : `${war.opponentName} won`;
    }
    if (!target) return String(war.status || '').toLowerCase() === 'finished' ? 'War finished' : 'War in progress';
    const seconds = Math.max(0, Math.ceil((target - now) / 1000));
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainder = seconds % 60;
    const clock = [hours, minutes, remainder].map(value => String(value).padStart(2, '0')).join(':');
    return `${start > now ? 'Starts' : 'Ends'} in ${days ? `${days}d ` : ''}${clock}`;
  }

  function updateWarCountdowns() {
    if (!root?.isConnected) return;
    root.querySelectorAll('[data-war-countdown]').forEach(element => {
      const war = state.backend.warSnapshot?.war;
      element.textContent = warCountdownLabel(war);
    });
  }

  function warTargetStateClass(value) {
    const stateName = String(value || '').toLowerCase();
    if (stateName === 'okay') return 'available';
    if (stateName.includes('hospital')) return 'hospital';
    if (stateName.includes('jail')) return 'jail';
    if (stateName.includes('travel') || stateName.includes('abroad')) return 'away';
    return 'unavailable';
  }

  function renderWarTargetList(war, snapshot) {
    const targets = [...(snapshot.targets || [])].sort((a, b) => {
      const priority = target => ({ available: 0, hospital: 1, jail: 2, away: 3, unavailable: 4 })[warTargetStateClass(target.statusState)] ?? 4;
      return priority(a) - priority(b) || String(a.name).localeCompare(String(b.name));
    });
    const canWriteNotes = backendCanWarNotes();
    if (!targets.length) {
      const message = String(war.status).toLowerCase() === 'finished'
        ? 'No opponent roster was stored for this completed war.'
        : 'No targets have been synchronized yet. A War Manager or Administrator can use Sync Ranked War to load the opponent roster.';
      return `<h3 class="section-title">Opponent targets</h3><div class="empty">${message}</div>`;
    }

    return `
      <div class="war-target-heading">
        <h3 class="section-title">Opponent targets <small>${targets.length} members</small></h3>
        <div class="war-target-tools">
          <label class="sr-only" for="v111-war-target-search">Search war targets</label>
          <input id="v111-war-target-search" type="search" value="${esc(state.ui.warTargetSearch)}" placeholder="Search targets" aria-controls="v111-war-target-list">
          <label class="sr-only" for="v111-war-target-filter">Filter war targets</label>
          <select id="v111-war-target-filter">
            <option value="all" ${state.ui.warTargetFilter === 'all' ? 'selected' : ''}>All targets</option>
            <option value="available" ${state.ui.warTargetFilter === 'available' ? 'selected' : ''}>Okay now</option>
            <option value="hospital" ${state.ui.warTargetFilter === 'hospital' ? 'selected' : ''}>Hospitalized</option>
            <option value="noted" ${state.ui.warTargetFilter === 'noted' ? 'selected' : ''}>With notes</option>
          </select>
        </div>
      </div>
      <div class="war-target-list" id="v111-war-target-list">
        ${targets.map(target => {
          const stateClass = warTargetStateClass(target.statusState);
          const note = String(target.note || '');
          const noteAuthor = target.noteUpdatedBy?.name
            ? `${target.noteUpdatedBy.name}${target.noteUpdatedAt ? ` · ${new Date(target.noteUpdatedAt).toLocaleString()}` : ''}`
            : '';
          const until = timestampMs(target.statusUntil);
          const lastAction = timestampMs(target.lastActionAt);
          return `
            <article class="war-target-card ${stateClass}" data-war-target data-target-name="${esc(String(target.name).toLowerCase())}" data-target-state="${stateClass}" data-target-noted="${note ? 'true' : 'false'}">
              <div class="war-target-main">
                <div>
                  <a class="war-target-name" href="https://www.torn.com/profiles.php?XID=${Number(target.tornId)}" target="_blank" rel="noopener">${esc(target.name)} [${Number(target.tornId)}]</a>
                  <small>Level ${formatNumber(target.level)}${target.position ? ` · ${esc(target.position)}` : ''}</small>
                </div>
                <span class="target-status ${stateClass}">${esc(target.statusState || 'Unknown')}</span>
              </div>
              <div class="war-target-details">
                <span>${esc(target.statusDescription || target.statusState || 'Status unavailable')}${until > Date.now() ? ` · until ${new Date(until).toLocaleTimeString()}` : ''}</span>
                <span>${lastAction ? `Last action ${new Date(lastAction).toLocaleString()}` : 'Last action unavailable'}${target.isRevivable ? ' · Revivable' : ''}</span>
              </div>
              <div class="war-target-actions">
                <a class="button primary mini" href="https://www.torn.com/loader.php?sid=attack&user2ID=${Number(target.tornId)}" target="_blank" rel="noopener">Attack</a>
                <a class="button mini" href="https://www.torn.com/profiles.php?XID=${Number(target.tornId)}" target="_blank" rel="noopener">Profile</a>
              </div>
              <div class="war-target-note">
                ${canWriteNotes ? `
                  <label for="v111-war-note-${Number(target.tornId)}">Officer note</label>
                  <textarea id="v111-war-note-${Number(target.tornId)}" data-war-note maxlength="500" placeholder="Add target information for officers and members">${esc(note)}</textarea>
                  <div><small>${noteAuthor ? `Last changed by ${esc(noteAuthor)}` : 'No officer note saved'}</small><button class="mini" id="v111-save-war-note-${Number(target.tornId)}" data-save-war-note data-war-id="${Number(war.id)}" data-target-id="${Number(target.tornId)}" data-note-version="${Number(target.noteVersion || 1)}"${busyAttributes()}>Save note</button></div>
                ` : `
                  <b>Officer note</b>
                  <p>${note ? esc(note) : 'No officer note.'}</p>
                  ${noteAuthor ? `<small>Last changed by ${esc(noteAuthor)}</small>` : ''}
                `}
              </div>
            </article>`;
        }).join('')}
      </div>`;
  }

  function renderWarPanel() {
    const feedback = state.ui.warStatus;
    if (!state.backend.connected) {
      return `
        <div class="war-empty">
          <h3>Ranked War Tracker</h3>
          <p class="notice">Connect your own API key to view the shared Vault 111 ranked-war dashboard.</p>
          <button class="primary" data-jump="backend">Open API Key</button>
        </div>`;
    }

    const snapshot = state.backend.warSnapshot;
    const controls = `
      <div class="toolbar war-toolbar">
        ${backendCanWarSync() ? `<button class="primary" data-act="war-sync"${busyAttributes()}>Sync Ranked War</button>` : ''}
        <button data-act="war-refresh"${busyAttributes()}>Refresh Tracker</button>
        <a class="button" href="${WAR_URL}" target="_blank" rel="noopener">Open Torn War</a>
      </div>
      ${renderStatusRegion('v111-war-status', feedback)}`;
    if (!snapshot) {
      return `${controls}<div class="empty">Load the shared ranked-war snapshot to begin.</div>`;
    }

    const sync = snapshot.sync;
    const syncedLabel = sync?.lastSuccessAt
      ? new Date(sync.lastSuccessAt).toLocaleString()
      : 'Not synchronized yet';
    if (!snapshot.war) {
      return `${controls}
        <div class="war-sync-line"><span>Last checked</span><b>${esc(syncedLabel)}</b></div>
        <div class="empty">No current or recent ranked war has been synchronized yet.${backendCanWarSync() ? ' Use Sync Ranked War to check Torn.' : ' Ask a War Manager or Administrator to synchronize it.'}</div>`;
    }

    const war = snapshot.war;
    const totals = snapshot.totals || {};
    const target = Math.max(1, Number(war.targetScore || 0));
    const ownProgress = Math.min(100, Math.max(0, Number(war.factionScore || 0) / target * 100));
    const opponentProgress = Math.min(100, Math.max(0, Number(war.opponentScore || 0) / target * 100));
    const participation = snapshot.participation || [];
    const active = participation.filter(member => Number(member.attacks || 0) > 0);
    const inactive = participation.filter(member => Number(member.attacks || 0) === 0);
    const recent = (snapshot.recentAttacks || []).slice(0, 30);
    const resultClass = result => ['Lost', 'Stalemate', 'Escape', 'Timeout', 'Interrupted'].includes(String(result)) ? 'loss' : 'win';
    const warOutcome = war.winnerFactionId
      ? (Number(war.winnerFactionId) === Number(war.factionId) ? 'Vault 111 won' : `${war.opponentName} won`)
      : warCountdownLabel(war);

    return `${controls}
      <div class="war-sync-line"><span>Shared snapshot</span><b>${esc(syncedLabel)}</b></div>
      ${sync?.isTruncated ? '<p class="notice war-warning">The Torn API page limit was reached. The newest score is correct, but older participation may be incomplete.</p>' : ''}
      <section class="war-score-card" aria-labelledby="v111-war-title">
        <div class="war-heading">
          <div><small>Ranked War #${esc(war.id)}</small><h3 id="v111-war-title">${esc(war.factionName)} vs ${esc(war.opponentName)}</h3></div>
          <span class="war-status ${esc(String(war.status || '').toLowerCase())}">${esc(war.status || 'Unknown')}</span>
        </div>
        <div class="war-clock" data-war-countdown>${esc(warOutcome)}</div>
        <div class="war-side">
          <div><b>${esc(war.factionName)}</b><strong>${formatNumber(war.factionScore)}</strong><small>Chain ${formatNumber(war.factionChain)}</small></div>
          <span>Target ${formatNumber(war.targetScore)}</span>
          <div><b>${esc(war.opponentName)}</b><strong>${formatNumber(war.opponentScore)}</strong><small>Chain ${formatNumber(war.opponentChain)}</small></div>
        </div>
        <div class="war-score-bars" aria-label="Score progress toward target">
          <i class="vault" style="width:${ownProgress.toFixed(2)}%"></i>
          <i class="opponent" style="width:${opponentProgress.toFixed(2)}%"></i>
        </div>
      </section>
      <div class="war-metrics">
        <div class="metric"><b>${formatNumber(totals.successfulHits)}</b><span>Successful hits</span></div>
        <div class="metric"><b>${formatNumber(totals.activeParticipants)}</b><span>Participants</span></div>
        <div class="metric"><b>${Number(totals.totalRespect || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}</b><span>Respect gained</span></div>
        <div class="metric"><b>${formatNumber(totals.assists)}</b><span>Assists</span></div>
      </div>
      ${renderWarTargetList(war, snapshot)}
      <h3 class="section-title">Member participation</h3>
      <div class="war-table" role="table" aria-label="Ranked war member participation">
        <div class="war-table-head" role="row"><span>Member</span><span>Hits</span><span>Respect</span><span>Attacks</span></div>
        ${active.length ? active.map(member => `
          <a class="war-member-row" role="row" href="https://www.torn.com/profiles.php?XID=${Number(member.tornId)}" target="_blank" rel="noopener">
            <span><b>${esc(member.name)}</b><small>${esc(member.position || 'Member')}</small></span>
            <strong>${formatNumber(member.successfulHits)}</strong>
            <strong>${Number(member.respect || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}</strong>
            <strong>${formatNumber(member.attacks)}</strong>
          </a>`).join('') : '<div class="empty">No ranked-war attacks have been recorded.</div>'}
      </div>
      ${inactive.length ? `<details class="war-inactive"><summary>${inactive.length} member${inactive.length === 1 ? '' : 's'} with no recorded attacks</summary><div>${inactive.map(member => `<a href="https://www.torn.com/profiles.php?XID=${Number(member.tornId)}" target="_blank" rel="noopener">${esc(member.name)}</a>`).join('')}</div></details>` : ''}
      <h3 class="section-title">Recent ranked-war attacks</h3>
      <div class="war-feed">
        ${recent.length ? recent.map(attack => `
          <div class="war-attack ${resultClass(attack.result)}">
            <div><b>${esc(attack.attackerName || 'Unknown attacker')}</b><span>→</span><b>${esc(attack.defenderName)}</b></div>
            <small>${esc(attack.result)} · +${Number(attack.respectGain || 0).toFixed(2)} respect · ${new Date(attack.endedAt).toLocaleString()}</small>
          </div>`).join('') : '<div class="empty">No ranked-war attacks have been recorded.</div>'}
      </div>`;
  }

  function formatMoney(value) {
    const amount = Number(value || 0);
    return `$${Number.isSafeInteger(amount) ? amount.toLocaleString() : '0'}`;
  }

  function payoutReportText(snapshot) {
    if (!snapshot?.war || !snapshot?.plan) return '';
    const status = snapshot.plan.status === 'FINALIZED' ? 'FINALIZED' : 'DRAFT';
    return [
      `Vault 111 Ranked War Payouts · War #${snapshot.war.id}`,
      `${snapshot.war.factionName} vs ${snapshot.war.opponentName}`,
      `Status: ${status} · Pool: ${formatMoney(snapshot.plan.poolAmount)} · Total: ${formatMoney(snapshot.plan.finalTotal)}`,
      'Points: ranked-war hit 1 · out-of-war chain hit 0.5 · out-of-war non-chain hit 0.25',
      '',
      ...(snapshot.rows || []).map((row, index) =>
        `${index + 1}. ${row.name} [${row.tornId}] — ${formatMoney(row.finalAmount)} ` +
        `(${Number(row.points || 0).toFixed(2)} points: ${row.warHits} war, ${row.chainHits} chain OOW, ${row.outsideChainHits} non-chain OOW` +
        `${Number(row.adjustmentAmount || 0) ? `, adjustment ${Number(row.adjustmentAmount) > 0 ? '+' : ''}${formatMoney(row.adjustmentAmount).replace('$-', '-$')}` : ''})` +
        `${row.adjustmentNote ? ` — ${row.adjustmentNote}` : ''}`
      )
    ].join('\n');
  }

  function renderPayoutPanel() {
    const feedback = state.ui.payoutStatus;
    if (!state.backend.connected) {
      return `
        <div class="war-empty">
          <h3>Ranked War Payout Calculator</h3>
          <p class="notice">Connect your own API key to view shared Vault 111 payout reports.</p>
          <button class="primary" data-jump="backend">Open API Key</button>
        </div>`;
    }

    const snapshot = state.backend.payoutSnapshot;
    const controls = `
      <div class="toolbar payout-toolbar">
        <button class="primary" data-act="payout-refresh"${busyAttributes()}>Refresh Payouts</button>
        <button data-act="payout-copy"${snapshot?.plan ? '' : ' disabled'}>Copy Report</button>
        <button data-act="payout-csv"${snapshot?.plan ? '' : ' disabled'}>Download CSV</button>
        <a class="button" href="${FACTION_PAYOUT_URL}" target="_blank" rel="noopener">Open Faction Payout</a>
        <button data-jump="war">Open War Tracker</button>
      </div>
      ${renderStatusRegion('v111-payout-status', feedback)}`;
    if (!snapshot) {
      return `${controls}<div class="empty">Refresh payouts to load the most recent ranked war.</div>`;
    }

    const war = snapshot.war;
    const plan = snapshot.plan;
    const canManage = backendCanPayoutManage();
    const canReopen = backendCanPayoutReopen();
    const finalized = plan?.status === 'FINALIZED';
    const rows = snapshot.rows || [];
    const activeRows = rows.filter(row =>
      Number(row.points || 0) > 0 ||
      Number(row.finalAmount || 0) !== 0 ||
      Number(row.adjustmentAmount || 0) !== 0
    );
    const finalizedBy = plan?.finalizedBy?.name
      ? `${plan.finalizedBy.name}${plan.finalizedAt ? ` · ${new Date(plan.finalizedAt).toLocaleString()}` : ''}`
      : '';

    const configuration = canManage && !finalized
      ? `
        <form class="payout-config" id="v111-payout-settings">
          <label>Total payout pool
            <input id="v111-payout-pool" name="poolAmount" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="16" value="${esc(plan?.poolAmount || '0')}" required>
          </label>
          <div class="payout-fixed-rules"><b>Fixed point rules</b><span>War hit 1 · OOW chain hit 0.5 · OOW non-chain hit 0.25</span></div>
          <button class="primary" type="submit"${busyAttributes()}>${plan ? 'Save & Recalculate' : 'Create Payout Draft'}</button>
        </form>`
      : plan
        ? `<div class="payout-readonly-config">
            <span>Pool <b>${formatMoney(plan.poolAmount)}</b></span>
            <span>War hit <b>1 point</b></span>
            <span>OOW chain hit <b>0.5 point</b></span>
            <span>OOW non-chain <b>0.25 point</b></span>
          </div>`
        : '';

    return `${controls}
      <section class="payout-hero">
        <div>
          <span class="eyebrow">Ranked War #${Number(war.id)}</span>
          <h3>${esc(war.factionName)} <span>vs</span> ${esc(war.opponentName)}</h3>
          <small>${esc(war.status)} · War data synchronized ${new Date(war.syncedAt).toLocaleString()}</small>
        </div>
        <span class="payout-state ${finalized ? 'finalized' : 'draft'}">${finalized ? 'Finalized & locked' : plan ? 'Draft' : 'Not configured'}</span>
      </section>
      ${configuration}
      ${plan ? `
        <div class="payout-metrics">
          <div><b>${formatMoney(plan.poolAmount)}</b><span>Payout pool</span></div>
          <div><b>${formatMoney(plan.finalTotal)}</b><span>Calculated total</span></div>
          <div><b>${activeRows.length}</b><span>Recipients</span></div>
          <div><b>${Number(plan.totalPoints || 0).toFixed(2)}</b><span>Total points</span></div>
        </div>
        ${finalized
          ? `<p class="notice success">This report is locked and will not change when new Torn war data is synchronized.${finalizedBy ? ` Finalized by ${esc(finalizedBy)}.` : ''}</p>`
          : `<p class="notice">Draft amounts divide the pool by fixed hit points. Manual adjustments are applied after the point-based distribution.</p>`}
        <div class="payout-actions">
          ${canManage && !finalized
            ? `<button class="primary" data-act="payout-finalize"${String(war.status).toLowerCase() === 'finished' ? busyAttributes() : ' disabled title="The ranked war must be finished first"'}>Finalize & Lock</button>`
            : ''}
          ${canReopen && finalized ? `<button class="danger" data-act="payout-reopen"${busyAttributes()}>Reopen Draft</button>` : ''}
        </div>
        <h3 class="section-title">Member payouts</h3>
        <div class="payout-list" role="table" aria-label="Ranked war member payouts">
          <div class="payout-table-head" role="row"><span>Member</span><span>Hit points</span><span>Base</span><span>Adjustment</span><span>Final payout</span></div>
          ${activeRows.length ? activeRows.map(row => `
            <article class="payout-row" role="row">
              <span class="payout-member">
                <a href="https://www.torn.com/profiles.php?XID=${Number(row.tornId)}" target="_blank" rel="noopener">${esc(row.name)} [${Number(row.tornId)}]</a>
                <small>${esc(row.position || 'Member')} · ${(Number(row.share || 0) * 100).toFixed(2)}% share</small>
              </span>
              <span class="payout-activity"><b>${Number(row.points || 0).toFixed(2)} points</b><small>${formatNumber(row.warHits)} war · ${formatNumber(row.chainHits)} OOW chain · ${formatNumber(row.outsideChainHits)} OOW non-chain</small></span>
              <strong class="payout-base" data-label="Base">${formatMoney(row.baseAmount)}</strong>
              <span class="payout-adjustment">
                ${canManage && !finalized ? `
                  <label class="sr-only" for="v111-payout-adjustment-${Number(row.tornId)}">Adjustment for ${esc(row.name)}</label>
                  <input id="v111-payout-adjustment-${Number(row.tornId)}" data-payout-adjustment type="text" inputmode="numeric" pattern="-?[0-9]*" maxlength="17" value="${esc(row.adjustmentAmount || '0')}">
                  <label class="sr-only" for="v111-payout-note-${Number(row.tornId)}">Adjustment note for ${esc(row.name)}</label>
                  <input id="v111-payout-note-${Number(row.tornId)}" data-payout-note type="text" maxlength="200" value="${esc(row.adjustmentNote || '')}" placeholder="Optional reason">
                  <button class="mini" data-save-payout-member data-war-id="${Number(war.id)}" data-member-id="${Number(row.tornId)}" data-plan-version="${Number(plan.version)}"${busyAttributes()}>Save</button>
                ` : `
                  <b class="${Number(row.adjustmentAmount || 0) < 0 ? 'negative' : Number(row.adjustmentAmount || 0) > 0 ? 'positive' : ''}">${Number(row.adjustmentAmount || 0) > 0 ? '+' : ''}${formatMoney(row.adjustmentAmount).replace('$-', '-$')}</b>
                  ${row.adjustmentNote ? `<small>${esc(row.adjustmentNote)}</small>` : ''}
                `}
              </span>
              <strong class="payout-final" data-label="Final payout">${formatMoney(row.finalAmount)}</strong>
            </article>`).join('') : '<div class="empty">No ranked-war activity is available for this payout report.</div>'}
        </div>
      ` : `
        <div class="empty">${canManage
          ? 'Create a payout draft to configure the pool and calculate member amounts.'
          : 'A War Manager or Administrator has not created a payout draft for this war yet.'}</div>
      `}`;
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
      const ownAnalytics = state.backend.memberOverview?.members?.find(member => Number(member.id) === Number(user.tornId));
      const analyticsStatus = user.analyticsConsentAt
        ? ownAnalytics?.analytics?.syncedAt
          ? `Synced ${new Date(ownAnalytics.analytics.syncedAt).toLocaleString()}`
          : 'Enabled; awaiting first synchronization'
        : 'Not enabled';
      return `
        <div class="backend-card">
          <div class="backend-state connected"><b>Secure backend connected</b><small>${esc(BACKEND_API)}</small></div>
          <p class="notice api-key-reminder">Enter only your own Torn API key. The first connection may take about a minute while the free Render server wakes up. Your approved statistics refresh automatically when you connect and when you return to this screen.</p>
          <dl>
            <div><dt>Player</dt><dd>${esc(user.name)} [${esc(user.tornId)}]</dd></div>
            <div><dt>Control Center role</dt><dd>${esc(user.role)}</dd></div>
            <div><dt>Faction position</dt><dd>${esc(user.factionPosition || 'Member')}</dd></div>
            <div><dt>Shared data</dt><dd>${esc(lastSync)}</dd></div>
            <div><dt>Snapshot</dt><dd>${Number(sync?.memberCount || 0)} members · ${Number(sync?.crimeCount || 0)} crimes</dd></div>
            <div><dt>My crime stats</dt><dd>${esc(personalStats)}</dd></div>
            <div><dt>Battle & drug analytics</dt><dd>${esc(analyticsStatus)}</dd></div>
          </dl>
          <div class="toolbar">
            ${backendCanSync() ? `<button class="primary" data-act="backend-sync"${busyAttributes()}>Sync Vault 111 from Torn</button>` : ''}
            <button class="primary" data-act="backend-sync-stats"${busyAttributes()}>Sync My Stats</button>
            ${user.analyticsConsentAt
              ? `<button class="danger" data-act="analytics-disable"${busyAttributes()}>Disable Analytics</button>`
              : `<button data-act="analytics-enable"${busyAttributes()}>Enable Analytics Tracking</button>`}
            <button data-act="load-shared"${busyAttributes()}>Refresh Shared Data</button>
            <button data-act="backend-logout"${busyAttributes()}>Disconnect</button>
          </div>
          ${renderStatusRegion('v111-backend-status', backendFeedback)}
          <p class="notice">${backendCanSync() ? 'Faction synchronization uses your encrypted key and requires Torn faction API permission. ' : 'Your role can read the latest shared snapshot. '}Crime stats are shared for planner scoring. If analytics tracking is enabled, exact battle stats, drug totals, rehabilitation totals, overdoses, and the current drug cooldown are stored for growth tracking and visible only to you, the Vault 111 Owner, and Administrators.</p>
        </div>`;
    }
    return `
      <div class="backend-card">
        <div class="backend-state"><b>Connect to Vault 111</b><small>${esc(BACKEND_API)}</small></div>
        <p class="notice api-key-reminder" id="v111-key-help">Enter only your own Torn API key. The first connection may take about a minute while the free Render server wakes up. Your key is sent to the configured Vault 111 backend for identity and faction verification, stored encrypted by the server, and never saved by the userscript.</p>
        <form id="v111-backend-form">
          <label for="v111-backend-key">Your Torn API key</label>
          <input id="v111-backend-key" name="torn-api-key" type="password" autocomplete="off" spellcheck="false" placeholder="Enter your API key" aria-describedby="v111-key-help" maxlength="256" required${busyAttributes()}>
          <label class="analytics-consent"><input id="v111-analytics-consent" type="checkbox" required${busyAttributes()}> I agree to store my exact battle stats, drug totals, rehabilitation totals, overdoses, and drug cooldown for member analytics. Exact values will be visible only to me, the Vault 111 Owner, and Administrators.</label>
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
    root.querySelector('[data-act="analytics-enable"]')?.addEventListener('click', enableMemberAnalytics);
    root.querySelector('[data-act="analytics-disable"]')?.addEventListener('click', disableMemberAnalytics);
    root.querySelector('[data-act="load-shared"]')?.addEventListener('click', refreshSharedData);
    root.querySelector('[data-act="member-refresh"]')?.addEventListener('click', () => refreshMemberOverview(false));
    root.querySelector('[data-act="member-sync-self"]')?.addEventListener('click', syncMyMemberAnalytics);
    root.querySelector('[data-act="war-sync"]')?.addEventListener('click', synchronizeWarTracker);
    root.querySelector('[data-act="war-refresh"]')?.addEventListener('click', () => refreshWarTracker(false));
    root.querySelector('#v111-payout-settings')?.addEventListener('submit', savePayoutSettings);
    root.querySelector('[data-act="payout-refresh"]')?.addEventListener('click', () => refreshPayouts(false));
    root.querySelector('[data-act="payout-copy"]')?.addEventListener('click', copyPayoutReport);
    root.querySelector('[data-act="payout-csv"]')?.addEventListener('click', downloadPayoutCsv);
    root.querySelector('[data-act="payout-finalize"]')?.addEventListener('click', finalizePayoutPlan);
    root.querySelector('[data-act="payout-reopen"]')?.addEventListener('click', reopenPayoutPlan);
    root.querySelectorAll('[data-save-payout-member]').forEach(button => {
      button.addEventListener('click', () => savePayoutMemberAdjustment(button));
    });
    root.querySelectorAll('[data-save-war-note]').forEach(button => {
      button.addEventListener('click', () => saveWarTargetNote(button));
    });
    root.querySelector('#v111-war-target-search')?.addEventListener('input', event => {
      state.ui.warTargetSearch = event.target.value;
      applyWarTargetFilter();
    });
    root.querySelector('#v111-war-target-filter')?.addEventListener('change', event => {
      state.ui.warTargetFilter = event.target.value;
      applyWarTargetFilter();
    });
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
    root.querySelector('#v111-member-filter')?.addEventListener('change', event => {
      state.ui.memberFilter = event.target.value;
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
    if (tab === 'members' && state.backend.connected && !state.backend.memberOverview) {
      setTimeout(() => {
        if (state.ui.activeTab === 'members') refreshMemberOverview(true);
      }, 0);
    }
    if (tab === 'war' && state.backend.connected && !state.backend.warSnapshot) {
      setTimeout(() => {
        if (state.ui.activeTab === 'war') refreshWarTracker(true);
      }, 0);
    }
    if (tab === 'payouts' && state.backend.connected && !state.backend.payoutSnapshot) {
      setTimeout(() => {
        if (state.ui.activeTab === 'payouts') refreshPayouts(true);
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
    const filter = String(state.ui.memberFilter || 'all');
    root.querySelectorAll('.member-row').forEach(row => {
      const matchesSearch = !query ||
        row.dataset.memberName.includes(query) ||
        row.textContent.toLowerCase().includes(query);
      const status = row.dataset.memberStatus || '';
      const matchesFilter =
        filter === 'all' ||
        (filter === 'analytics' && row.dataset.memberAnalytics === 'true') ||
        status === filter;
      row.style.display = matchesSearch && matchesFilter ? 'flex' : 'none';
    });
  }

  function applyWarTargetFilter() {
    if (!root?.isConnected) return;
    const query = String(state.ui.warTargetSearch || '').trim().toLowerCase();
    const filter = String(state.ui.warTargetFilter || 'all');
    root.querySelectorAll('[data-war-target]').forEach(card => {
      const matchesSearch = !query ||
        String(card.dataset.targetName || '').includes(query) ||
        String(card.textContent || '').toLowerCase().includes(query);
      const matchesFilter =
        filter === 'all' ||
        (filter === 'noted' && card.dataset.targetNoted === 'true') ||
        card.dataset.targetState === filter;
      card.hidden = !(matchesSearch && matchesFilter);
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
    if (tab === 'members') return 'memberStatus';
    if (tab === 'war') return 'warStatus';
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
        daysInFaction: Number(m.daysInFaction ?? m.days_in_faction ?? 0),
        lastActionAt: m.lastActionAt ?? m.last_action?.timestamp ?? null,
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

  function backendCanWarSync() {
    return ['OWNER', 'ADMIN', 'WAR_MANAGER'].includes(String(state.backend.user?.role || '').toUpperCase());
  }

  function backendCanWarNotes() {
    return ['OWNER', 'ADMIN', 'WAR_MANAGER', 'OFFICER'].includes(String(state.backend.user?.role || '').toUpperCase());
  }

  function backendCanPayoutManage() {
    return ['OWNER', 'ADMIN', 'WAR_MANAGER'].includes(String(state.backend.user?.role || '').toUpperCase());
  }

  function backendCanPayoutReopen() {
    return ['OWNER', 'ADMIN'].includes(String(state.backend.user?.role || '').toUpperCase());
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
    state.backend.memberOverview = null;
    state.backend.memberWarHistory = new Map();
    state.backend.memberWarHistoryLoading = new Set();
    state.backend.warSnapshot = null;
    state.backend.payoutSnapshot = null;
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

  async function backendApi(method, route, body, { timeoutMs = 15000 } = {}) {
    await ensureBackendAwake();
    let token = await backendAccessToken();
    try {
      return await backendRequest(method, route, { body, token, timeoutMs });
    } catch (error) {
      if (error.status !== 401) throw error;
      save(STORE.backendExpires, 0);
      token = await backendAccessToken();
      return backendRequest(method, route, { body, token, timeoutMs });
    }
  }

  function personalStatsAutoSyncDue() {
    const lastSync = Number(load(STORE.backendStatsLastAutoSync, 0)) || 0;
    return Date.now() - lastSync >= STATS_AUTO_SYNC_INTERVAL_MS;
  }

  async function syncOwnMemberData(force = false) {
    if (!force && !personalStatsAutoSyncDue()) return false;
    await backendApi('POST', '/v1/me/crime-stats/sync', {});
    let analyticsResult = null;
    if (state.backend.user?.analyticsConsentAt) {
      analyticsResult = await backendApi('POST', '/v1/me/analytics/sync', {});
    }
    save(STORE.backendStatsLastAutoSync, Date.now());
    return { analyticsResult };
  }

  async function connectBackend(event) {
    event.preventDefault();
    if (state.backend.loading) return;
    const input = root.querySelector('#v111-backend-key');
    const consent = root.querySelector('#v111-analytics-consent');
    const key = input?.value.trim() || '';
    if (!/^[A-Za-z0-9_-]{8,256}$/.test(key)) {
      return setStatus(root.querySelector('#v111-backend-status'), 'That does not look like a valid Torn API key.', true);
    }
    if (!consent?.checked) {
      return setStatus(root.querySelector('#v111-backend-status'), 'Confirm the analytics privacy notice before connecting.', true);
    }
    state.backend.error = '';
    state.ui.backendStatus = null;
    if (!beginBackendWork('Connecting securely…', 'backend')) return;
    let sessionEstablished = false;
    let warning = '';
    try {
      await ensureBackendAwake();
      const session = await backendRequest('POST', '/v1/auth/login', {
        body: { apiKey: key, analyticsConsent: true }
      });
      saveBackendSession(session);
      state.backend.connected = true;
      state.backend.user = session.user;
      sessionEstablished = true;
      try {
        const synced = await syncOwnMemberData(true);
        if (synced?.analyticsResult?.warnings?.length) {
          warning = synced.analyticsResult.warnings.join(' ');
        }
      } catch (error) {
        warning = `Connected, but your member stats could not be synced: ${friendly(error)}`;
      }
      try {
        await loadSharedPlan();
      } catch (error) {
        warning ||= `Connected, but shared data could not be loaded: ${friendly(error)}`;
      }
      try {
        await loadWarSnapshot();
      } catch (error) {
        warning ||= `Connected, but the shared war tracker could not be loaded: ${friendly(error)}`;
      }
      try {
        await loadMemberOverview();
      } catch (error) {
        warning ||= `Connected, but member analytics could not be loaded: ${friendly(error)}`;
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
        const synced = await syncOwnMemberData();
        if (synced?.analyticsResult?.warnings?.length) {
          warning = synced.analyticsResult.warnings.join(' ');
        }
      } catch (error) {
        warning = `Connected, but your automatic member-stat refresh failed: ${friendly(error)}`;
      }
      try {
        await loadSharedPlan();
      } catch (error) {
        warning ||= `Connected, but shared data could not be loaded: ${friendly(error)}`;
      }
      try {
        await loadWarSnapshot();
      } catch (error) {
        warning ||= `Connected, but the shared war tracker could not be loaded: ${friendly(error)}`;
      }
      try {
        await loadMemberOverview();
      } catch (error) {
        warning ||= `Connected, but member analytics could not be loaded: ${friendly(error)}`;
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

  async function loadMemberOverview() {
    const result = await backendApi('GET', '/v1/members/overview');
    state.backend.memberOverview = result;
    return result;
  }

  async function loadWarSnapshot() {
    const result = await backendApi('GET', '/v1/war/snapshot');
    state.backend.warSnapshot = result;
    state.backend.payoutSnapshot = null;
    state.backend.memberWarHistory = new Map();
    return result;
  }

  async function loadPayoutSnapshot() {
    const warSnapshot = state.backend.warSnapshot || await loadWarSnapshot();
    const warId = Number(warSnapshot?.war?.id || 0);
    if (!warId) {
      state.backend.payoutSnapshot = null;
      return null;
    }
    const result = await backendApi('GET', `/v1/war/${encodeURIComponent(warId)}/payout`);
    state.backend.payoutSnapshot = result;
    return result;
  }

  async function refreshPayouts(silent = false) {
    if (state.backend.loading || !state.backend.connected) return;
    state.ui.payoutStatus = null;
    if (!beginBackendWork('Refreshing shared ranked-war payouts…', 'payouts', !silent)) return;
    try {
      const result = await loadPayoutSnapshot();
      if (!silent) {
        setFeedback(
          'payouts',
          result?.plan
            ? `War #${result.war.id} ${String(result.plan.status).toLowerCase()} payout report refreshed.`
            : result?.war
              ? `War #${result.war.id} is ready for a payout draft.`
              : 'No current or recent ranked war is available for payouts.'
        );
      }
    } catch (error) {
      setFeedback('payouts', friendly(error), true);
    } finally {
      finishBackendWork();
      state.ui.activeTab = 'payouts';
      render();
    }
  }

  function normalizedMoneyInput(value, signed = false) {
    const normalized = String(value || '').replace(/[$,\s]/g, '');
    const pattern = signed ? /^-?\d+$/ : /^\d+$/;
    if (!pattern.test(normalized)) throw new Error('Enter a whole-dollar amount without decimals.');
    const amount = Number(normalized);
    if (!Number.isSafeInteger(amount)) throw new Error('That money amount is too large.');
    return normalized;
  }

  async function savePayoutSettings(event) {
    event.preventDefault();
    if (state.backend.loading || !backendCanPayoutManage()) return;
    const snapshot = state.backend.payoutSnapshot;
    const warId = Number(snapshot?.war?.id || 0);
    if (!warId) return;
    try {
      const poolAmount = normalizedMoneyInput(root.querySelector('#v111-payout-pool')?.value);
      if (!beginBackendWork('Saving payout settings and recalculating…', 'payouts')) return;
      state.backend.payoutSnapshot = await backendApi('PUT', `/v1/war/${encodeURIComponent(warId)}/payout`, {
        poolAmount,
        expectedVersion: Number(snapshot.plan?.version || 0)
      });
      setFeedback('payouts', 'Payout draft saved and recalculated.');
    } catch (error) {
      setFeedback('payouts', friendly(error), true);
    } finally {
      if (state.backend.loading) finishBackendWork();
      state.ui.activeTab = 'payouts';
      render();
    }
  }

  async function savePayoutMemberAdjustment(button) {
    if (state.backend.loading || !backendCanPayoutManage()) return;
    const row = button.closest('.payout-row');
    const amountInput = row?.querySelector('[data-payout-adjustment]');
    const noteInput = row?.querySelector('[data-payout-note]');
    const warId = Number(button.dataset.warId || 0);
    const memberId = Number(button.dataset.memberId || 0);
    const expectedVersion = Number(button.dataset.planVersion || 0);
    if (!row || !amountInput || !noteInput || !warId || !memberId || !expectedVersion) {
      setFeedback('payouts', 'This payout row could not be identified. Refresh and try again.', true);
      render();
      return;
    }
    try {
      const amount = normalizedMoneyInput(amountInput.value, true);
      const note = noteInput.value.trim();
      if (note.length > 200) throw new Error('Adjustment notes are limited to 200 characters.');
      if (!beginBackendWork(`Saving payout adjustment for member ${memberId}…`, 'payouts')) return;
      state.backend.payoutSnapshot = await backendApi(
        'PUT',
        `/v1/war/${encodeURIComponent(warId)}/payout/members/${encodeURIComponent(memberId)}`,
        { amount, note: note || null, expectedVersion }
      );
      setFeedback('payouts', 'Member payout adjustment saved.');
    } catch (error) {
      setFeedback(
        'payouts',
        error?.status === 409 ? 'The payout draft changed. It has been refreshed; review the amount before saving again.' : friendly(error),
        true
      );
      if (error?.status === 409) {
        try { await loadPayoutSnapshot(); } catch {}
      }
    } finally {
      if (state.backend.loading) finishBackendWork();
      state.ui.activeTab = 'payouts';
      render();
    }
  }

  async function finalizePayoutPlan() {
    const snapshot = state.backend.payoutSnapshot;
    if (state.backend.loading || !backendCanPayoutManage() || !snapshot?.plan) return;
    if (!window.confirm('Finalize and lock this payout report? Future Torn synchronizations will not change the stored member amounts.')) return;
    if (!beginBackendWork('Finalizing and locking payout report…', 'payouts')) return;
    try {
      state.backend.payoutSnapshot = await backendApi(
        'POST',
        `/v1/war/${encodeURIComponent(snapshot.war.id)}/payout/finalize`,
        { expectedVersion: Number(snapshot.plan.version) }
      );
      setFeedback('payouts', 'Payout report finalized and locked.');
    } catch (error) {
      setFeedback('payouts', friendly(error), true);
      if (error?.status === 409) {
        try { await loadPayoutSnapshot(); } catch {}
      }
    } finally {
      finishBackendWork();
      state.ui.activeTab = 'payouts';
      render();
    }
  }

  async function reopenPayoutPlan() {
    const snapshot = state.backend.payoutSnapshot;
    if (state.backend.loading || !backendCanPayoutReopen() || !snapshot?.plan) return;
    if (!window.confirm('Reopen this finalized payout report? Its locked snapshot will become a recalculating draft again.')) return;
    if (!beginBackendWork('Reopening payout draft…', 'payouts')) return;
    try {
      state.backend.payoutSnapshot = await backendApi(
        'POST',
        `/v1/war/${encodeURIComponent(snapshot.war.id)}/payout/reopen`,
        { expectedVersion: Number(snapshot.plan.version) }
      );
      setFeedback('payouts', 'Payout report reopened as a draft.');
    } catch (error) {
      setFeedback('payouts', friendly(error), true);
      if (error?.status === 409) {
        try { await loadPayoutSnapshot(); } catch {}
      }
    } finally {
      finishBackendWork();
      state.ui.activeTab = 'payouts';
      render();
    }
  }

  async function copyPayoutReport() {
    const text = payoutReportText(state.backend.payoutSnapshot);
    if (!text) {
      setFeedback('payouts', 'There is no payout report to copy yet.', true);
      render();
      return;
    }
    await copyText(text);
    setFeedback('payouts', 'Payout report copied to the clipboard.');
    render();
  }

  function downloadPayoutCsv() {
    const snapshot = state.backend.payoutSnapshot;
    if (!snapshot?.plan) {
      setFeedback('payouts', 'There is no payout report to download yet.', true);
      render();
      return;
    }
    const csvCell = value => `"${String(value ?? '').replace(/"/g, '""')}"`;
    const lines = [
      ['Torn ID', 'Name', 'Position', 'War Hits (1 pt)', 'OOW Chain Hits (0.5 pt)', 'OOW Non-Chain Hits (0.25 pt)', 'Total Points', 'Share %', 'Base Amount', 'Adjustment', 'Final Payout', 'Adjustment Note'],
      ...(snapshot.rows || []).map(row => [
        row.tornId,
        row.name,
        row.position || '',
        row.warHits,
        row.chainHits,
        row.outsideChainHits,
        Number(row.points || 0).toFixed(2),
        (Number(row.share || 0) * 100).toFixed(4),
        row.baseAmount,
        row.adjustmentAmount,
        row.finalAmount,
        row.adjustmentNote || ''
      ])
    ].map(row => row.map(csvCell).join(',')).join('\r\n');
    const blob = new Blob([`\uFEFF${lines}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `vault111-ranked-war-${Number(snapshot.war.id)}-payouts.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setFeedback('payouts', 'Payout CSV downloaded.');
    render();
  }

  async function refreshWarTracker(silent = false) {
    if (state.backend.loading || !state.backend.connected) return;
    state.ui.warStatus = null;
    if (!beginBackendWork('Refreshing shared ranked-war data…', 'war', !silent)) return;
    try {
      const result = await loadWarSnapshot();
      if (!silent) {
        const message = result?.war
          ? `Ranked War #${result.war.id} refreshed with ${formatNumber(result?.totals?.attacks)} recorded attacks.`
          : 'The shared war tracker was refreshed. No ranked war is stored yet.';
        setFeedback('war', message);
      }
    } catch (error) {
      setFeedback('war', friendly(error), true);
    } finally {
      finishBackendWork();
      state.ui.activeTab = 'war';
      render();
    }
  }

  async function synchronizeWarTracker() {
    if (state.backend.loading || !state.backend.connected) return;
    if (!backendCanWarSync()) {
      setFeedback('war', 'Your Control Center role can view the tracker but cannot synchronize Torn war data.', true);
      render();
      return;
    }
    state.ui.warStatus = null;
    if (!beginBackendWork('Synchronizing ranked-war scores, targets, and attacks from Torn…', 'war')) return;
    try {
      const sync = await backendApi('POST', '/v1/war/sync', {}, { timeoutMs: 45000 });
      const result = await loadWarSnapshot();
      const message = result?.war
        ? `Ranked War #${result.war.id} synchronized with ${formatNumber(sync?.targets ?? result?.targets?.length)} targets and ${formatNumber(sync?.attacks)} outgoing attacks for war tracking and payout points.`
        : 'Torn was checked successfully. No current or recent ranked war was returned.';
      setFeedback('war', message);
    } catch (error) {
      setFeedback('war', friendly(error), true);
    } finally {
      finishBackendWork();
      state.ui.activeTab = 'war';
      render();
    }
  }

  async function saveWarTargetNote(button) {
    if (state.backend.loading || !state.backend.connected) return;
    if (!backendCanWarNotes()) {
      setFeedback('war', 'Your Control Center role can read officer notes but cannot edit them.', true);
      render();
      return;
    }
    const card = button.closest('[data-war-target]');
    const textarea = card?.querySelector('[data-war-note]');
    const warId = Number(button.dataset.warId || 0);
    const targetId = Number(button.dataset.targetId || 0);
    const expectedVersion = Number(button.dataset.noteVersion || 0);
    if (!textarea || !warId || !targetId || !expectedVersion) {
      setFeedback('war', 'This target note could not be identified. Refresh the tracker and try again.', true);
      render();
      return;
    }
    const note = textarea.value.trim();
    if (note.length > 500) {
      setFeedback('war', 'Officer notes are limited to 500 characters.', true);
      render();
      return;
    }
    state.ui.warStatus = null;
    if (!beginBackendWork(`Saving note for target ${targetId}…`, 'war')) return;
    try {
      await backendApi(
        'PUT',
        `/v1/war/${encodeURIComponent(warId)}/targets/${encodeURIComponent(targetId)}/note`,
        { note: note || null, expectedVersion }
      );
      await loadWarSnapshot();
      setFeedback('war', note ? 'Officer target note saved.' : 'Officer target note cleared.');
    } catch (error) {
      if (error?.status === 409) {
        await loadWarSnapshot().catch(() => undefined);
      }
      setFeedback('war', friendly(error), true);
    } finally {
      finishBackendWork();
      state.ui.activeTab = 'war';
      render();
    }
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
      const synced = await syncOwnMemberData(true);
      const result = await loadSharedPlan();
      await loadMemberOverview();
      const memberCount = Number(result?.sync?.memberCount || result?.members?.length || 0);
      const crimeCount = Number(result?.sync?.crimeCount || result?.crimes?.length || 0);
      if (!silent) {
        const warning = synced?.analyticsResult?.warnings?.join(' ');
        setFeedback(returnTab, `${warning ? `${warning} ` : ''}Your member stats were updated. Shared data loaded: ${memberCount} members and ${crimeCount} available crimes.`);
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
    if (!beginBackendWork('Synchronizing your crime, battle, and drug stats…', 'backend')) return;
    try {
      const synced = await syncOwnMemberData(!automatic);
      await loadSharedPlan();
      await loadMemberOverview();
      state.backend.error = '';
      const warning = synced?.analyticsResult?.warnings?.join(' ');
      setFeedback('backend', automatic
        ? `${warning ? `${warning} ` : ''}Your member stats were refreshed automatically.`
        : `${warning ? `${warning} ` : ''}Your crime, battle, drug, and cooldown statistics were synchronized.`);
    } catch (error) {
      state.backend.error = friendly(error);
      setFeedback('backend', state.backend.error, true);
    } finally {
      finishBackendWork();
      render();
    }
  }

  async function refreshMemberOverview(silent = false) {
    if (state.backend.loading || !state.backend.connected) return;
    state.ui.memberStatus = null;
    if (!beginBackendWork('Refreshing the faction member overview…', 'members', !silent)) return;
    try {
      const result = await loadMemberOverview();
      if (!silent) {
        setFeedback('members', `Member overview refreshed: ${formatNumber(result?.summary?.analyticsShared)} members sharing analytics.`);
      }
    } catch (error) {
      setFeedback('members', friendly(error), true);
    } finally {
      finishBackendWork();
      state.ui.activeTab = 'members';
      render();
    }
  }

  async function syncMyMemberAnalytics() {
    if (state.backend.loading || !state.backend.connected) return;
    if (!state.backend.user?.analyticsConsentAt) {
      setFeedback('members', 'Enable analytics tracking from the API Key screen first.', true);
      render();
      return;
    }
    state.ui.memberStatus = null;
    if (!beginBackendWork('Synchronizing your battle stats, drug totals, and cooldown…', 'members')) return;
    try {
      const result = await syncOwnMemberData(true);
      await loadMemberOverview();
      const warning = result?.analyticsResult?.warnings?.join(' ');
      setFeedback('members', warning || 'Your member analytics were synchronized successfully.', Boolean(warning));
    } catch (error) {
      setFeedback('members', friendly(error), true);
    } finally {
      finishBackendWork();
      state.ui.activeTab = 'members';
      render();
    }
  }

  async function enableMemberAnalytics() {
    if (state.backend.loading || !state.backend.connected) return;
    if (!window.confirm('Enable storage of your exact battle stats, drug totals, rehabilitation totals, overdoses, and drug cooldown? Exact values will be visible only to you, the Vault 111 Owner, and Administrators.')) return;
    if (!beginBackendWork('Enabling and synchronizing member analytics…', 'backend')) return;
    try {
      const consent = await backendApi('PUT', '/v1/me/analytics-consent', { accepted: true });
      state.backend.user.analyticsConsentAt = consent.analyticsConsentAt;
      const result = await syncOwnMemberData(true);
      await loadMemberOverview();
      const warning = result?.analyticsResult?.warnings?.join(' ');
      setFeedback('backend', warning || 'Member analytics tracking is enabled and synchronized.', Boolean(warning));
    } catch (error) {
      setFeedback('backend', friendly(error), true);
    } finally {
      finishBackendWork();
      state.ui.activeTab = 'backend';
      render();
    }
  }

  async function disableMemberAnalytics() {
    if (state.backend.loading || !state.backend.connected) return;
    if (!window.confirm('Disable analytics tracking and permanently delete your stored battle-stat and drug history from the Control Center?')) return;
    if (!beginBackendWork('Deleting your stored member analytics…', 'backend')) return;
    try {
      await backendApi('PUT', '/v1/me/analytics-consent', { accepted: false });
      state.backend.user.analyticsConsentAt = null;
      save(STORE.backendStatsLastAutoSync, 0);
      await loadMemberOverview();
      setFeedback('backend', 'Analytics tracking was disabled and your stored analytics history was deleted.');
    } catch (error) {
      setFeedback('backend', friendly(error), true);
    } finally {
      finishBackendWork();
      state.ui.activeTab = 'backend';
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
    if (element?.id === 'v111-member-status') state.ui.memberStatus = { text, error };
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
        display: flex !important;
        flex-direction: column !important;
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
        flex: 0 0 auto !important;
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
      #v111-ocp .body { display:flex !important; flex:1 1 auto !important; flex-direction:column !important; min-height:0 !important; max-height:none !important; overflow:hidden !important; }
      #v111-ocp.collapsed .body { display:none !important; }
      #v111-ocp.collapsed { width:300px !important; max-height:none !important; }
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
      #v111-ocp .war-empty h3 { margin:0 0 8px !important; color:#fff !important; }
      #v111-ocp .war-toolbar { margin-bottom:9px !important; }
      #v111-ocp .war-sync-line { display:flex !important; justify-content:space-between !important; gap:10px !important; margin:8px 0 !important; color:#afc3d7 !important; font-size:11px !important; }
      #v111-ocp .war-sync-line b { color:#eef6ff !important; text-align:right !important; }
      #v111-ocp .war-warning { border-color:#8b7130 !important; background:#392f18 !important; color:#ffe9a8 !important; }
      #v111-ocp .war-score-card { margin:8px 0 !important; padding:12px !important; border:1px solid #3d6f99 !important; border-radius:10px !important; background:linear-gradient(145deg,#182c40,#101923) !important; }
      #v111-ocp .war-heading { display:flex !important; justify-content:space-between !important; align-items:flex-start !important; gap:9px !important; }
      #v111-ocp .war-heading h3 { margin:2px 0 !important; color:#fff !important; font-size:16px !important; overflow-wrap:anywhere !important; }
      #v111-ocp .war-status { flex:0 0 auto !important; padding:4px 7px !important; border-radius:999px !important; background:#3d5368 !important; color:#fff !important; font-size:10px !important; font-weight:800 !important; text-transform:uppercase !important; letter-spacing:.4px !important; }
      #v111-ocp .war-status.active { background:#226946 !important; color:#d4ffe5 !important; }
      #v111-ocp .war-status.scheduled { background:#62511e !important; color:#fff1ae !important; }
      #v111-ocp .war-clock { margin:7px 0 10px !important; color:var(--v111-gold) !important; font:800 12px/1.3 ui-monospace,SFMono-Regular,Consolas,monospace !important; }
      #v111-ocp .war-side { display:grid !important; grid-template-columns:minmax(0,1fr) auto minmax(0,1fr) !important; align-items:center !important; gap:8px !important; }
      #v111-ocp .war-side > div { min-width:0 !important; }
      #v111-ocp .war-side > div:last-child { text-align:right !important; }
      #v111-ocp .war-side b, #v111-ocp .war-side strong, #v111-ocp .war-side small { display:block !important; overflow-wrap:anywhere !important; }
      #v111-ocp .war-side strong { color:#fff !important; font-size:23px !important; }
      #v111-ocp .war-side > span { color:#c1d2e2 !important; font-size:10px !important; font-weight:800 !important; text-align:center !important; }
      #v111-ocp .war-score-bars { display:grid !important; gap:4px !important; margin-top:9px !important; padding:3px !important; border-radius:6px !important; background:#0a1118 !important; overflow:hidden !important; }
      #v111-ocp .war-score-bars i { display:block !important; min-width:2px !important; height:5px !important; border-radius:99px !important; }
      #v111-ocp .war-score-bars .vault { background:linear-gradient(90deg,#247ac2,#65b9f5) !important; }
      #v111-ocp .war-score-bars .opponent { background:linear-gradient(90deg,#8f3540,#e26f79) !important; }
      #v111-ocp .war-metrics { display:grid !important; grid-template-columns:repeat(4,minmax(0,1fr)) !important; gap:6px !important; margin:8px 0 !important; }
      #v111-ocp .war-metrics .metric { padding:7px 4px !important; }
      #v111-ocp .war-metrics .metric b { font-size:15px !important; overflow-wrap:anywhere !important; }
      #v111-ocp .war-target-heading { display:flex !important; justify-content:space-between !important; align-items:end !important; gap:8px !important; margin-top:10px !important; }
      #v111-ocp .war-target-heading .section-title { margin:0 !important; }
      #v111-ocp .war-target-heading .section-title small { display:inline !important; margin-left:4px !important; font-weight:400 !important; }
      #v111-ocp .war-target-tools { display:flex !important; gap:5px !important; min-width:0 !important; }
      #v111-ocp .war-target-tools input, #v111-ocp .war-target-tools select { min-width:0 !important; height:32px !important; margin:0 !important; padding:5px 7px !important; border:1px solid #405a72 !important; border-radius:6px !important; background:#101820 !important; color:#eef5ff !important; font:11px system-ui,-apple-system,"Segoe UI",Arial,sans-serif !important; }
      #v111-ocp .war-target-tools input { width:135px !important; }
      #v111-ocp .war-target-list { display:grid !important; gap:6px !important; margin:7px 0 12px !important; }
      #v111-ocp .war-target-card { display:grid !important; grid-template-columns:minmax(0,1fr) auto !important; gap:7px 9px !important; padding:9px !important; border:1px solid #31506a !important; border-left:3px solid #657789 !important; border-radius:8px !important; background:#131f2b !important; }
      #v111-ocp .war-target-card[hidden] { display:none !important; }
      #v111-ocp .war-target-card.available { border-left-color:#4fb47c !important; }
      #v111-ocp .war-target-card.hospital { border-left-color:#c75d68 !important; }
      #v111-ocp .war-target-card.jail { border-left-color:#d0a24a !important; }
      #v111-ocp .war-target-card.away { border-left-color:#5b89b7 !important; }
      #v111-ocp .war-target-main { display:flex !important; justify-content:space-between !important; align-items:flex-start !important; gap:7px !important; min-width:0 !important; }
      #v111-ocp .war-target-main > div { min-width:0 !important; }
      #v111-ocp .war-target-name { display:block !important; color:#f5f9ff !important; font-weight:800 !important; text-decoration:none !important; overflow-wrap:anywhere !important; }
      #v111-ocp .target-status { flex:0 0 auto !important; padding:3px 6px !important; border-radius:999px !important; background:#415466 !important; color:#fff !important; font-size:9px !important; font-weight:800 !important; text-transform:uppercase !important; }
      #v111-ocp .target-status.available { background:#225f3e !important; color:#ccf4da !important; }
      #v111-ocp .target-status.hospital { background:#6e3038 !important; color:#ffd9dd !important; }
      #v111-ocp .target-status.jail { background:#68531f !important; color:#ffedb1 !important; }
      #v111-ocp .target-status.away { background:#274e72 !important; color:#d8edff !important; }
      #v111-ocp .war-target-details { grid-column:1 !important; display:grid !important; gap:2px !important; color:#b6c9db !important; font-size:10px !important; overflow-wrap:anywhere !important; }
      #v111-ocp .war-target-actions { grid-column:2 !important; grid-row:1 / span 2 !important; display:flex !important; align-items:center !important; gap:4px !important; }
      #v111-ocp .war-target-note { grid-column:1 / -1 !important; padding-top:7px !important; border-top:1px solid #2a4155 !important; }
      #v111-ocp .war-target-note label, #v111-ocp .war-target-note > b { display:block !important; margin-bottom:4px !important; color:#d8e7f5 !important; font-size:10px !important; font-weight:800 !important; }
      #v111-ocp .war-target-note textarea { display:block !important; width:100% !important; min-height:54px !important; resize:vertical !important; margin:0 !important; padding:7px !important; border:1px solid #405a72 !important; border-radius:6px !important; background:#0d1720 !important; color:#fff !important; font:11px/1.35 system-ui,-apple-system,"Segoe UI",Arial,sans-serif !important; }
      #v111-ocp .war-target-note > div { display:flex !important; justify-content:space-between !important; align-items:center !important; gap:7px !important; margin-top:5px !important; }
      #v111-ocp .war-target-note p { margin:0 !important; color:#dce8f3 !important; white-space:pre-wrap !important; overflow-wrap:anywhere !important; }
      #v111-ocp .war-table { display:grid !important; gap:3px !important; }
      #v111-ocp .war-table-head, #v111-ocp .war-member-row { display:grid !important; grid-template-columns:minmax(150px,1fr) 52px 72px 52px !important; align-items:center !important; gap:6px !important; padding:7px 8px !important; }
      #v111-ocp .war-table-head { color:#9fb4c8 !important; font-size:10px !important; font-weight:800 !important; text-transform:uppercase !important; }
      #v111-ocp .war-member-row { border:1px solid #2a4358 !important; border-radius:6px !important; background:#152330 !important; color:#eaf4ff !important; text-decoration:none !important; }
      #v111-ocp .war-member-row:hover { background:#1b3143 !important; }
      #v111-ocp .war-member-row > span { min-width:0 !important; }
      #v111-ocp .war-member-row b, #v111-ocp .war-member-row small { display:block !important; overflow:hidden !important; text-overflow:ellipsis !important; white-space:nowrap !important; }
      #v111-ocp .war-member-row > strong { text-align:right !important; font-size:12px !important; }
      #v111-ocp .war-inactive { margin:7px 0 !important; border:1px solid #2c455b !important; border-radius:6px !important; background:#121e29 !important; }
      #v111-ocp .war-inactive summary { padding:8px !important; color:#bfd0df !important; cursor:pointer !important; font-weight:700 !important; }
      #v111-ocp .war-inactive > div { display:flex !important; flex-wrap:wrap !important; gap:5px !important; padding:0 8px 8px !important; }
      #v111-ocp .war-inactive a { color:#a9d8fa !important; font-size:10px !important; text-decoration:none !important; }
      #v111-ocp .war-feed { display:grid !important; gap:5px !important; }
      #v111-ocp .war-attack { padding:7px 8px !important; border-left:3px solid #4c9a70 !important; border-radius:5px !important; background:#15232f !important; }
      #v111-ocp .war-attack.loss { border-left-color:#bc5963 !important; }
      #v111-ocp .war-attack > div { display:flex !important; gap:5px !important; align-items:center !important; overflow-wrap:anywhere !important; }
      #v111-ocp .war-attack small { margin-top:2px !important; }
      #v111-ocp .payout-toolbar { margin-bottom:9px !important; }
      #v111-ocp .payout-hero { display:flex !important; align-items:flex-start !important; justify-content:space-between !important; gap:10px !important; margin:8px 0 !important; padding:11px !important; border:1px solid #38627f !important; border-radius:8px !important; background:linear-gradient(135deg,#18354a,#132432) !important; }
      #v111-ocp .payout-hero h3 { margin:2px 0 !important; color:#fff !important; font-size:15px !important; }
      #v111-ocp .payout-hero h3 span { color:#8facbf !important; font-size:11px !important; }
      #v111-ocp .payout-hero small { color:#b4c8d8 !important; }
      #v111-ocp .eyebrow { color:#f2c94c !important; font-size:9px !important; font-weight:800 !important; letter-spacing:.08em !important; text-transform:uppercase !important; }
      #v111-ocp .payout-state { flex:0 0 auto !important; padding:5px 8px !important; border-radius:999px !important; font-size:10px !important; font-weight:900 !important; }
      #v111-ocp .payout-state.draft { background:#6a5623 !important; color:#fff0b0 !important; }
      #v111-ocp .payout-state.finalized { background:#1d603c !important; color:#c8f5d9 !important; }
      #v111-ocp .payout-config { display:grid !important; grid-template-columns:minmax(150px,.8fr) minmax(260px,1.5fr) auto !important; align-items:end !important; gap:8px !important; margin:8px 0 !important; padding:9px !important; border:1px solid #304c63 !important; border-radius:8px !important; background:#142331 !important; }
      #v111-ocp .payout-config > label { display:grid !important; gap:3px !important; color:#c9d8e6 !important; font-size:10px !important; font-weight:700 !important; }
      #v111-ocp .payout-fixed-rules { display:grid !important; gap:3px !important; min-width:0 !important; padding:6px 8px !important; border:1px solid #2d4b62 !important; border-radius:6px !important; background:#101d28 !important; color:#b9cddd !important; font-size:10px !important; }
      #v111-ocp .payout-fixed-rules b { color:#f2c94c !important; }
      #v111-ocp .payout-config input, #v111-ocp .payout-adjustment input { width:100% !important; min-width:0 !important; margin:0 !important; padding:6px !important; border:1px solid #405d75 !important; border-radius:5px !important; background:#0d1720 !important; color:#fff !important; font:11px system-ui,-apple-system,"Segoe UI",Arial,sans-serif !important; }
      #v111-ocp .payout-readonly-config { display:grid !important; grid-template-columns:repeat(4,minmax(0,1fr)) !important; gap:6px !important; margin:8px 0 !important; }
      #v111-ocp .payout-readonly-config span, #v111-ocp .payout-metrics > div { display:grid !important; gap:2px !important; padding:7px !important; border:1px solid #2d475d !important; border-radius:6px !important; background:#142330 !important; color:#aabed0 !important; font-size:9px !important; text-align:center !important; }
      #v111-ocp .payout-readonly-config b, #v111-ocp .payout-metrics b { color:#fff !important; font-size:13px !important; }
      #v111-ocp .payout-metrics { display:grid !important; grid-template-columns:repeat(4,minmax(0,1fr)) !important; gap:6px !important; margin:8px 0 !important; }
      #v111-ocp .notice.success { border-color:#347651 !important; background:#163625 !important; color:#c9f1d7 !important; }
      #v111-ocp .payout-actions { display:flex !important; justify-content:flex-end !important; gap:6px !important; margin:7px 0 !important; }
      #v111-ocp .payout-list { display:grid !important; min-width:0 !important; max-width:100% !important; gap:4px !important; overflow:hidden !important; }
      #v111-ocp .payout-table-head, #v111-ocp .payout-row { display:grid !important; grid-template-columns:minmax(108px,1.2fr) minmax(84px,1fr) minmax(60px,.65fr) minmax(100px,1fr) minmax(72px,.75fr) !important; align-items:center !important; gap:5px !important; min-width:0 !important; max-width:100% !important; padding:6px !important; }
      #v111-ocp .payout-table-head { color:#9fb4c8 !important; font-size:9px !important; font-weight:800 !important; text-transform:uppercase !important; }
      #v111-ocp .payout-row { border:1px solid #2a4358 !important; border-radius:7px !important; background:#142330 !important; overflow:hidden !important; }
      #v111-ocp .payout-row > strong { min-width:0 !important; color:#eaf4ff !important; font-size:11px !important; text-align:right !important; overflow-wrap:anywhere !important; }
      #v111-ocp .payout-row > strong::before { display:none !important; }
      #v111-ocp .payout-member, #v111-ocp .payout-activity, #v111-ocp .payout-adjustment { display:grid !important; gap:3px !important; min-width:0 !important; }
      #v111-ocp .payout-member a { color:#dcedfb !important; font-weight:800 !important; text-decoration:none !important; overflow-wrap:anywhere !important; }
      #v111-ocp .payout-member small, #v111-ocp .payout-activity small, #v111-ocp .payout-adjustment small { color:#9fb5c8 !important; overflow-wrap:anywhere !important; }
      #v111-ocp .payout-adjustment { grid-template-columns:minmax(0,1fr) auto !important; align-items:center !important; }
      #v111-ocp .payout-adjustment [data-payout-adjustment] { grid-column:1 / -1 !important; }
      #v111-ocp .payout-adjustment [data-payout-note] { grid-column:1 !important; }
      #v111-ocp .payout-adjustment .mini { grid-column:2 !important; }
      #v111-ocp .payout-adjustment > b, #v111-ocp .payout-adjustment > small { grid-column:1 / -1 !important; }
      #v111-ocp .payout-adjustment .positive { color:#8ee0ae !important; }
      #v111-ocp .payout-adjustment .negative { color:#ff9ea7 !important; }
      #v111-ocp .payout-final { color:#f2c94c !important; font-size:12px !important; }
      @media(max-width:600px) {
        #v111-ocp:not(.collapsed) { right:6px !important; top:50% !important; bottom:auto !important; transform:translateY(-50%) !important; width:min(88vw,360px) !important; max-height:40vh !important; font-size:12px !important; }
        #v111-ocp:not(.collapsed) .body { max-height:none !important; }
        #v111-ocp.collapsed { width:min(240px,calc(100vw - 24px)) !important; max-height:none !important; }
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
        #v111-ocp .war-score-card { padding:7px !important; }
        #v111-ocp .war-heading h3 { font-size:12px !important; }
        #v111-ocp .war-side strong { font-size:17px !important; }
        #v111-ocp .war-side > span { font-size:8px !important; }
        #v111-ocp .war-metrics { grid-template-columns:repeat(2,minmax(0,1fr)) !important; gap:4px !important; }
        #v111-ocp .war-target-heading { align-items:stretch !important; flex-direction:column !important; }
        #v111-ocp .war-target-tools { display:grid !important; grid-template-columns:minmax(0,1fr) minmax(0,1fr) !important; }
        #v111-ocp .war-target-tools input { width:100% !important; }
        #v111-ocp .war-target-card { grid-template-columns:minmax(0,1fr) !important; gap:5px !important; padding:6px !important; }
        #v111-ocp .war-target-actions { grid-column:1 !important; grid-row:auto !important; }
        #v111-ocp .war-target-actions > * { flex:1 1 0 !important; }
        #v111-ocp .war-target-note { grid-column:1 !important; }
        #v111-ocp .war-target-note textarea { min-height:48px !important; padding:5px !important; font-size:9px !important; }
        #v111-ocp .war-table-head, #v111-ocp .war-member-row { grid-template-columns:minmax(90px,1fr) 34px 52px 38px !important; gap:3px !important; padding:5px !important; }
        #v111-ocp .war-table-head { font-size:8px !important; }
        #v111-ocp .war-member-row > strong { font-size:9px !important; }
        #v111-ocp .war-attack { padding:5px !important; }
        #v111-ocp .payout-hero { align-items:flex-start !important; padding:7px !important; }
        #v111-ocp .payout-hero h3 { font-size:11px !important; }
        #v111-ocp .payout-state { padding:4px 6px !important; font-size:8px !important; }
        #v111-ocp .payout-config { grid-template-columns:1fr !important; gap:5px !important; padding:6px !important; }
        #v111-ocp .payout-readonly-config, #v111-ocp .payout-metrics { grid-template-columns:repeat(2,minmax(0,1fr)) !important; gap:3px !important; }
        #v111-ocp .payout-readonly-config span, #v111-ocp .payout-metrics > div { padding:5px !important; }
        #v111-ocp .payout-table-head { display:none !important; }
        #v111-ocp .payout-row { grid-template-columns:repeat(2,minmax(0,1fr)) !important; gap:5px !important; padding:6px !important; }
        #v111-ocp .payout-member { grid-column:1 / -1 !important; grid-row:1 !important; }
        #v111-ocp .payout-activity { grid-column:1 / -1 !important; grid-row:2 !important; }
        #v111-ocp .payout-row > strong { grid-row:3 !important; padding:5px 6px !important; border:1px solid #2a4155 !important; border-radius:5px !important; background:#101d28 !important; }
        #v111-ocp .payout-row > strong::before { display:block !important; margin-bottom:2px !important; color:#91a9bc !important; font-size:8px !important; font-weight:800 !important; letter-spacing:.04em !important; text-transform:uppercase !important; content:attr(data-label) !important; }
        #v111-ocp .payout-base { grid-column:1 !important; text-align:left !important; }
        #v111-ocp .payout-final { grid-column:2 !important; text-align:right !important; }
        #v111-ocp .payout-adjustment { grid-column:1 / -1 !important; grid-row:4 !important; grid-template-columns:minmax(0,1fr) auto !important; padding-top:5px !important; border-top:1px solid #2a4155 !important; }
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
      #v111-ocp .member-summary { display:grid !important; grid-template-columns:repeat(4,minmax(0,1fr)) !important; gap:6px !important; margin-bottom:6px !important; }
      #v111-ocp .member-summary > div { display:grid !important; gap:2px !important; min-width:0 !important; padding:8px 5px !important; border:1px solid #2f4e66 !important; border-radius:7px !important; background:#142432 !important; text-align:center !important; }
      #v111-ocp .member-summary b { color:#fff !important; font-size:16px !important; }
      #v111-ocp .member-summary span { color:#a9bfd1 !important; font-size:9px !important; }
      #v111-ocp .member-privacy { margin:0 0 7px !important; color:#a9bfd1 !important; font-size:9px !important; }
      #v111-ocp .member-tools > label:not(.sr-only) { display:flex !important; align-items:center !important; gap:5px !important; color:#b9cddd !important; font-size:9px !important; }
      #v111-ocp .crime-title-actions { display:flex !important; align-items:center !important; gap:7px !important; flex:0 0 auto !important; }
      #v111-ocp .crime-readiness { height:4px !important; background:#0b1117 !important; overflow:hidden !important; }
      #v111-ocp .crime-readiness i { display:block !important; height:100% !important; }
      #v111-ocp button.player-link { display:block !important; padding:0 !important; min-height:0 !important; margin-top:4px !important; border:0 !important; background:transparent !important; color:#fff !important; font-weight:800 !important; text-align:left !important; }
      #v111-ocp .member-list { display:grid !important; gap:5px !important; }
      #v111-ocp button.member-row { display:flex !important; justify-content:space-between !important; align-items:center !important; width:100% !important; padding:8px !important; text-align:left !important; }
      #v111-ocp .member-identity { display:grid !important; gap:2px !important; min-width:0 !important; }
      #v111-ocp .member-identity b, #v111-ocp .member-identity small { overflow:hidden !important; text-overflow:ellipsis !important; white-space:nowrap !important; }
      #v111-ocp .member-tags { display:flex !important; gap:4px !important; flex-wrap:wrap !important; justify-content:flex-end !important; }
      #v111-ocp .member-tags i { font-style:normal !important; font-size:10px !important; background:#24415a !important; border-radius:5px !important; padding:3px 5px !important; }
      #v111-ocp .member-tags i.analytics-tag { background:#31552f !important; color:#d9f3d7 !important; }
      #v111-ocp #v111-modal[hidden] { display:none !important; }
      #v111-ocp #v111-modal { position:fixed !important; inset:0 !important; z-index:2147483647 !important; display:block !important; }
      #v111-ocp .modal-backdrop { position:absolute !important; inset:0 !important; background:rgba(0,0,0,.75) !important; }
      #v111-ocp .member-modal { position:absolute !important; right:18px !important; top:50% !important; transform:translateY(-50%) !important; width:min(430px,calc(100vw - 36px)) !important; max-height:80vh !important; overflow:auto !important; background:#111a23 !important; border:1px solid #3b709b !important; border-radius:10px !important; padding:12px !important; box-shadow:0 20px 60px rgba(0,0,0,.8) !important; }
      #v111-ocp .modal-head { display:flex !important; justify-content:space-between !important; align-items:flex-start !important; gap:10px !important; }
      #v111-ocp .modal-head h3 { margin:0 !important; }
      #v111-ocp .profile-status { margin:10px 0 !important; padding:7px !important; border-radius:6px !important; font-weight:800 !important; }
      #v111-ocp .profile-status.free { background:#173b29 !important; color:#c4f3d5 !important; }
      #v111-ocp .profile-status.busy { background:#49262b !important; color:#ffd7dc !important; }
      #v111-ocp .member-live-status { display:flex !important; justify-content:space-between !important; gap:8px !important; margin-bottom:8px !important; color:#b7c9d9 !important; font-size:10px !important; }
      #v111-ocp .member-analytics-section { margin:9px 0 !important; padding:8px !important; border:1px solid #2d4b62 !important; border-radius:7px !important; background:#101d28 !important; }
      #v111-ocp .member-analytics-section h4 { margin:0 0 6px !important; color:#f2c94c !important; }
      #v111-ocp .analytics-heading { display:flex !important; align-items:center !important; justify-content:space-between !important; gap:8px !important; }
      #v111-ocp .battle-stat-grid, #v111-ocp .drug-summary { display:grid !important; grid-template-columns:repeat(2,minmax(0,1fr)) !important; gap:5px !important; }
      #v111-ocp .battle-stat-grid > div, #v111-ocp .drug-summary > div, #v111-ocp .cooldown-card { display:grid !important; gap:2px !important; min-width:0 !important; padding:6px !important; border-radius:5px !important; background:#182b3a !important; }
      #v111-ocp .battle-stat-grid .wide { grid-column:1 / -1 !important; }
      #v111-ocp .battle-stat-grid span, #v111-ocp .drug-summary span, #v111-ocp .cooldown-card span { color:#9fb5c8 !important; font-size:9px !important; }
      #v111-ocp .battle-stat-grid b, #v111-ocp .drug-summary b, #v111-ocp .cooldown-card b { color:#fff !important; overflow-wrap:anywhere !important; }
      #v111-ocp .drug-breakdown { margin:6px 0 !important; }
      #v111-ocp .drug-breakdown summary { cursor:pointer !important; color:#bed8eb !important; font-weight:800 !important; }
      #v111-ocp .drug-breakdown > div { display:grid !important; grid-template-columns:repeat(2,minmax(0,1fr)) !important; gap:3px !important; margin-top:5px !important; }
      #v111-ocp .drug-breakdown span { display:flex !important; justify-content:space-between !important; gap:5px !important; padding:4px 5px !important; border-radius:4px !important; background:#182b3a !important; }
      #v111-ocp .drug-breakdown b { color:#b9d4e8 !important; text-transform:capitalize !important; }
      #v111-ocp .analytics-trends { display:grid !important; gap:4px !important; }
      #v111-ocp .analytics-trends > div { display:grid !important; grid-template-columns:minmax(78px,1fr) repeat(3,minmax(0,1fr)) !important; gap:4px !important; padding:5px !important; border-radius:5px !important; background:#182b3a !important; }
      #v111-ocp .analytics-trends span { color:#c3d5e4 !important; font-size:9px !important; text-align:right !important; overflow-wrap:anywhere !important; }
      #v111-ocp .member-history-section { margin:9px 0 !important; padding:8px !important; border:1px solid #395c75 !important; border-radius:7px !important; background:#101d28 !important; }
      #v111-ocp .member-history-section h4 { margin:0 0 6px !important; color:#f2c94c !important; }
      #v111-ocp .history-summary { display:grid !important; grid-template-columns:repeat(3,minmax(0,1fr)) !important; gap:4px !important; margin-bottom:6px !important; }
      #v111-ocp .history-summary > div { display:grid !important; gap:2px !important; min-width:0 !important; padding:5px !important; border-radius:5px !important; background:#182b3a !important; }
      #v111-ocp .history-summary span { color:#9fb5c8 !important; font-size:8px !important; }
      #v111-ocp .history-summary b { color:#fff !important; font-size:11px !important; overflow-wrap:anywhere !important; }
      #v111-ocp .member-war-list { display:grid !important; gap:5px !important; }
      #v111-ocp .member-war-row { display:grid !important; gap:4px !important; min-width:0 !important; padding:6px !important; border:1px solid #29475e !important; border-radius:6px !important; background:#152837 !important; }
      #v111-ocp .member-war-head { display:flex !important; align-items:center !important; justify-content:space-between !important; gap:6px !important; min-width:0 !important; }
      #v111-ocp .member-war-head > b { min-width:0 !important; color:#e8f3fc !important; overflow:hidden !important; text-overflow:ellipsis !important; white-space:nowrap !important; }
      #v111-ocp .history-outcome { flex:0 0 auto !important; padding:2px 5px !important; border-radius:999px !important; background:#30465a !important; color:#d8e5ef !important; font-size:8px !important; font-style:normal !important; font-weight:900 !important; text-transform:uppercase !important; }
      #v111-ocp .history-outcome.won { background:#1d603c !important; color:#c8f5d9 !important; }
      #v111-ocp .history-outcome.lost { background:#722f38 !important; color:#ffd5da !important; }
      #v111-ocp .history-outcome.active { background:#705a25 !important; color:#fff0b7 !important; }
      #v111-ocp .member-war-row > small { color:#90a9bc !important; }
      #v111-ocp .member-war-metrics { display:grid !important; grid-template-columns:repeat(4,minmax(0,1fr)) !important; gap:3px !important; }
      #v111-ocp .member-war-metrics span { display:grid !important; gap:1px !important; padding:4px !important; border-radius:4px !important; background:#0f1d28 !important; color:#9fb5c8 !important; font-size:8px !important; text-align:center !important; }
      #v111-ocp .member-war-metrics b { color:#fff !important; font-size:10px !important; }
      #v111-ocp .member-war-payout { padding:4px 5px !important; border-radius:4px !important; background:#202f3b !important; color:#afc0cd !important; font-size:9px !important; font-weight:800 !important; }
      #v111-ocp .member-war-payout.finalized { background:#173b29 !important; color:#c4f3d5 !important; }
      #v111-ocp .analytics-consent { display:flex !important; align-items:flex-start !important; gap:7px !important; grid-column:1 / -1 !important; padding:7px !important; border:1px solid #3c5a70 !important; border-radius:6px !important; background:#132431 !important; color:#c5d7e5 !important; font-size:10px !important; line-height:1.35 !important; }
      #v111-ocp .analytics-consent input { flex:0 0 auto !important; width:16px !important; height:16px !important; margin:1px 0 0 !important; }
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
        #v111-ocp .member-summary { grid-template-columns:repeat(2,minmax(0,1fr)) !important; gap:3px !important; }
        #v111-ocp .member-summary > div { padding:5px 3px !important; }
        #v111-ocp .member-summary b { font-size:13px !important; }
        #v111-ocp .member-tools { display:grid !important; grid-template-columns:repeat(2,minmax(0,1fr)) !important; }
        #v111-ocp .member-tools > * { min-width:0 !important; width:100% !important; }
        #v111-ocp .member-tools #v111-member-search { grid-column:1 / -1 !important; }
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
        #v111-ocp button.member-row { align-items:flex-start !important; flex-direction:column !important; gap:4px !important; }
        #v111-ocp .member-tags { justify-content:flex-start !important; }
        #v111-ocp .queue-row { align-items:flex-start !important; }
        #v111-ocp .queue-right { align-items:flex-end !important; flex-direction:column !important; }
        #v111-ocp .member-modal { right:6vw !important; width:min(88vw,360px) !important; max-height:40vh !important; padding:7px !important; font-size:10px !important; }
        #v111-ocp .profile-status { margin:5px 0 !important; padding:5px !important; }
        #v111-ocp .member-analytics-section { margin:5px 0 !important; padding:5px !important; }
        #v111-ocp .member-history-section { margin:5px 0 !important; padding:5px !important; }
        #v111-ocp .history-summary { gap:3px !important; }
        #v111-ocp .member-war-metrics { grid-template-columns:repeat(2,minmax(0,1fr)) !important; }
        #v111-ocp .analytics-trends > div { grid-template-columns:1fr !important; }
        #v111-ocp .analytics-trends span { text-align:left !important; }
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
