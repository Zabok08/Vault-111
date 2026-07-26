import {
  Prisma,
  type MemberAnalytics,
  type MemberAnalyticsSnapshot
} from "@prisma/client";
import type { Principal } from "./auth.js";
import { hasPermission } from "./auth.js";
import { decryptSecret } from "./crypto.js";
import { db } from "./db.js";
import { fetchMemberAnalytics, verifyTornIdentity } from "./torn.js";

const SNAPSHOT_BUCKET_MS = 6 * 60 * 60 * 1000;
const HISTORY_RETENTION_MS = 400 * 24 * 60 * 60 * 1000;
const TREND_WINDOW_MS = 35 * 24 * 60 * 60 * 1000;

function httpError(message: string, statusCode: number) {
  return Object.assign(new Error(message), { statusCode, expose: true });
}

function decimal(value: number) {
  return new Prisma.Decimal(value);
}

function bucketDate(date: Date) {
  return new Date(Math.floor(date.getTime() / SNAPSHOT_BUCKET_MS) * SNAPSHOT_BUCKET_MS);
}

function decimalText(value: Prisma.Decimal | null | undefined) {
  return value === null || value === undefined ? null : value.toFixed(0);
}

function integerText(value: bigint | null | undefined) {
  return value === null || value === undefined ? null : value.toString();
}

function decimalDifference(
  current: Prisma.Decimal | null | undefined,
  previous: Prisma.Decimal | null | undefined
) {
  const currentText = decimalText(current);
  const previousText = decimalText(previous);
  if (currentText === null || previousText === null) return null;
  return (BigInt(currentText) - BigInt(previousText)).toString();
}

function numberDifference(
  current: number | null | undefined,
  previous: number | null | undefined
) {
  if (current === null || current === undefined || previous === null || previous === undefined) {
    return null;
  }
  return current - previous;
}

function snapshotData(current: MemberAnalytics) {
  return {
    capturedAt: current.syncedAt,
    strength: current.strength,
    defense: current.defense,
    speed: current.speed,
    dexterity: current.dexterity,
    battleTotal: current.battleTotal,
    cannabis: current.cannabis,
    ecstasy: current.ecstasy,
    ketamine: current.ketamine,
    lsd: current.lsd,
    opium: current.opium,
    pcp: current.pcp,
    shrooms: current.shrooms,
    speedDrug: current.speedDrug,
    vicodin: current.vicodin,
    xanax: current.xanax,
    drugTotal: current.drugTotal,
    overdoses: current.overdoses,
    rehabilitationCount: current.rehabilitationCount,
    rehabilitationFees: current.rehabilitationFees,
    drugCooldownSeconds: current.drugCooldownSeconds
  };
}

export async function setMemberAnalyticsConsent(
  principal: Principal,
  accepted: boolean
) {
  if (accepted) {
    const consentAt = new Date();
    await db.user.update({
      where: { id: principal.id },
      data: { analyticsConsentAt: consentAt }
    });
    return { analyticsConsentAt: consentAt };
  }

  await db.$transaction([
    db.memberAnalyticsSnapshot.deleteMany({
      where: { factionId: principal.factionId, tornId: principal.tornId }
    }),
    db.memberAnalytics.deleteMany({
      where: { factionId: principal.factionId, tornId: principal.tornId }
    }),
    db.user.update({
      where: { id: principal.id },
      data: { analyticsConsentAt: null }
    })
  ]);
  return { analyticsConsentAt: null };
}

