import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const requested = process.argv[2];
if (!requested) {
  throw new Error("Usage: npm run client:configure -- https://your-control-center-domain");
}

const backend = new URL(requested);
if (backend.protocol !== "https:" || backend.username || backend.password) {
  throw new Error("The production backend address must be a plain HTTPS URL.");
}
if (backend.pathname !== "/" || backend.search || backend.hash) {
  throw new Error("Use only the HTTPS origin, without a path, query string, or fragment.");
}

const sourcePath = resolve("client/Vault-111-Control-Center-v3.0.0-alpha.11.user.js");
const outputPath = resolve(
  process.argv[3] || "client/Vault-111-Control-Center-v3.0.0-alpha.11-production.user.js"
);
let source = await readFile(sourcePath, "utf8");

source = source
  .replace(/^\/\/ @connect\s+127\.0\.0\.1\r?\n/m, "")
  .replace(/^\/\/ @connect\s+localhost\r?\n/m, "")
  .replace(
    /^\/\/ @grant\s+GM_xmlhttpRequest/m,
    `// @connect      ${backend.hostname}\n// @grant        GM_xmlhttpRequest`
  )
  .replace(
    /const BACKEND_API = 'http:\/\/127\.0\.0\.1:3000';/,
    `const BACKEND_API = '${backend.origin}';`
  );

await writeFile(outputPath, source, "utf8");
console.log(`Created ${outputPath} for ${backend.origin}. No secrets were included.`);
