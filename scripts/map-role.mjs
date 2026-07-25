import { loadEnvFile } from "node:process";

const argumentsList = process.argv.slice(2);
const envFile = argumentsList.find(value => value.startsWith("--env-file="))?.slice("--env-file=".length) || ".env";
try {
  loadEnvFile(envFile);
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}

const factionId = Number(process.env.VAULT111_FACTION_ID);
const positional = argumentsList.filter(value => !value.startsWith("--"));
const factionPosition = String(positional[0] || "").trim();
const appRole = String(positional[1] || "").trim().toUpperCase();
const allowedRoles = new Set(["ADMIN", "OC_PLANNER", "WAR_MANAGER", "OFFICER", "MEMBER"]);

if (!Number.isSafeInteger(factionId) || factionId <= 0 || !factionPosition || !allowedRoles.has(appRole)) {
  throw new Error(
    'Usage: npm run role:map -- "Exact Torn Position" ADMIN|OC_PLANNER|WAR_MANAGER|OFFICER|MEMBER [--env-file=.env.production]'
  );
}

// Import Prisma only after the requested environment file has been loaded.
const { PrismaClient } = await import("@prisma/client");
const prisma = new PrismaClient();
try {
  const positionExists = await prisma.factionMember.findFirst({
    where: { factionId, position: factionPosition, isActive: true },
    select: { tornId: true }
  });
  if (!positionExists) {
    throw new Error(
      `No active faction member currently has the exact position "${factionPosition}". Synchronize first and check the spelling.`
    );
  }
  await prisma.roleMapping.upsert({
    where: {
      factionId_factionPosition: {
        factionId,
        factionPosition
      }
    },
    create: { factionId, factionPosition, appRole },
    update: { appRole }
  });
  console.log(`Mapped Torn position "${factionPosition}" to ${appRole}.`);
} finally {
  await prisma.$disconnect();
}