export async function synchronizeOwnMemberAnalytics(principal: Principal) {
  const actor = await db.user.findUnique({ where: { id: principal.id } });
  if (!actor || actor.isSuspended) throw httpError("Authentication required", 401);
  if (!actor.analyticsConsentAt) {
    throw httpError("Enable member analytics consent before synchronizing", 409);
  }
  if (!actor.encryptedApiKey) {
    throw httpError("Reconnect your Torn API key before synchronizing member analytics", 409);
  }

  const apiKey = decryptSecret(actor.encryptedApiKey, `torn-api-key:${actor.tornId}`);
  const identity = await verifyTornIdentity(apiKey);
  if (identity.tornId !== actor.tornId || identity.factionId !== actor.factionId) {
    const now = new Date();
    await db.$transaction([
      db.user.update({
        where: { id: actor.id },
        data: { isSuspended: true }
      }),
      db.session.updateMany({
        where: { userId: actor.id, revokedAt: null },
        data: { revokedAt: now }
      })
    ]);
    throw httpError("Vault 111 membership could not be re-verified", 403);
  }

  const analytics = await fetchMemberAnalytics(apiKey);
  const now = new Date();
  const existing = await db.memberAnalytics.findUnique({
    where: {
      factionId_tornId: {
        factionId: actor.factionId,
        tornId: actor.tornId
      }
    }
  });
  const movesTotalsForward = Boolean(existing && (analytics.battle || analytics.drugs));
  const battleData = analytics.battle
    ? {
        strength: decimal(analytics.battle.strength),
        defense: decimal(analytics.battle.defense),
        speed: decimal(analytics.battle.speed),
        dexterity: decimal(analytics.battle.dexterity),
        battleTotal: decimal(analytics.battle.total),
        battleSyncedAt: now
      }
    : {};
  const drugData = analytics.drugs
    ? {
        cannabis: analytics.drugs.cannabis,
        ecstasy: analytics.drugs.ecstasy,
        ketamine: analytics.drugs.ketamine,
        lsd: analytics.drugs.lsd,
        opium: analytics.drugs.opium,
        pcp: analytics.drugs.pcp,
        shrooms: analytics.drugs.shrooms,
        speedDrug: analytics.drugs.speed,
        vicodin: analytics.drugs.vicodin,
        xanax: analytics.drugs.xanax,
        drugTotal: analytics.drugs.total,
        overdoses: analytics.drugs.overdoses,
        rehabilitationCount: analytics.drugs.rehabilitationCount,
        rehabilitationFees: BigInt(analytics.drugs.rehabilitationFees),
        drugsSyncedAt: now
      }
    : {};
  const cooldownData = analytics.cooldowns
    ? {
        drugCooldownSeconds: analytics.cooldowns.drug,
        cooldownSyncedAt: now
      }
    : {};
  const previousData = movesTotalsForward
    ? {
        previousBattleTotal: analytics.battle ? existing?.battleTotal ?? null : null,
        previousDrugTotal: analytics.drugs ? existing?.drugTotal ?? null : null,
        previousXanax: analytics.drugs ? existing?.xanax ?? null : null,
        previousSyncedAt: existing?.syncedAt ?? null
      }
    : {};

  const current = await db.$transaction(async transaction => {
    const updated = await transaction.memberAnalytics.upsert({
      where: {
        factionId_tornId: {
          factionId: actor.factionId,
          tornId: actor.tornId
        }
      },
      create: {
        factionId: actor.factionId,
        tornId: actor.tornId,
        ...battleData,
        ...drugData,
        ...cooldownData,
        syncedAt: now
      },
      update: {
        ...battleData,
        ...drugData,
        ...cooldownData,
        ...previousData,
        syncedAt: now
      }
    });
    const bucketAt = bucketDate(now);
    const values = snapshotData(updated);
    await transaction.memberAnalyticsSnapshot.upsert({
      where: {
        factionId_tornId_bucketAt: {
          factionId: actor.factionId,
          tornId: actor.tornId,
          bucketAt
        }
      },
      create: {
        factionId: actor.factionId,
        tornId: actor.tornId,
        bucketAt,
        ...values
      },
      update: values
    });
    await transaction.memberAnalyticsSnapshot.deleteMany({
      where: {
        factionId: actor.factionId,
        tornId: actor.tornId,
        capturedAt: { lt: new Date(now.getTime() - HISTORY_RETENTION_MS) }
      }
    });
    await transaction.user.update({
      where: { id: actor.id },
      data: {
        name: identity.name,
        factionPosition: identity.factionPosition,
        lastVerifiedAt: now
      }
    });
    return updated;
  });

  return {
    syncedAt: current.syncedAt,
    battleStats: Boolean(analytics.battle),
    drugStats: Boolean(analytics.drugs),
    cooldowns: Boolean(analytics.cooldowns),
    warnings: analytics.warnings
  };
}

function trendSnapshot(
  history: MemberAnalyticsSnapshot[],
  targetTime: number
) {
  let selected: MemberAnalyticsSnapshot | null = null;
  for (const snapshot of history) {
    if (snapshot.capturedAt.getTime() <= targetTime) selected = snapshot;
    else break;
  }
  return selected;
}

function trendValues(
  current: MemberAnalytics,
  previous: Pick<MemberAnalyticsSnapshot, "battleTotal" | "drugTotal" | "xanax" | "capturedAt"> | null
) {
  if (!previous) return null;
  return {
    since: previous.capturedAt,
    battleTotal: decimalDifference(current.battleTotal, previous.battleTotal),
    drugTotal: numberDifference(current.drugTotal, previous.drugTotal),
    xanax: numberDifference(current.xanax, previous.xanax)
  };
}

