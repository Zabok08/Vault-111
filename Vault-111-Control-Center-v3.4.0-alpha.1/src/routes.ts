import type { FastifyInstance } from "fastify";
import { AppRole } from "@prisma/client";
import { z } from "zod";
import { db } from "./db.js";
import { config } from "./config.js";
import { encryptSecret, newOpaqueToken, sha256 } from "./crypto.js";
import { verifyTornIdentity } from "./torn.js";
import {
  authenticate,
  hasPermission,
  issueAccessToken,
  requirePermission
} from "./auth.js";
import { audit } from "./audit.js";
import {
  readFactionCrimes,
  readFactionMembers,
  readFactionSnapshot,
  readRankedWarSnapshot,
  synchronizeFaction,
  synchronizeOwnCrimeStats,
  synchronizeRankedWar
} from "./ingestion.js";
import {
  finalizeWarPayout,
  parseMoney,
  readWarPayout,
  reopenWarPayout,
  saveWarPayoutAdjustment,
  saveWarPayoutSettings
} from "./payouts.js";
import {
  readMemberOverview,
  setMemberAnalyticsConsent,
  synchronizeOwnMemberAnalytics
} from "./memberAnalytics.js";
import { readMemberWarHistory } from "./memberWarHistory.js";
import {
  createAnnouncement,
  deleteAnnouncement,
  readDashboardSnapshot,
  updateAnnouncement
} from "./dashboard.js";

const loginBody = z.object({
  apiKey: z.string().trim().min(8).max(256),
  analyticsConsent: z.boolean().optional().default(false)
});
const refreshBody = z.object({ refreshToken: z.string().min(32).max(256) });
const analyticsConsentBody = z.object({ accepted: z.boolean() });
const assignmentBody = z.object({
  assignedTornId: z.number().int().positive().nullable(),
  locked: z.boolean().default(false),
  note: z.string().trim().max(500).nullable().optional(),
  expectedVersion: z.number().int().positive()
});
const crimeParams = z.object({ crimeId: z.string().min(1).max(128), roleKey: z.string().min(1).max(128) });
const warTargetParams = z.object({
  warId: z.coerce.number().int().positive(),
  targetTornId: z.coerce.number().int().positive()
});
const warTargetNoteBody = z.object({
  note: z.string().trim().max(500).nullable().transform(value => value || null),
  expectedVersion: z.number().int().positive()
});
const warPayoutParams = z.object({
  warId: z.coerce.number().int().positive()
});
const warPayoutMemberParams = warPayoutParams.extend({
  tornId: z.coerce.number().int().positive()
});
const memberHistoryParams = z.object({
  tornId: z.coerce.number().int().positive()
});
const announcementParams = z.object({
  announcementId: z.string().min(1).max(128)
});
const announcementBody = z.object({
  title: z.string().trim().min(3).max(120),
  body: z.string().trim().min(1).max(2000),
  pinned: z.boolean().default(false),
  expiresAt: z.string().datetime().nullable().transform(value => value ? new Date(value) : null)
});
const announcementUpdateBody = announcementBody.extend({
  expectedVersion: z.number().int().positive()
});
const announcementDeleteQuery = z.object({
  expectedVersion: z.coerce.number().int().positive()
});
const warPayoutSettingsBody = z.object({
  poolAmount: z.string().regex(/^\d+$/).max(16),
  expectedVersion: z.number().int().min(0)
});
const warPayoutAdjustmentBody = z.object({
  amount: z.string().regex(/^-?\d+$/).max(17),
  note: z.string().trim().max(200).nullable().transform(value => value || null),
  expectedVersion: z.number().int().positive()
});
const versionedActionBody = z.object({
  expectedVersion: z.number().int().positive()
});

function refreshExpiry() {
  return new Date(Date.now() + config.REFRESH_TOKEN_TTL_DAYS * 86_400_000);
}

