import { db } from "./db.js";

export const MAX_MONEY = BigInt(Number.MAX_SAFE_INTEGER);

export type PayoutParticipant = {
  tornId: number;
  name: string;
  position: string | null;
  warHits: number;
  chainHits: number;
  outsideChainHits: number;
  points: number;
};

export type PayoutAdjustment = {
  tornId: number;
  amount: bigint;
  note: string | null;
};

export type CalculatedPayoutRow = PayoutParticipant & {
  share: number;
  baseAmount: bigint;
  adjustmentAmount: bigint;
  finalAmount: bigint;
  adjustmentNote: string | null;
};

const successfulHitResults = new Set([
  "Attacked",
  "Mugged",
  "Hospitalized",
  "Arrested",
  "Looted",
  "Special",
  "Bounty"
]);

export function isSuccessfulPayoutHit(result: string) {
  return successfulHitResults.has(result);
}

function httpError(message: string, statusCode: number) {
  return Object.assign(new Error(message), { statusCode });
}

export function parseMoney(value: string, { signed = false } = {}) {
  const pattern = signed ? /^-?\d+$/ : /^\d+$/;
  if (!pattern.test(value)) throw httpError("Money amounts must use whole dollars", 400);
  const parsed = BigInt(value);
  if (signed) {
    if (parsed < -MAX_MONEY || parsed > MAX_MONEY) {
      throw httpError("Money amount is outside the supported range", 400);
    }
  } else if (parsed < 0n || parsed > MAX_MONEY) {
    throw httpError("Money amount is outside the supported range", 400);
  }
  return parsed;
}

export function calculateHitPoints(input: {
  warHits: number;
  chainHits: number;
  outsideChainHits: number;
}) {
  return input.warHits + input.chainHits * 0.5 + input.outsideChainHits * 0.25;
}

export function classifyPayoutHit(input: {
  isRankedWar: boolean;
  defenderFactionId: number | null;
  opponentFactionId: number;
  chain: number | null;
}) {
  if (input.isRankedWar && input.defenderFactionId === input.opponentFactionId) return "war" as const;
  if (input.chain !== null && input.chain > 0) return "chain" as const;
  return "outside_chain" as const;
}

export function calculateWarPayout(input: {
  poolAmount: bigint;
  participants: PayoutParticipant[];
  adjustments?: PayoutAdjustment[];
}) {
  if (input.poolAmount < 0n || input.poolAmount > MAX_MONEY) {
    throw httpError("Payout pool is outside the supported range", 400);
  }

  const adjustmentMap = new Map(
    (input.adjustments ?? []).map(adjustment => [adjustment.tornId, adjustment])
  );
  const participants = input.participants.filter(
    participant => participant.points > 0 || adjustmentMap.has(participant.tornId)
  );
  const totalPoints = participants.reduce((total, participant) => total + participant.points, 0);
  const poolNumber = Number(input.poolAmount);
  const provisional = participants.map(participant => {
    const share = totalPoints > 0 ? participant.points / totalPoints : 0;
    const rawAmount = poolNumber * share;
    return {
      participant,
      share,
      rawAmount,
      baseAmount: BigInt(Math.floor(rawAmount))
    };
  });

  let allocated = provisional.reduce((total, member) => total + member.baseAmount, 0n);
  let remainder = input.poolAmount - allocated;
  const remainderOrder = [...provisional].sort(
    (a, b) =>
      (b.rawAmount - Math.floor(b.rawAmount)) - (a.rawAmount - Math.floor(a.rawAmount)) ||
      b.participant.points - a.participant.points ||
      b.participant.warHits - a.participant.warHits ||
      a.participant.tornId - b.participant.tornId
  );
  for (let index = 0; remainder > 0n && remainderOrder.length; index += 1) {
    const recipient = remainderOrder[index % remainderOrder.length]!;
    recipient.baseAmount += 1n;
    remainder -= 1n;
  }
  const deductionOrder = [...remainderOrder].reverse();
  for (let index = 0; remainder < 0n && deductionOrder.length; index += 1) {
    const recipient = deductionOrder[index % deductionOrder.length]!;
    if (recipient.baseAmount === 0n) continue;
    recipient.baseAmount -= 1n;
    remainder += 1n;
  }

  const rows: CalculatedPayoutRow[] = provisional.map(member => {
    const adjustment = adjustmentMap.get(member.participant.tornId);
    const requestedAdjustment = adjustment?.amount ?? 0n;
    const adjusted = member.baseAmount + requestedAdjustment;
    return {
      ...member.participant,
      share: member.share,
      baseAmount: member.baseAmount,
      adjustmentAmount: requestedAdjustment,
      finalAmount: adjusted > 0n ? adjusted : 0n,
      adjustmentNote: adjustment?.note ?? null
    };
  }).sort(
    (a, b) =>
      Number(b.finalAmount - a.finalAmount) ||
      b.points - a.points ||
      b.warHits - a.warHits ||
      a.name.localeCompare(b.name)
  );

  allocated = rows.reduce((total, row) => total + row.baseAmount, 0n);
  const finalTotal = rows.reduce((total, row) => total + row.finalAmount, 0n);
  return {
    rows,
    poolAmount: input.poolAmount,
    totalPoints,
    allocatedBase: allocated,
    unallocatedPool: input.poolAmount - allocated,
    finalTotal
  };
}

