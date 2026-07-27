// ==UserScript==
// @name         Vault 111 Control Center
// @namespace    https://www.torn.com/
// @version      3.6.0-alpha.4
// @description  Vault 111 administration, scheduling, dashboard, OC planning, war tracking, payouts, and member analytics.
// @author       Vault 111
// @downloadURL  https://raw.githubusercontent.com/Zabok08/Vault-111/main/Vault-111-Control-Center.user.js
// @updateURL    https://raw.githubusercontent.com/Zabok08/Vault-111/main/Vault-111-Control-Center.user.js
// @match        https://www.torn.com/*
// @match        https://torn.com/*
// @match        https://*.torn.com/*
// @connect      vault111-control-center.onrender.com
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_addStyle
// @grant        GM_notification
// @run-at       document-idle
// ==/UserScript==

(() => {
  'use strict';

  const CLIENT_VERSION = '3.6.0-alpha.4';
  const INSTANCE_MARKER_ID = 'v111-control-center-singleton';
  const existingMarker = document.getElementById(INSTANCE_MARKER_ID);
  const existingPanel = document.getElementById('v111-ocp');
  if (existingMarker && existingPanel && existingMarker.dataset.version === CLIENT_VERSION) return;
  if (existingMarker && existingPanel) existingPanel.remove();
  if (existingMarker && !existingPanel) {
    const startedAt = Number(existingMarker.dataset.startedAt || 0);
    if (startedAt && Date.now() - startedAt < 10_000) return;
  }
  existingMarker?.remove();
  const instanceMarker = document.createElement('meta');
  instanceMarker.id = INSTANCE_MARKER_ID;
  instanceMarker.dataset.version = CLIENT_VERSION;
  instanceMarker.dataset.startedAt = String(Date.now());
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
    backendStatsLastAutoSync: 'v111_v3_stats_last_auto_sync',
    plannerLastAutoSync: 'v111_v3_planner_last_auto_sync',
    scheduleNotificationLog: 'v111_v3_schedule_notification_log'
  };
  const STATS_AUTO_SYNC_INTERVAL_MS = 5 * 60 * 1000;
  const PLANNER_AUTO_SYNC_INTERVAL_MS = 5 * 60 * 1000;
  const CRIME_URL = 'https://www.torn.com/factions.php?step=your&type=1#/tab=crimes';
  const WAR_URL = 'https://www.torn.com/factions.php?step=your&type=1#/tab=war/rank';
  const FACTION_PAYOUT_URL = 'https://www.torn.com/factions.php?step=your#/tab=controls&option=give-to-user';
  const TAB_IDS = ['dashboard', 'plan', 'members', 'war', 'payouts', 'schedule', 'admin', 'backend', 'settings'];
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
      dashboardSnapshot: null,
      scheduleSnapshot: null,
      adminSnapshot: null,
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
      scheduleStatus: null,
      adminStatus: null,
      backendStatus: null,
      settingsStatus: null,
      busyLabel: '',
      modalMemberId: null,
      announcementFormOpen: false,
      editingAnnouncementId: null,
      scheduleEventFormOpen: false,
      editingScheduleEventId: null,
      scheduleFilter: 'upcoming',
      scheduleToast: null,
      adminUserSearch: '',
      adminAuditFilter: 'all'
    }
  };

  state.cache = normalizeCache(state.cache);
  state.settings = Object.assign({ collapsed:false, collapsedPosition:null, planningOpen:true, showBreakdown:true, filter:'all', autoRefresh:false, refreshMinutes:5, compact:false }, isPlainRecord(state.settings) ? state.settings : {});
  state.overrides = isPlainRecord(state.overrides) ? state.overrides : {};
  // Remove obsolete locally stored API keys from pre-backend releases.
  removeStoredValue('v111_ocp_keys_v1');
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
  let stableMobileViewportHeight = 0;
  let renderRecoveryAttempted = false;

  syncMountToPage();
  configureAutoRefresh();
  restoreBackendSession();
  window.addEventListener('hashchange', syncMountToPage);
  window.addEventListener('popstate', syncMountToPage);
  window.addEventListener('pageshow', () => {
    syncMountToPage();
    ensurePanelVisible();
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      syncMountToPage();
      ensurePanelVisible();
    }
  });
  window.addEventListener('resize', () => syncMobileViewport());
  window.visualViewport?.addEventListener('resize', () => syncMobileViewport());
  window.visualViewport?.addEventListener('scroll', () => syncMobileViewport());
  document.addEventListener('focusin', event => {
    if (root?.contains(event.target)) setTimeout(() => syncMobileViewport(), 60);
  });
  document.addEventListener('focusout', event => {
    if (root?.contains(event.target)) setTimeout(() => syncMobileViewport(), 300);
  });
  setInterval(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      syncMountToPage();
    }
  }, 500);
  setInterval(updateCrimeCountdowns, 1000);
  setInterval(checkScheduleReminders, 30000);

  function isFactionPage() {
    const path = location.pathname.toLowerCase().replace(/\/+$/, '');
    if (/\/factions?\.php$/.test(path) || /\/factions?$/.test(path)) return true;
    const params = new URLSearchParams(location.search);
    const routeHint = [
      params.get('sid'),
      params.get('page'),
      params.get('section'),
      params.get('route')
    ].filter(Boolean).join(' ').toLowerCase();
    if (/(^|[^a-z])factions?([^a-z]|$)/.test(routeHint)) return true;
    return /(^|[#/])factions?(?:[/=&]|$)/i.test(location.hash);
  }

  function isPlainRecord(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
  }

  function emptyCache() {
    return { members: [], crimes: [], syncedAt: 0 };
  }

  function normalizeCache(value) {
    if (!isPlainRecord(value)) return emptyCache();
    const syncedAt = Number(value.syncedAt || 0);
    return {
      members: Array.isArray(value.members) ? value.members : [],
      crimes: Array.isArray(value.crimes) ? value.crimes : [],
      syncedAt: Number.isFinite(syncedAt) ? syncedAt : 0
    };
  }

  function showBootstrapStatus() {
    if (!root) return;
    root.dataset.v111Bootstrap = 'true';
    root.style.cssText = [
      'position:fixed!important',
      'right:8px!important',
      'top:18vh!important',
      'z-index:2147483646!important',
      'display:block!important',
      'visibility:visible!important',
      'opacity:1!important',
      'width:min(94vw,380px)!important',
      'padding:12px!important',
      'border:1px solid #2d5d91!important',
      'border-radius:10px!important',
      'background:#111820!important',
      'color:#eef5ff!important',
      'font:13px/1.4 system-ui,-apple-system,\"Segoe UI\",Arial,sans-serif!important',
      'box-shadow:0 12px 40px rgba(0,0,0,.75)!important'
    ].join(';');
    root.innerHTML = '<strong style="display:block;color:#fff">Vault 111 Control Center</strong><small style="display:block;margin-top:3px;color:#b7c8d9">Loading mobile interface…</small>';
  }

  function clearBootstrapStyles() {
    if (!root || root.dataset.v111Bootstrap !== 'true') return;
    root.removeAttribute('style');
    delete root.dataset.v111Bootstrap;
  }

  function showStartupFailure(error) {
    if (!root) return;
    root.className = '';
    root.dataset.v111Bootstrap = 'true';
    root.style.cssText = [
      'position:fixed!important',
      'right:8px!important',
      'top:12vh!important',
      'z-index:2147483646!important',
      'display:block!important',
      'visibility:visible!important',
      'opacity:1!important',
      'width:min(94vw,390px)!important',
      'padding:12px!important',
      'border:1px solid #cc6b6b!important',
      'border-radius:10px!important',
      'background:#181114!important',
      'color:#fff!important',
      'font:13px/1.45 system-ui,-apple-system,\"Segoe UI\",Arial,sans-serif!important',
      'box-shadow:0 12px 40px rgba(0,0,0,.8)!important'
    ].join(';');
    root.innerHTML = `
      <strong style="display:block;font-size:15px">Vault 111 needs to recover</strong>
      <span style="display:block;margin:6px 0;color:#ffd7d7">The interface could not finish loading on this device. Your API key connection is still saved.</span>
      <small style="display:block;margin-bottom:8px;color:#d7b8bd">${esc(friendly(error))}</small>
      <button type="button" data-v111-reload style="margin-right:6px;padding:7px 10px;border:0;border-radius:6px;background:#2d6da8;color:#fff;font-weight:700">Reload Torn</button>
      <button type="button" data-v111-clear-cache style="padding:7px 10px;border:1px solid #8d6570;border-radius:6px;background:#302027;color:#fff;font-weight:700">Clear display cache</button>`;
    root.querySelector('[data-v111-reload]')?.addEventListener('click', () => location.reload());
    root.querySelector('[data-v111-clear-cache]')?.addEventListener('click', () => {
      state.cache = emptyCache();
      state.overrides = {};
      save(STORE.cache, state.cache);
      save(STORE.overrides, state.overrides);
      location.reload();
    });
  }

  function syncMountToPage() {
    if (isFactionPage() && !dismissedUntilReload) {
      const existingRoot = document.getElementById('v111-ocp');
      if (existingRoot && existingRoot !== root) {
        if (existingRoot.dataset.v111Version === CLIENT_VERSION) return;
        existingRoot.remove();
      }
      if (!root || !root.isConnected) {
        root = document.createElement('section');
        root.id = 'v111-ocp';
        root.dataset.v111Version = CLIENT_VERSION;
        root.setAttribute('role', 'region');
        root.setAttribute('aria-label', 'Vault 111 Control Center');
        (document.body || document.documentElement).appendChild(root);
        showBootstrapStatus();
        render();
        syncMobileViewport(true);
        ensurePanelVisible();
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

  function usesMobileLayout() {
    return window.matchMedia?.('(max-width:700px), (pointer:coarse) and (max-width:900px)').matches ?? false;
  }

  function isPlannerEditor(element) {
    return element instanceof Element &&
      root?.contains(element) &&
      Boolean(element.matches('input, textarea, select, [contenteditable="true"]'));
  }

  function syncMobileViewport(forceStable = false) {
    if (!root?.isConnected) return;
    const viewport = window.visualViewport;
    const height = Math.max(1, Number(viewport?.height || window.innerHeight || 1));
    const offsetTop = Math.max(0, Number(viewport?.offsetTop || 0));
    const mobile = usesMobileLayout();
    if (!mobile) {
      stableMobileViewportHeight = height;
      root.classList.remove('keyboard-open');
      for (const property of ['--v111-mobile-panel-height', '--v111-mobile-panel-top', '--v111-visual-height']) {
        root.style.removeProperty(property);
      }
      if (state.settings.collapsed) applyCollapsedPosition();
      return;
    }

    const editorFocused = isPlannerEditor(document.activeElement);
    if (
      forceStable ||
      !stableMobileViewportHeight ||
      (!editorFocused && height >= stableMobileViewportHeight * 0.8)
    ) {
      stableMobileViewportHeight = height;
    }
    const keyboardOpen =
      editorFocused &&
      stableMobileViewportHeight - height >= Math.max(100, stableMobileViewportHeight * 0.18);
    const restingPanelHeight = Math.max(220, Math.min(420, stableMobileViewportHeight * 0.4));
    const visiblePanelHeight = Math.min(restingPanelHeight, Math.max(180, height - 12));
    const top = offsetTop + Math.max(6, (height - visiblePanelHeight) / 2);

    root.classList.toggle('keyboard-open', keyboardOpen);
    root.style.setProperty('--v111-mobile-panel-height', `${Math.round(visiblePanelHeight)}px`);
    root.style.setProperty('--v111-mobile-panel-top', `${Math.round(top)}px`);
    root.style.setProperty('--v111-visual-height', `${Math.round(height)}px`);
    if (state.settings.collapsed) applyCollapsedPosition();
  }

  function ensurePanelVisible() {
    if (!root?.isConnected || !usesMobileLayout()) return;
    requestAnimationFrame(() => {
      if (!root?.isConnected) return;
      const viewport = window.visualViewport;
      const left = Math.max(0, Number(viewport?.offsetLeft || 0));
      const top = Math.max(0, Number(viewport?.offsetTop || 0));
      const right = left + Math.max(1, Number(viewport?.width || window.innerWidth));
      const bottom = top + Math.max(1, Number(viewport?.height || window.innerHeight));
      const rect = root.getBoundingClientRect();
      const intersects =
        rect.width > 0 &&
        rect.height > 0 &&
        rect.right > left &&
        rect.left < right &&
        rect.bottom > top &&
        rect.top < bottom;
      if (intersects) return;

      stableMobileViewportHeight = Math.max(1, Number(viewport?.height || window.innerHeight));
      if (state.settings.collapsed) {
        state.settings.collapsedPosition = {
          left: Math.max(left + 8, right - Math.max(1, root.offsetWidth || 240) - 8),
          top: Math.max(top + 8, top + (bottom - top - Math.max(1, root.offsetHeight || 48)) / 2)
        };
        save(STORE.settings, state.settings);
        applyCollapsedPosition(true);
      } else {
        for (const property of ['left', 'top', 'right', 'bottom', 'transform']) {
          root.style.removeProperty(property);
        }
        syncMobileViewport(true);
      }
    });
  }

  function render() {
    if (!root || !root.isConnected) return;
    try {
      renderUnsafe();
      renderRecoveryAttempted = false;
    } catch (error) {
      console.error('[Vault 111] Control Center render failed.', error);
      if (!renderRecoveryAttempted) {
        renderRecoveryAttempted = true;
        state.cache = emptyCache();
        state.overrides = {};
        save(STORE.cache, state.cache);
        save(STORE.overrides, state.overrides);
        try {
          renderUnsafe();
          return;
        } catch (retryError) {
          console.error('[Vault 111] Control Center recovery render failed.', retryError);
          showStartupFailure(retryError);
          return;
        }
      }
      showStartupFailure(error);
    }
  }

  function renderUnsafe() {
    if (!root || !root.isConnected) return;
    clearBootstrapStyles();
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
          <small>v3.6 alpha.4 · ${state.backend.connected ? '<b class="backend-label">BACKEND CONNECTED</b> · ' : ''}${syncedAt ? `Synced ${new Date(syncedAt).toLocaleString()}` : 'Not synced'}</small>
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
          <button class="${isActive('schedule') ? 'active' : ''}" data-tab="schedule" ${tabAttributes('schedule')}>Schedule</button>
          ${backendCanAdminRead() ? `<button class="${isActive('admin') ? 'active' : ''}" data-tab="admin" ${tabAttributes('admin')}>Admin</button>` : ''}
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
          <section data-pane="schedule" ${paneAttributes('schedule')}>
            ${renderSchedulePanel()}
          </section>
          <section data-pane="admin" ${paneAttributes('admin')}>
            ${renderAdminPanel()}
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
      <div id="v111-schedule-toast" class="schedule-toast"${state.ui.scheduleToast?.until > Date.now() ? '' : ' hidden'} role="status" aria-live="assertive" aria-atomic="true">${esc(state.ui.scheduleToast?.message || '')}</div>
      <div id="v111-announcer" class="sr-only" role="status" aria-live="polite" aria-atomic="true"></div>`;

    applyCollapsedPosition();
    syncMobileViewport();
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
    // Optimizer suggestions do not fill a Torn slot. Count every role that is actually empty there.
    const unfilled = openSlots.length;
    const readinessValues = planning.map(crimeReadiness);
    const avgReadiness = readinessValues.length ? Math.round(readinessValues.reduce((a,b)=>a+b,0) / readinessValues.length) : 0;
    const ready = readinessValues.filter(v => v >= 80).length;
    const occupied = members.filter(m => m.isInOc).length;
    const available = members.filter(m => m.apiStatus === 'ok' && !m.isInOc).length;
    return { planning: planning.length, openRoles: openSlots.length, filled: filled.length, unfilled, avgReadiness, ready, occupied, available };
  }

  function announcementDateInput(value) {
    const time = timestampMs(value);
    if (!time) return '';
    const date = new Date(time - new Date(time).getTimezoneOffset() * 60_000);
    return date.toISOString().slice(0, 16);
  }

  function renderAnnouncementComposer(snapshot) {
    if (!backendCanAnnouncements()) return '';
    const editing = (snapshot?.announcements || []).find(
      announcement => announcement.id === state.ui.editingAnnouncementId
    );
    if (!state.ui.announcementFormOpen && !editing) {
      return `<button class="mini announcement-new" data-act="announcement-new"${busyAttributes()}>New announcement</button>`;
    }
    return `<form id="v111-announcement-form" class="announcement-form">
      <input type="hidden" id="v111-announcement-id" value="${esc(editing?.id || '')}">
      <input type="hidden" id="v111-announcement-version" value="${Number(editing?.version || 0)}">
      <label>Title
        <input id="v111-announcement-title" type="text" minlength="3" maxlength="120" required value="${esc(editing?.title || '')}" placeholder="Faction update">
      </label>
      <label class="wide">Message
        <textarea id="v111-announcement-body" minlength="1" maxlength="2000" required placeholder="Write the announcement for faction members">${esc(editing?.body || '')}</textarea>
      </label>
      <label>Expires
        <input id="v111-announcement-expires" type="datetime-local" value="${esc(announcementDateInput(editing?.expiresAt))}">
      </label>
      <label class="announcement-pin"><input id="v111-announcement-pinned" type="checkbox" ${editing?.pinned ? 'checked' : ''}> Pin to the top</label>
      <div class="toolbar wide">
        <button class="primary" type="submit"${busyAttributes()}>${editing ? 'Save changes' : 'Publish announcement'}</button>
        <button type="button" data-act="announcement-cancel"${busyAttributes()}>Cancel</button>
      </div>
    </form>`;
  }

  function renderDashboardAnnouncements(snapshot) {
    if (!state.backend.connected) {
      return `<section class="dashboard-section announcements-panel">
        <div class="dashboard-section-head"><h3>Announcements</h3></div>
        <p class="notice">Connect on the API Key screen to view faction announcements.</p>
      </section>`;
    }
    if (!snapshot) {
      return `<section class="dashboard-section announcements-panel" aria-busy="true">
        <div class="dashboard-section-head"><h3>Announcements</h3></div>
        <p class="notice">Loading the shared faction dashboard…</p>
      </section>`;
    }
    const announcements = snapshot.announcements || [];
    return `<section class="dashboard-section announcements-panel">
      <div class="dashboard-section-head">
        <div><h3>Announcements</h3><small>${announcements.length} active</small></div>
        ${!state.ui.announcementFormOpen && !state.ui.editingAnnouncementId ? renderAnnouncementComposer(snapshot) : ''}
      </div>
      ${state.ui.announcementFormOpen || state.ui.editingAnnouncementId ? renderAnnouncementComposer(snapshot) : ''}
      <div class="announcement-list">${announcements.length ? announcements.map(announcement => `
        <article class="announcement-card ${announcement.pinned ? 'pinned' : ''}">
          <div class="announcement-title">
            <div>${announcement.pinned ? '<i>PINNED</i>' : ''}<h4>${esc(announcement.title)}</h4></div>
            ${backendCanAnnouncements() ? `<div class="announcement-actions">
              <button class="mini" data-edit-announcement="${esc(announcement.id)}"${busyAttributes()}>Edit</button>
              <button class="mini danger" data-delete-announcement="${esc(announcement.id)}" data-announcement-version="${Number(announcement.version)}"${busyAttributes()}>Delete</button>
            </div>` : ''}
          </div>
          <p>${esc(announcement.body)}</p>
          <small>Posted by ${esc(announcement.createdBy?.name || 'Vault 111 officer')} · ${formatRelativeDate(announcement.createdAt)}${announcement.expiresAt ? ` · Expires ${esc(new Date(announcement.expiresAt).toLocaleString())}` : ''}${timestampMs(announcement.updatedAt) > timestampMs(announcement.createdAt) + 1000 ? ` · Updated ${formatRelativeDate(announcement.updatedAt)}` : ''}</small>
        </article>`).join('') : '<div class="empty">No active faction announcements.</div>'}</div>
    </section>`;
  }

  const SCHEDULE_EVENT_LABELS = {
    CHAIN: 'Chain',
    RANKED_WAR: 'Ranked War',
    OC: 'Organized Crime',
    FACTION: 'Faction',
    MEETING: 'Meeting',
    OTHER: 'Other'
  };

  function scheduleEventLabel(type) {
    return SCHEDULE_EVENT_LABELS[String(type || '').toUpperCase()] || 'Event';
  }

  function scheduleDateInput(value) {
    return announcementDateInput(value);
  }

  function eventCountdown(value) {
    const time = timestampMs(value);
    if (!time) return 'Time unavailable';
    const difference = time - Date.now();
    const absolute = Math.abs(difference);
    const minutes = Math.floor(absolute / 60_000);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    const label = days
      ? `${days}d ${hours % 24}h`
      : hours
        ? `${hours}h ${minutes % 60}m`
        : `${Math.max(1, minutes)}m`;
    return difference >= 0 ? `Starts in ${label}` : `Started ${label} ago`;
  }

  function upcomingScheduleEvents(snapshot, limit = 5) {
    const now = Date.now();
    return (snapshot?.events || [])
      .filter(event => timestampMs(event.startsAt) >= now)
      .sort((a, b) => timestampMs(a.startsAt) - timestampMs(b.startsAt))
      .slice(0, limit);
  }

  function renderDashboardUpcomingEvents(snapshot) {
    if (!state.backend.connected) return '';
    if (!snapshot) {
      return `<section class="dashboard-section upcoming-events-panel" aria-busy="true">
        <div class="dashboard-section-head"><h3>Upcoming events</h3></div>
        <p class="notice">Loading the shared faction schedule…</p>
      </section>`;
    }
    const events = upcomingScheduleEvents(snapshot, 5);
    return `<section class="dashboard-section upcoming-events-panel">
      <div class="dashboard-section-head">
        <div><h3>Upcoming events</h3><small>${events.length} shown</small></div>
        <button class="mini" data-jump="schedule">Open Schedule</button>
      </div>
      <div class="dashboard-event-list">${events.length ? events.map(event => `
        <article class="dashboard-event-row ${String(event.type).toLowerCase()}">
          <i>${esc(scheduleEventLabel(event.type))}</i>
          <span><b>${esc(event.title)}</b><small>${esc(new Date(event.startsAt).toLocaleString())}</small></span>
          <strong data-event-countdown="${esc(event.id)}">${esc(eventCountdown(event.startsAt))}</strong>
        </article>`).join('') : '<div class="empty">No upcoming scheduled events.</div>'}</div>
    </section>`;
  }

  function renderScheduleEventForm(snapshot) {
    const allowedTypes = snapshot?.permissions?.allowedEventTypes || [];
    const editing = (snapshot?.events || []).find(
      event => event.id === state.ui.editingScheduleEventId && event.source === 'manual'
    );
    if (!allowedTypes.length) return '';
    if (!state.ui.scheduleEventFormOpen && !editing) {
      return `<button class="primary mini" data-act="schedule-new"${busyAttributes()}>New event</button>`;
    }
    const selectedType = editing?.type && allowedTypes.includes(editing.type)
      ? editing.type
      : allowedTypes[0];
    return `<form id="v111-schedule-event-form" class="schedule-event-form">
      <input type="hidden" id="v111-schedule-event-id" value="${esc(editing?.id || '')}">
      <input type="hidden" id="v111-schedule-event-version" value="${Number(editing?.version || 0)}">
      <label>Event type
        <select id="v111-schedule-event-type" required>
          ${allowedTypes.map(type => `<option value="${esc(type)}" ${type === selectedType ? 'selected' : ''}>${esc(scheduleEventLabel(type))}</option>`).join('')}
        </select>
      </label>
      <label>Title
        <input id="v111-schedule-event-title" type="text" minlength="3" maxlength="120" required value="${esc(editing?.title || '')}" placeholder="Faction event">
      </label>
      <label class="wide">Description
        <textarea id="v111-schedule-event-description" maxlength="2000" placeholder="Optional event details">${esc(editing?.description || '')}</textarea>
      </label>
      <label>Starts
        <input id="v111-schedule-event-start" type="datetime-local" required value="${esc(scheduleDateInput(editing?.startsAt))}">
      </label>
      <label>Ends
        <input id="v111-schedule-event-end" type="datetime-local" value="${esc(scheduleDateInput(editing?.endsAt))}">
      </label>
      <div class="toolbar wide">
        <button class="primary" type="submit"${busyAttributes()}>${editing ? 'Save event' : 'Create event'}</button>
        <button type="button" data-act="schedule-cancel"${busyAttributes()}>Cancel</button>
      </div>
    </form>`;
  }

  function renderNotificationPreferences(snapshot) {
    const preference = snapshot?.preferences;
    if (!preference) return '';
    return `<details class="notification-preferences">
      <summary>My notification preferences</summary>
      <form id="v111-notification-preferences">
        <label class="setting-row"><input id="v111-notifications-enabled" type="checkbox" ${preference.enabled ? 'checked' : ''}> Enable schedule reminders</label>
        <label class="setting-row"><input id="v111-browser-notifications" type="checkbox" ${preference.browserNotifications ? 'checked' : ''}> Show Tampermonkey browser notifications</label>
        <fieldset>
          <legend>Event types</legend>
          ${Object.entries(SCHEDULE_EVENT_LABELS).map(([type, label]) => `<label><input type="checkbox" data-notification-event-type="${type}" ${preference.eventTypes?.includes(type) ? 'checked' : ''}> ${esc(label)}</label>`).join('')}
        </fieldset>
        <label>Reminder minutes before an event
          <input id="v111-reminder-minutes" type="text" inputmode="numeric" maxlength="40" value="${esc((preference.reminderMinutes || [60,15]).join(', '))}" placeholder="60, 15">
        </label>
        <button class="primary" type="submit"${busyAttributes()}>Save my preferences</button>
        <p class="notice">Browser notifications work while Torn is open. The free Render server does not provide reliable offline push delivery.</p>
      </form>
    </details>`;
  }

  function renderSchedulePanel() {
    if (!state.backend.connected) {
      return `<div class="schedule-empty">
        <h3>Faction Scheduler</h3>
        <p class="notice">Connect your own API key to view shared faction events and configure reminders.</p>
        <button class="primary" data-jump="backend">Open API Key</button>
      </div>`;
    }
    const snapshot = state.backend.scheduleSnapshot;
    if (!snapshot) {
      return `<div class="toolbar"><button class="primary" data-act="schedule-refresh"${busyAttributes()}>Load Schedule</button></div>
        ${renderStatusRegion('v111-schedule-status', state.ui.scheduleStatus)}
        <div class="empty">The shared schedule has not loaded yet.</div>`;
    }
    const filter = state.ui.scheduleFilter || 'upcoming';
    const now = Date.now();
    const events = (snapshot.events || []).filter(event => {
      if (filter === 'upcoming') return timestampMs(event.startsAt) >= now;
      if (filter === 'all') return true;
      return event.type === filter;
    });
    return `<div class="schedule-toolbar">
      <div class="toolbar">
        <button data-act="schedule-refresh"${busyAttributes()}>Refresh</button>
        ${!state.ui.scheduleEventFormOpen && !state.ui.editingScheduleEventId ? renderScheduleEventForm(snapshot) : ''}
      </div>
      <label>Show
        <select id="v111-schedule-filter">
          <option value="upcoming" ${filter === 'upcoming' ? 'selected' : ''}>Upcoming</option>
          <option value="all" ${filter === 'all' ? 'selected' : ''}>Recent & upcoming</option>
          ${Object.entries(SCHEDULE_EVENT_LABELS).map(([type, label]) => `<option value="${type}" ${filter === type ? 'selected' : ''}>${esc(label)}</option>`).join('')}
        </select>
      </label>
    </div>
    ${state.ui.scheduleEventFormOpen || state.ui.editingScheduleEventId ? renderScheduleEventForm(snapshot) : ''}
    ${renderStatusRegion('v111-schedule-status', state.ui.scheduleStatus)}
    <div class="schedule-summary">
      <div><b>${formatNumber(upcomingScheduleEvents(snapshot, 100).length)}</b><span>Upcoming</span></div>
      <div><b>${formatNumber((snapshot.events || []).filter(event => event.source === 'automatic').length)}</b><span>Automatic</span></div>
      <div><b>${snapshot.preferences?.enabled ? 'On' : 'Off'}</b><span>My reminders</span></div>
    </div>
    <div class="schedule-event-list">${events.length ? events.map(event => `
      <article class="schedule-event-card ${String(event.type).toLowerCase()} ${event.source}">
        <div class="schedule-event-head">
          <div><i>${esc(scheduleEventLabel(event.type))}</i>${event.source === 'automatic' ? '<em>AUTO</em>' : ''}<h3>${esc(event.title)}</h3></div>
          ${event.editable ? `<div>
            <button class="mini" data-edit-schedule-event="${esc(event.id)}"${busyAttributes()}>Edit</button>
            <button class="mini danger" data-delete-schedule-event="${esc(event.id)}" data-event-version="${Number(event.version)}"${busyAttributes()}>Delete</button>
          </div>` : ''}
        </div>
        ${event.description ? `<p>${esc(event.description)}</p>` : ''}
        <div class="schedule-event-time">
          <b>${esc(new Date(event.startsAt).toLocaleString())}</b>
          <span data-event-countdown="${esc(event.id)}">${esc(eventCountdown(event.startsAt))}</span>
          ${event.endsAt ? `<small>Ends ${esc(new Date(event.endsAt).toLocaleString())}</small>` : ''}
        </div>
        ${event.createdBy?.name ? `<small>Created by ${esc(event.createdBy.name)}${timestampMs(event.updatedAt) > timestampMs(event.createdAt) + 1000 ? ` · Updated ${formatRelativeDate(event.updatedAt)}` : ''}</small>` : ''}
      </article>`).join('') : '<div class="empty">No events match this filter.</div>'}</div>
    ${renderNotificationPreferences(snapshot)}`;
  }

  const ADMIN_ROLE_LABELS = {
    OWNER: 'Owner',
    ADMIN: 'Administrator',
    OC_PLANNER: 'OC Planner',
    WAR_MANAGER: 'War Manager',
    OFFICER: 'Officer',
    MEMBER: 'Member'
  };

  function adminRoleLabel(role) {
    return ADMIN_ROLE_LABELS[String(role || '').toUpperCase()] || 'Member';
  }

  function adminAuditCategory(action) {
    const value = String(action || '').toLowerCase();
    if (value.startsWith('admin.')) return 'admin';
    if (value.startsWith('auth.')) return 'auth';
    if (value.includes('.sync')) return 'sync';
    return 'activity';
  }

  function renderAdminPanel() {
    if (!state.backend.connected) {
      return `<div class="admin-empty">
        <h3>Administration &amp; Permissions</h3>
        <p class="notice">Connect your own API key to verify your Control Center role.</p>
        <button class="primary" data-jump="backend">Open API Key</button>
      </div>`;
    }
    if (!backendCanAdminRead()) {
      return `<div class="empty">Administration is available only to the Vault 111 Owner and Administrators.</div>`;
    }
    const snapshot = state.backend.adminSnapshot;
    if (!snapshot) {
      return `<div class="toolbar"><button class="primary" data-act="admin-refresh"${busyAttributes()}>Load Administration</button></div>
        ${renderStatusRegion('v111-admin-status', state.ui.adminStatus)}
        <div class="empty">Administrative data has not loaded yet.</div>`;
    }
    const canManage = Boolean(snapshot.permissions?.canManage);
    const roles = snapshot.permissions?.assignableRoles || ['ADMIN', 'OC_PLANNER', 'WAR_MANAGER', 'OFFICER', 'MEMBER'];
    const auditEvents = snapshot.audit || [];
    return `<div class="admin-toolbar toolbar">
        <button data-act="admin-refresh"${busyAttributes()}>Refresh Administration</button>
      </div>
      ${renderStatusRegion('v111-admin-status', state.ui.adminStatus)}
      <div class="admin-summary">
        <div><b>${formatNumber(snapshot.summary?.users)}</b><span>Connected users</span></div>
        <div><b>${formatNumber(snapshot.summary?.connectedKeys)}</b><span>API keys connected</span></div>
        <div><b>${formatNumber(snapshot.summary?.activeSessions)}</b><span>Active sessions</span></div>
        <div class="${Number(snapshot.summary?.suspendedUsers) ? 'warning' : ''}"><b>${formatNumber(snapshot.summary?.suspendedUsers)}</b><span>Suspended</span></div>
      </div>
      <section class="admin-section admin-health">
        <div class="admin-section-head"><div><h3>System health</h3><small>No secret values are displayed</small></div></div>
        <div class="admin-health-grid">
          <article>
            <b>Backend database</b>
            <strong class="healthy">Connected</strong>
            <small>Confirmed by this protected request</small>
          </article>
          <article>
            <b>Faction data</b>
            <strong class="${snapshot.sync?.faction?.lastError ? 'warning' : 'healthy'}">${snapshot.sync?.faction?.lastError ? 'Needs attention' : 'Operational'}</strong>
            <small>${esc(formatRelativeDate(snapshot.sync?.faction?.lastSuccessAt))}${snapshot.sync?.faction?.lastError ? ` · ${esc(snapshot.sync.faction.lastError)}` : ''}</small>
          </article>
          <article>
            <b>Ranked War data</b>
            <strong class="${snapshot.sync?.war?.lastError ? 'warning' : 'healthy'}">${snapshot.sync?.war?.lastError ? 'Needs attention' : 'Operational'}</strong>
            <small>${esc(formatRelativeDate(snapshot.sync?.war?.lastSuccessAt))}${snapshot.sync?.war?.lastError ? ` · ${esc(snapshot.sync.war.lastError)}` : ''}</small>
          </article>
        </div>
      </section>
      <section class="admin-section">
        <div class="admin-section-head">
          <div><h3>Faction position mappings</h3><small>${formatNumber(snapshot.summary?.mappedPositions)} mapped positions</small></div>
          ${canManage ? '<i class="owner-only">Owner-only editing</i>' : '<i>Read-only</i>'}
        </div>
        <p class="admin-help">A mapping applies the selected Control Center role to everyone holding that exact Torn faction position. Saving or removing a mapping signs affected users out so the new permission takes effect immediately.</p>
        <div class="admin-mapping-list">${(snapshot.positions || []).length ? snapshot.positions.map(position => {
          const mapping = position.mapping;
          return `<article class="admin-mapping-row" data-admin-position="${esc(position.factionPosition)}">
            <div><b>${esc(position.factionPosition)}</b><small>${formatNumber(position.memberCount)} active member${Number(position.memberCount) === 1 ? '' : 's'} · ${mapping ? `Mapped to ${esc(adminRoleLabel(mapping.appRole))}` : 'Unmapped (Member)'}</small></div>
            ${canManage ? `<select data-role-mapping-select aria-label="Control Center role for ${esc(position.factionPosition)}">
              ${roles.map(role => `<option value="${esc(role)}" ${role === (mapping?.appRole || 'MEMBER') ? 'selected' : ''}>${esc(adminRoleLabel(role))}</option>`).join('')}
            </select>
            <button class="mini primary" data-save-role-mapping data-mapping-version="${Number(mapping?.version || 0)}"${busyAttributes()}>Save</button>
            ${mapping ? `<button class="mini danger" data-delete-role-mapping data-mapping-version="${Number(mapping.version)}"${busyAttributes()}>Remove</button>` : ''}` : `<strong>${esc(adminRoleLabel(mapping?.appRole || 'MEMBER'))}</strong>`}
          </article>`;
        }).join('') : '<div class="empty">Synchronize faction members to load current Torn positions.</div>'}</div>
      </section>
      <section class="admin-section">
        <div class="admin-section-head">
          <div><h3>Control Center users</h3><small>API connection status only—keys are never shown</small></div>
        </div>
        <label class="sr-only" for="v111-admin-user-search">Search Control Center users</label>
        <input id="v111-admin-user-search" class="admin-search" type="search" value="${esc(state.ui.adminUserSearch)}" placeholder="Search users, positions, or roles">
        <div class="admin-user-list">${(snapshot.users || []).map(user => `
          <article class="admin-user-card ${user.isSuspended ? 'suspended' : ''} ${user.activeFactionMember === false ? 'departed' : ''}" data-admin-user data-admin-user-search="${esc(`${user.name} ${user.tornId} ${user.factionPosition || ''} ${user.role}`.toLowerCase())}">
            <div class="admin-user-main">
              <div><a href="https://www.torn.com/profiles.php?XID=${Number(user.tornId)}" target="_blank" rel="noopener">${esc(user.name)} [${Number(user.tornId)}]</a><small>${esc(user.factionPosition || 'No faction position')}</small></div>
              <span class="admin-role ${String(user.role).toLowerCase()}">${esc(adminRoleLabel(user.role))}</span>
            </div>
            <div class="admin-user-facts">
              <span><b>${user.apiKeyConnected ? 'Connected' : 'Not connected'}</b>API key</span>
              <span><b>${formatNumber(user.activeSessionCount)}</b>Active sessions</span>
              <span><b>${user.analyticsEnabled ? 'Enabled' : 'Disabled'}</b>Analytics</span>
              <span><b>${user.isSuspended ? 'Suspended' : 'Active'}</b>Access</span>
            </div>
            <small>Verified ${esc(formatRelativeDate(user.lastVerifiedAt))}${user.apiKeyUpdatedAt ? ` · Key updated ${esc(formatRelativeDate(user.apiKeyUpdatedAt))}` : ''}${user.activeFactionMember === false ? ' · Not active in the latest faction sync' : ''}</small>
            ${canManage && user.manageable ? `<div class="admin-user-actions">
              <button class="mini ${user.isSuspended ? 'primary' : 'danger'}" data-admin-suspend="${user.isSuspended ? 'false' : 'true'}" data-admin-user-id="${esc(user.id)}" data-admin-user-version="${Number(user.version)}"${busyAttributes()}>${user.isSuspended ? 'Restore access' : 'Suspend access'}</button>
              <button class="mini" data-admin-revoke-sessions data-admin-user-id="${esc(user.id)}" data-admin-user-version="${Number(user.version)}"${busyAttributes()}>Revoke sessions</button>
            </div>` : ''}
          </article>`).join('')}</div>
      </section>
      <section class="admin-section">
        <div class="admin-section-head">
          <div><h3>Audit history</h3><small>Latest ${formatNumber(auditEvents.length)} protected actions</small></div>
          <label>Show
            <select id="v111-admin-audit-filter">
              <option value="all" ${state.ui.adminAuditFilter === 'all' ? 'selected' : ''}>All activity</option>
              <option value="admin" ${state.ui.adminAuditFilter === 'admin' ? 'selected' : ''}>Administration</option>
              <option value="auth" ${state.ui.adminAuditFilter === 'auth' ? 'selected' : ''}>Authentication</option>
              <option value="sync" ${state.ui.adminAuditFilter === 'sync' ? 'selected' : ''}>Synchronizations</option>
              <option value="activity" ${state.ui.adminAuditFilter === 'activity' ? 'selected' : ''}>Other activity</option>
            </select>
          </label>
        </div>
        <div class="admin-audit-list">${auditEvents.length ? auditEvents.map(event => {
          const metadata = event.metadata && Object.keys(event.metadata).length ? JSON.stringify(event.metadata) : '';
          return `<article class="admin-audit-row" data-admin-audit="${esc(adminAuditCategory(event.action))}">
            <div><b>${esc(event.action)}</b><small>${event.actor ? `${esc(event.actor.name)} [${Number(event.actor.tornId)}]` : 'System'} · ${esc(new Date(event.createdAt).toLocaleString())}</small></div>
            <span>${esc(event.resource)}${event.resourceId ? ` · ${esc(event.resourceId)}` : ''}</span>
            ${metadata ? `<details><summary>Details</summary><code>${esc(metadata)}</code></details>` : ''}
          </article>`;
        }).join('') : '<div class="empty">No audit activity is available.</div>'}</div>
      </section>
      <p class="notice admin-security-note">${canManage ? 'Sensitive actions are Owner-only, audited, version-checked, and immediately revoke affected sessions.' : 'Administrators have read-only access here. Only the Owner can change mappings, suspend access, or revoke sessions.'}</p>`;
  }

  function renderUnifiedDashboard(snapshot) {
    if (!state.backend.connected) {
      return `<section class="dashboard-section control-overview">
        <div class="dashboard-section-head"><h3>Faction overview</h3></div>
        <p class="notice">Connect your own API key to load the shared Vault 111 dashboard.</p>
        <button class="primary" data-jump="backend">Open API Key</button>
      </section>`;
    }
    if (!snapshot) {
      return `<section class="dashboard-section control-overview" aria-busy="true">
        <div class="dashboard-section-head"><h3>Faction overview</h3></div>
        <p class="notice">Loading shared war, member, payout, and synchronization summaries…</p>
      </section>`;
    }
    const war = snapshot.war;
    const members = snapshot.members || {};
    const crimes = snapshot.crimes || {};
    const chain = snapshot.chain;
    const payout = snapshot.payout;
    const factionSync = snapshot.sync?.faction;
    const warSync = snapshot.sync?.war;
    const syncErrors = [factionSync?.lastError, warSync?.lastError].filter(Boolean);
    return `<section class="dashboard-section control-overview">
      <div class="dashboard-section-head">
        <div><h3>Faction overview</h3><small>Shared Control Center status</small></div>
        <button class="mini" data-act="dashboard-refresh"${busyAttributes()}>Refresh overview</button>
      </div>
      <div class="control-overview-grid">
        <article class="overview-card war">
          <small>Ranked war</small>
          ${war ? `
            <h4>vs ${esc(war.opponentName)}</h4>
            <b>${formatNumber(war.factionScore)} – ${formatNumber(war.opponentScore)}</b>
            <span data-dashboard-war-countdown>${esc(warCountdownLabel(war))}</span>
          ` : '<h4>No synchronized war</h4><span>Open the War tab for synchronization controls.</span>'}
          <button class="mini" data-jump="war">Open War</button>
        </article>
        <article class="overview-card chain">
          <small>Current chain</small>
          ${Number(chain?.current || 0) > 0 ? `
            <h4>${formatNumber(chain.current)} hit${Number(chain.current) === 1 ? '' : 's'}</h4>
            <b>${formatNumber(chain.current)} / ${formatNumber(Math.max(Number(chain.max || 0), Number(chain.current || 0)))}</b>
            <span data-dashboard-chain-countdown>${esc(chainCountdownLabel(chain))}</span>
          ` : `
            <h4>No active chain</h4>
            <b>${Number(chain?.max || 0) ? `Last count ${formatNumber(chain.max)}` : 'Waiting for faction sync'}</b>
            <span data-dashboard-chain-countdown>${esc(chainCountdownLabel(chain))}</span>
          `}
          <button class="mini" data-jump="war">Open War</button>
        </article>
        <article class="overview-card members">
          <small>Member availability</small>
          <h4>${formatNumber(members.available)} available</h4>
          <b>${formatNumber(members.inOc)} in OC · ${formatNumber(members.hospitalized)} hospital</b>
          <span>${formatNumber(members.traveling)} traveling · ${formatNumber(members.inactive)} inactive</span>
          <button class="mini" data-jump="members">Open Members</button>
        </article>
        <article class="overview-card payout">
          <small>Latest finalized payout</small>
          ${payout ? `
            <h4>${formatMoney(payout.finalTotal)}</h4>
            <b>vs ${esc(payout.opponentName)}</b>
            <span>${formatNumber(payout.membersPaid)} members · ${formatRelativeDate(payout.finalizedAt)}</span>
          ` : '<h4>No finalized payout</h4><span>Finalized war payouts will appear here.</span>'}
          <button class="mini" data-jump="payouts">Open Payouts</button>
        </article>
        <article class="overview-card sync ${syncErrors.length ? 'warning' : ''}">
          <small>Data health</small>
          <h4>${syncErrors.length ? 'Needs attention' : 'Operational'}</h4>
          <b>Faction ${formatRelativeDate(factionSync?.lastSuccessAt)}</b>
          <span>War ${formatRelativeDate(warSync?.lastSuccessAt)} · Analytics ${formatRelativeDate(snapshot.sync?.analyticsLastSuccessAt)}</span>
          ${syncErrors.length ? `<em>${esc(syncErrors[0])}</em>` : ''}
          <button class="mini" data-jump="backend">API & Sync</button>
        </article>
      </div>
      <div class="dashboard-canonical-line">
        <span><b>${formatNumber(crimes.planning)}</b> planning</span>
        <span><b>${formatNumber(crimes.recruiting)}</b> recruiting</span>
        <span><b>${formatNumber(crimes.openRoles)}</b> Torn slots open</span>
        <span><b>${formatNumber(crimes.ready)}</b> ready by time</span>
      </div>
    </section>`;
  }

  function renderDashboard(metrics, plans) {
    const suggestedRole = getMyTopSuggestedRole(plans);
    return `
      ${renderUnifiedDashboard(state.backend.dashboardSnapshot)}
      ${renderDashboardAnnouncements(state.backend.dashboardSnapshot)}
      ${renderDashboardUpcomingEvents(state.backend.scheduleSnapshot)}
      <div class="dashboard-section-head oc-dashboard-heading"><div><h3>OC planning</h3><small>Local optimizer readiness</small></div></div>
      <div class="dashboard-grid">
        <div class="metric"><b>${metrics.planning}</b><span>Planning crimes</span></div>
        <div class="metric"><b>${metrics.ready}</b><span>Strong / ready</span></div>
        <div class="metric"><b>${metrics.available}</b><span>Available with stats</span></div>
        <div class="metric"><b>${metrics.unfilled}</b><span>Torn roles unfilled</span></div>
        <div class="metric wide"><b>${metrics.avgReadiness}%</b><span>Average readiness</span></div>
      </div>
      <div class="dashboard-actions toolbar">
        <button class="primary" data-act="sync"${busyAttributes()}>Sync Data</button>
        <button data-jump="plan">Open Planner</button>
        <button data-act="export">Copy Plan</button>
      </div>
      ${renderStatusRegion('v111-dashboard-status', state.ui.dashboardStatus)}
      ${renderMySuggestedRole(suggestedRole)}`;
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
    const chainCountdown = root.querySelector('[data-dashboard-chain-countdown]');
    if (chainCountdown) {
      chainCountdown.textContent = chainCountdownLabel(state.backend.dashboardSnapshot?.chain);
    }
    root.querySelectorAll('[data-event-countdown]').forEach(element => {
      const event = state.backend.scheduleSnapshot?.events?.find(
        candidate => String(candidate.id) === String(element.dataset.eventCountdown)
      );
      if (event) element.textContent = eventCountdown(event.startsAt);
    });
  }


  function chainCountdownLabel(chain) {
    if (!chain) return 'Synchronize faction data to load the chain.';
    const cooldownAt = timestampMs(chain.cooldownAt);
    if (cooldownAt > Date.now()) return `Cooldown ${eventCountdown(cooldownAt).toLowerCase()}`;
    const timeoutAt = timestampMs(chain.timeoutAt);
    if (Number(chain.current || 0) > 0 && timeoutAt > Date.now()) {
      return `${eventCountdown(timeoutAt).replace('Starts in ', '')} until the chain breaks`;
    }
    if (Number(chain.current || 0) > 0) return 'Chain timer expired; synchronize for the latest state.';
    return 'No chain is currently active.';
  }

  function getMyTopSuggestedRole(plans) {
    const ownId = Number(state.backend.user?.tornId || 0);
    if (!ownId) return { reason: 'Connect your own API key to see your top suggested OC role.' };
    const member = (state.cache.members || []).find(candidate => Number(candidate.id) === ownId);
    if (!member || member.apiStatus !== 'ok') {
      return { reason: 'Synchronize your stats to calculate your top suggested OC role.' };
    }

    const existing = plans.flatMap(crime =>
      crime.slots
        .filter(slot => slot.existing && Number(slot.assigned?.id || slot.userId || 0) === ownId)
        .map(slot => ({ crime, slot, current: true, score: Number(slot.score || 0), rank: 1 }))
    ).sort((a, b) => b.score - a.score)[0];
    if (existing) return existing;
    if (member.isInOc) {
      return { reason: 'You are already assigned to an OC in Torn. Your next recommendation will appear when you become available.' };
    }

    const suggestions = [];
    for (const crime of plans) {
      const status = String(crime.status || '').toLowerCase();
      if (!status.includes('planning') && !status.includes('recruit')) continue;
      for (const slot of crime.slots) {
        if (slot.existing) continue;
        const detail = roleScoreDetailed(member, slot, crime);
        const candidateRank = (slot.candidatePool || []).findIndex(candidate => Number(candidate.id) === ownId);
        suggestions.push({
          crime,
          slot,
          current: false,
          score: detail.score,
          rank: candidateRank >= 0 ? candidateRank + 1 : null
        });
      }
    }
    return suggestions.sort((a, b) => b.score - a.score)[0] || {
      reason: 'No open Planning or Recruiting role is available for a recommendation.'
    };
  }

  function renderMySuggestedRole(suggestion) {
    if (!suggestion?.crime || !suggestion?.slot) {
      return `<div class="highlight-card suggested-role-card">
        <small>Your top suggested OC role</small>
        <div class="highlight-title"><h3>Not available yet</h3></div>
        <p>${esc(suggestion?.reason || 'Synchronize the planner to calculate your recommendation.')}</p>
        <div class="toolbar"><button data-jump="plan">Open Planner</button><button data-jump="backend">Open API Key</button></div>
      </div>`;
    }
    const readiness = crimeReadiness(suggestion.crime);
    return `<div class="highlight-card suggested-role-card">
      <small>${suggestion.current ? 'Your current OC role' : 'Your top suggested OC role'}</small>
      <div class="highlight-title"><h3>${esc(suggestion.slot.role)}</h3><span class="readiness-badge ${readinessClass(readiness)}">${readiness}% crime readiness</span></div>
      <b>${esc(suggestion.crime.name)}</b>
      <p>${suggestion.current
        ? 'This is your confirmed assignment in Torn.'
        : `${suggestion.rank ? `Ranked #${suggestion.rank} for this role. ` : ''}This is your strongest statistical fit across open Planning and Recruiting roles.`}</p>
      <div class="toolbar"><a class="button primary" href="${esc(suggestion.crime.url)}" target="_blank" rel="noopener">Open Crime</a><button data-jump-crime="${esc(suggestion.crime.id)}">View in Planner</button></div>
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
    root.querySelectorAll('[data-dashboard-war-countdown]').forEach(element => {
      element.textContent = warCountdownLabel(state.backend.dashboardSnapshot?.war);
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
    const viewport = usesMobileLayout() ? window.visualViewport : null;
    const offsetLeft = Math.max(0, Number(viewport?.offsetLeft || 0));
    const offsetTop = Math.max(0, Number(viewport?.offsetTop || 0));
    const viewportWidth = Math.max(1, Number(viewport?.width || window.innerWidth));
    const viewportHeight = Math.max(1, Number(viewport?.height || window.innerHeight));
    const minLeft = offsetLeft + margin;
    const minTop = offsetTop + margin;
    const maxLeft = Math.max(minLeft, offsetLeft + viewportWidth - width - margin);
    const maxTop = Math.max(minTop, offsetTop + viewportHeight - height - margin);
    return {
      left: Math.round(Math.min(maxLeft, Math.max(minLeft, Number(position?.left) || minLeft))),
      top: Math.round(Math.min(maxTop, Math.max(minTop, Number(position?.top) || minTop)))
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
    root.style.setProperty('left', `${position.left}px`, 'important');
    root.style.setProperty('top', `${position.top}px`, 'important');
    root.style.setProperty('right', 'auto', 'important');
    root.style.setProperty('transform', 'none', 'important');
    if (persist) {
      state.settings.collapsedPosition = position;
      save(STORE.settings, state.settings);
    }
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
    root.querySelector('[data-act="dashboard-refresh"]')?.addEventListener('click', () => refreshDashboard(false));
    root.querySelector('[data-act="announcement-new"]')?.addEventListener('click', () => {
      state.ui.announcementFormOpen = true;
      state.ui.editingAnnouncementId = null;
      render();
      root.querySelector('#v111-announcement-title')?.focus();
    });
    root.querySelector('[data-act="announcement-cancel"]')?.addEventListener('click', () => {
      state.ui.announcementFormOpen = false;
      state.ui.editingAnnouncementId = null;
      render();
    });
    root.querySelector('#v111-announcement-form')?.addEventListener('submit', saveAnnouncement);
    root.querySelectorAll('[data-edit-announcement]').forEach(button => {
      button.addEventListener('click', () => {
        state.ui.announcementFormOpen = true;
        state.ui.editingAnnouncementId = button.dataset.editAnnouncement;
        render();
        root.querySelector('#v111-announcement-title')?.focus();
      });
    });
    root.querySelectorAll('[data-delete-announcement]').forEach(button => {
      button.addEventListener('click', () => removeAnnouncement(button));
    });
    root.querySelector('[data-act="schedule-refresh"]')?.addEventListener('click', () => refreshSchedule(false));
    root.querySelector('[data-act="schedule-new"]')?.addEventListener('click', () => {
      state.ui.scheduleEventFormOpen = true;
      state.ui.editingScheduleEventId = null;
      render();
      root.querySelector('#v111-schedule-event-title')?.focus();
    });
    root.querySelector('[data-act="schedule-cancel"]')?.addEventListener('click', () => {
      state.ui.scheduleEventFormOpen = false;
      state.ui.editingScheduleEventId = null;
      render();
    });
    root.querySelector('#v111-schedule-event-form')?.addEventListener('submit', saveScheduleEvent);
    root.querySelectorAll('[data-edit-schedule-event]').forEach(button => {
      button.addEventListener('click', () => {
        state.ui.scheduleEventFormOpen = true;
        state.ui.editingScheduleEventId = button.dataset.editScheduleEvent;
        render();
        root.querySelector('#v111-schedule-event-title')?.focus();
      });
    });
    root.querySelectorAll('[data-delete-schedule-event]').forEach(button => {
      button.addEventListener('click', () => removeScheduleEvent(button));
    });
    root.querySelector('#v111-notification-preferences')?.addEventListener('submit', saveSchedulePreferences);
    root.querySelector('#v111-schedule-filter')?.addEventListener('change', event => {
      state.ui.scheduleFilter = event.target.value;
      state.ui.activeTab = 'schedule';
      render();
    });
    root.querySelector('[data-act="admin-refresh"]')?.addEventListener('click', () => refreshAdmin(false));
    root.querySelectorAll('[data-save-role-mapping]').forEach(button => {
      button.addEventListener('click', () => saveAdminRoleMapping(button));
    });
    root.querySelectorAll('[data-delete-role-mapping]').forEach(button => {
      button.addEventListener('click', () => removeAdminRoleMapping(button));
    });
    root.querySelectorAll('[data-admin-suspend]').forEach(button => {
      button.addEventListener('click', () => changeAdminUserSuspension(button));
    });
    root.querySelectorAll('[data-admin-revoke-sessions]').forEach(button => {
      button.addEventListener('click', () => revokeAdminUserSessions(button));
    });
    root.querySelector('#v111-admin-user-search')?.addEventListener('input', event => {
      state.ui.adminUserSearch = event.target.value;
      applyAdminFilters();
    });
    root.querySelector('#v111-admin-audit-filter')?.addEventListener('change', event => {
      state.ui.adminAuditFilter = event.target.value;
      applyAdminFilters();
    });
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
    applyAdminFilters();
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
    if (tab === 'plan') {
      setTimeout(() => {
        if (state.ui.activeTab === 'plan') autoSyncPlannerOnOpen();
      }, 0);
    }
    if (tab === 'dashboard' && state.backend.connected && !state.backend.dashboardSnapshot) {
      setTimeout(() => {
        if (state.ui.activeTab === 'dashboard') refreshDashboard(true);
      }, 0);
    }
    if (tab === 'dashboard' && state.backend.connected && !state.backend.scheduleSnapshot) {
      setTimeout(() => {
        if (state.ui.activeTab === 'dashboard' && !state.backend.loading) refreshSchedule(true, 'dashboard');
      }, 0);
    }
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
    if (tab === 'schedule' && state.backend.connected && !state.backend.scheduleSnapshot) {
      setTimeout(() => {
        if (state.ui.activeTab === 'schedule') refreshSchedule(true);
      }, 0);
    }
    if (tab === 'admin' && backendCanAdminRead() && !state.backend.adminSnapshot) {
      setTimeout(() => {
        if (state.ui.activeTab === 'admin') refreshAdmin(true);
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

  function applyAdminFilters() {
    if (!root?.isConnected) return;
    const userQuery = String(state.ui.adminUserSearch || '').trim().toLowerCase();
    root.querySelectorAll('[data-admin-user]').forEach(card => {
      card.hidden = Boolean(userQuery) &&
        !String(card.dataset.adminUserSearch || '').includes(userQuery);
    });
    const auditFilter = String(state.ui.adminAuditFilter || 'all');
    root.querySelectorAll('[data-admin-audit]').forEach(row => {
      row.hidden = auditFilter !== 'all' && row.dataset.adminAudit !== auditFilter;
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
    if (tab === 'schedule') return 'scheduleStatus';
    if (tab === 'admin') return 'adminStatus';
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

  function plannerAutoSyncDue() {
    const lastSync = Number(load(STORE.plannerLastAutoSync, 0) || 0);
    return !lastSync || Date.now() - lastSync >= PLANNER_AUTO_SYNC_INTERVAL_MS;
  }

  async function autoSyncPlannerOnOpen() {
    if (!state.backend.connected || state.backend.loading || !plannerAutoSyncDue()) return;
    await syncBackendFaction(false, false, true);
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

  function backendCanAnnouncements() {
    if (state.backend.dashboardSnapshot?.permissions) {
      return Boolean(state.backend.dashboardSnapshot.permissions.canManageAnnouncements);
    }
    return ['OWNER', 'ADMIN', 'OFFICER'].includes(
      String(state.backend.user?.role || '').toUpperCase()
    );
  }

  function backendCanAdminRead() {
    return ['OWNER', 'ADMIN'].includes(
      String(state.backend.user?.role || '').toUpperCase()
    );
  }

  function backendCanAdminManage() {
    if (state.backend.adminSnapshot?.permissions) {
      return Boolean(state.backend.adminSnapshot.permissions.canManage);
    }
    return String(state.backend.user?.role || '').toUpperCase() === 'OWNER';
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
    removeStoredValue(STORE.backendAccess);
    removeStoredValue(STORE.backendRefresh);
    removeStoredValue(STORE.backendExpires);
    state.backend.connected = false;
    state.backend.user = null;
    state.backend.sync = null;
    state.backend.dashboardSnapshot = null;
    state.backend.scheduleSnapshot = null;
    state.backend.adminSnapshot = null;
    state.backend.memberOverview = null;
    state.backend.memberWarHistory = new Map();
    state.backend.memberWarHistoryLoading = new Set();
    state.backend.warSnapshot = null;
    state.backend.payoutSnapshot = null;
    state.backend.assignments = new Map();
    state.backend.crimeVersions = new Map();
    if (state.ui.activeTab === 'admin') state.ui.activeTab = 'backend';
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
      try {
        await loadDashboardSnapshot();
      } catch (error) {
        warning ||= `Connected, but the unified dashboard could not be loaded: ${friendly(error)}`;
      }
      try {
        await loadScheduleSnapshot();
      } catch (error) {
        warning ||= `Connected, but the faction schedule could not be loaded: ${friendly(error)}`;
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
      try {
        await loadDashboardSnapshot();
      } catch (error) {
        warning ||= `Connected, but the unified dashboard could not be loaded: ${friendly(error)}`;
      }
      try {
        await loadScheduleSnapshot();
      } catch (error) {
        warning ||= `Connected, but the faction schedule could not be loaded: ${friendly(error)}`;
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

  async function loadDashboardSnapshot() {
    const result = await backendApi('GET', '/v1/dashboard');
    state.backend.dashboardSnapshot = result;
    return result;
  }

  async function loadScheduleSnapshot() {
    const result = await backendApi('GET', '/v1/schedule');
    state.backend.scheduleSnapshot = result;
    checkScheduleReminders();
    return result;
  }

  async function refreshDashboard(silent = false) {
    if (state.backend.loading || !state.backend.connected) return;
    if (!beginBackendWork('Refreshing the unified faction dashboard…', 'dashboard', !silent)) return;
    try {
      await Promise.all([
        loadDashboardSnapshot(),
        loadScheduleSnapshot()
      ]);
      if (!silent) setFeedback('dashboard', 'Faction dashboard refreshed.');
    } catch (error) {
      setFeedback('dashboard', friendly(error), true);
    } finally {
      finishBackendWork();
      state.ui.activeTab = 'dashboard';
      render();
    }
  }

  async function refreshSchedule(silent = false, returnTab = 'schedule') {
    if (state.backend.loading || !state.backend.connected) return;
    if (!beginBackendWork('Refreshing the shared faction schedule…', returnTab, !silent)) return;
    try {
      const snapshot = await loadScheduleSnapshot();
      if (!silent) {
        setFeedback(
          returnTab,
          `Schedule refreshed: ${formatNumber(upcomingScheduleEvents(snapshot, 100).length)} upcoming events.`
        );
      }
    } catch (error) {
      setFeedback(returnTab, friendly(error), true);
    } finally {
      finishBackendWork();
      state.ui.activeTab = returnTab;
      render();
    }
  }

  async function saveScheduleEvent(event) {
    event.preventDefault();
    if (state.backend.loading || !state.backend.connected) return;
    const id = root.querySelector('#v111-schedule-event-id')?.value || '';
    const expectedVersion = Number(root.querySelector('#v111-schedule-event-version')?.value || 0);
    const type = root.querySelector('#v111-schedule-event-type')?.value || '';
    const title = root.querySelector('#v111-schedule-event-title')?.value.trim() || '';
    const description = root.querySelector('#v111-schedule-event-description')?.value.trim() || '';
    const startValue = root.querySelector('#v111-schedule-event-start')?.value || '';
    const endValue = root.querySelector('#v111-schedule-event-end')?.value || '';
    if (title.length < 3 || title.length > 120) {
      setFeedback('schedule', 'Event titles must be between 3 and 120 characters.', true);
      setStatus(root.querySelector('#v111-schedule-status'), state.ui.scheduleStatus.text, true);
      return;
    }
    if (description.length > 2000) {
      setFeedback('schedule', 'Event descriptions are limited to 2,000 characters.', true);
      setStatus(root.querySelector('#v111-schedule-status'), state.ui.scheduleStatus.text, true);
      return;
    }
    const startsAt = new Date(startValue);
    const endsAt = endValue ? new Date(endValue) : null;
    if (!Number.isFinite(startsAt.getTime()) || startsAt.getTime() < Date.now() - 5 * 60_000) {
      setFeedback('schedule', 'Choose a valid future start time.', true);
      setStatus(root.querySelector('#v111-schedule-status'), state.ui.scheduleStatus.text, true);
      return;
    }
    if (endsAt && (!Number.isFinite(endsAt.getTime()) || endsAt <= startsAt)) {
      setFeedback('schedule', 'The event end time must be after its start time.', true);
      setStatus(root.querySelector('#v111-schedule-status'), state.ui.scheduleStatus.text, true);
      return;
    }
    if (!beginBackendWork(id ? 'Saving scheduled event…' : 'Creating scheduled event…', 'schedule', false)) return;
    try {
      const payload = {
        type,
        title,
        description: description || null,
        startsAt: startsAt.toISOString(),
        endsAt: endsAt ? endsAt.toISOString() : null
      };
      if (id) {
        await backendApi('PUT', `/v1/schedule/events/${encodeURIComponent(id)}`, {
          ...payload,
          expectedVersion
        });
      } else {
        await backendApi('POST', '/v1/schedule/events', payload);
      }
      await loadScheduleSnapshot();
      state.ui.scheduleEventFormOpen = false;
      state.ui.editingScheduleEventId = null;
      setFeedback('schedule', id ? 'Scheduled event updated.' : 'Scheduled event created.');
    } catch (error) {
      if (error?.status === 409) await loadScheduleSnapshot().catch(() => undefined);
      setFeedback('schedule', friendly(error), true);
    } finally {
      finishBackendWork();
      state.ui.activeTab = 'schedule';
      render();
    }
  }

  async function removeScheduleEvent(button) {
    if (state.backend.loading || !state.backend.connected) return;
    const id = button.dataset.deleteScheduleEvent || '';
    const expectedVersion = Number(button.dataset.eventVersion || 0);
    if (!id || !expectedVersion) return;
    if (!window.confirm('Delete this scheduled faction event? This cannot be undone.')) return;
    if (!beginBackendWork('Deleting scheduled event…', 'schedule')) return;
    try {
      await backendApi(
        'DELETE',
        `/v1/schedule/events/${encodeURIComponent(id)}?expectedVersion=${encodeURIComponent(expectedVersion)}`
      );
      await loadScheduleSnapshot();
      if (state.ui.editingScheduleEventId === id) {
        state.ui.editingScheduleEventId = null;
        state.ui.scheduleEventFormOpen = false;
      }
      setFeedback('schedule', 'Scheduled event deleted.');
    } catch (error) {
      if (error?.status === 409) await loadScheduleSnapshot().catch(() => undefined);
      setFeedback('schedule', friendly(error), true);
    } finally {
      finishBackendWork();
      state.ui.activeTab = 'schedule';
      render();
    }
  }

  async function saveSchedulePreferences(event) {
    event.preventDefault();
    if (state.backend.loading || !state.backend.connected) return;
    const enabled = Boolean(root.querySelector('#v111-notifications-enabled')?.checked);
    const browserNotifications = Boolean(root.querySelector('#v111-browser-notifications')?.checked);
    const eventTypes = [...root.querySelectorAll('[data-notification-event-type]:checked')]
      .map(input => input.dataset.notificationEventType);
    const reminderMinutes = String(root.querySelector('#v111-reminder-minutes')?.value || '')
      .split(/[\s,]+/)
      .filter(Boolean)
      .map(Number);
    const validReminders = reminderMinutes.length >= 1 &&
      reminderMinutes.length <= 5 &&
      reminderMinutes.every(value => Number.isInteger(value) && value >= 0 && value <= 10080);
    if (!eventTypes.length) {
      setFeedback('schedule', 'Choose at least one event type for reminders.', true);
      setStatus(root.querySelector('#v111-schedule-status'), state.ui.scheduleStatus.text, true);
      return;
    }
    if (!validReminders) {
      setFeedback('schedule', 'Enter one to five reminder times between 0 and 10,080 minutes.', true);
      setStatus(root.querySelector('#v111-schedule-status'), state.ui.scheduleStatus.text, true);
      return;
    }
    if (!beginBackendWork('Saving your notification preferences…', 'schedule', false)) return;
    try {
      await backendApi('PUT', '/v1/me/notification-preferences', {
        enabled,
        browserNotifications,
        eventTypes,
        reminderMinutes
      });
      await loadScheduleSnapshot();
      setFeedback('schedule', 'Your notification preferences were saved.');
    } catch (error) {
      setFeedback('schedule', friendly(error), true);
    } finally {
      finishBackendWork();
      state.ui.activeTab = 'schedule';
      render();
    }
  }

  function checkScheduleReminders() {
    const snapshot = state.backend.scheduleSnapshot;
    const preference = snapshot?.preferences;
    if (!state.backend.connected || !preference?.enabled) return;
    const now = Date.now();
    const reminders = [...new Set((preference.reminderMinutes || []).map(Number))]
      .filter(value => Number.isInteger(value) && value >= 0)
      .sort((a, b) => a - b);
    if (!reminders.length) return;
    const selectedTypes = new Set(preference.eventTypes || []);
    const log = load(STORE.scheduleNotificationLog, {});
    let changed = false;
    for (const [key, sentAt] of Object.entries(log)) {
      if (now - Number(sentAt || 0) > 30 * 24 * 60 * 60 * 1000) {
        delete log[key];
        changed = true;
      }
    }
    for (const event of snapshot.events || []) {
      if (!selectedTypes.has(event.type)) continue;
      const startsAt = timestampMs(event.startsAt);
      const remaining = startsAt - now;
      if (remaining < -60_000) continue;
      const comparisonRemaining = Math.max(0, remaining);
      const reminder = reminders.find(minutes =>
        comparisonRemaining <= minutes * 60_000 &&
        !log[`${event.id}:${minutes}`]
      );
      if (reminder === undefined) continue;
      const key = `${event.id}:${reminder}`;
      log[key] = now;
      changed = true;
      const timing = eventCountdown(event.startsAt);
      const message = `${event.title} — ${timing}`;
      showScheduleToast(message);
      if (preference.browserNotifications && typeof GM_notification === 'function') {
        try {
          GM_notification({
            title: `Vault 111 · ${scheduleEventLabel(event.type)}`,
            text: message,
            timeout: 12000,
            onclick: () => window.focus()
          });
        } catch {
          // In-app reminders continue if the browser blocks extension notifications.
        }
      }
    }
    if (changed) save(STORE.scheduleNotificationLog, log);
  }

  function showScheduleToast(message) {
    state.ui.scheduleToast = {
      message,
      until: Date.now() + 10_000
    };
    const toast = root?.querySelector('#v111-schedule-toast');
    if (!toast) return;
    toast.textContent = message;
    toast.hidden = false;
    announce(message);
    setTimeout(() => {
      const current = root?.querySelector('#v111-schedule-toast');
      if (state.ui.scheduleToast?.message === message) state.ui.scheduleToast = null;
      if (current && current.textContent === message) current.hidden = true;
    }, 10000);
  }

  async function loadAdminSnapshot() {
    if (!backendCanAdminRead()) {
      state.backend.adminSnapshot = null;
      return null;
    }
    const [overview, audit] = await Promise.all([
      backendApi('GET', '/v1/admin/overview'),
      backendApi('GET', '/v1/admin/audit?limit=100')
    ]);
    state.backend.adminSnapshot = {
      ...overview,
      audit: audit?.events || []
    };
    return state.backend.adminSnapshot;
  }

  async function refreshAdmin(silent = false) {
    if (state.backend.loading || !state.backend.connected || !backendCanAdminRead()) return;
    state.ui.adminStatus = null;
    if (!beginBackendWork('Refreshing protected administration data…', 'admin', !silent)) return;
    try {
      const snapshot = await loadAdminSnapshot();
      if (!silent) {
        setFeedback(
          'admin',
          `Administration refreshed: ${formatNumber(snapshot?.summary?.users)} connected users and ${formatNumber(snapshot?.summary?.mappedPositions)} role mappings.`
        );
      }
    } catch (error) {
      setFeedback('admin', friendly(error), true);
    } finally {
      finishBackendWork();
      state.ui.activeTab = 'admin';
      render();
    }
  }

  async function saveAdminRoleMapping(button) {
    if (state.backend.loading || !backendCanAdminManage()) return;
    const row = button.closest('[data-admin-position]');
    const factionPosition = row?.dataset.adminPosition || '';
    const appRole = row?.querySelector('[data-role-mapping-select]')?.value || '';
    const expectedVersion = Number(button.dataset.mappingVersion || 0);
    if (!factionPosition || !appRole) return;
    if (!window.confirm(`Map "${factionPosition}" to ${adminRoleLabel(appRole)}? Affected users will be signed out so the new role takes effect immediately.`)) return;
    if (!beginBackendWork('Saving faction position permissions…', 'admin')) return;
    try {
      const result = await backendApi(
        'PUT',
        `/v1/admin/role-mappings/${encodeURIComponent(factionPosition)}`,
        { appRole, expectedVersion }
      );
      await loadAdminSnapshot();
      setFeedback(
        'admin',
        result?.unchanged
          ? 'That role mapping was already current.'
          : `Role mapping saved. ${formatNumber(result?.affectedUsers)} affected user${Number(result?.affectedUsers) === 1 ? '' : 's'} must reconnect.`
      );
    } catch (error) {
      if (error?.status === 409) await loadAdminSnapshot().catch(() => undefined);
      setFeedback('admin', friendly(error), true);
    } finally {
      finishBackendWork();
      state.ui.activeTab = 'admin';
      render();
    }
  }

  async function removeAdminRoleMapping(button) {
    if (state.backend.loading || !backendCanAdminManage()) return;
    const row = button.closest('[data-admin-position]');
    const factionPosition = row?.dataset.adminPosition || '';
    const expectedVersion = Number(button.dataset.mappingVersion || 0);
    if (!factionPosition || !expectedVersion) return;
    if (!window.confirm(`Remove the mapping for "${factionPosition}"? Affected users will become read-only Members and must reconnect.`)) return;
    if (!beginBackendWork('Removing faction position permissions…', 'admin')) return;
    try {
      const result = await backendApi(
        'DELETE',
        `/v1/admin/role-mappings/${encodeURIComponent(factionPosition)}?expectedVersion=${encodeURIComponent(expectedVersion)}`
      );
      await loadAdminSnapshot();
      setFeedback(
        'admin',
        `Role mapping removed. ${formatNumber(result?.affectedUsers)} affected user${Number(result?.affectedUsers) === 1 ? '' : 's'} must reconnect.`
      );
    } catch (error) {
      if (error?.status === 409) await loadAdminSnapshot().catch(() => undefined);
      setFeedback('admin', friendly(error), true);
    } finally {
      finishBackendWork();
      state.ui.activeTab = 'admin';
      render();
    }
  }

  async function changeAdminUserSuspension(button) {
    if (state.backend.loading || !backendCanAdminManage()) return;
    const userId = button.dataset.adminUserId || '';
    const expectedVersion = Number(button.dataset.adminUserVersion || 0);
    const suspended = button.dataset.adminSuspend === 'true';
    if (!userId || !expectedVersion) return;
    const label = suspended ? 'Suspend this member’s Control Center access and revoke every session?' : 'Restore this member’s Control Center access? They will still need to reconnect.';
    if (!window.confirm(label)) return;
    if (!beginBackendWork(suspended ? 'Suspending Control Center access…' : 'Restoring Control Center access…', 'admin')) return;
    try {
      const result = await backendApi(
        'PUT',
        `/v1/admin/users/${encodeURIComponent(userId)}/suspension`,
        { suspended, expectedVersion }
      );
      await loadAdminSnapshot();
      setFeedback(
        'admin',
        `${suspended ? 'Access suspended' : 'Access restored'}. ${formatNumber(result?.revokedSessions)} session${Number(result?.revokedSessions) === 1 ? '' : 's'} revoked.`
      );
    } catch (error) {
      if (error?.status === 409) await loadAdminSnapshot().catch(() => undefined);
      setFeedback('admin', friendly(error), true);
    } finally {
      finishBackendWork();
      state.ui.activeTab = 'admin';
      render();
    }
  }

  async function revokeAdminUserSessions(button) {
    if (state.backend.loading || !backendCanAdminManage()) return;
    const userId = button.dataset.adminUserId || '';
    const expectedVersion = Number(button.dataset.adminUserVersion || 0);
    if (!userId || !expectedVersion) return;
    if (!window.confirm('Revoke all of this member’s Control Center sessions? They will need to connect their own API key again.')) return;
    if (!beginBackendWork('Revoking member sessions…', 'admin')) return;
    try {
      const result = await backendApi(
        'POST',
        `/v1/admin/users/${encodeURIComponent(userId)}/revoke-sessions`,
        { expectedVersion }
      );
      await loadAdminSnapshot();
      setFeedback(
        'admin',
        `${formatNumber(result?.revokedSessions)} session${Number(result?.revokedSessions) === 1 ? '' : 's'} revoked.`
      );
    } catch (error) {
      if (error?.status === 409) await loadAdminSnapshot().catch(() => undefined);
      setFeedback('admin', friendly(error), true);
    } finally {
      finishBackendWork();
      state.ui.activeTab = 'admin';
      render();
    }
  }

  async function saveAnnouncement(event) {
    event.preventDefault();
    if (state.backend.loading || !backendCanAnnouncements()) return;
    const title = root.querySelector('#v111-announcement-title')?.value.trim() || '';
    const body = root.querySelector('#v111-announcement-body')?.value.trim() || '';
    const expiresValue = root.querySelector('#v111-announcement-expires')?.value || '';
    const pinned = Boolean(root.querySelector('#v111-announcement-pinned')?.checked);
    const id = root.querySelector('#v111-announcement-id')?.value || '';
    const expectedVersion = Number(root.querySelector('#v111-announcement-version')?.value || 0);
    if (title.length < 3 || title.length > 120) {
      setFeedback('dashboard', 'Announcement titles must be between 3 and 120 characters.', true);
      setStatus(root.querySelector('#v111-dashboard-status'), state.ui.dashboardStatus.text, true);
      return;
    }
    if (!body || body.length > 2000) {
      setFeedback('dashboard', 'Announcement messages must contain 1 to 2,000 characters.', true);
      setStatus(root.querySelector('#v111-dashboard-status'), state.ui.dashboardStatus.text, true);
      return;
    }
    let expiresAt = null;
    if (expiresValue) {
      const expiration = new Date(expiresValue);
      if (!Number.isFinite(expiration.getTime()) || expiration.getTime() <= Date.now()) {
        setFeedback('dashboard', 'Choose a future expiration date and time.', true);
        setStatus(root.querySelector('#v111-dashboard-status'), state.ui.dashboardStatus.text, true);
        return;
      }
      expiresAt = expiration.toISOString();
    }
    if (!beginBackendWork(id ? 'Saving announcement changes…' : 'Publishing faction announcement…', 'dashboard', false)) return;
    try {
      const payload = { title, body, pinned, expiresAt };
      if (id) {
        await backendApi('PUT', `/v1/announcements/${encodeURIComponent(id)}`, {
          ...payload,
          expectedVersion
        });
      } else {
        await backendApi('POST', '/v1/announcements', payload);
      }
      await loadDashboardSnapshot();
      state.ui.announcementFormOpen = false;
      state.ui.editingAnnouncementId = null;
      setFeedback('dashboard', id ? 'Faction announcement updated.' : 'Faction announcement published.');
    } catch (error) {
      if (error?.status === 409) await loadDashboardSnapshot().catch(() => undefined);
      setFeedback('dashboard', friendly(error), true);
    } finally {
      finishBackendWork();
      state.ui.activeTab = 'dashboard';
      render();
    }
  }

  async function removeAnnouncement(button) {
    if (state.backend.loading || !backendCanAnnouncements()) return;
    const id = button.dataset.deleteAnnouncement || '';
    const expectedVersion = Number(button.dataset.announcementVersion || 0);
    if (!id || !expectedVersion) return;
    if (!window.confirm('Delete this faction announcement? This cannot be undone.')) return;
    if (!beginBackendWork('Deleting faction announcement…', 'dashboard')) return;
    try {
      await backendApi(
        'DELETE',
        `/v1/announcements/${encodeURIComponent(id)}?expectedVersion=${encodeURIComponent(expectedVersion)}`
      );
      await loadDashboardSnapshot();
      if (state.ui.editingAnnouncementId === id) {
        state.ui.editingAnnouncementId = null;
        state.ui.announcementFormOpen = false;
      }
      setFeedback('dashboard', 'Faction announcement deleted.');
    } catch (error) {
      if (error?.status === 409) await loadDashboardSnapshot().catch(() => undefined);
      setFeedback('dashboard', friendly(error), true);
    } finally {
      finishBackendWork();
      state.ui.activeTab = 'dashboard';
      render();
    }
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
      await loadDashboardSnapshot();
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
      await loadDashboardSnapshot();
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
      await loadDashboardSnapshot();
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
      await loadDashboardSnapshot();
      await loadScheduleSnapshot();
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
      await loadDashboardSnapshot();
      await loadScheduleSnapshot();
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

  async function syncBackendFaction(silent = false, returnToBackend = false, plannerAutomatic = false) {
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
      await loadDashboardSnapshot();
      await loadScheduleSnapshot();
      const memberCount = Number(result?.sync?.memberCount || result?.members?.length || 0);
      const crimeCount = Number(result?.sync?.crimeCount || result?.crimes?.length || 0);
      if (returnTab === 'plan') save(STORE.plannerLastAutoSync, Date.now());
      if (plannerAutomatic) {
        setFeedback('planner', `Planner synchronized and rebuilt automatically: ${memberCount} members and ${crimeCount} available crimes.`);
      }
      if (!silent) {
        const warning = synced?.analyticsResult?.warnings?.join(' ');
        if (!plannerAutomatic) {
          setFeedback(returnTab, `${warning ? `${warning} ` : ''}Your member stats were updated. Shared data loaded: ${memberCount} members and ${crimeCount} available crimes.`);
        }
      }
    } catch (error) {
      state.backend.error = friendly(error);
      if (!silent) setFeedback(plannerAutomatic ? 'planner' : returnTab, state.backend.error, true);
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
      await loadDashboardSnapshot();
      await loadScheduleSnapshot();
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
      await loadDashboardSnapshot();
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
      await loadDashboardSnapshot();
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
      await loadDashboardSnapshot();
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
      await loadDashboardSnapshot();
      await loadScheduleSnapshot();
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
  function load(key, fallback) {
    try {
      return typeof GM_getValue === 'function' ? GM_getValue(key, fallback) : fallback;
    } catch {
      return fallback;
    }
  }
  function save(key, value) {
    try {
      if (typeof GM_setValue === 'function') GM_setValue(key, value);
    } catch (error) {
      console.warn('[Vault 111] Could not save local display state.', error);
    }
  }
  function removeStoredValue(key) {
    try {
      if (typeof GM_deleteValue === 'function') GM_deleteValue(key);
    } catch (error) {
      console.warn('[Vault 111] Could not remove obsolete local display state.', error);
    }
  }
  async function copyText(text) {
    if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text);
    const area = document.createElement('textarea'); area.value = text; document.body.appendChild(area); area.select(); document.execCommand('copy'); area.remove();
  }

  function addStyles() {
    const css = `
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
        visibility: visible !important;
        opacity: 1 !important;
        transition: top .2s ease, transform .2s ease, max-height .2s ease !important;
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
      #v111-ocp .tabs { position:relative !important; top:auto !important; z-index:20 !important; flex:0 0 auto !important; display:grid !important; grid-auto-flow:column !important; grid-auto-columns:minmax(0,1fr) !important; width:100% !important; margin:0 !important; overflow:hidden !important; background:#0d131a !important; border-bottom:1px solid #26384a !important; box-shadow:0 4px 10px rgba(0,0,0,.35) !important; isolation:isolate !important; }
      #v111-ocp .tabs button { min-width:0 !important; border:0 !important; border-radius:0 !important; padding:6px 3px !important; background:transparent !important; color:#aebed0 !important; font-size:10px !important; white-space:normal !important; overflow-wrap:anywhere !important; }
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
      @media(max-width:700px), (pointer:coarse) and (max-width:900px) {
        #v111-ocp:not(.collapsed) { right:3vw !important; left:auto !important; top:var(--v111-mobile-panel-top,30vh) !important; bottom:auto !important; transform:none !important; width:min(94vw,380px) !important; max-height:var(--v111-mobile-panel-height,40vh) !important; font-size:12px !important; }
        #v111-ocp.keyboard-open:not(.collapsed) { box-shadow:0 8px 34px rgba(0,0,0,.82) !important; }
        #v111-ocp:not(.collapsed) .body { max-height:none !important; }
        #v111-ocp.collapsed { width:min(240px,calc(100vw - 16px)) !important; max-height:none !important; }
        #v111-ocp header { min-height:40px !important; padding:6px 8px !important; }
        #v111-ocp header strong { font-size:13px !important; }
        #v111-ocp header small, #v111-ocp small { font-size:10px !important; }
        #v111-ocp .head-actions button { min-width:27px !important; min-height:27px !important; padding:2px 6px !important; font-size:15px !important; }
        #v111-ocp main { padding:5px !important; }
        #v111-ocp .tabs { grid-template-columns:repeat(5,minmax(0,1fr)) !important; grid-auto-flow:row !important; grid-auto-columns:auto !important; }
        #v111-ocp .tabs button { min-height:28px !important; padding:3px 2px !important; font-size:9px !important; line-height:1.05 !important; }
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

      #v111-ocp .dashboard-section { margin:0 0 10px !important; padding:9px !important; border:1px solid #2d4c64 !important; border-radius:9px !important; background:#101b26 !important; }
      #v111-ocp .dashboard-section-head { display:flex !important; align-items:center !important; justify-content:space-between !important; gap:8px !important; margin:0 0 7px !important; }
      #v111-ocp .dashboard-section-head > div { min-width:0 !important; }
      #v111-ocp .dashboard-section-head h3 { margin:0 !important; color:#fff !important; font-size:14px !important; }
      #v111-ocp .dashboard-section-head small { color:#91aabd !important; font-size:9px !important; }
      #v111-ocp .oc-dashboard-heading { margin-top:12px !important; }
      #v111-ocp .control-overview-grid { display:grid !important; grid-template-columns:repeat(2,minmax(0,1fr)) !important; gap:6px !important; }
      #v111-ocp .overview-card { display:grid !important; grid-template-columns:minmax(0,1fr) auto !important; align-items:center !important; gap:3px 7px !important; min-width:0 !important; padding:8px !important; border:1px solid #2b465c !important; border-radius:7px !important; background:linear-gradient(145deg,#172a39,#12212d) !important; }
      #v111-ocp .overview-card > small, #v111-ocp .overview-card > h4, #v111-ocp .overview-card > b, #v111-ocp .overview-card > span, #v111-ocp .overview-card > em { grid-column:1 !important; min-width:0 !important; overflow-wrap:anywhere !important; }
      #v111-ocp .overview-card > small { color:#8fa9bc !important; font-size:8px !important; font-weight:800 !important; letter-spacing:.04em !important; text-transform:uppercase !important; }
      #v111-ocp .overview-card > h4 { margin:0 !important; color:#fff !important; font-size:14px !important; }
      #v111-ocp .overview-card > b { color:#cae3f6 !important; font-size:10px !important; }
      #v111-ocp .overview-card > span { color:#96adbf !important; font-size:9px !important; }
      #v111-ocp .overview-card > em { color:#ffb7bd !important; font-size:8px !important; font-style:normal !important; }
      #v111-ocp .overview-card > button { grid-column:2 !important; grid-row:1 / span 5 !important; align-self:center !important; }
      #v111-ocp .overview-card.warning { border-color:#8a4850 !important; }
      #v111-ocp .dashboard-canonical-line { display:grid !important; grid-template-columns:repeat(4,minmax(0,1fr)) !important; gap:4px !important; margin-top:6px !important; }
      #v111-ocp .dashboard-canonical-line span { padding:5px !important; border-radius:5px !important; background:#0f1a24 !important; color:#9eb4c5 !important; font-size:9px !important; text-align:center !important; }
      #v111-ocp .dashboard-canonical-line b { color:#fff !important; font-size:11px !important; }
      #v111-ocp .announcement-list { display:grid !important; gap:5px !important; }
      #v111-ocp .announcement-card { min-width:0 !important; padding:7px !important; border:1px solid #29465d !important; border-left:3px solid #397caf !important; border-radius:7px !important; background:#142634 !important; }
      #v111-ocp .announcement-card.pinned { border-left-color:#f2c94c !important; background:linear-gradient(135deg,#22303a,#172837) !important; }
      #v111-ocp .announcement-title { display:flex !important; align-items:flex-start !important; justify-content:space-between !important; gap:7px !important; }
      #v111-ocp .announcement-title > div:first-child { display:flex !important; align-items:center !important; min-width:0 !important; gap:5px !important; }
      #v111-ocp .announcement-title h4 { margin:0 !important; color:#fff !important; font-size:12px !important; overflow-wrap:anywhere !important; }
      #v111-ocp .announcement-title i { flex:0 0 auto !important; padding:2px 4px !important; border-radius:4px !important; background:#665523 !important; color:#ffeaa0 !important; font-size:7px !important; font-style:normal !important; font-weight:900 !important; }
      #v111-ocp .announcement-actions { display:flex !important; flex:0 0 auto !important; gap:3px !important; }
      #v111-ocp .announcement-card p { margin:6px 0 !important; color:#d6e5f0 !important; line-height:1.35 !important; white-space:pre-wrap !important; overflow-wrap:anywhere !important; }
      #v111-ocp .announcement-card > small { color:#8fa8ba !important; font-size:8px !important; }
      #v111-ocp .announcement-form { display:grid !important; grid-template-columns:repeat(2,minmax(0,1fr)) !important; gap:6px !important; margin:0 0 7px !important; padding:7px !important; border:1px solid #3b6685 !important; border-radius:7px !important; background:#132531 !important; }
      #v111-ocp .announcement-form label { display:grid !important; gap:3px !important; min-width:0 !important; color:#bcd0df !important; font-size:9px !important; font-weight:700 !important; }
      #v111-ocp .announcement-form label.wide, #v111-ocp .announcement-form .wide { grid-column:1 / -1 !important; }
      #v111-ocp .announcement-form input[type="text"], #v111-ocp .announcement-form input[type="datetime-local"], #v111-ocp .announcement-form textarea { width:100% !important; min-width:0 !important; box-sizing:border-box !important; margin:0 !important; border:1px solid #405d75 !important; border-radius:5px !important; background:#0d1720 !important; color:#fff !important; padding:6px !important; font:11px system-ui,-apple-system,"Segoe UI",Arial,sans-serif !important; }
      #v111-ocp .announcement-form textarea { min-height:72px !important; resize:vertical !important; }
      #v111-ocp .announcement-form .announcement-pin { display:flex !important; align-items:center !important; align-self:end !important; grid-template-columns:auto 1fr !important; }
      #v111-ocp .announcement-form .announcement-pin input { width:16px !important; height:16px !important; margin:0 !important; }
      #v111-ocp .dashboard-event-list, #v111-ocp .schedule-event-list { display:grid !important; gap:5px !important; }
      #v111-ocp .dashboard-event-row { display:grid !important; grid-template-columns:auto minmax(0,1fr) auto !important; align-items:center !important; gap:7px !important; min-width:0 !important; padding:7px !important; border:1px solid #29465d !important; border-left:3px solid #397caf !important; border-radius:7px !important; background:#142634 !important; }
      #v111-ocp .dashboard-event-row > i, #v111-ocp .schedule-event-head i { padding:2px 5px !important; border-radius:999px !important; background:#274f70 !important; color:#dceeff !important; font-size:8px !important; font-style:normal !important; font-weight:900 !important; text-transform:uppercase !important; }
      #v111-ocp .dashboard-event-row > span { min-width:0 !important; }
      #v111-ocp .dashboard-event-row b, #v111-ocp .dashboard-event-row small { display:block !important; overflow:hidden !important; text-overflow:ellipsis !important; white-space:nowrap !important; }
      #v111-ocp .dashboard-event-row b { color:#fff !important; font-size:11px !important; }
      #v111-ocp .dashboard-event-row strong { color:var(--v111-gold) !important; font:800 9px/1.2 ui-monospace,SFMono-Regular,Consolas,monospace !important; text-align:right !important; }
      #v111-ocp .dashboard-event-row.chain, #v111-ocp .schedule-event-card.chain { border-left-color:#e0aa42 !important; }
      #v111-ocp .dashboard-event-row.ranked_war, #v111-ocp .schedule-event-card.ranked_war { border-left-color:#dc626d !important; }
      #v111-ocp .dashboard-event-row.oc, #v111-ocp .schedule-event-card.oc { border-left-color:#52ad77 !important; }
      #v111-ocp .schedule-toolbar { display:flex !important; align-items:end !important; justify-content:space-between !important; gap:8px !important; margin-bottom:7px !important; }
      #v111-ocp .schedule-toolbar > label { display:grid !important; gap:3px !important; color:#bcd0df !important; font-size:9px !important; font-weight:700 !important; }
      #v111-ocp .schedule-toolbar select { min-width:130px !important; margin:0 !important; padding:6px !important; border:1px solid #405d75 !important; border-radius:5px !important; background:#0d1720 !important; color:#fff !important; }
      #v111-ocp .schedule-summary { display:grid !important; grid-template-columns:repeat(3,minmax(0,1fr)) !important; gap:5px !important; margin:7px 0 !important; }
      #v111-ocp .schedule-summary > div { display:grid !important; gap:2px !important; padding:7px !important; border:1px solid #2f4e66 !important; border-radius:7px !important; background:#142432 !important; text-align:center !important; }
      #v111-ocp .schedule-summary b { color:#fff !important; font-size:15px !important; }
      #v111-ocp .schedule-summary span { color:#9fb5c8 !important; font-size:9px !important; }
      #v111-ocp .schedule-event-card { min-width:0 !important; padding:8px !important; border:1px solid #29465d !important; border-left:3px solid #397caf !important; border-radius:8px !important; background:#142634 !important; }
      #v111-ocp .schedule-event-card.automatic { background:linear-gradient(145deg,#162b38,#11212c) !important; }
      #v111-ocp .schedule-event-head { display:flex !important; justify-content:space-between !important; align-items:flex-start !important; gap:8px !important; }
      #v111-ocp .schedule-event-head > div { display:flex !important; align-items:center !important; flex-wrap:wrap !important; gap:5px !important; min-width:0 !important; }
      #v111-ocp .schedule-event-head h3 { flex-basis:100% !important; margin:2px 0 0 !important; color:#fff !important; font-size:13px !important; overflow-wrap:anywhere !important; }
      #v111-ocp .schedule-event-head em { padding:2px 4px !important; border-radius:4px !important; background:#31552f !important; color:#d9f3d7 !important; font-size:7px !important; font-style:normal !important; font-weight:900 !important; }
      #v111-ocp .schedule-event-head > div:last-child { flex:0 0 auto !important; }
      #v111-ocp .schedule-event-card > p { margin:6px 0 !important; color:#d6e5f0 !important; white-space:pre-wrap !important; overflow-wrap:anywhere !important; }
      #v111-ocp .schedule-event-time { display:flex !important; align-items:center !important; flex-wrap:wrap !important; gap:4px 9px !important; margin:6px 0 !important; padding:6px !important; border-radius:6px !important; background:#0f1d28 !important; }
      #v111-ocp .schedule-event-time b { color:#fff !important; font-size:10px !important; }
      #v111-ocp .schedule-event-time span { margin-left:auto !important; color:var(--v111-gold) !important; font:800 10px/1.2 ui-monospace,SFMono-Regular,Consolas,monospace !important; }
      #v111-ocp .schedule-event-time small { flex-basis:100% !important; }
      #v111-ocp .schedule-event-form { display:grid !important; grid-template-columns:repeat(2,minmax(0,1fr)) !important; gap:6px !important; margin:0 0 8px !important; padding:8px !important; border:1px solid #3b6685 !important; border-radius:8px !important; background:#132531 !important; }
      #v111-ocp .schedule-event-form label { display:grid !important; gap:3px !important; min-width:0 !important; color:#bcd0df !important; font-size:9px !important; font-weight:700 !important; }
      #v111-ocp .schedule-event-form .wide { grid-column:1 / -1 !important; }
      #v111-ocp .schedule-event-form input, #v111-ocp .schedule-event-form select, #v111-ocp .schedule-event-form textarea, #v111-ocp .notification-preferences input[type="text"] { width:100% !important; min-width:0 !important; margin:0 !important; padding:6px !important; border:1px solid #405d75 !important; border-radius:5px !important; background:#0d1720 !important; color:#fff !important; font:11px system-ui,-apple-system,"Segoe UI",Arial,sans-serif !important; }
      #v111-ocp .schedule-event-form textarea { min-height:72px !important; resize:vertical !important; }
      #v111-ocp .notification-preferences { margin-top:8px !important; border:1px solid #31516d !important; border-radius:8px !important; background:#101923 !important; overflow:hidden !important; }
      #v111-ocp .notification-preferences > summary { padding:8px !important; color:#dce9f6 !important; cursor:pointer !important; font-weight:800 !important; }
      #v111-ocp .notification-preferences form { display:grid !important; gap:6px !important; padding:0 8px 8px !important; }
      #v111-ocp .notification-preferences fieldset { display:grid !important; grid-template-columns:repeat(3,minmax(0,1fr)) !important; gap:5px !important; margin:0 !important; padding:7px !important; border:1px solid #2f4e66 !important; border-radius:6px !important; }
      #v111-ocp .notification-preferences legend { padding:0 4px !important; color:#bcd0df !important; font-size:9px !important; font-weight:800 !important; }
      #v111-ocp .notification-preferences fieldset label { display:flex !important; align-items:center !important; gap:4px !important; min-width:0 !important; color:#c8d8e5 !important; font-size:9px !important; }
      #v111-ocp .notification-preferences input[type="checkbox"] { flex:0 0 auto !important; width:16px !important; height:16px !important; min-height:16px !important; margin:0 !important; padding:0 !important; }
      #v111-ocp .schedule-toast { position:fixed !important; right:18px !important; bottom:18px !important; z-index:2147483647 !important; width:min(360px,calc(100vw - 36px)) !important; padding:11px 13px !important; border:1px solid #e0b94b !important; border-radius:9px !important; background:#172736 !important; color:#fff !important; box-shadow:0 12px 34px rgba(0,0,0,.65) !important; font-weight:800 !important; }
      #v111-ocp .schedule-toast[hidden] { display:none !important; }
      #v111-ocp .admin-summary { display:grid !important; grid-template-columns:repeat(4,minmax(0,1fr)) !important; gap:5px !important; margin:7px 0 !important; }
      #v111-ocp .admin-summary > div { display:grid !important; gap:2px !important; min-width:0 !important; padding:7px 4px !important; border:1px solid #2f4e66 !important; border-radius:7px !important; background:#142432 !important; text-align:center !important; }
      #v111-ocp .admin-summary > div.warning { border-color:#8a4850 !important; background:#351f25 !important; }
      #v111-ocp .admin-summary b { color:#fff !important; font-size:15px !important; }
      #v111-ocp .admin-summary span { color:#9fb5c8 !important; font-size:8px !important; overflow-wrap:anywhere !important; }
      #v111-ocp .admin-section { margin:8px 0 !important; padding:8px !important; border:1px solid #2d4c64 !important; border-radius:9px !important; background:#101b26 !important; }
      #v111-ocp .admin-section-head { display:flex !important; align-items:flex-start !important; justify-content:space-between !important; gap:8px !important; margin-bottom:7px !important; }
      #v111-ocp .admin-section-head h3 { margin:0 !important; color:#fff !important; font-size:13px !important; }
      #v111-ocp .admin-section-head small { color:#91aabd !important; font-size:8px !important; }
      #v111-ocp .admin-section-head > i { flex:0 0 auto !important; padding:3px 5px !important; border-radius:999px !important; background:#263d50 !important; color:#bcd0df !important; font-size:8px !important; font-style:normal !important; font-weight:800 !important; }
      #v111-ocp .admin-section-head > i.owner-only { background:#665523 !important; color:#ffeaa0 !important; }
      #v111-ocp .admin-help { margin:0 0 7px !important; color:#a9bfd1 !important; font-size:9px !important; }
      #v111-ocp .admin-health-grid { display:grid !important; grid-template-columns:repeat(3,minmax(0,1fr)) !important; gap:5px !important; }
      #v111-ocp .admin-health-grid article { display:grid !important; gap:3px !important; min-width:0 !important; padding:7px !important; border:1px solid #2a465b !important; border-radius:7px !important; background:#142634 !important; }
      #v111-ocp .admin-health-grid b { color:#dce9f5 !important; font-size:9px !important; }
      #v111-ocp .admin-health-grid strong { color:#dbe7f1 !important; font-size:11px !important; }
      #v111-ocp .admin-health-grid strong.healthy { color:#81d9a2 !important; }
      #v111-ocp .admin-health-grid strong.warning { color:#ffb6bd !important; }
      #v111-ocp .admin-health-grid small { overflow-wrap:anywhere !important; }
      #v111-ocp .admin-mapping-list, #v111-ocp .admin-user-list, #v111-ocp .admin-audit-list { display:grid !important; gap:5px !important; }
      #v111-ocp .admin-mapping-row { display:grid !important; grid-template-columns:minmax(0,1fr) 135px auto auto !important; align-items:center !important; gap:5px !important; min-width:0 !important; padding:7px !important; border:1px solid #29465d !important; border-radius:7px !important; background:#142634 !important; }
      #v111-ocp .admin-mapping-row > div { min-width:0 !important; }
      #v111-ocp .admin-mapping-row b, #v111-ocp .admin-mapping-row small { display:block !important; overflow-wrap:anywhere !important; }
      #v111-ocp .admin-mapping-row b { color:#fff !important; }
      #v111-ocp .admin-mapping-row > strong { color:#d8e7f4 !important; text-align:right !important; }
      #v111-ocp .admin-mapping-row select, #v111-ocp .admin-search, #v111-ocp #v111-admin-audit-filter { min-width:0 !important; width:100% !important; margin:0 !important; padding:6px !important; border:1px solid #405d75 !important; border-radius:5px !important; background:#0d1720 !important; color:#fff !important; font:10px system-ui,-apple-system,"Segoe UI",Arial,sans-serif !important; }
      #v111-ocp .admin-search { margin-bottom:6px !important; }
      #v111-ocp .admin-user-card { min-width:0 !important; padding:7px !important; border:1px solid #29465d !important; border-left:3px solid #397caf !important; border-radius:7px !important; background:#142634 !important; }
      #v111-ocp .admin-user-card.suspended { border-color:#8a4850 !important; background:#351f25 !important; }
      #v111-ocp .admin-user-card.departed { border-style:dashed !important; border-color:#a87543 !important; }
      #v111-ocp .admin-user-card[hidden], #v111-ocp .admin-audit-row[hidden] { display:none !important; }
      #v111-ocp .admin-user-main { display:flex !important; align-items:flex-start !important; justify-content:space-between !important; gap:7px !important; }
      #v111-ocp .admin-user-main > div { min-width:0 !important; }
      #v111-ocp .admin-user-main a { display:block !important; color:#fff !important; font-weight:800 !important; text-decoration:none !important; overflow-wrap:anywhere !important; }
      #v111-ocp .admin-role { flex:0 0 auto !important; padding:3px 6px !important; border-radius:999px !important; background:#314c62 !important; color:#e4f2fc !important; font-size:8px !important; font-weight:900 !important; text-transform:uppercase !important; }
      #v111-ocp .admin-role.owner { background:#735e24 !important; color:#fff0ad !important; }
      #v111-ocp .admin-role.admin { background:#6a3040 !important; color:#ffd9df !important; }
      #v111-ocp .admin-user-facts { display:grid !important; grid-template-columns:repeat(4,minmax(0,1fr)) !important; gap:4px !important; margin:6px 0 !important; }
      #v111-ocp .admin-user-facts span { display:grid !important; gap:2px !important; min-width:0 !important; padding:4px !important; border-radius:5px !important; background:#0f1d28 !important; color:#8fa8ba !important; font-size:8px !important; text-align:center !important; }
      #v111-ocp .admin-user-facts b { color:#fff !important; overflow-wrap:anywhere !important; }
      #v111-ocp .admin-user-actions { display:flex !important; justify-content:flex-end !important; gap:5px !important; margin-top:6px !important; padding-top:6px !important; border-top:1px solid #2a4155 !important; }
      #v111-ocp .admin-section-head > label { display:grid !important; gap:2px !important; min-width:120px !important; color:#aabfd0 !important; font-size:8px !important; }
      #v111-ocp .admin-audit-row { min-width:0 !important; padding:7px !important; border:1px solid #29465d !important; border-radius:7px !important; background:#142634 !important; }
      #v111-ocp .admin-audit-row > div { display:flex !important; justify-content:space-between !important; gap:7px !important; }
      #v111-ocp .admin-audit-row b { color:#fff !important; overflow-wrap:anywhere !important; }
      #v111-ocp .admin-audit-row > span { display:block !important; margin-top:3px !important; color:#9fb5c8 !important; font-size:8px !important; overflow-wrap:anywhere !important; }
      #v111-ocp .admin-audit-row details { margin-top:4px !important; }
      #v111-ocp .admin-audit-row summary { color:#bcd4e6 !important; cursor:pointer !important; font-size:8px !important; font-weight:800 !important; }
      #v111-ocp .admin-audit-row code { display:block !important; max-height:90px !important; margin-top:4px !important; padding:5px !important; overflow:auto !important; border-radius:5px !important; background:#0b151d !important; color:#bcd0df !important; font-size:8px !important; white-space:pre-wrap !important; overflow-wrap:anywhere !important; }
      #v111-ocp .admin-security-note { border-color:#665523 !important; background:#2b281b !important; color:#f7e8b0 !important; }
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
      @media(max-width:700px), (pointer:coarse) and (max-width:900px) {
        #v111-ocp:not(.collapsed) { font-size:11px !important; }
        #v111-ocp .dashboard-section { margin-bottom:5px !important; padding:5px !important; }
        #v111-ocp .dashboard-section-head { margin-bottom:4px !important; }
        #v111-ocp .dashboard-section-head h3 { font-size:11px !important; }
        #v111-ocp .control-overview-grid { grid-template-columns:1fr !important; gap:3px !important; }
        #v111-ocp .overview-card { padding:5px !important; }
        #v111-ocp .overview-card > h4 { font-size:11px !important; }
        #v111-ocp .dashboard-canonical-line { grid-template-columns:repeat(2,minmax(0,1fr)) !important; gap:3px !important; margin-top:3px !important; }
        #v111-ocp .announcement-card { padding:5px !important; }
        #v111-ocp .announcement-title { align-items:flex-start !important; flex-direction:column !important; gap:3px !important; }
        #v111-ocp .announcement-actions { width:100% !important; }
        #v111-ocp .announcement-actions button { flex:1 1 auto !important; }
        #v111-ocp .announcement-card p { margin:4px 0 !important; font-size:9px !important; }
        #v111-ocp .announcement-form { grid-template-columns:1fr !important; gap:4px !important; padding:5px !important; }
        #v111-ocp .announcement-form label, #v111-ocp .announcement-form .wide { grid-column:1 !important; }
        #v111-ocp .announcement-form textarea { min-height:58px !important; }
        #v111-ocp .dashboard-event-row { grid-template-columns:auto minmax(0,1fr) !important; gap:4px !important; padding:5px !important; }
        #v111-ocp .dashboard-event-row strong { grid-column:2 !important; text-align:left !important; }
        #v111-ocp .schedule-toolbar { align-items:stretch !important; flex-direction:column !important; gap:4px !important; }
        #v111-ocp .schedule-toolbar > label, #v111-ocp .schedule-toolbar select { width:100% !important; }
        #v111-ocp .schedule-summary { gap:3px !important; }
        #v111-ocp .schedule-summary > div { padding:5px 3px !important; }
        #v111-ocp .schedule-summary b { font-size:12px !important; }
        #v111-ocp .schedule-event-card { padding:5px !important; }
        #v111-ocp .schedule-event-head { align-items:stretch !important; flex-direction:column !important; gap:4px !important; }
        #v111-ocp .schedule-event-head > div:last-child { display:grid !important; grid-template-columns:repeat(2,minmax(0,1fr)) !important; width:100% !important; }
        #v111-ocp .schedule-event-time { gap:3px !important; padding:5px !important; }
        #v111-ocp .schedule-event-time span { flex-basis:100% !important; margin-left:0 !important; }
        #v111-ocp .schedule-event-form { grid-template-columns:1fr !important; gap:4px !important; padding:5px !important; }
        #v111-ocp .schedule-event-form label, #v111-ocp .schedule-event-form .wide { grid-column:1 !important; }
        #v111-ocp .schedule-event-form textarea { min-height:58px !important; }
        #v111-ocp .notification-preferences fieldset { grid-template-columns:repeat(2,minmax(0,1fr)) !important; }
        #v111-ocp .schedule-toast { right:3vw !important; bottom:8px !important; width:min(94vw,380px) !important; padding:8px !important; font-size:10px !important; }
        #v111-ocp .admin-summary { grid-template-columns:repeat(2,minmax(0,1fr)) !important; gap:3px !important; }
        #v111-ocp .admin-summary > div, #v111-ocp .admin-section { padding:5px !important; }
        #v111-ocp .admin-health-grid { grid-template-columns:1fr !important; gap:3px !important; }
        #v111-ocp .admin-health-grid article { padding:5px !important; }
        #v111-ocp .admin-mapping-row { grid-template-columns:minmax(0,1fr) auto !important; gap:4px !important; padding:5px !important; }
        #v111-ocp .admin-mapping-row select { grid-column:1 / -1 !important; }
        #v111-ocp .admin-mapping-row button { width:100% !important; }
        #v111-ocp .admin-user-card, #v111-ocp .admin-audit-row { padding:5px !important; }
        #v111-ocp .admin-user-facts { grid-template-columns:repeat(2,minmax(0,1fr)) !important; gap:3px !important; }
        #v111-ocp .admin-user-actions { display:grid !important; grid-template-columns:repeat(2,minmax(0,1fr)) !important; gap:3px !important; }
        #v111-ocp .admin-user-actions button { width:100% !important; white-space:normal !important; }
        #v111-ocp .admin-audit-row > div { display:grid !important; gap:2px !important; }
        #v111-ocp .admin-section-head { align-items:stretch !important; flex-direction:column !important; gap:4px !important; }
        #v111-ocp .admin-section-head > label { min-width:0 !important; width:100% !important; }
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
        #v111-ocp .announcement-form .announcement-pin input { min-height:16px !important; padding:0 !important; }
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
        #v111-ocp .member-modal { right:3vw !important; width:min(94vw,380px) !important; max-height:var(--v111-mobile-panel-height,40vh) !important; padding:7px !important; font-size:10px !important; }
        #v111-ocp .profile-status { margin:5px 0 !important; padding:5px !important; }
        #v111-ocp .member-analytics-section { margin:5px 0 !important; padding:5px !important; }
        #v111-ocp .member-history-section { margin:5px 0 !important; padding:5px !important; }
        #v111-ocp .history-summary { gap:3px !important; }
        #v111-ocp .member-war-metrics { grid-template-columns:repeat(2,minmax(0,1fr)) !important; }
        #v111-ocp .analytics-trends > div { grid-template-columns:1fr !important; }
        #v111-ocp .analytics-trends span { text-align:left !important; }
        #v111-ocp .profile-roles div, #v111-ocp .stat-bars div { gap:5px !important; padding:5px !important; }
      }
      @media(pointer:coarse) and (min-width:901px) {
        #v111-ocp button, #v111-ocp a.button { min-height:44px !important; }
        #v111-ocp .mini { min-height:40px !important; }
        #v111-ocp input, #v111-ocp select { min-height:44px !important; }
      }
      @media(prefers-reduced-motion:reduce) {
        #v111-ocp *, #v111-ocp *::before, #v111-ocp *::after { animation-duration:.01ms !important; animation-iteration-count:1 !important; transition-duration:.01ms !important; scroll-behavior:auto !important; }
        #v111-ocp .spinner { animation:none !important; border-color:var(--v111-gold) !important; }
      }
    `;
    try {
      if (typeof GM_addStyle === 'function') {
        GM_addStyle(css);
        return;
      }
    } catch (error) {
      console.warn('[Vault 111] Userscript style helper was unavailable; using browser styles.', error);
    }
    const style = document.createElement('style');
    style.id = 'v111-control-center-styles';
    style.textContent = css;
    (document.head || document.documentElement).appendChild(style);
  }})();
