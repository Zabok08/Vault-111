import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const client = readFileSync(
  resolve("client/Vault-111-Control-Center-v3.0.0-alpha.11.user.js"),
  "utf8"
);

describe("Tampermonkey release client", () => {
  it("includes the accessibility and motion safeguards required for alpha.11", () => {
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
});
