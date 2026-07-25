import { loadEnvFile } from "node:process";

const argumentsList = process.argv.slice(2);
const envFile = argumentsList.find(value => value.startsWith("--env-file="))?.slice("--env-file=".length) || ".env";
try {
  loadEnvFile(envFile);
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}

const tornId = Number(argumentsList.find(value => !value.startsWith("--")));
if (!Number.isSafeInteger(tornId) || tornId <= 0) {
  throw new Error("Usage: npm run owner:grant -- YOUR_NUMERIC_TORN_ID [--env-file=.env.production]");
}

// Prisma reads its datasource configuration during module initialization.
// Load the selected environment file first so production helpers cannot
// accidentally connect to a local database.
const { PrismaClient } = await import("@prisma/client");
const prisma = new PrismaClient();
try {
  const user = await prisma.user.findUnique({
    where: { tornId },
    select: { tornId: true, name: true, role: true }
  });
  if (!user) {
    throw new Error(
      `Torn user ${tornId} has not connected to the backend yet. Connect once from the userscript, then rerun this command.`
    );
  }
  const updated = await prisma.user.update({
    where: { tornId },
    data: { role: "OWNER" },
    select: { tornId: true, name: true, role: true }
  });
  console.log(`Granted ${updated.name} [${updated.tornId}] the ${updated.role} role.`);
} finally {
  await prisma.$disconnect();
}
