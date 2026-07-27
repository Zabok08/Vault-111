import { db } from "./db.js";
import {
  calculateHitPoints,
  classifyPayoutHit,
  isSuccessfulPayoutHit
} from "./payouts.js";

const MAX_HISTORY_WARS = 5;

type HistoryAttack = {
  rankedWarId: number;
  result: string;
  isRankedWar: boolean;
  defenderFactionId: number | null;
  chain: number | null;
};

export function summarizeMemberWarPerformance(
  attacks: HistoryAttack[],
  opponentFactionId: number
) {
  let warHits = 0;
  let chainHits = 0;
  let outsideChainHits = 0;

  for (const attack of attacks) {
    if (!isSuccessfulPayoutHit(attack.result)) continue;
    const category = classifyPayoutHit({
      isRankedWar: attack.isRankedWar,
      defenderFactionId: attack.defenderFactionId,
      opponentFactionId,
      chain: attack.chain
    });
    if (category === "war") warHits += 1;
    else if (category === "chain") chainHits += 1;
    else outsideChainHits += 1;
  }

  return {
    attacks: attacks.length,
    successfulHits: warHits + chainHits + outsideChainHits,
    warHits,
    chainHits,
    outsideChainHits,
    points: calculateHitPoints({ warHits, chainHits, outsideChainHits })
  };
}

function warOutcome(input: {
  factionId: number;
  opponentFactionId: number;
  winnerFactionId: number | null;
  status: string;
}) {
  if (input.winnerFactionId === input.factionId) return "won" as const;
  if (input.winnerFactionId === input.opponentFactionId) return "lost" as const;
  if (/active|upcoming|scheduled|waiting/i.test(input.status)) return "active" as const;
  return "completed" as const;
}

function serializedMoney(value: bigint) {
  return value.toString();
}

export async function readMemberWarHistory(
  factionId: number,
  tornId: number
) {
  const member = await db.factionMember.findFirst({
    where: { factionId, tornId, isActive: true },
    select: { tornId: true, name: true }
  });
  if (!member) {
    throw Object.assign(new Error("Faction member not found"), {
      statusCode: 404,
      expose: true
    });
  }

  const wars = await db.rankedWar.findMany({
    where: { factionId },
    orderBy: { startsAt: "desc" },
    take: MAX_HISTORY_WARS,
    select: {
      id: true,
      factionId: true,
      opponentFactionId: true,
      opponentName: true,
      startsAt: true,
      endsAt: true,
      winnerFactionId: true,
      status: true,
      payoutPlan: {
        select: {
          status: true,
          poolAmount: true,
          finalizedAt: true,
          entries: {
            where: { tornId },
            select: {
              points: true,
              finalAmount: true,
              adjustmentNote: true
            },
            take: 1
          }
        }
      }
    }
  });

  if (!wars.length) {
    return {
      member,
      summary: {
        wars: 0,
        attacks: 0,
        successfulHits: 0,
        points: 0,
        finalizedPayoutTotal: "0"
      },
      wars: []
    };
  }

  const attacks = await db.warAttack.findMany({
    where: {
      rankedWarId: { in: wars.map(war => war.id) },
      attackerTornId: tornId
    },
    select: {
      rankedWarId: true,
      result: true,
      isRankedWar: true,
      defenderFactionId: true,
      chain: true
    }
  });
  const attacksByWar = new Map<number, HistoryAttack[]>();
  for (const attack of attacks) {
    const list = attacksByWar.get(attack.rankedWarId) ?? [];
    list.push(attack);
    attacksByWar.set(attack.rankedWarId, list);
  }

  const rows = wars.map(war => {
    const performance = summarizeMemberWarPerformance(
      attacksByWar.get(war.id) ?? [],
      war.opponentFactionId
    );
    const payoutEntry = war.payoutPlan?.entries[0] ?? null;
    const payoutFinalized = war.payoutPlan?.status === "FINALIZED";
    return {
      id: war.id,
      opponentFactionId: war.opponentFactionId,
      opponentName: war.opponentName,
      startsAt: war.startsAt,
      endsAt: war.endsAt,
      status: war.status,
      outcome: warOutcome(war),
      performance,
      payout: war.payoutPlan
        ? {
            status: war.payoutPlan.status,
            poolAmount: serializedMoney(war.payoutPlan.poolAmount),
            finalizedAt: war.payoutPlan.finalizedAt,
            finalAmount: payoutFinalized
              ? serializedMoney(payoutEntry?.finalAmount ?? 0n)
              : null,
            points: payoutFinalized
              ? payoutEntry?.points ?? performance.points
              : performance.points,
            note: payoutFinalized ? payoutEntry?.adjustmentNote ?? null : null
          }
        : null
    };
  });

  return {
    member,
    summary: {
      wars: rows.length,
      attacks: rows.reduce((total, row) => total + row.performance.attacks, 0),
      successfulHits: rows.reduce(
        (total, row) => total + row.performance.successfulHits,
        0
      ),
      points: Number(
        rows
          .reduce((total, row) => total + row.performance.points, 0)
          .toFixed(2)
      ),
      finalizedPayoutTotal: serializedMoney(
        rows.reduce(
          (total, row) =>
            total +
            (row.payout?.status === "FINALIZED"
              ? BigInt(row.payout.finalAmount ?? "0")
              : 0n),
          0n
        )
      )
    },
    wars: rows
  };
}
