import { describe, expect, it } from "vitest";
import { summarizeMemberWarPerformance } from "../src/memberWarHistory.js";

describe("member ranked-war history", () => {
  it("uses the same fixed payout-point rules as the payout calculator", () => {
    const summary = summarizeMemberWarPerformance(
      [
        {
          rankedWarId: 10,
          result: "Hospitalized",
          isRankedWar: true,
          defenderFactionId: 222,
          chain: 15
        },
        {
          rankedWarId: 10,
          result: "Attacked",
          isRankedWar: false,
          defenderFactionId: 333,
          chain: 8
        },
        {
          rankedWarId: 10,
          result: "Mugged",
          isRankedWar: false,
          defenderFactionId: 444,
          chain: null
        },
        {
          rankedWarId: 10,
          result: "Lost",
          isRankedWar: false,
          defenderFactionId: 444,
          chain: 9
        }
      ],
      222
    );

    expect(summary).toEqual({
      attacks: 4,
      successfulHits: 3,
      warHits: 1,
      chainHits: 1,
      outsideChainHits: 1,
      points: 1.75
    });
  });

  it("does not count assists or failed attacks as payout hits", () => {
    const summary = summarizeMemberWarPerformance(
      [
        {
          rankedWarId: 11,
          result: "Assist",
          isRankedWar: true,
          defenderFactionId: 222,
          chain: 1
        },
        {
          rankedWarId: 11,
          result: "Escape",
          isRankedWar: false,
          defenderFactionId: 333,
          chain: null
        }
      ],
      222
    );

    expect(summary.successfulHits).toBe(0);
    expect(summary.points).toBe(0);
    expect(summary.attacks).toBe(2);
  });
});
