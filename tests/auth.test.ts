import { beforeAll, describe, expect, it } from "vitest";

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

describe("server-enforced permissions", () => {
  it("allows Members to read but not synchronize", async () => {
    const { requirePermission } = await import("../src/auth.js");
    const member = {
      id: "member",
      tornId: 42,
      factionId: 123,
      role: "MEMBER",
      isSuspended: false,
      sessionVersion: 1
    } as const;

    expect(() => requirePermission(member, "oc.read")).not.toThrow();
    expect(() => requirePermission(member, "oc.sync")).toThrowError(
      expect.objectContaining({ statusCode: 403 })
    );
    expect(() => requirePermission(member, "war.read")).not.toThrow();
    expect(() => requirePermission(member, "war.sync")).toThrowError(
      expect.objectContaining({ statusCode: 403 })
    );
    expect(() => requirePermission(member, "war.payout.read")).not.toThrow();
    expect(() => requirePermission(member, "war.payout.manage")).toThrowError(
      expect.objectContaining({ statusCode: 403 })
    );
    expect(() => requirePermission(member, "members.read")).not.toThrow();
    expect(() => requirePermission(member, "members.analytics.read_all")).toThrowError(
      expect.objectContaining({ statusCode: 403 })
    );
    expect(() => requirePermission(member, "dashboard.read")).not.toThrow();
    expect(() => requirePermission(member, "schedule.read")).not.toThrow();
    expect(() => requirePermission(member, "schedule.manage")).toThrowError(
      expect.objectContaining({ statusCode: 403 })
    );
    expect(() => requirePermission(member, "admin.read")).toThrowError(
      expect.objectContaining({ statusCode: 403 })
    );
    expect(() => requirePermission(member, "admin.manage")).toThrowError(
      expect.objectContaining({ statusCode: 403 })
    );
    expect(() => requirePermission(member, "announcements.manage")).toThrowError(
      expect.objectContaining({ statusCode: 403 })
    );
  });

  it("allows OC Planners to synchronize", async () => {
    const { requirePermission } = await import("../src/auth.js");
    const planner = {
      id: "planner",
      tornId: 43,
      factionId: 123,
      role: "OC_PLANNER",
      isSuspended: false,
      sessionVersion: 1
    } as const;

    expect(() => requirePermission(planner, "oc.sync")).not.toThrow();
    expect(() => requirePermission(planner, "war.read")).not.toThrow();
    expect(() => requirePermission(planner, "war.sync")).toThrow();
    expect(() => requirePermission(planner, "schedule.manage_oc")).not.toThrow();
    expect(() => requirePermission(planner, "schedule.manage_war")).toThrow();
  });

  it("allows War Managers to synchronize wars without OC assignment access", async () => {
    const { requirePermission } = await import("../src/auth.js");
    const warManager = {
      id: "war-manager",
      tornId: 44,
      factionId: 123,
      role: "WAR_MANAGER",
      isSuspended: false,
      sessionVersion: 1
    } as const;

    expect(() => requirePermission(warManager, "war.sync")).not.toThrow();
    expect(() => requirePermission(warManager, "war.manage")).not.toThrow();
    expect(() => requirePermission(warManager, "war.payout.manage")).not.toThrow();
    expect(() => requirePermission(warManager, "war.payout.reopen")).toThrow();
    expect(() => requirePermission(warManager, "schedule.manage_war")).not.toThrow();
    expect(() => requirePermission(warManager, "schedule.manage_oc")).toThrow();
    expect(() => requirePermission(warManager, "oc.assign")).toThrowError(
      expect.objectContaining({ statusCode: 403 })
    );
  });

  it("allows Officers to edit target notes without granting war synchronization", async () => {
    const { requirePermission } = await import("../src/auth.js");
    const officer = {
      id: "officer",
      tornId: 45,
      factionId: 123,
      role: "OFFICER",
      isSuspended: false,
      sessionVersion: 1
    } as const;

    expect(() => requirePermission(officer, "war.read")).not.toThrow();
    expect(() => requirePermission(officer, "war.notes")).not.toThrow();
    expect(() => requirePermission(officer, "war.payout.read")).not.toThrow();
    expect(() => requirePermission(officer, "war.payout.manage")).toThrow();
    expect(() => requirePermission(officer, "announcements.manage")).not.toThrow();
    expect(() => requirePermission(officer, "schedule.manage")).not.toThrow();
    expect(() => requirePermission(officer, "war.sync")).toThrowError(
      expect.objectContaining({ statusCode: 403 })
    );
  });

  it("reserves reopening finalized payouts for Administrators and the Owner", async () => {
    const { requirePermission } = await import("../src/auth.js");
    const administrator = {
      id: "administrator",
      tornId: 46,
      factionId: 123,
      role: "ADMIN",
      isSuspended: false,
      sessionVersion: 1
    } as const;

    expect(() => requirePermission(administrator, "war.payout.manage")).not.toThrow();
    expect(() => requirePermission(administrator, "war.payout.reopen")).not.toThrow();
    expect(() => requirePermission(administrator, "members.read")).not.toThrow();
    expect(() => requirePermission(administrator, "members.analytics.read_all")).not.toThrow();
    expect(() => requirePermission(administrator, "announcements.manage")).not.toThrow();
    expect(() => requirePermission(administrator, "schedule.manage")).not.toThrow();
    expect(() => requirePermission(administrator, "admin.read")).not.toThrow();
    expect(() => requirePermission(administrator, "admin.manage")).toThrowError(
      expect.objectContaining({ statusCode: 403 })
    );
  });

  it("reserves administration mutations for the Owner wildcard role", async () => {
    const { issueAccessToken, requirePermission } = await import("../src/auth.js");
    const { decodeJwt } = await import("jose");
    const owner = {
      id: "owner",
      tornId: 47,
      factionId: 123,
      role: "OWNER",
      isSuspended: false,
      sessionVersion: 1
    } as const;

    expect(() => requirePermission(owner, "admin.read")).not.toThrow();
    expect(() => requirePermission(owner, "admin.manage")).not.toThrow();
    expect(decodeJwt(await issueAccessToken(owner)).sessionVersion).toBe(1);
  });
});
