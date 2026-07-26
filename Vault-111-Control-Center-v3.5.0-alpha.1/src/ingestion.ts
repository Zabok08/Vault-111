import { AppRole, type Prisma } from "@prisma/client";
import type { Principal } from "./auth.js";
import { decryptSecret } from "./crypto.js";
import { db } from "./db.js";
import {
  fetchFactionPlanningData,
  fetchFactionWarData,
  fetchPersonalCrimeStats,
  verifyTornIdentity
} from "./torn.js";

const LOCK_STALE_AFTER_MS = 2 * 60_000;

function httpError(message: string, statusCode: number) {
  return Object.assign(new Error(message), { statusCode, expose: true });
}

function unixDate(value: number | null) {
  return value ? new Date(value * 1000) : null;
}

function safeErrorMessage(error: unknown) {
  return String(error instanceof Error ? error.message : "Unknown synchronization error")
    .replace(/[A-Za-z0-9_-]{16,}/g, "[redacted]")
    .slice(0, 300);
}

async function acquireSyncLock(factionId: number, tornId: number) {
  await db.factionSyncState.upsert({
    where: { factionId },
    create: { factionId },
    update: {}
  });
  const now = new Date();
  const claimed = await db.factionSyncState.updateMany({
    where: {
      factionId,
      OR: [
        { inProgressAt: null },
        { inProgressAt: { lt: new Date(now.getTime() - LOCK_STALE_AFTER_MS) } }
      ]
    },
    data: {
      inProgressAt: now,
      lastAttemptAt: now,
      syncedByTornId: tornId,
      lastError: null
    }
  });
  if (claimed.count !== 1) {
    throw httpError("A faction synchronization is already running", 409);
  }
}

async function acquireWarSyncLock(factionId: number, tornId: number) {
  await db.warSyncState.upsert({
    where: { factionId },
    create: { factionId },
    update: {}
  });
  const now = new Date();
  const claimed = await db.warSyncState.updateMany({
    where: {
      factionId,
      OR: [
        { inProgressAt: null },
        { inProgressAt: { lt: new Date(now.getTime() - LOCK_STALE_AFTER_MS) } }
      ]
    },
    data: {
      inProgressAt: now,
      lastAttemptAt: now,
      syncedByTornId: tornId,
      lastError: null
    }
  });
  if (claimed.count !== 1) {
    throw httpError("A ranked-war synchronization is already running", 409);
  }
}

async function suspendInvalidMember(userId: string) {
  const now = new Date();
  await db.$transaction([
    db.user.update({ where: { id: userId }, data: { isSuspended: true } }),
    db.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: now }
    })
  ]);
}

