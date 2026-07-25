import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { config } from "./config.js";

type Envelope = { v: string; iv: string; tag: string; data: string };

function keyFor(version: string): Buffer {
  const encoded = config.KEY_ENCRYPTION_KEYS_JSON[version];
  if (!encoded) throw new Error(`Unknown encryption key version: ${version}`);
  const key = Buffer.from(encoded, "base64");
  if (key.length !== 32) throw new Error(`Encryption key ${version} must decode to 32 bytes`);
  return key;
}

export function encryptSecret(plaintext: string, context: string): string {
  const v = config.KEY_ENCRYPTION_ACTIVE_VERSION;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyFor(v), iv);
  cipher.setAAD(Buffer.from(context));
  const data = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const envelope: Envelope = {
    v,
    iv: iv.toString("base64url"),
    tag: cipher.getAuthTag().toString("base64url"),
    data: data.toString("base64url")
  };
  return Buffer.from(JSON.stringify(envelope)).toString("base64url");
}

export function decryptSecret(encoded: string, context: string): string {
  const envelope = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as Envelope;
  const decipher = createDecipheriv("aes-256-gcm", keyFor(envelope.v), Buffer.from(envelope.iv, "base64url"));
  decipher.setAAD(Buffer.from(context));
  decipher.setAuthTag(Buffer.from(envelope.tag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(envelope.data, "base64url")),
    decipher.final()
  ]).toString("utf8");
}

export const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
export const newOpaqueToken = () => randomBytes(32).toString("base64url");