async function readWarParticipants(
  rankedWarId: number,
  factionId: number,
  opponentFactionId: number
): Promise<PayoutParticipant[]> {
  const [members, attacks] = await Promise.all([
    db.factionMember.findMany({
      where: { factionId, isActive: true },
      select: { tornId: true, name: true, position: true }
    }),
    db.warAttack.findMany({
      where: { rankedWarId },
      select: {
        attackerTornId: true,
        attackerName: true,
        attackerFactionId: true,
        defenderFactionId: true,
        result: true,
        chain: true,
        isRankedWar: true
      }
    })
  ]);
  const summaries = new Map<number, PayoutParticipant>();
  for (const member of members) {
    summaries.set(member.tornId, {
      tornId: member.tornId,
      name: member.name,
      position: member.position,
      warHits: 0,
      chainHits: 0,
      outsideChainHits: 0,
      points: 0
    });
  }
  for (const attack of attacks) {
    if (
      !attack.attackerTornId ||
      !successfulHitResults.has(attack.result) ||
      (attack.attackerFactionId !== null && attack.attackerFactionId !== factionId)
    ) continue;
    const summary = summaries.get(attack.attackerTornId) ?? {
      tornId: attack.attackerTornId,
      name: attack.attackerName ?? `Player ${attack.attackerTornId}`,
      position: null,
      warHits: 0,
      chainHits: 0,
      outsideChainHits: 0,
      points: 0
    };
    const category = classifyPayoutHit({
      isRankedWar: attack.isRankedWar,
      defenderFactionId: attack.defenderFactionId,
      opponentFactionId,
      chain: attack.chain
    });
    if (category === "war") summary.warHits += 1;
    else if (category === "chain") summary.chainHits += 1;
    else summary.outsideChainHits += 1;
    summary.points = calculateHitPoints(summary);
    summaries.set(summary.tornId, summary);
  }
  return Array.from(summaries.values());
}

function serializedMoney(value: bigint) {
  return value.toString();
}

function serializeCalculatedRow(row: CalculatedPayoutRow) {
  return {
    ...row,
    baseAmount: serializedMoney(row.baseAmount),
    adjustmentAmount: serializedMoney(row.adjustmentAmount),
    finalAmount: serializedMoney(row.finalAmount)
  };
}