export async function synchronizeFaction(principal: Principal) {
  const actor = await db.user.findUnique({ where: { id: principal.id } });
  if (!actor || actor.isSuspended) throw httpError("Authentication required", 401);
  if (!actor.encryptedApiKey) {
    throw httpError("Reconnect your Torn API key before synchronizing", 409);
  }

  await acquireSyncLock(actor.factionId, actor.tornId);
  try {
    const apiKey = decryptSecret(actor.encryptedApiKey, `torn-api-key:${actor.tornId}`);
    const identity = await verifyTornIdentity(apiKey);
    if (identity.tornId !== actor.tornId || identity.factionId !== actor.factionId) {
      await suspendInvalidMember(actor.id);
      throw httpError("Vault 111 membership could not be re-verified", 403);
    }

    const mapping = identity.factionPosition
      ? await db.roleMapping.findUnique({
          where: {
            factionId_factionPosition: {
              factionId: identity.factionId,
              factionPosition: identity.factionPosition
            }
          }
        })
      : null;
    const role = actor.role === AppRole.OWNER
      ? AppRole.OWNER
      : (mapping?.appRole ?? AppRole.MEMBER);

    const snapshot = await fetchFactionPlanningData(apiKey);
    const now = new Date();

    await db.$transaction(async transaction => {
      await transaction.factionMember.updateMany({
        where: { factionId: actor.factionId, isActive: true },
        data: { isActive: false }
      });
      for (const member of snapshot.members) {
        await transaction.factionMember.upsert({
          where: {
            factionId_tornId: {
              factionId: actor.factionId,
              tornId: member.id
            }
          },
          create: {
            factionId: actor.factionId,
            tornId: member.id,
            name: member.name,
            position: member.position,
            level: member.level,
            daysInFaction: member.daysInFaction,
            isInOc: member.isInOc,
            status: member.status,
            lastActionAt: unixDate(member.lastActionAt),
            tornPayload: member.payload as Prisma.InputJsonValue,
            isActive: true,
            lastSeenAt: now
          },
          update: {
            name: member.name,
            position: member.position,
            level: member.level,
            daysInFaction: member.daysInFaction,
            isInOc: member.isInOc,
            status: member.status,
            lastActionAt: unixDate(member.lastActionAt),
            tornPayload: member.payload as Prisma.InputJsonValue,
            isActive: true,
            lastSeenAt: now
          }
        });
      }

      await transaction.ocCrime.updateMany({
        where: { factionId: actor.factionId, isActive: true },
        data: { isActive: false }
      });
      for (const crime of snapshot.crimes) {
        await transaction.ocCrime.upsert({
          where: { id: crime.id },
          create: {
            id: crime.id,
            factionId: actor.factionId,
            name: crime.name,
            difficulty: crime.difficulty,
            status: crime.status,
            tornPayload: crime.payload as Prisma.InputJsonValue,
            createdAtTorn: unixDate(crime.createdAt),
            planningAt: unixDate(crime.planningAt),
            readyAt: unixDate(crime.readyAt),
            expiredAt: unixDate(crime.expiredAt),
            executedAt: unixDate(crime.executedAt),
            isActive: true,
            lastSeenAt: now,
            syncedAt: now
          },
          update: {
            factionId: actor.factionId,
            name: crime.name,
            difficulty: crime.difficulty,
            status: crime.status,
            tornPayload: crime.payload as Prisma.InputJsonValue,
            createdAtTorn: unixDate(crime.createdAt),
            planningAt: unixDate(crime.planningAt),
            readyAt: unixDate(crime.readyAt),
            expiredAt: unixDate(crime.expiredAt),
            executedAt: unixDate(crime.executedAt),
            isActive: true,
            lastSeenAt: now,
            syncedAt: now,
            version: { increment: 1 }
          }
        });
      }

      await transaction.user.update({
        where: { id: actor.id },
        data: {
          name: identity.name,
          factionPosition: identity.factionPosition,
          role,
          lastVerifiedAt: now
        }
      });
      await transaction.factionSyncState.update({
        where: { factionId: actor.factionId },
        data: {
          inProgressAt: null,
          lastSuccessAt: now,
          syncedByTornId: actor.tornId,
          memberCount: snapshot.members.length,
          crimeCount: snapshot.crimes.length,
          lastError: null
        }
      });
    });

    return {
      syncedAt: now,
      members: snapshot.members.length,
      crimes: snapshot.crimes.length
    };
  } catch (error) {
    await db.factionSyncState.update({
      where: { factionId: actor.factionId },
      data: {
        inProgressAt: null,
        lastError: safeErrorMessage(error)
      }
    }).catch(() => undefined);
    throw error;
  }
}

