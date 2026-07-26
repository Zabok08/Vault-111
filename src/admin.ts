import { AppRole } from "@prisma/client";
import type { Principal } from "./auth.js";
import { hasPermission } from "./auth.js";
import { db } from "./db.js";

export const assignableAdminRoles = [
  AppRole.ADMIN,
  AppRole.OC_PLANNER,
  AppRole.WAR_MANAGER,
  AppRole.OFFICER,
  AppRole.MEMBER
] as const;

function httpError(message: string, statusCode: number) {
  return Object.assign(new Error(message), {
    statusCode,
    expose: true
  });
}

function requireAdminManage(principal: Principal) {
  if (!hasPermission(principal, "admin.manage")) {
    throw httpError("Forbidden", 403);
  }
}

function requireAssignableRole(role: AppRole) {
  if (!assignableAdminRoles.includes(role as typeof assignableAdminRoles[number])) {
    throw httpError("The Owner role cannot be assigned through a faction-position mapping", 400);
  }
}

async function requireActiveFactionPosition(factionId: number, factionPosition: string) {
  const member = await db.factionMember.findFirst({
    where: {
      factionId,
      position: factionPosition,
      isActive: true
    },
    select: { tornId: true }
  });
  if (!member) {
    throw httpError("That exact Torn faction position is not currently active", 400);
  }
}

export async function readAdminOverview(principal: Principal) {
  const now = new Date();
  const [
    users,
    mappings,
    members,
    factionSync,
    warSync
  ] = await Promise.all([
    db.user.findMany({
      where: { factionId: principal.factionId },
      orderBy: [{ role: "asc" }, { name: "asc" }],
      select: {
        id: true,
        tornId: true,
        name: true,
        factionPosition: true,
        role: true,
        isSuspended: true,
        adminVersion: true,
        apiKeyUpdatedAt: true,
        analyticsConsentAt: true,
        lastVerifiedAt: true,
        createdAt: true,
        updatedAt: true,
        sessions: {
          where: {
            revokedAt: null,
            expiresAt: { gt: now }
          },
          orderBy: { lastUsedAt: "desc" },
          select: {
            lastUsedAt: true,
            expiresAt: true
          }
        }
      }
    }),
    db.roleMapping.findMany({
      where: { factionId: principal.factionId },
      orderBy: { factionPosition: "asc" }
    }),
    db.factionMember.findMany({
      where: {
        factionId: principal.factionId,
        isActive: true,
        position: { not: null }
      },
      select: {
        tornId: true,
        position: true
      }
    }),
    db.factionSyncState.findUnique({
      where: { factionId: principal.factionId }
    }),
    db.warSyncState.findUnique({
      where: { factionId: principal.factionId }
    })
  ]);

  const positionCounts = new Map<string, number>();
  for (const member of members) {
    const position = member.position?.trim();
    if (!position) continue;
    positionCounts.set(position, (positionCounts.get(position) ?? 0) + 1);
  }
  const mappingByPosition = new Map(
    mappings.map(mapping => [mapping.factionPosition, mapping])
  );
  const activeTornIds = new Set(members.map(member => member.tornId));
  const allPositions = new Set([
    ...positionCounts.keys(),
    ...mappings.map(mapping => mapping.factionPosition)
  ]);

  return {
    serverTime: now,
    permissions: {
      canManage: hasPermission(principal, "admin.manage"),
      assignableRoles: [...assignableAdminRoles]
    },
    summary: {
      users: users.length,
      suspendedUsers: users.filter(user => user.isSuspended).length,
      connectedKeys: users.filter(user => Boolean(user.apiKeyUpdatedAt)).length,
      activeSessions: users.reduce((total, user) => total + user.sessions.length, 0),
      mappedPositions: mappings.length
    },
    sync: {
      faction: factionSync,
      war: warSync
    },
    positions: [...allPositions]
      .sort((left, right) => left.localeCompare(right))
      .map(factionPosition => {
        const memberCount = positionCounts.get(factionPosition) ?? 0;
        const mapping = mappingByPosition.get(factionPosition);
        return {
          factionPosition,
          memberCount,
          mapping: mapping
            ? {
                id: mapping.id,
                appRole: mapping.appRole,
                version: mapping.version,
                createdAt: mapping.createdAt,
                updatedAt: mapping.updatedAt
              }
            : null
        };
      }),
    users: users.map(user => ({
      id: user.id,
      tornId: user.tornId,
      name: user.name,
      factionPosition: user.factionPosition,
      role: user.role,
      isSuspended: user.isSuspended,
      version: user.adminVersion,
      apiKeyConnected: Boolean(user.apiKeyUpdatedAt),
      apiKeyUpdatedAt: user.apiKeyUpdatedAt,
      analyticsEnabled: Boolean(user.analyticsConsentAt),
      lastVerifiedAt: user.lastVerifiedAt,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      activeSessionCount: user.sessions.length,
      lastSessionAt: user.sessions[0]?.lastUsedAt ?? null,
      activeFactionMember: factionSync?.lastSuccessAt
        ? activeTornIds.has(user.tornId)
        : null,
      manageable: user.role !== AppRole.OWNER && user.id !== principal.id
    }))
  };
}

