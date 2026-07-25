import type { FastifyInstance } from "fastify";
import { AppRole } from "@prisma/client";
import { z } from "zod";
import { db } from "./db.js";
import { config } from "./config.js";
import { encryptSecret, newOpaqueToken, sha256 } from "./crypto.js";
import { verifyTornIdentity } from "./torn.js";
import { authenticate, issueAccessToken, requirePermission } from "./auth.js";
import { audit } from "./audit.js";
import {
  readFactionCrimes,
  readFactionMembers,
  readFactionSnapshot,
  synchronizeFaction,
  synchronizeOwnCrimeStats
} from "./ingestion.js";

const loginBody = z.object({ apiKey: z.string().trim().min(8).max(256) });
const refreshBody = z.object({ refreshToken: z.string().min(32).max(256) });
const assignmentBody = z.object({
  assignedTornId: z.number().int().positive().nullable(),
  locked: z.boolean().default(false),
  note: z.string().trim().max(500).nullable().optional(),
  expectedVersion: z.number().int().positive()
});
const crimeParams = z.object({ crimeId: z.string().min(1).max(128), roleKey: z.string().min(1).max(128) });

function refreshExpiry() {
  return new Date(Date.now() + config.REFRESH_TOKEN_TTL_DAYS * 86_400_000);
}

export async function registerRoutes(app: FastifyInstance) {
  app.get("/health", async (_request, reply) => {
    try {
      await db.$queryRaw`SELECT 1`;
      return { ok: true, version: "3.0.0-alpha.11", database: "connected" };
    } catch {
      return reply.code(503).send({
        ok: false,
        version: "3.0.0-alpha.11",
        database: "unavailable"
      });
    }
  });

  app.post("/v1/auth/login", { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } }, async (request, reply) => {
    const { apiKey } = loginBody.parse(request.body);
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
      create: { ...identity, role, encryptedApiKey, apiKeyFingerprint: sha256(apiKey).slice(0, 16), apiKeyUpdatedAt: new Date(), lastVerifiedAt: new Date() },
      update: { ...identity, role, encryptedApiKey, apiKeyFingerprint: sha256(apiKey).slice(0, 16), apiKeyUpdatedAt: new Date(), lastVerifiedAt: new Date() }
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
    return reply.send({
      accessToken: await issueAccessToken(user),
      refreshToken,
      expiresIn: config.ACCESS_TOKEN_TTL_SECONDS,
      user: { tornId: user.tornId, name: user.name, role: user.role, factionPosition: user.factionPosition }
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
    const user = await db.user.findUniqueOrThrow({ where: { id: principal.id }, select: { tornId: true, name: true, role: true, factionPosition: true, lastVerifiedAt: true } });
    return { user };
  });

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