export async function synchronizeOwnCrimeStats(principal: Principal) {
  const actor = await db.user.findUnique({ where: { id: principal.id } });
  if (!actor || actor.isSuspended) throw httpError("Authentication required", 401);
  if (!actor.encryptedApiKey) {
    throw httpError("Reconnect your Torn API key before synchronizing your crime stats", 409);
  }

  const apiKey = decryptSecret(actor.encryptedApiKey, `torn-api-key:${actor.tornId}`);
  const [identity, crimeStats] = await Promise.all([
    verifyTornIdentity(apiKey),
    fetchPersonalCrimeStats(apiKey)
  ]);
  if (identity.tornId !== actor.tornId || identity.factionId !== actor.factionId) {
    await suspendInvalidMember(actor.id);
    throw httpError("Vault 111 membership could not be re-verified", 403);
  }

  const now = new Date();
  await db.$transaction([
    db.memberCrimeStats.upsert({
      where: {
        factionId_tornId: {
          factionId: actor.factionId,
          tornId: actor.tornId
        }
      },
      create: {
        factionId: actor.factionId,
        tornId: actor.tornId,
        stats: crimeStats.stats as Prisma.InputJsonValue,
        totals: crimeStats.totals as Prisma.InputJsonValue,
        syncedAt: now
      },
      update: {
        stats: crimeStats.stats as Prisma.InputJsonValue,
        totals: crimeStats.totals as Prisma.InputJsonValue,
        syncedAt: now
      }
    }),
    db.user.update({
      where: { id: actor.id },
      data: {
        name: identity.name,
        factionPosition: identity.factionPosition,
        lastVerifiedAt: now
      }
    })
  ]);

  return {
    syncedAt: now,
    trackedStats: Object.keys(crimeStats.stats).length
  };
}

