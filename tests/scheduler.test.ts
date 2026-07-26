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

describe("scheduler permissions and reminder normalization", () => {
  it("scopes event types to each server-enforced role", async () => {
    const { allowedScheduleEventTypes } = await import("../src/scheduler.js");
    const base = {
      tornId: 42,
      factionId: 123,
      isSuspended: false
    };

    expect(allowedScheduleEventTypes({
      ...base,
      id: "member",
      role: "MEMBER"
    })).toEqual([]);
    expect(allowedScheduleEventTypes({
      ...base,
      id: "oc-planner",
      role: "OC_PLANNER"
    })).toEqual(["OC"]);
    expect(allowedScheduleEventTypes({
      ...base,
      id: "war-manager",
      role: "WAR_MANAGER"
    })).toEqual(["CHAIN", "RANKED_WAR"]);
    expect(allowedScheduleEventTypes({
      ...base,
      id: "officer",
      role: "OFFICER"
    })).toEqual(["CHAIN", "RANKED_WAR", "OC", "FACTION", "MEETING", "OTHER"]);
  });

  it("deduplicates, validates, and orders reminder times", async () => {
    const { normalizeReminderMinutes } = await import("../src/scheduler.js");

    expect(normalizeReminderMinutes([15, 60, 15, 0])).toEqual([60, 15, 0]);
    expect(() => normalizeReminderMinutes([])).toThrowError(
      expect.objectContaining({ statusCode: 400 })
    );
    expect(() => normalizeReminderMinutes([1, 2, 3, 4, 5, 6])).toThrowError(
      expect.objectContaining({ statusCode: 400 })
    );
  });
});
