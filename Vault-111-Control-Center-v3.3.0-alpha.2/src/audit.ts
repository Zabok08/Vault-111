import type { FastifyRequest } from "fastify";
import type { Prisma } from "@prisma/client";
import { db } from "./db.js";
import { sha256 } from "./crypto.js";

export async function audit(
  request: FastifyRequest,
  actorUserId: string | null,
  action: string,
  resource: string,
  resourceId?: string,
  metadata?: Record<string, unknown>
) {
  await db.auditEvent.create({
    data: {
      actorUserId,
      action,
      resource,
      resourceId: resourceId ?? null,
      requestId: request.id,
      ipHash: request.ip ? sha256(request.ip) : null,
      metadata: (metadata ?? {}) as Prisma.InputJsonValue
    }
  });
}
