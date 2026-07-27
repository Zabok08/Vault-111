import { beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

beforeAll(() => {
  process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
  process.env.PUBLIC_BASE_URL = "http://127.0.0.1:3000";
  process.env.VAULT111_FACTION_ID = "123";
  process.env.JWT_ISSUER = "test";
  process.env.JWT_AUDIENCE = "test";
  process.env.JWT_SECRET = "12345678901234567890123456789012";
  process.env.KEY_ENCRYPTION_ACTIVE_VERSION = "v1";
  process.env.KEY_ENCRYPTION_KEYS_JSON = JSON.stringify({
    v1: Buffer.alloc(32, 7).toString("base64")
  });
});

describe("administration role safeguards", () => {
  it("never permits Owner assignment through faction-position mappings", async () => {
    const { assignableAdminRoles } = await import("../src/admin.js");

    expect(assignableAdminRoles).toEqual([
      "ADMIN",
      "OC_PLANNER",
      "WAR_MANAGER",
      "OFFICER",
      "MEMBER"
    ]);
    expect(assignableAdminRoles).not.toContain("OWNER");
  });

  it("keeps credential and session secrets out of the administration service", () => {
    const source = readFileSync("src/admin.ts", "utf8");

    expect(source).toContain("apiKeyConnected");
    expect(source).toContain("apiKeyUpdatedAt");
    expect(source).not.toContain("encryptedApiKey");
    expect(source).not.toContain("apiKeyFingerprint");
    expect(source).not.toContain("refreshTokenHash");
    expect(source).not.toContain("ipHash");
    expect(source).not.toContain("userAgent");
  });
});