export async function registerRoutes(app: FastifyInstance) {
  app.get("/health", async (_request, reply) => {
    try {
      await db.$queryRaw`SELECT 1`;
      return { ok: true, version: "3.4.0-alpha.1", database: "connected" };
    } catch {
      return reply.code(503).send({
        ok: false,
        version: "3.4.0-alpha.1",
        database: "unavailable"
      });
    }
  });

  app.post("/v1/auth/login", { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } }, async (request, reply) => {
    const { apiKey, analyticsConsent } = loginBody.parse(request.body);
    const identity = await verifyTornIdentity(apiKey);
    if (identity.factionId !== config.VAULT111_FACTION_ID) {
      throw Object.assign(new Error("Vault 111 membership is required"), { statusCode: 403 });
    }
    const mapping = identity.factionPosition
      ? await db.roleMapping.findUnique({
          where: { factionId_factionPosition: { factionId: identity.factionId, factionPosition: identity.factionPosition } }
        })
      : null;
    const existing = await db.user.findUnique({ where: { tornId: identity.tornId } });
    const role = existing?.role === AppRole.OWNER ? AppRole.OWNER : mapping?.appRole ?? AppRole.MEMBER;
    const encryptedApiKey = encryptSecret(apiKey, `torn-api-key:${identity.tornId}`);
    const user = await db.user.upsert({
      where: { tornId: identity.tornId },
      create: {
        ...identity,
        role,
        encryptedApiKey,
        apiKeyFingerprint: sha256(apiKey).slice(0, 16),
        apiKeyUpdatedAt: new Date(),
        analyticsConsentAt: analyticsConsent ? new Date() : null,
        lastVerifiedAt: new Date()
      },
      update: {
        ...identity,
        role,
        encryptedApiKey,
        apiKeyFingerprint: sha256(apiKey).slice(0, 16),
        apiKeyUpdatedAt: new Date(),
        ...(analyticsConsent ? { analyticsConsentAt: new Date() } : {}),
        lastVerifiedAt: new Date()
      }
    });
    if (user.isSuspended) throw Object.assign(new Error("Account suspended"), { statusCode: 403 });
    const refreshToken = newOpaqueToken();
    await db.session.create({
      data: {
        userId: user.id,
        refreshTokenHash: sha256(refreshToken),
        expiresAt: refreshExpiry(),
        userAgent: request.headers["user-agent"]?.slice(0, 300) ?? null,
        ipHash: sha256(request.ip)
      }
    });
    await audit(request, user.id, "auth.login", "session");
    if (analyticsConsent && !existing?.analyticsConsentAt) {
      await audit(
        request,
        user.id,
        "member.analytics.consent.granted",
        "member_analytics",
        String(user.tornId),
        { source: "login" }
      );
    }
    return reply.send({
      accessToken: await issueAccessToken(user),
      refreshToken,
      expiresIn: config.ACCESS_TOKEN_TTL_SECONDS,
      user: {
        tornId: user.tornId,
        name: user.name,
        role: user.role,
        factionPosition: user.factionPosition,
        analyticsConsentAt: user.analyticsConsentAt
      }
    });
  });

  app.post("/v1/auth/refresh", async (request) => {
    const { refreshToken } = refreshBody.parse(request.body);
    const old = await db.session.findUnique({ where: { refreshTokenHash: sha256(refreshToken) }, include: { user: true } });
    if (!old || old.revokedAt || old.expiresAt <= new Date() || old.user.isSuspended) {
      throw Object.assign(new Error("Invalid refresh token"), { statusCode: 401 });
    }
    const nextToken = newOpaqueToken();
    await db.$transaction([
      db.session.update({ where: { id: old.id }, data: { revokedAt: new Date() } }),
      db.session.create({
        data: {
          userId: old.userId,
          refreshTokenHash: sha256(nextToken),
          expiresAt: refreshExpiry(),
          userAgent: request.headers["user-agent"]?.slice(0, 300) ?? null,
          ipHash: sha256(request.ip)
        }
      })
    ]);
    return { accessToken: await issueAccessToken(old.user), refreshToken: nextToken, expiresIn: config.ACCESS_TOKEN_TTL_SECONDS };
  });

  app.post("/v1/auth/logout", async (request, reply) => {
    const { refreshToken } = refreshBody.parse(request.body);
    await db.session.updateMany({ where: { refreshTokenHash: sha256(refreshToken), revokedAt: null }, data: { revokedAt: new Date() } });
    return reply.code(204).send();
  });

  app.get("/v1/me", async (request) => {
    const principal = await authenticate(request);
    const user = await db.user.findUniqueOrThrow({
      where: { id: principal.id },
      select: {
        tornId: true,
        name: true,
        role: true,
        factionPosition: true,
        analyticsConsentAt: true,
        lastVerifiedAt: true
      }
    });
    return { user };
  });

  app.put("/v1/me/analytics-consent", async request => {
    const principal = await authenticate(request);
    const { accepted } = analyticsConsentBody.parse(request.body);
    const result = await setMemberAnalyticsConsent(principal, accepted);
    await audit(
      request,
      principal.id,
      accepted ? "member.analytics.consent.granted" : "member.analytics.consent.withdrawn",
      "member_analytics",
      String(principal.tornId),
      { storedAnalyticsDeleted: !accepted }
    );
    return result;
  });

  app.post(
    "/v1/me/analytics/sync",
    { config: { rateLimit: { max: 2, timeWindow: "1 minute" } } },
    async request => {
      const principal = await authenticate(request);
      const result = await synchronizeOwnMemberAnalytics(principal);
      await audit(
        request,
        principal.id,
        "member.analytics.sync",
        "member_analytics",
        String(principal.tornId),
        {
          battleStats: result.battleStats,
          drugStats: result.drugStats,
          cooldowns: result.cooldowns,
          warningCount: result.warnings.length,
          syncedAt: result.syncedAt.toISOString()
        }
      );
      return result;
    }
  );

  app.post(
    "/v1/me/crime-stats/sync",
    { config: { rateLimit: { max: 2, timeWindow: "1 minute" } } },
    async request => {
      const principal = await authenticate(request);
      const result = await synchronizeOwnCrimeStats(principal);
      await audit(request, principal.id, "member.crime_stats.sync", "member_crime_stats", String(principal.tornId), {
        trackedStats: result.trackedStats,
        syncedAt: result.syncedAt.toISOString()
      });
      return result;
    }
  );

  app.get("/v1/me/crime-stats", async request => {
    const principal = await authenticate(request);
    const record = await db.memberCrimeStats.findUnique({
      where: {
        factionId_tornId: {
          factionId: principal.factionId,
          tornId: principal.tornId
        }
      },
      select: { stats: true, syncedAt: true }
    });
    const trackedStats =
      record?.stats && typeof record.stats === "object" && !Array.isArray(record.stats)
        ? Object.keys(record.stats).length
        : 0;
    return {
      crimeStats: record
        ? { syncedAt: record.syncedAt, trackedStats }
        : null
    };
  });

  app.post(
    "/v1/faction/sync",
    { config: { rateLimit: { max: 2, timeWindow: "1 minute" } } },
    async request => {
      const principal = await authenticate(request);
      requirePermission(principal, "oc.sync");
      const result = await synchronizeFaction(principal);
      await audit(request, principal.id, "faction.sync", "faction", String(principal.factionId), {
        members: result.members,
        crimes: result.crimes,
        syncedAt: result.syncedAt.toISOString()
      });
      return result;
    }
  );

  app.get("/v1/faction/members", async request => {
    const principal = await authenticate(request);
    requirePermission(principal, "oc.read");
    return { members: await readFactionMembers(principal.factionId) };
  });

  app.get("/v1/members/overview", async request => {
    const principal = await authenticate(request);
    requirePermission(principal, "members.read");
    const overview = await readMemberOverview(principal);
    if (overview.privacy.canReadAllAnalytics) {
      await audit(
        request,
        principal.id,
        "member.analytics.read_all",
        "member_analytics",
        String(principal.factionId),
        { exactAnalyticsRecords: overview.summary.analyticsShared }
      );
    }
    return overview;
  });

  app.get("/v1/members/:tornId/war-history", async request => {
    const principal = await authenticate(request);
    requirePermission(principal, "members.read");
    const params = memberHistoryParams.parse(request.params);
    return readMemberWarHistory(principal.factionId, params.tornId);
  });

  app.get("/v1/dashboard", async request => {
    const principal = await authenticate(request);
    requirePermission(principal, "dashboard.read");
    return readDashboardSnapshot(
      principal.factionId,
      hasPermission(principal, "announcements.manage")
    );
  });

  app.post(
    "/v1/announcements",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async request => {
      const principal = await authenticate(request);
      requirePermission(principal, "announcements.manage");
      const body = announcementBody.parse(request.body);
      const announcement = await createAnnouncement({
        factionId: principal.factionId,
        actorUserId: principal.id,
        ...body
      });
      await audit(
        request,
        principal.id,
        "announcement.create",
        "announcement",
        announcement.id,
        {
          title: announcement.title,
          pinned: announcement.pinned,
          expiresAt: announcement.expiresAt?.toISOString() ?? null
        }
      );
      return { announcement };
    }
  );

  app.put("/v1/announcements/:announcementId", async request => {
    const principal = await authenticate(request);
    requirePermission(principal, "announcements.manage");
    const params = announcementParams.parse(request.params);
    const body = announcementUpdateBody.parse(request.body);
    const announcement = await updateAnnouncement({
      id: params.announcementId,
      factionId: principal.factionId,
      actorUserId: principal.id,
      ...body
    });
    await audit(
      request,
      principal.id,
      "announcement.update",
      "announcement",
      announcement.id,
      {
        title: announcement.title,
        pinned: announcement.pinned,
        expiresAt: announcement.expiresAt?.toISOString() ?? null,
        version: announcement.version
      }
    );
    return { announcement };
  });

  app.delete("/v1/announcements/:announcementId", async request => {
    const principal = await authenticate(request);
    requirePermission(principal, "announcements.manage");
    const params = announcementParams.parse(request.params);
    const query = announcementDeleteQuery.parse(request.query);
    await deleteAnnouncement({
      id: params.announcementId,
      factionId: principal.factionId,
      expectedVersion: query.expectedVersion
    });
    await audit(
      request,
      principal.id,
      "announcement.delete",
      "announcement",
      params.announcementId,
      { expectedVersion: query.expectedVersion }
    );
    return { deleted: true };
  });

  app.get("/v1/oc/snapshot", async request => {
    const principal = await authenticate(request);
    requirePermission(principal, "oc.read");
    return readFactionSnapshot(principal.factionId);
  });

  app.get("/v1/oc/crimes", async (request) => {
    const principal = await authenticate(request);
    requirePermission(principal, "oc.read");
    return { crimes: await readFactionCrimes(principal.factionId) };
  });

  app.post(
    "/v1/war/sync",
    { config: { rateLimit: { max: 2, timeWindow: "1 minute" } } },
    async request => {
      const principal = await authenticate(request);
      requirePermission(principal, "war.sync");
      const result = await synchronizeRankedWar(principal);
      await audit(request, principal.id, "ranked_war.sync", "ranked_war", result.rankedWarId ? String(result.rankedWarId) : undefined, {
        attacks: result.attacks,
        targets: result.targets,
        truncated: result.truncated,
        syncedAt: result.syncedAt.toISOString()
      });
      return result;
    }
  );

  app.get("/v1/war/snapshot", async request => {
    const principal = await authenticate(request);
    requirePermission(principal, "war.read");
    return readRankedWarSnapshot(principal.factionId);
  });

  app.put("/v1/war/:warId/targets/:targetTornId/note", async request => {
    const principal = await authenticate(request);
    requirePermission(principal, "war.notes");
    const params = warTargetParams.parse(request.params);
    const body = warTargetNoteBody.parse(request.body);
    const war = await db.rankedWar.findFirst({
      where: { id: params.warId, factionId: principal.factionId },
      select: { id: true }
    });
    if (!war) {
      throw Object.assign(new Error("Ranked war not found"), { statusCode: 404 });
    }
    const existing = await db.warTarget.findUnique({
      where: {
        rankedWarId_tornId: {
          rankedWarId: params.warId,
          tornId: params.targetTornId
        }
      },
      select: { noteVersion: true }
    });
    if (!existing) {
      throw Object.assign(new Error("War target not found"), { statusCode: 404 });
    }
    const updated = await db.warTarget.updateMany({
      where: {
        rankedWarId: params.warId,
        tornId: params.targetTornId,
        noteVersion: body.expectedVersion
      },
      data: {
        note: body.note,
        noteVersion: { increment: 1 },
        noteUpdatedAt: new Date(),
        noteUpdatedById: principal.id
      }
    });
    if (updated.count !== 1) {
      throw Object.assign(new Error("Target note changed; refresh before editing"), { statusCode: 409 });
    }
    const target = await db.warTarget.findUniqueOrThrow({
      where: {
        rankedWarId_tornId: {
          rankedWarId: params.warId,
          tornId: params.targetTornId
        }
      },
      include: {
        noteUpdatedBy: {
          select: { tornId: true, name: true }
        }
      }
    });
    await audit(
      request,
      principal.id,
      "ranked_war.target_note.update",
      "war_target",
      `${params.warId}:${params.targetTornId}`,
      {
        noteLength: body.note?.length ?? 0,
        noteVersion: target.noteVersion
      }
    );
    return { target };
  });

  app.get("/v1/war/:warId/payout", async request => {
    const principal = await authenticate(request);
    requirePermission(principal, "war.payout.read");
    const params = warPayoutParams.parse(request.params);
    return readWarPayout(principal.factionId, params.warId);
  });

  app.put("/v1/war/:warId/payout", async request => {
    const principal = await authenticate(request);
    requirePermission(principal, "war.payout.manage");
    const params = warPayoutParams.parse(request.params);
    const body = warPayoutSettingsBody.parse(request.body);
    const poolAmount = parseMoney(body.poolAmount);
    await saveWarPayoutSettings({
      factionId: principal.factionId,
      rankedWarId: params.warId,
      actorUserId: principal.id,
      poolAmount,
      expectedVersion: body.expectedVersion
    });
    await audit(request, principal.id, "ranked_war.payout.settings.update", "war_payout", String(params.warId), {
      poolAmount: body.poolAmount
    });
    return readWarPayout(principal.factionId, params.warId);
  });

  app.put("/v1/war/:warId/payout/members/:tornId", async request => {
    const principal = await authenticate(request);
    requirePermission(principal, "war.payout.manage");
    const params = warPayoutMemberParams.parse(request.params);
    const body = warPayoutAdjustmentBody.parse(request.body);
    const amount = parseMoney(body.amount, { signed: true });
    await saveWarPayoutAdjustment({
      factionId: principal.factionId,
      rankedWarId: params.warId,
      actorUserId: principal.id,
      tornId: params.tornId,
      amount,
      note: body.note,
      expectedVersion: body.expectedVersion
    });
    await audit(request, principal.id, "ranked_war.payout.adjustment.update", "war_payout_member", `${params.warId}:${params.tornId}`, {
      amount: body.amount,
      noteLength: body.note?.length ?? 0
    });
    return readWarPayout(principal.factionId, params.warId);
  });

  app.post("/v1/war/:warId/payout/finalize", async request => {
    const principal = await authenticate(request);
    requirePermission(principal, "war.payout.manage");
    const params = warPayoutParams.parse(request.params);
    const body = versionedActionBody.parse(request.body);
    await finalizeWarPayout({
      factionId: principal.factionId,
      rankedWarId: params.warId,
      actorUserId: principal.id,
      expectedVersion: body.expectedVersion
    });
    await audit(request, principal.id, "ranked_war.payout.finalize", "war_payout", String(params.warId));
    return readWarPayout(principal.factionId, params.warId);
  });

  app.post("/v1/war/:warId/payout/reopen", async request => {
    const principal = await authenticate(request);
    requirePermission(principal, "war.payout.reopen");
    const params = warPayoutParams.parse(request.params);
    const body = versionedActionBody.parse(request.body);
    await reopenWarPayout({
      factionId: principal.factionId,
      rankedWarId: params.warId,
      actorUserId: principal.id,
      expectedVersion: body.expectedVersion
    });
    await audit(request, principal.id, "ranked_war.payout.reopen", "war_payout", String(params.warId));
    return readWarPayout(principal.factionId, params.warId);
  });

  app.put("/v1/oc/crimes/:crimeId/roles/:roleKey", async (request) => {
    const principal = await authenticate(request);
    requirePermission(principal, "oc.assign");
    const params = crimeParams.parse(request.params);
    const body = assignmentBody.parse(request.body);
    const crime = await db.ocCrime.findFirstOrThrow({ where: { id: params.crimeId, factionId: principal.factionId } });
    if (crime.version !== body.expectedVersion) {
      throw Object.assign(new Error("Crime changed; refresh before editing"), { statusCode: 409 });
    }
    const assignedUser = body.assignedTornId
      ? await db.user.findFirst({ where: { tornId: body.assignedTornId, factionId: principal.factionId } })
      : null;
    const assignment = await db.ocAssignment.upsert({
      where: { crimeId_roleKey: { crimeId: crime.id, roleKey: params.roleKey } },
      create: {
        crimeId: crime.id,
        roleKey: params.roleKey,
        assignedTornId: body.assignedTornId,
        assignedUserId: assignedUser?.id ?? null,
        locked: body.locked,
        expectedVersion: crime.version,
        changedByUserId: principal.id,
        note: body.note ?? null
      },
      update: {
        assignedTornId: body.assignedTornId,
        assignedUserId: assignedUser?.id ?? null,
        locked: body.locked,
        expectedVersion: crime.version,
        changedByUserId: principal.id,
        note: body.note ?? null
      }
    });
    await audit(request, principal.id, "oc.assignment.upsert", "oc_assignment", assignment.id, {
      crimeId: crime.id,
      roleKey: params.roleKey,
      assignedTornId: body.assignedTornId
    });
    return { assignment };
  });

  app.get("/v1/admin/audit", async (request) => {
    const principal = await authenticate(request);
    requirePermission(principal, "audit.read");
    return { events: await db.auditEvent.findMany({ take: 100, orderBy: { createdAt: "desc" } }) };
  });
}
