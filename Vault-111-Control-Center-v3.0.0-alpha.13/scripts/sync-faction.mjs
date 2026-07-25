import { loadEnvFile } from "node:process";

const envFile = process.argv.slice(2).find(value => value.startsWith("--env-file="))?.slice("--env-file=".length) || ".env";
try {
  loadEnvFile(envFile);
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}

const [{ db }, { synchronizeFaction }] = await Promise.all([
  import("../dist/src/db.js"),
  import("../dist/src/ingestion.js")
]);

try {
  const owner = await db.user.findFirst({
    where: { role: "OWNER", isSuspended: false },
    orderBy: { createdAt: "asc" }
  });
  if (!owner) {
    throw new Error("No active Owner has connected. Connect once and run owner:grant first.");
  }
  const result = await synchronizeFaction(owner);
  console.log(
    `Faction sync complete: ${result.members} members and ${result.crimes} available crimes.`
  );
} finally {
  await db.$disconnect();
}
