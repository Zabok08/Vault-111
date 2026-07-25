import { randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const envPath = resolve(process.argv[2] || ".env");
let contents;

try {
  contents = await readFile(envPath, "utf8");
} catch (error) {
  if (error?.code === "ENOENT") {
    throw new Error(`No .env file was found at ${envPath}. Copy .env.example to .env first.`);
  }
  throw error;
}

function setValue(source, name, value) {
  const line = `${name}=${value}`;
  const pattern = new RegExp(`^${name}=.*$`, "m");
  return pattern.test(source)
    ? source.replace(pattern, line)
    : `${source.replace(/\s*$/, "")}\n${line}\n`;
}

function getValue(source, name) {
  return source.match(new RegExp(`^${name}=(.*)$`, "m"))?.[1] ?? "";
}

const currentJwt = getValue(contents, "JWT_SECRET");
const currentKeyJson = getValue(contents, "KEY_ENCRYPTION_KEYS_JSON");
let currentEncryptionKey = "";
try {
  currentEncryptionKey = JSON.parse(currentKeyJson).v1 ?? "";
} catch {
  // Invalid or placeholder JSON is replaced below.
}

const jwtIsValid = /^[A-Za-z0-9_-]{64}$/.test(currentJwt);
let encryptionKeyIsValid = false;
try {
  encryptionKeyIsValid =
    Buffer.from(currentEncryptionKey, "base64").length === 32;
} catch {
  encryptionKeyIsValid = false;
}

if (jwtIsValid && encryptionKeyIsValid) {
  console.log(`Valid secrets already exist in ${envPath}. No changes were made.`);
  process.exit(0);
}

const jwtSecret = jwtIsValid
  ? currentJwt
  : randomBytes(48).toString("base64url");
const encryptionKey = encryptionKeyIsValid
  ? currentEncryptionKey
  : randomBytes(32).toString("base64");

contents = setValue(contents, "JWT_SECRET", jwtSecret);
contents = setValue(contents, "KEY_ENCRYPTION_ACTIVE_VERSION", "v1");
contents = setValue(
  contents,
  "KEY_ENCRYPTION_KEYS_JSON",
  JSON.stringify({ v1: encryptionKey })
);

await writeFile(envPath, contents, { encoding: "utf8", mode: 0o600 });
console.log(`Generated JWT and encryption secrets in ${envPath}. Secret values were not displayed.`);
