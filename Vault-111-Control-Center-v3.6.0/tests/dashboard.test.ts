import { describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import {
  summarizeDashboardCrimes,
  summarizeDashboardMembers
} from "../src/dashboard.js";

describe("unified dashboard summaries", () => {
  it("summarizes member availability and public status groups", () => {
    const now = Date.UTC(2026, 6, 25, 12);
    const summary = summarizeDashboardMembers(
      [
        {
          isInOc: false,
          status: "Okay",
          lastActionAt: new Date(now - 60_000)
        },
        {
          isInOc: true,
          status: "Okay",
          lastActionAt: new Date(now - 60_000)
        },
        {
          isInOc: false,
          status: "Hospital",
          lastActionAt: new Date(now - 4 * 24 * 60 * 60 * 1000)
        },
        {
          isInOc: false,
          status: "Traveling",
          lastActionAt: new Date(now - 60_000)
        }
      ],
      now
    );

    expect(summary).toEqual({
      total: 4,
      inOc: 1,
      available: 1,
      hospitalized: 1,
      traveling: 1,
      inactive: 1
    });
  });

  it("counts planning, recruiting, ready, filled, and open crime roles", () => {
    const now = Date.UTC(2026, 6, 25, 12);
    const summary = summarizeDashboardCrimes(
      [
        {
          status: "Planning",
          readyAt: new Date(now - 1_000),
          tornPayload: {
            slots: [
              { position: "Driver", user: { id: 10 } },
              { position: "Muscle", user: null }
            ]
          } as Prisma.JsonValue
        },
        {
          status: "Recruiting",
          readyAt: new Date(now + 60_000),
          tornPayload: {
            slots: [
              { position: "Hacker", user_id: 11 },
              { position: "Driver" }
            ]
          } as Prisma.JsonValue
        }
      ],
      now
    );

    expect(summary).toEqual({
      total: 2,
      planning: 1,
      recruiting: 1,
      ready: 1,
      openRoles: 2,
      filledRoles: 2
    });
  });
});