export async function synchronizeRankedWar(principal: Principal) {
  const actor = await db.user.findUnique({ where: { id: principal.id } });
  if (!actor || actor.isSuspended) throw httpError("Authentication required", 401);
  if (!actor.encryptedApiKey) {
    throw httpError("Reconnect your Torn API key before synchronizing the ranked war", 409);
  }

  await acquireWarSyncLock(actor.factionId, actor.tornId);
  try {
    const apiKey = decryptSecret(actor.encryptedApiKey, `torn-api-key:${actor.tornId}`);
    const identity = await verifyTornIdentity(apiKey);
    if (identity.tornId !== actor.tornId || identity.factionId !== actor.factionId) {
      await suspendInvalidMember(actor.id);
      throw httpError("Vault 111 membership could not be re-verified", 403);
    }

    const snapshot = await fetchFactionWarData(apiKey, actor.factionId);
    const now = new Date();
    await db.$transaction(async transaction => {
      if (snapshot.war) {
        const war = snapshot.war;
        await transaction.rankedWar.upsert({
          where: { id: war.id },
          create: {
            id: war.id,
            factionId: war.factionId,
            factionName: war.factionName,
            opponentFactionId: war.opponentFactionId,
            opponentName: war.opponentName,
            startsAt: unixDate(war.startsAt)!,
            endsAt: unixDate(war.endsAt),
            targetScore: war.targetScore,
            factionScore: war.factionScore,
            opponentScore: war.opponentScore,
            factionChain: war.factionChain,
            opponentChain: war.opponentChain,
            winnerFactionId: war.winnerFactionId,
            status: war.status,
            lastSeenAt: now,
            syncedAt: now
          },
          update: {
            factionId: war.factionId,
            factionName: war.factionName,
            opponentFactionId: war.opponentFactionId,
            opponentName: war.opponentName,
            startsAt: unixDate(war.startsAt)!,
            endsAt: unixDate(war.endsAt),
            targetScore: war.targetScore,
            factionScore: war.factionScore,
            opponentScore: war.opponentScore,
            factionChain: war.factionChain,
            opponentChain: war.opponentChain,
            winnerFactionId: war.winnerFactionId,
            status: war.status,
            lastSeenAt: now,
            syncedAt: now
          }
        });

        if (snapshot.targetsLoaded) {
          await transaction.warTarget.updateMany({
            where: { rankedWarId: war.id, isActive: true },
            data: { isActive: false }
          });
          for (const target of snapshot.targets) {
            await transaction.warTarget.upsert({
              where: {
                rankedWarId_tornId: {
                  rankedWarId: war.id,
                  tornId: target.id
                }
              },
              create: {
                rankedWarId: war.id,
                tornId: target.id,
                name: target.name,
                level: target.level,
                position: target.position,
                statusState: target.statusState,
                statusDescription: target.statusDescription,
                statusUntil: unixDate(target.statusUntil),
                lastActionAt: unixDate(target.lastActionAt),
                isRevivable: target.isRevivable,
                isActive: true,
                lastSeenAt: now,
                syncedAt: now
              },
              update: {
                name: target.name,
                level: target.level,
                position: target.position,
                statusState: target.statusState,
                statusDescription: target.statusDescription,
                statusUntil: unixDate(target.statusUntil),
                lastActionAt: unixDate(target.lastActionAt),
                isRevivable: target.isRevivable,
                isActive: true,
                lastSeenAt: now,
                syncedAt: now
              }
            });
          }
        }

        await transaction.warAttack.deleteMany({ where: { rankedWarId: war.id } });
        if (snapshot.attacks.length) {
          await transaction.warAttack.createMany({
            data: snapshot.attacks.map(attack => ({
              id: attack.id,
              rankedWarId: war.id,
              startedAt: unixDate(attack.startedAt)!,
              endedAt: unixDate(attack.endedAt)!,
              attackerTornId: attack.attackerTornId,
              attackerName: attack.attackerName,
              attackerFactionId: attack.attackerFactionId,
              defenderTornId: attack.defenderTornId,
              defenderName: attack.defenderName,
              defenderFactionId: attack.defenderFactionId,
              result: attack.result,
              respectGain: attack.respectGain,
              respectLoss: attack.respectLoss,
              chain: attack.chain,
              isInterrupted: attack.isInterrupted,
              isRankedWar: attack.isRankedWar,
              syncedAt: now
            })),
            skipDuplicates: true
          });
        }
      }

      await transaction.user.update({
        where: { id: actor.id },
        data: {
          name: identity.name,
          factionPosition: identity.factionPosition,
          lastVerifiedAt: now
        }
      });
      await transaction.warSyncState.update({
        where: { factionId: actor.factionId },
        data: {
          inProgressAt: null,
          lastSuccessAt: now,
          syncedByTornId: actor.tornId,
          rankedWarId: snapshot.war?.id ?? null,
          attackCount: snapshot.attacks.length,
          ...(snapshot.targetsLoaded ? { targetCount: snapshot.targets.length } : {}),
          isTruncated: snapshot.truncated,
          lastError: null
        }
      });
    }, { timeout: 30_000 });

    return {
      syncedAt: now,
      rankedWarId: snapshot.war?.id ?? null,
      attacks: snapshot.attacks.length,
      targets: snapshot.targetsLoaded ? snapshot.targets.length : null,
      truncated: snapshot.truncated
    };
  } catch (error) {
    await db.warSyncState.update({
      where: { factionId: actor.factionId },
      data: {
        inProgressAt: null,
        lastError: safeErrorMessage(error)
      }
    }).catch(() => undefined);
    throw error;
  }
}

function jsonObject(value: Prisma.JsonValue | undefined) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, Prisma.JsonValue>
    : {};
}

export async function readFactionMembers(factionId: number) {
  const [rows, crimeStats] = await Promise.all([
    db.factionMember.findMany({
      where: { factionId, isActive: true },
      orderBy: [{ position: "asc" }, { name: "asc" }]
    }),
    db.memberCrimeStats.findMany({
      where: { factionId },
      select: {
        tornId: true,
        stats: true,
        totals: true,
        syncedAt: true
      }
    })
  ]);
  const crimeStatsByTornId = new Map(crimeStats.map(record => [record.tornId, record]));
  return rows.map(member => {
    const personal = crimeStatsByTornId.get(member.tornId);
    return {
      id: member.tornId,
      name: member.name,
      position: member.position,
      level: member.level,
      daysInFaction: member.daysInFaction,
      isInOc: member.isInOc,
      status: member.status,
      lastActionAt: member.lastActionAt,
      apiStatus: personal ? "ok" : "not_registered",
      stats: personal ? jsonObject(personal.stats) : {},
      totals: personal ? jsonObject(personal.totals) : {},
      statsSyncedAt: personal?.syncedAt ?? null
    };
  });
}