export async function readWarPayout(factionId: number, rankedWarId: number) {
  const war = await db.rankedWar.findFirst({
    where: { id: rankedWarId, factionId },
    select: {
      id: true,
      factionId: true,
      factionName: true,
      opponentFactionId: true,
      opponentName: true,
      startsAt: true,
      endsAt: true,
      status: true,
      syncedAt: true
    }
  });
  if (!war) throw httpError("Ranked war not found", 404);

  const plan = await db.warPayoutPlan.findUnique({
    where: { rankedWarId },
    include: {
      adjustments: true,
      entries: { orderBy: [{ finalAmount: "desc" }, { name: "asc" }] },
      updatedBy: { select: { tornId: true, name: true } },
      finalizedBy: { select: { tornId: true, name: true } }
    }
  });

  if (plan?.status === "FINALIZED") {
    const rows = plan.entries.map(entry => ({
      tornId: entry.tornId,
      name: entry.name,
      position: entry.position,
      warHits: entry.warHits,
      chainHits: entry.chainHits,
      outsideChainHits: entry.outsideChainHits,
      points: entry.points,
      share: entry.share,
      baseAmount: serializedMoney(entry.baseAmount),
      adjustmentAmount: serializedMoney(entry.adjustmentAmount),
      finalAmount: serializedMoney(entry.finalAmount),
      adjustmentNote: entry.adjustmentNote
    }));
    return {
      war,
      rules: {
        warHitPoints: 1,
        chainHitPoints: 0.5,
        outsideChainHitPoints: 0.25
      },
      plan: {
        id: plan.id,
        status: plan.status,
        version: plan.version,
        poolAmount: serializedMoney(plan.poolAmount),
        totalPoints: rows.reduce((total, row) => total + row.points, 0),
        finalTotal: serializedMoney(rows.reduce((total, row) => total + BigInt(row.finalAmount), 0n)),
        updatedAt: plan.updatedAt,
        updatedBy: plan.updatedBy,
        finalizedAt: plan.finalizedAt,
        finalizedBy: plan.finalizedBy
      },
      rows
    };
  }

  const participants = await readWarParticipants(
    rankedWarId,
    factionId,
    war.opponentFactionId
  );
  const calculation = calculateWarPayout({
    poolAmount: plan?.poolAmount ?? 0n,
    participants,
    adjustments: plan
      ? plan.adjustments.map(adjustment => ({
          tornId: adjustment.tornId,
          amount: adjustment.amount,
          note: adjustment.note
        }))
      : []
  });
  return {
    war,
    rules: {
      warHitPoints: 1,
      chainHitPoints: 0.5,
      outsideChainHitPoints: 0.25
    },
    plan: plan
      ? {
          id: plan.id,
          status: plan.status,
          version: plan.version,
          poolAmount: serializedMoney(plan.poolAmount),
          totalPoints: calculation.totalPoints,
          finalTotal: serializedMoney(calculation.finalTotal),
          allocatedBase: serializedMoney(calculation.allocatedBase),
          unallocatedPool: serializedMoney(calculation.unallocatedPool),
          updatedAt: plan.updatedAt,
          updatedBy: plan.updatedBy,
          finalizedAt: null,
          finalizedBy: null
        }
      : null,
    rows: calculation.rows.map(serializeCalculatedRow)
  };
}

export async function saveWarPayoutSettings(input: {
  factionId: number;
  rankedWarId: number;
  actorUserId: string;
  poolAmount: bigint;
  expectedVersion: number;
}) {
  const war = await db.rankedWar.findFirst({
    where: { id: input.rankedWarId, factionId: input.factionId },
    select: { id: true }
  });
  if (!war) throw httpError("Ranked war not found", 404);

  if (input.expectedVersion === 0) {
    try {
      return await db.warPayoutPlan.create({
        data: {
          rankedWarId: input.rankedWarId,
          factionId: input.factionId,
          poolAmount: input.poolAmount,
          updatedByUserId: input.actorUserId
        }
      });
    } catch (error) {
      if ((error as { code?: string }).code === "P2002") {
        throw httpError("Payout plan changed; refresh before editing", 409);
      }
      throw error;
    }
  }

  const updated = await db.warPayoutPlan.updateMany({
    where: {
      rankedWarId: input.rankedWarId,
      factionId: input.factionId,
      status: "DRAFT",
      version: input.expectedVersion
    },
    data: {
      poolAmount: input.poolAmount,
      updatedByUserId: input.actorUserId,
      version: { increment: 1 }
    }
  });
  if (updated.count !== 1) throw httpError("Payout plan changed or is locked; refresh before editing", 409);
}

export async function saveWarPayoutAdjustment(input: {
  factionId: number;
  rankedWarId: number;
  actorUserId: string;
  tornId: number;
  amount: bigint;
  note: string | null;
  expectedVersion: number;
}) {
  const plan = await db.warPayoutPlan.findFirst({
    where: { rankedWarId: input.rankedWarId, factionId: input.factionId },
    select: { id: true, status: true }
  });
  if (!plan) throw httpError("Create the payout draft before adding adjustments", 409);
  if (plan.status !== "DRAFT") throw httpError("Finalized payouts are locked", 409);
  const [member, attacker] = await Promise.all([
    db.factionMember.findUnique({
      where: {
        factionId_tornId: {
          factionId: input.factionId,
          tornId: input.tornId
        }
      },
      select: { tornId: true }
    }),
    db.warAttack.findFirst({
      where: {
        rankedWarId: input.rankedWarId,
        attackerTornId: input.tornId,
        attackerFactionId: input.factionId
      },
      select: { id: true }
    })
  ]);
  if (!member && !attacker) throw httpError("Payout member was not found in this faction or war", 404);

  await db.$transaction(async transaction => {
    const updated = await transaction.warPayoutPlan.updateMany({
      where: {
        id: plan.id,
        status: "DRAFT",
        version: input.expectedVersion
      },
      data: {
        updatedByUserId: input.actorUserId,
        version: { increment: 1 }
      }
    });
    if (updated.count !== 1) throw httpError("Payout plan changed; refresh before editing", 409);
    if (input.amount === 0n && !input.note) {
      await transaction.warPayoutAdjustment.deleteMany({
        where: { planId: plan.id, tornId: input.tornId }
      });
    } else {
      await transaction.warPayoutAdjustment.upsert({
        where: { planId_tornId: { planId: plan.id, tornId: input.tornId } },
        create: {
          planId: plan.id,
          tornId: input.tornId,
          amount: input.amount,
          note: input.note,
          updatedByUserId: input.actorUserId
        },
        update: {
          amount: input.amount,
          note: input.note,
          updatedByUserId: input.actorUserId
        }
      });
    }
  });
}

