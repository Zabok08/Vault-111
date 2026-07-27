import { describe, expect, it } from "vitest";
import {
  calculateHitPoints,
  classifyPayoutHit,
  calculateWarPayout,
  parseMoney,
  type PayoutParticipant
} from "../src/payouts.js";

const participants: PayoutParticipant[] = [
  {
    tornId: 1,
    name: "Alpha",
    position: "Member",
    warHits: 5,
    chainHits: 2,
    outsideChainHits: 0,
    points: 6
  },
  {
    tornId: 2,
    name: "Bravo",
    position: "Member",
    warHits: 2,
    chainHits: 1,
    outsideChainHits: 2,
    points: 3
  }
];

describe("ranked-war payout calculation", () => {
  it("scores the three successful-hit categories with fixed point values", () => {
    expect(calculateHitPoints({
      warHits: 4,
      chainHits: 3,
      outsideChainHits: 2
    })).toBe(6);
  });

  it("classifies war, chain, and non-chain hits from Torn attack fields", () => {
    expect(classifyPayoutHit({
      isRankedWar: true,
      defenderFactionId: 456,
      opponentFactionId: 456,
      chain: 22
    })).toBe("war");
    expect(classifyPayoutHit({
      isRankedWar: false,
      defenderFactionId: 999,
      opponentFactionId: 456,
      chain: 23
    })).toBe("chain");
    expect(classifyPayoutHit({
      isRankedWar: false,
      defenderFactionId: 999,
      opponentFactionId: 456,
      chain: null
    })).toBe("outside_chain");
  });

  it("distributes the complete pool according to total hit points", () => {
    const result = calculateWarPayout({
      poolAmount: 900_001n,
      participants
    });

    expect(result.totalPoints).toBe(9);
    expect(result.allocatedBase).toBe(900_001n);
    expect(result.unallocatedPool).toBe(0n);
    expect(result.rows.reduce((total, row) => total + row.baseAmount, 0n)).toBe(900_001n);
    expect(result.rows[0]!.name).toBe("Alpha");
    expect(result.rows[0]!.share).toBeCloseTo(2 / 3);
  });

  it("applies manual bonuses and caps deductions at a zero final payout", () => {
    const result = calculateWarPayout({
      poolAmount: 900n,
      participants,
      adjustments: [
        { tornId: 1, amount: -10_000n, note: "Deduction" },
        { tornId: 2, amount: 250n, note: "Bonus" }
      ]
    });
    const alpha = result.rows.find(row => row.tornId === 1);
    const bravo = result.rows.find(row => row.tornId === 2);

    expect(alpha?.finalAmount).toBe(0n);
    expect(alpha?.adjustmentNote).toBe("Deduction");
    expect(bravo?.finalAmount).toBe((bravo?.baseAmount ?? 0n) + 250n);
  });

  it("validates safe whole-dollar amounts", () => {
    expect(parseMoney("2500000000")).toBe(2_500_000_000n);
    expect(parseMoney("-500", { signed: true })).toBe(-500n);
    expect(() => parseMoney("-1")).toThrow();
    expect(() => parseMoney("1.25")).toThrow("Money amounts must use whole dollars");
  });
});
