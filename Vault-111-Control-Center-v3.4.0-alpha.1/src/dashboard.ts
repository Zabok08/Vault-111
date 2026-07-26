import type { Prisma } from "@prisma/client";
import { db } from "./db.js";

const INACTIVE_AFTER_MS = 3 * 24 * 60 * 60 * 1000;

function httpError(message: string, statusCode: number) {
  return Object.assign(new Error(message), {
    statusCode,
    expose: true
  });
}

function jsonObject(value: Prisma.JsonValue | undefined) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, Prisma.JsonValue>
    : {};
}

function assignedSlot(slotValue: Prisma.JsonValue) {
  const slot = jsonObject(slotValue);
  const user = jsonObject(slot.user);
  return Boolean(
    Number(user.id || 0) ||
    Number(slot.user_id || 0) ||
    Number(slot.userId || 0)
  );
}

export function summarizeDashboardMembers(
  members: Array<{
    isInOc: boolean;
    status: string | null;
    lastActionAt: Date | null;
  }>,
  now = Date.now()
) {
  let hospitalized = 0;
  let traveling = 0;
  let inactive = 0;
  let available = 0;

  for (const member of members) {
    const status = String(member.status || "").toLowerCase();
    const inHospital = /hospital/.test(status);
    const isTraveling = /travel|abroad/.test(status);
    const isInactive = Boolean(
      member.lastActionAt &&
      now - member.lastActionAt.getTime() > INACTIVE_AFTER_MS
    );
    if (inHospital) hospitalized += 1;
    if (isTraveling) traveling += 1;
    if (isInactive) inactive += 1;
    if (
      !member.isInOc &&
      !inHospital &&
      !isTraveling &&
      !isInactive &&
      !/federal|fallen/.test(status)
    ) {
      available += 1;
    }
  }

  return {
    total: members.length,
    inOc: members.filter(member => member.isInOc).length,
    available,
    hospitalized,
    traveling,
    inactive
  };
}

export function summarizeDashboardCrimes(
  crimes: Array<{
    status: string;
    readyAt: Date | null;
    tornPayload: Prisma.JsonValue;
  }>,
  now = Date.now()
) {
  let planning = 0;
  let recruiting = 0;
  let ready = 0;
  let openRoles = 0;
  let filledRoles = 0;

  for (const crime of crimes) {
    const status = String(crime.status || "").toLowerCase();
    if (status.includes("planning")) planning += 1;
    if (status.includes("recruit")) recruiting += 1;
    if (crime.readyAt && crime.readyAt.getTime() <= now) ready += 1;
    const payload = jsonObject(crime.tornPayload);
    const slots = Array.isArray(payload.slots) ? payload.slots : [];
    for (const slot of slots) {
      if (assignedSlot(slot)) filledRoles += 1;
      else openRoles += 1;
    }
  }

  return {
    total: crimes.length,
    planning,
    recruiting,
    ready,
    openRoles,
    filledRoles
  };
}

function serializeAnnouncement(announcement: {
  id: string;
  title: string;
  body: string;
  pinned: boolean;
  expiresAt: Date | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  createdBy: { tornId: number; name: string };
  updatedBy: { tornId: number; name: string };
}) {
  return announcement;
}