export async function readFactionCrimes(factionId: number) {
  const [rows, members] = await Promise.all([
    db.ocCrime.findMany({
      where: { factionId, isActive: true },
      include: { assignments: true },
      orderBy: [{ status: "asc" }, { readyAt: "asc" }, { syncedAt: "desc" }]
    }),
    db.factionMember.findMany({
      where: { factionId, isActive: true },
      select: { tornId: true, name: true }
    })
  ]);
  const names = new Map(members.map(member => [member.tornId, member.name]));
  return rows.map(row => {
    const payload = jsonObject(row.tornPayload);
    const rawSlots = Array.isArray(payload.slots) ? payload.slots : [];
    const slots = rawSlots.map(value => {
      const slot = jsonObject(value);
      const user = jsonObject(slot.user);
      const userId = Number(user.id || 0);
      return {
        ...slot,
        user: userId
          ? { ...user, id: userId, name: names.get(userId) ?? `Player ${userId}` }
          : null
      };
    });
    return {
      ...payload,
      id: row.id,
      name: row.name,
      difficulty: row.difficulty,
      status: row.status,
      slots,
      version: row.version,
      syncedAt: row.syncedAt,
      assignments: row.assignments
    };
  });
}

export async function readFactionSnapshot(factionId: number) {
  const [members, crimes, sync] = await Promise.all([
    readFactionMembers(factionId),
    readFactionCrimes(factionId),
    db.factionSyncState.findUnique({
      where: { factionId },
      select: {
        lastSuccessAt: true,
        memberCount: true,
        crimeCount: true,
        inProgressAt: true
      }
    })
  ]);
  return {
    sync: sync
      ? {
          lastSuccessAt: sync.lastSuccessAt,
          memberCount: sync.memberCount,
          crimeCount: sync.crimeCount,
          inProgress: Boolean(sync.inProgressAt)
        }
      : null,
    members,
    crimes
  };
}

const successfulWarResults = new Set([
  "Attacked",
  "Mugged",
  "Hospitalized",
  "Arrested",
  "Looted",
  "Special",
  "Bounty"
]);
const failedWarResults = new Set(["Lost", "Stalemate", "Escape", "Timeout", "Interrupted"]);

