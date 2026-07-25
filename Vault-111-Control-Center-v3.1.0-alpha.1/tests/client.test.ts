import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const client = readFileSync(
  resolve("client/Vault-111-Control-Center-v3.1.0-alpha.1.user.js"),
  "utf8"
);

describe("Tampermonkey release client", () => {
  it("includes the accessibility and motion safeguards required for v3.1", () => {
    expect(client).toContain('role="tablist"');
    expect(client).toContain('role="tabpanel"');
    expect(client).toContain('role="dialog"');
    expect(client).toContain('aria-modal="true"');
    expect(client).toContain("event.key === 'Escape'");
    expect(client).toContain('aria-live="polite"');
    expect(client).toContain(":focus-visible");
    expect(client).toContain("@media(prefers-reduced-motion:reduce)");
  });

  it("keeps refreshes on the current tab and contains no obsolete dropdown rules", () => {
    expect(client).toContain("const returnTab = returnToBackend ? 'backend' : state.ui.activeTab;");
    expect(client).not.toContain("switchTab('optimizer')");
    expect(client).not.toContain("details.crime-card");
    expect(client).not.toContain(".planning-group[open]");
  });

  it("wakes a sleeping free host before protected requests without retrying mutations", () => {
    expect(client).toContain("async function ensureBackendAwake(force = false)");
    expect(client).toContain("await ensureBackendAwake();");
    expect(client).toContain("backendRequest('GET', '/health'");
    expect(client).toContain("timeoutMs: Math.min(65000");
    expect(client).toContain("did not become ready within 90 seconds");
    expect(client.match(/backendRequest\('GET', '\/health'/g)).toHaveLength(1);
  });

  it("retains the requested alpha.12 UI and API-screen behavior", () => {
    expect(client).toContain("v111-control-center-singleton");
    expect(client).toContain("collapsedPosition");
    expect(client).toContain("data-drag-handle");
    expect(client).toContain("addEventListener('pointerdown'");
    expect(client).toContain("max-height:40vh");
    expect(client).toContain("backendStatsLastAutoSync");
    expect(client).toContain("syncOwnCrimeStats");
    expect(client).toContain("syncBackendPersonalStats({ automatic: true })");
    expect(client).toContain("Enter only your own Torn API key.");
    expect(client).toContain("first connection may take about a minute");
  });

  it("keeps the navigation outside the scroller and compacts mobile content", () => {
    expect(client).toContain("function getScrollContainer()");
    expect(client).toContain("root?.querySelector('main')");
    expect(client).toContain("flex-direction:column !important; min-height:0 !important");
    expect(client).toContain("position:relative !important; top:auto !important; z-index:20 !important");
    expect(client).toContain("overflow-y:auto !important; overflow-x:hidden !important");
    expect(client).toContain("grid-template-columns:repeat(2,minmax(0,1fr)) !important");
    expect(client).toContain("@media(pointer:coarse) and (min-width:601px)");
  });

  it("uses measured flex sizing instead of clipping against assumed header heights", () => {
    expect(client).toContain("display: flex !important;");
    expect(client).toContain("flex: 0 0 auto !important;");
    expect(client).toContain("flex:1 1 auto !important; flex-direction:column !important");
    expect(client).toContain("#v111-ocp:not(.collapsed) .body { max-height:none !important; }");
    expect(client).toContain("#v111-ocp.collapsed { width:300px !important; max-height:none !important; }");
    expect(client).toContain("#v111-ocp.collapsed { width:min(240px,calc(100vw - 24px)) !important; max-height:none !important; }");
    expect(client).not.toContain("max-height:calc(82vh - 48px)");
    expect(client).not.toContain("max-height:calc(40vh - 40px)");
  });

  it("provides a secure ranked-war module without client-side permission trust", () => {
    expect(client).toContain("data-tab=\"war\"");
    expect(client).toContain("renderWarPanel()");
    expect(client).toContain("backendCanWarSync()");
    expect(client).toContain("backendApi('POST', '/v1/war/sync'");
    expect(client).toContain("backendApi('GET', '/v1/war/snapshot'");
    expect(client).toContain("Member participation");
    expect(client).toContain("Recent ranked-war attacks");
    expect(client).toContain("data-war-countdown");
  });
});