export async function saveRoleMapping(input: {
  principal: Principal;
  factionPosition: string;
  appRole: AppRole;
  expectedVersion: number;
}) {
  requireAdminManage(input.principal);
  requireAssignableRole(input.appRole);
  await requireActiveFactionPosition(
    input.principal.factionId,
    input.factionPosition
  );
  const existing = await db.roleMapping.findUnique({
    where: {
      factionId_factionPosition: {
        factionId: input.principal.factionId,
        factionPosition: input.factionPosition
      }
    }
  });
  if (
    (existing && existing.version !== input.expectedVersion) ||
    (!existing && input.expectedVersion !== 0)
  ) {
    throw httpError("Role mapping changed; refresh before editing", 409);
  }
  if (existing?.appRole === input.appRole) {
    return {
      mapping: existing,
      affectedUsers: 0,
      unchanged: true
    };
  }

  const now = new Date();
  return db.$transaction(async transaction => {
    let mapping;
    if (existing) {
      const updated = await transaction.roleMapping.updateMany({
        where: {
          id: existing.id,
          factionId: input.principal.factionId,
          version: input.expectedVersion
        },
        data: {
          appRole: input.appRole,
          version: { increment: 1 }
        }
      });
      if (!updated.count) {
        throw httpError("Role mapping changed; refresh before editing", 409);
      }
      mapping = await transaction.roleMapping.findUniqueOrThrow({
        where: { id: existing.id }
      });
    } else {
      try {
        mapping = await transaction.roleMapping.create({
          data: {
            factionId: input.principal.factionId,
            factionPosition: input.factionPosition,
            appRole: input.appRole
          }
        });
      } catch (error) {
        if (
          typeof error === "object" &&
          error &&
          "code" in error &&
          error.code === "P2002"
        ) {
          throw httpError("Role mapping changed; refresh before editing", 409);
        }
        throw error;
      }
    }

    const affectedUsers = await transaction.user.findMany({
      where: {
        factionId: input.principal.factionId,
        factionPosition: input.factionPosition,
        role: { not: AppRole.OWNER }
      },
      select: { id: true }
    });
    const affectedUserIds = affectedUsers.map(user => user.id);
    if (affectedUserIds.length) {
      await transaction.user.updateMany({
        where: { id: { in: affectedUserIds } },
        data: {
          role: input.appRole,
          sessionVersion: { increment: 1 },
          adminVersion: { increment: 1 }
        }
      });
      await transaction.session.updateMany({
        where: {
          userId: { in: affectedUserIds },
          revokedAt: null
        },
        data: { revokedAt: now }
      });
    }
    return {
      mapping,
      affectedUsers: affectedUserIds.length,
      unchanged: false
    };
  });
}