export async function readRankedWarSnapshot(factionId: number) {
  const [war, sync, members] = await Promise.all([
    db.rankedWar.findFirst({
      where: { factionId },
      orderBy: { startsAt: "desc" }
    }),
    db.warSyncState.findUnique({
      where: { factionId },
      select: {
        lastAttemptAt: true,
        lastSuccessAt: true,
        inProgressAt: true,
        syncedByTornId: true,
        rankedWarId: true,
        attackCount: true,
        targetCount: true,
        isTruncated: true,
        lastError: true
      }
    }),
    db.factionMember.findMany({
      where: { factionId, isActive: true },
      select: { tornId: true, name: true, position: true },
      orderBy: { name: "asc" }
    })
  ]);
  const [attacks, targets] = war
    ? await Promise.all([
        db.warAttack.findMany({
          where: { rankedWarId: war.id },
          orderBy: { endedAt: "desc" }
        }),
        db.warTarget.findMany({
          where: { rankedWarId: war.id, isActive: true },
          include: {
            noteUpdatedBy: {
              select: { tornId: true, name: true }
            }
          },
          orderBy: { name: "asc" }
        })
      ])
    : [[], []];

  const rankedAttacks = attacks.filter(attack => attack.isRankedWar);
  const summaries = new Map<number, {
    tornId: number;
    name: string;
    position: string | null;
    attacks: number;
    successfulHits: number;
    assists: number;
    failedAttacks: number;
    respect: number;
    lastAttackAt: Date | null;
  }>();
  for (const member of members) {
    summaries.set(member.tornId, {
      tornId: member.tornId,
      name: member.name,
      position: member.position,
      attacks: 0,
      successfulHits: 0,
      assists: 0,
      failedAttacks: 0,
      respect: 0,
      lastAttackAt: null
    });
  }
  for (const attack of rankedAttacks) {
    if (!attack.attackerTornId) continue;
    const existing = summaries.get(attack.attackerTornId) ?? {
      tornId: attack.attackerTornId,
      name: attack.attackerName ?? `Player ${attack.attackerTornId}`,
      position: null,
      attacks: 0,
      successfulHits: 0,
      assists: 0,
      failedAttacks: 0,
      respect: 0,
      lastAttackAt: null
    };
    existing.attacks += 1;
    existing.successfulHits += successfulWarResults.has(attack.result) ? 1 : 0;
    existing.assists += attack.result === "Assist" ? 1 : 0;
    existing.failedAttacks += failedWarResults.has(attack.result) ? 1 : 0;
    existing.respect += attack.respectGain;
    if (!existing.lastAttackAt || attack.endedAt > existing.lastAttackAt) {
      existing.lastAttackAt = attack.endedAt;
    }
    summaries.set(existing.tornId, existing);
  }

  const participation = Array.from(summaries.values())
    .map(summary => ({ ...summary, respect: Number(summary.respect.toFixed(2)) }))
    .sort((a, b) =>
      b.successfulHits - a.successfulHits ||
      b.respect - a.respect ||
      a.name.localeCompare(b.name)
    );
  const totalRespect = Number(
    rankedAttacks.reduce((total, attack) => total + attack.respectGain, 0).toFixed(2)
  );

  return {
    sync: sync
      ? {
          ...sync,
          inProgress: Boolean(sync.inProgressAt),
          inProgressAt: undefined
        }
      : null,
    war: war
      ? {
          id: war.id,
          factionId: war.factionId,
          factionName: war.factionName,
          opponentFactionId: war.opponentFactionId,
          opponentName: war.opponentName,
          startsAt: war.startsAt,
          endsAt: war.endsAt,
          targetScore: war.targetScore,
          factionScore: war.factionScore,
          opponentScore: war.opponentScore,
          factionChain: war.factionChain,
          opponentChain: war.opponentChain,
          winnerFactionId: war.winnerFactionId,
          status: war.status,
          syncedAt: war.syncedAt
        }
      : null,
    totals: {
      attacks: rankedAttacks.length,
      successfulHits: participation.reduce((total, member) => total + member.successfulHits, 0),
      assists: participation.reduce((total, member) => total + member.assists, 0),
      activeParticipants: participation.filter(member => member.attacks > 0).length,
      totalRespect
    },
    participation,
    targets: targets.map(target => ({
      tornId: target.tornId,
      name: target.name,
      level: target.level,
      position: target.position,
      statusState: target.statusState,
      statusDescription: target.statusDescription,
      statusUntil: target.statusUntil,
      lastActionAt: target.lastActionAt,
      isRevivable: target.isRevivable,
      syncedAt: target.syncedAt,
      note: target.note,
      noteVersion: target.noteVersion,
      noteUpdatedAt: target.noteUpdatedAt,
      noteUpdatedBy: target.noteUpdatedBy
    })),
    recentAttacks: rankedAttacks.slice(0, 100).map(attack => ({
      id: attack.id,
      startedAt: attack.startedAt,
      endedAt: attack.endedAt,
      attackerTornId: attack.attackerTornId,
      attackerName: attack.attackerName,
      defenderTornId: attack.defenderTornId,
      defenderName: attack.defenderName,
      result: attack.result,
      respectGain: attack.respectGain,
      chain: attack.chain,
      isInterrupted: attack.isInterrupted
    }))
  };
}
