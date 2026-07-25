import { loadEnvFile } from "node:process";
import { PrismaClient } from "@prisma/client";

const envFile = process.argv.slice(2).find(value => value.startsWith("--env-file="))?.slice("--env-file=".length) || ".env";
try {
  loadEnvFile(envFile);
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}

const prisma = new PrismaClient();
try {
  const [users, sessions, roleMappings, factionMembers, activeCrimes, roles, migrations] = await Promise.all([
    prisma.user.count(),
    prisma.session.count(),
    prisma.roleMapping.count(),
    prisma.factionMember.count({ where: { isActive: true } }),
    prisma.ocCrime.count({ where: { isActive: true } }),
    prisma.user.groupBy({ by: ["role"], _count: { _all: true } }),
    prisma.$queryRaw`SELECT migration_name, finished_at, rolled_back_at FROM "_prisma_migrations" ORDER BY started_at`
  ]);
  console.log(JSON.stringify({
    database: "connected",
    users,
    sessions,
    roleMappings,
    factionMembers,
    activeCrimes,
    roles: Object.fromEntries(roles.map(entry => [entry.role, entry._count._all])),
    migrations: migrations.map(({ migration_name, finished_at, rolled_back_at }) => ({
      name: migration_name,
      finished: Boolean(finished_at),
      rolledBack: Boolean(rolled_back_at)
    }))
  }, null, 2));
} finally {
  await prisma.$disconnect();
}