function exactAnalytics(
  current: MemberAnalytics,
  history: MemberAnalyticsSnapshot[],
  now = Date.now()
) {
  const previous = current.previousSyncedAt
    ? {
        capturedAt: current.previousSyncedAt,
        battleTotal: current.previousBattleTotal,
        drugTotal: current.previousDrugTotal,
        xanax: current.previousXanax
      }
    : null;
  return {
    syncedAt: current.syncedAt,
    battleSyncedAt: current.battleSyncedAt,
    drugsSyncedAt: current.drugsSyncedAt,
    cooldownSyncedAt: current.cooldownSyncedAt,
    battle: current.battleSyncedAt
      ? {
          strength: decimalText(current.strength),
          defense: decimalText(current.defense),
          speed: decimalText(current.speed),
          dexterity: decimalText(current.dexterity),
          total: decimalText(current.battleTotal)
        }
      : null,
    drugs: current.drugsSyncedAt
      ? {
          cannabis: current.cannabis,
          ecstasy: current.ecstasy,
          ketamine: current.ketamine,
          lsd: current.lsd,
          opium: current.opium,
          pcp: current.pcp,
          shrooms: current.shrooms,
          speed: current.speedDrug,
          vicodin: current.vicodin,
          xanax: current.xanax,
          total: current.drugTotal,
          overdoses: current.overdoses,
          rehabilitations: {
            amount: current.rehabilitationCount,
            fees: integerText(current.rehabilitationFees)
          }
        }
      : null,
    cooldowns: current.cooldownSyncedAt
      ? { drug: current.drugCooldownSeconds }
      : null,
    gains: {
      previous: previous
        ? {
            since: previous.capturedAt,
            battleTotal: decimalDifference(current.battleTotal, previous.battleTotal),
            drugTotal: numberDifference(current.drugTotal, previous.drugTotal),
            xanax: numberDifference(current.xanax, previous.xanax)
          }
        : null,
      day: trendValues(current, trendSnapshot(history, now - 24 * 60 * 60 * 1000)),
      week: trendValues(current, trendSnapshot(history, now - 7 * 24 * 60 * 60 * 1000)),
      month: trendValues(current, trendSnapshot(history, now - 30 * 24 * 60 * 60 * 1000))
    }
  };
}

export async function readMemberOverview(principal: Principal) {
  const canReadAllAnalytics = hasPermission(principal, "members.analytics.read_all");
  const [members, users, currentRows] = await Promise.all([
    db.factionMember.findMany({
      where: { factionId: principal.factionId, isActive: true },
      orderBy: [{ position: "asc" }, { name: "asc" }]
    }),
    db.user.findMany({
      where: { factionId: principal.factionId, isSuspended: false },
      select: {
        tornId: true,
        role: true,
        analyticsConsentAt: true,
        apiKeyUpdatedAt: true
      }
    }),
    db.memberAnalytics.findMany({
      where: { factionId: principal.factionId }
    })
  ]);
  const visibleIds = currentRows
    .filter(row => canReadAllAnalytics || row.tornId === principal.tornId)
    .map(row => row.tornId);
  const historyRows = visibleIds.length
    ? await db.memberAnalyticsSnapshot.findMany({
        where: {
          factionId: principal.factionId,
          tornId: { in: visibleIds },
          capturedAt: { gte: new Date(Date.now() - TREND_WINDOW_MS) }
        },
        orderBy: [{ tornId: "asc" }, { capturedAt: "asc" }]
      })
    : [];
  const userByTornId = new Map(users.map(user => [user.tornId, user]));
  const currentByTornId = new Map(currentRows.map(row => [row.tornId, row]));
  const historyByTornId = new Map<number, MemberAnalyticsSnapshot[]>();
  for (const snapshot of historyRows) {
    const list = historyByTornId.get(snapshot.tornId) ?? [];
    list.push(snapshot);
    historyByTornId.set(snapshot.tornId, list);
  }

  const rows = members.map(member => {
    const user = userByTornId.get(member.tornId);
    const current = currentByTornId.get(member.tornId);
    const exactVisible = Boolean(
      current &&
      user?.analyticsConsentAt &&
      (canReadAllAnalytics || member.tornId === principal.tornId)
    );
    const analyticsAccess = exactVisible
      ? "exact"
      : member.tornId === principal.tornId && !user?.analyticsConsentAt
        ? "consent_required"
        : user?.analyticsConsentAt && current
          ? "private"
          : user?.analyticsConsentAt
            ? "not_synced"
            : "not_shared";
    return {
      id: member.tornId,
      name: member.name,
      position: member.position,
      level: member.level,
      daysInFaction: member.daysInFaction,
      isInOc: member.isInOc,
      status: member.status,
      lastActionAt: member.lastActionAt,
      connectedAt: user?.apiKeyUpdatedAt ?? null,
      analyticsConsentAt: member.tornId === principal.tornId || canReadAllAnalytics
        ? user?.analyticsConsentAt ?? null
        : undefined,
      analyticsAccess,
      analytics: exactVisible && current
        ? exactAnalytics(current, historyByTornId.get(member.tornId) ?? [])
        : null
    };
  });

  return {
    privacy: {
      canReadAllAnalytics,
      exactStatsVisibleTo: "The member, Vault 111 Owner, and Administrators"
    },
    summary: {
      members: rows.length,
      connected: rows.filter(row => row.connectedAt).length,
      analyticsShared: rows.filter(row => currentByTornId.has(row.id)).length,
      inOc: rows.filter(row => row.isInOc).length,
      hospitalized: rows.filter(row => /hospital/i.test(row.status || "")).length,
      traveling: rows.filter(row => /travel|abroad/i.test(row.status || "")).length
    },
    members: rows
  };
}