export async function finalizeWarPayout(input: {
  factionId: number;
  rankedWarId: number;
  actorUserId: string;
  expectedVersion: number;
}) {
  const war = await db.rankedWar.findFirst({
    where: { id: input.rankedWarId, factionId: input.factionId },
    select: { id: true, status: true, opponentFactionId: true }
  });
  if (!war) throw httpError("Ranked war not found", 404);
  if (war.status.toLowerCase() !== "finished") {
    throw httpError("Payouts can only be finalized after the ranked war is finished", 409);
  }
  const plan = await db.warPayoutPlan.findFirst({
    where: { rankedWarId: input.rankedWarId, factionId: input.factionId },
    include: { adjustments: true }
  });
  if (!plan) throw httpError("Create a payout draft before finalizing", 409);
  if (plan.status !== "DRAFT" || plan.version !== input.expectedVersion) {
    throw httpError("Payout plan changed or is already locked; refresh before finalizing", 409);
  }

  const participants = await readWarParticipants(
    input.rankedWarId,
    input.factionId,
    war.opponentFactionId
  );
  const calculation = calculateWarPayout({
    poolAmount: plan.poolAmount,
    participants,
    adjustments: plan.adjustments.map(adjustment => ({
      tornId: adjustment.tornId,
      amount: adjustment.amount,
      note: adjustment.note
    }))
  });
  if (plan.poolAmount > 0n && calculation.allocatedBase === 0n) {
    throw httpError("The payout pool cannot be finalized without eligible successful hits", 409);
  }

  await db.$transaction(async transaction => {
    const updated = await transaction.warPayoutPlan.updateMany({
      where: {
        id: plan.id,
        status: "DRAFT",
        version: input.expectedVersion
      },
      data: {
        status: "FINALIZED",
        version: { increment: 1 },
        finalizedAt: new Date(),
        finalizedByUserId: input.actorUserId,
        updatedByUserId: input.actorUserId
      }
    });
    if (updated.count !== 1) throw httpError("Payout plan changed; refresh before finalizing", 409);
    await transaction.warPayoutEntry.deleteMany({ where: { planId: plan.id } });
    if (calculation.rows.length) {
      await transaction.warPayoutEntry.createMany({
        data: calculation.rows.map(row => ({
          planId: plan.id,
          tornId: row.tornId,
          name: row.name,
          position: row.position,
          warHits: row.warHits,
          chainHits: row.chainHits,
          outsideChainHits: row.outsideChainHits,
          points: row.points,
          share: row.share,
          baseAmount: row.baseAmount,
          adjustmentAmount: row.adjustmentAmount,
          finalAmount: row.finalAmount,
          adjustmentNote: row.adjustmentNote
        }))
      });
    }
  }, { timeout: 30_000 });
}

export async function reopenWarPayout(input: {
  factionId: number;
  rankedWarId: number;
  actorUserId: string;
  expectedVersion: number;
}) {
  const plan = await db.warPayoutPlan.findFirst({
    where: { rankedWarId: input.rankedWarId, factionId: input.factionId },
    select: { id: true }
  });
  if (!plan) throw httpError("Payout plan not found", 404);
  await db.$transaction(async transaction => {
    const updated = await transaction.warPayoutPlan.updateMany({
      where: {
        id: plan.id,
        status: "FINALIZED",
        version: input.expectedVersion
      },
      data: {
        status: "DRAFT",
        version: { increment: 1 },
        finalizedAt: null,
        finalizedByUserId: null,
        updatedByUserId: input.actorUserId
      }
    });
    if (updated.count !== 1) throw httpError("Payout plan changed or is not finalized; refresh before reopening", 409);
    await transaction.warPayoutEntry.deleteMany({ where: { planId: plan.id } });
  });
}