export async function deleteRoleMapping(input: {
  principal: Principal;
  factionPosition: string;
  expectedVersion: number;
}) {
  requireAdminManage(input.principal);
  const existing = await db.roleMapping.findUnique({
    where: {
      factionId_factionPosition: {
        factionId: input.principal.factionId,
        factionPosition: input.factionPosition
      }
    }
  });
  if (!existing) throw httpError("Role mapping not found", 404);
  if (existing.version !== input.expectedVersion) {
    throw httpError("Role mapping changed; refresh before deleting", 409);
  }

  const now = new Date();
  return db.$transaction(async transaction => {
    const deleted = await transaction.roleMapping.deleteMany({
      where: {
        id: existing.id,
        factionId: input.principal.factionId,
        version: input.expectedVersion
      }
    });
    if (!deleted.count) {
      throw httpError("Role mapping changed; refresh before deleting", 409);
    }
    const affectedUsers = await transaction.user.findMany({
      where: {
        factionId: input.principal.factionId,
        factionPosition: input.factionPosition,
        role: { not: AppRole.OWNER }
      },
      select: { id: true }
    });
    const affectedUserIds = affectedUsers.map(user => user.id);
    if (affectedUserIds.length) {
      await transaction.user.updateMany({
        where: { id: { in: affectedUserIds } },
        data: {
          role: AppRole.MEMBER,
          sessionVersion: { increment: 1 },
          adminVersion: { increment: 1 }
        }
      });
      await transaction.session.updateMany({
        where: {
          userId: { in: affectedUserIds },
          revokedAt: null
        },
        data: { revokedAt: now }
      });
    }
    return { affectedUsers: affectedUserIds.length };
  });
}

async function readManageableUser(
  principal: Principal,
  userId: string
) {
  requireAdminManage(principal);
  const user = await db.user.findFirst({
    where: {
      id: userId,
      factionId: principal.factionId
    },
    select: {
      id: true,
      tornId: true,
      name: true,
      role: true,
      adminVersion: true
    }
  });
  if (!user) throw httpError("Control Center user not found", 404);
  if (user.id === principal.id || user.role === AppRole.OWNER) {
    throw httpError("Owner accounts cannot be managed from this screen", 403);
  }
  return user;
}

export async function setUserSuspension(input: {
  principal: Principal;
  userId: string;
  suspended: boolean;
  expectedVersion: number;
}) {
  const user = await readManageableUser(input.principal, input.userId);
  if (user.adminVersion !== input.expectedVersion) {
    throw httpError("Member access changed; refresh before editing", 409);
  }
  const now = new Date();
  const result = await db.$transaction(async transaction => {
    const updated = await transaction.user.updateMany({
      where: {
        id: user.id,
        factionId: input.principal.factionId,
        role: { not: AppRole.OWNER },
        adminVersion: input.expectedVersion
      },
      data: {
        isSuspended: input.suspended,
        sessionVersion: { increment: 1 },
        adminVersion: { increment: 1 }
      }
    });
    if (!updated.count) {
      throw httpError("Member access changed; refresh before editing", 409);
    }
    const revoked = await transaction.session.updateMany({
      where: {
        userId: user.id,
        revokedAt: null
      },
      data: { revokedAt: now }
    });
    return { revokedSessions: revoked.count };
  });
  return { user, suspended: input.suspended, ...result };
}

export async function revokeUserSessions(input: {
  principal: Principal;
  userId: string;
  expectedVersion: number;
}) {
  const user = await readManageableUser(input.principal, input.userId);
  if (user.adminVersion !== input.expectedVersion) {
    throw httpError("Member access changed; refresh before revoking sessions", 409);
  }
  const now = new Date();
  const result = await db.$transaction(async transaction => {
    const updated = await transaction.user.updateMany({
      where: {
        id: user.id,
        factionId: input.principal.factionId,
        role: { not: AppRole.OWNER },
        adminVersion: input.expectedVersion
      },
      data: {
        sessionVersion: { increment: 1 },
        adminVersion: { increment: 1 }
      }
    });
    if (!updated.count) {
      throw httpError("Member access changed; refresh before revoking sessions", 409);
    }
    const revoked = await transaction.session.updateMany({
      where: {
        userId: user.id,
        revokedAt: null
      },
      data: { revokedAt: now }
    });
    return { revokedSessions: revoked.count };
  });
  return { user, ...result };
}