export async function readDashboardSnapshot(
  factionId: number,
  canManageAnnouncements: boolean
) {
  const now = new Date();
  const [
    members,
    crimes,
    war,
    factionSync,
    warSync,
    analyticsSync,
    payout,
    announcements
  ] = await Promise.all([
    db.factionMember.findMany({
      where: { factionId, isActive: true },
      select: {
        isInOc: true,
        status: true,
        lastActionAt: true
      }
    }),
    db.ocCrime.findMany({
      where: { factionId, isActive: true },
      select: {
        status: true,
        readyAt: true,
        tornPayload: true
      }
    }),
    db.rankedWar.findFirst({
      where: { factionId },
      orderBy: { startsAt: "desc" },
      select: {
        id: true,
        factionId: true,
        opponentFactionId: true,
        opponentName: true,
        startsAt: true,
        endsAt: true,
        targetScore: true,
        factionScore: true,
        opponentScore: true,
        winnerFactionId: true,
        status: true,
        syncedAt: true
      }
    }),
    db.factionSyncState.findUnique({
      where: { factionId },
      select: {
        lastAttemptAt: true,
        lastSuccessAt: true,
        inProgressAt: true,
        lastError: true,
        memberCount: true,
        crimeCount: true
      }
    }),
    db.warSyncState.findUnique({
      where: { factionId },
      select: {
        lastAttemptAt: true,
        lastSuccessAt: true,
        inProgressAt: true,
        lastError: true,
        rankedWarId: true,
        attackCount: true,
        targetCount: true
      }
    }),
    db.memberAnalytics.findFirst({
      where: { factionId },
      orderBy: { syncedAt: "desc" },
      select: { syncedAt: true }
    }),
    db.warPayoutPlan.findFirst({
      where: { factionId, status: "FINALIZED" },
      orderBy: { finalizedAt: "desc" },
      select: {
        id: true,
        rankedWarId: true,
        finalizedAt: true,
        entries: {
          select: { finalAmount: true }
        },
        war: {
          select: {
            opponentName: true,
            startsAt: true
          }
        }
      }
    }),
    db.announcement.findMany({
      where: {
        factionId,
        OR: [
          { expiresAt: null },
          { expiresAt: { gt: now } }
        ]
      },
      orderBy: [
        { pinned: "desc" },
        { createdAt: "desc" }
      ],
      take: 20,
      include: {
        createdBy: { select: { tornId: true, name: true } },
        updatedBy: { select: { tornId: true, name: true } }
      }
    })
  ]);

  return {
    serverTime: now,
    permissions: {
      canManageAnnouncements
    },
    members: summarizeDashboardMembers(members, now.getTime()),
    crimes: summarizeDashboardCrimes(crimes, now.getTime()),
    war,
    payout: payout
      ? {
          id: payout.id,
          rankedWarId: payout.rankedWarId,
          opponentName: payout.war.opponentName,
          warStartedAt: payout.war.startsAt,
          finalizedAt: payout.finalizedAt,
          membersPaid: payout.entries.filter(entry => entry.finalAmount > 0n).length,
          finalTotal: payout.entries
            .reduce((total, entry) => total + entry.finalAmount, 0n)
            .toString()
        }
      : null,
    sync: {
      faction: factionSync
        ? {
            ...factionSync,
            lastError: factionSync.lastError ? "Last faction sync attempt failed" : null,
            inProgress: Boolean(factionSync.inProgressAt),
            inProgressAt: undefined
          }
        : null,
      war: warSync
        ? {
            ...warSync,
            lastError: warSync.lastError ? "Last war sync attempt failed" : null,
            inProgress: Boolean(warSync.inProgressAt),
            inProgressAt: undefined
          }
        : null,
      analyticsLastSuccessAt: analyticsSync?.syncedAt ?? null
    },
    announcements: announcements.map(serializeAnnouncement)
  };
}

function validateExpiration(expiresAt: Date | null) {
  if (expiresAt && expiresAt.getTime() <= Date.now()) {
    throw httpError("Announcement expiration must be in the future", 400);
  }
}

export async function createAnnouncement(input: {
  factionId: number;
  actorUserId: string;
  title: string;
  body: string;
  pinned: boolean;
  expiresAt: Date | null;
}) {
  validateExpiration(input.expiresAt);
  return db.announcement.create({
    data: {
      factionId: input.factionId,
      title: input.title,
      body: input.body,
      pinned: input.pinned,
      expiresAt: input.expiresAt,
      createdByUserId: input.actorUserId,
      updatedByUserId: input.actorUserId
    },
    include: {
      createdBy: { select: { tornId: true, name: true } },
      updatedBy: { select: { tornId: true, name: true } }
    }
  });
}

export async function updateAnnouncement(input: {
  id: string;
  factionId: number;
  actorUserId: string;
  title: string;
  body: string;
  pinned: boolean;
  expiresAt: Date | null;
  expectedVersion: number;
}) {
  validateExpiration(input.expiresAt);
  const updated = await db.announcement.updateMany({
    where: {
      id: input.id,
      factionId: input.factionId,
      version: input.expectedVersion
    },
    data: {
      title: input.title,
      body: input.body,
      pinned: input.pinned,
      expiresAt: input.expiresAt,
      updatedByUserId: input.actorUserId,
      version: { increment: 1 }
    }
  });
  if (!updated.count) {
    const exists = await db.announcement.findFirst({
      where: { id: input.id, factionId: input.factionId },
      select: { id: true }
    });
    throw httpError(
      exists
        ? "Announcement changed; refresh before editing"
        : "Announcement not found",
      exists ? 409 : 404
    );
  }
  return db.announcement.findUniqueOrThrow({
    where: { id: input.id },
    include: {
      createdBy: { select: { tornId: true, name: true } },
      updatedBy: { select: { tornId: true, name: true } }
    }
  });
}

export async function deleteAnnouncement(input: {
  id: string;
  factionId: number;
  expectedVersion: number;
}) {
  const deleted = await db.announcement.deleteMany({
    where: {
      id: input.id,
      factionId: input.factionId,
      version: input.expectedVersion
    }
  });
  if (!deleted.count) {
    const exists = await db.announcement.findFirst({
      where: { id: input.id, factionId: input.factionId },
      select: { id: true }
    });
    throw httpError(
      exists
        ? "Announcement changed; refresh before deleting"
        : "Announcement not found",
      exists ? 409 : 404
    );
  }
}
