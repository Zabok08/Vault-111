import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const envPath = resolve(process.argv[2] || ".env");
const contents = await readFile(envPath, "utf8");

if (/^DIRECT_URL=.+$/m.test(contents)) {
  console.log(`DIRECT_URL already exists in ${envPath}. No changes were made.`);
  process.exit(0);
}

const databaseUrl = contents.match(/^DATABASE_URL=(.+)$/m)?.[1]?.trim();
if (!databaseUrl) {
  throw new Error(`DATABASE_URL is missing from ${envPath}.`);
}

const parsed = new URL(databaseUrl);
const localHosts = new Set(["127.0.0.1", "localhost", "postgres"]);
if (!localHosts.has(parsed.hostname)) {
  throw new Error("Refusing to copy a non-local DATABASE_URL. Add the production DIRECT_URL explicitly.");
}

const updated = `${contents.replace(/\s*$/, "")}\nDIRECT_URL=${databaseUrl}\n`;
await writeFile(envPath, updated, { encoding: "utf8", mode: 0o600 });
console.log(`Added the local direct database connection to ${envPath}. No credential was displayed.`);
