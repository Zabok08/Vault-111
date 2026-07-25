import type { FastifyRequest } from "fastify";
import { SignJWT, jwtVerify } from "jose";
import type { AppRole, User } from "@prisma/client";
import { config } from "./config.js";
import { db } from "./db.js";

const secret = new TextEncoder().encode(config.JWT_SECRET);

export type Principal = Pick<User, "id" | "tornId" | "factionId" | "role" | "isSuspended">;

export async function issueAccessToken(user: Principal) {
  return new SignJWT({ tornId: user.tornId, factionId: user.factionId, role: user.role })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(user.id)
    .setIssuer(config.JWT_ISSUER)
    .setAudience(config.JWT_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${config.ACCESS_TOKEN_TTL_SECONDS}s`)
    .sign(secret);
}

export async function authenticate(request: FastifyRequest): Promise<Principal> {
  const value = request.headers.authorization;
  if (!value?.startsWith("Bearer ")) throw Object.assign(new Error("Authentication required"), { statusCode: 401 });
  try {
    const { payload } = await jwtVerify(value.slice(7), secret, {
      issuer: config.JWT_ISSUER,
      audience: config.JWT_AUDIENCE
    });
    const user = await db.user.findUnique({
      where: { id: String(payload.sub) },
      select: {
        id: true,
        tornId: true,
        factionId: true,
        role: true,
        isSuspended: true
      }
    });
    if (
      !user ||
      user.isSuspended ||
      user.tornId !== Number(payload.tornId) ||
      user.factionId !== Number(payload.factionId)
    ) {
      throw new Error("Invalid session");
    }
    return user;
  } catch {
    throw Object.assign(new Error("Invalid or expired access token"), { statusCode: 401 });
  }
}

const permissions: Record<AppRole, Set<string>> = {
  OWNER: new Set(["*"]),
  ADMIN: new Set([
    "oc.read",
    "oc.sync",
    "oc.assign",
    "oc.optimize",
    "war.read",
    "war.sync",
    "war.manage",
    "war.notes",
    "roles.read",
    "audit.read"
  ]),
  OC_PLANNER: new Set(["oc.read", "oc.sync", "oc.assign", "oc.optimize", "war.read"]),
  WAR_MANAGER: new Set(["oc.read", "war.read", "war.sync", "war.manage", "war.notes"]),
  OFFICER: new Set(["oc.read", "war.read", "war.notes"]),
  MEMBER: new Set(["oc.read", "war.read"])
};

export function requirePermission(principal: Principal, permission: string) {
  const granted = permissions[principal.role];
  if (!granted?.has("*") && !granted?.has(permission)) {
    throw Object.assign(new Error("Forbidden"), { statusCode: 403 });
  }
}
