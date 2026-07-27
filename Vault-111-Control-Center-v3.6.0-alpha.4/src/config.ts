import { z } from "zod";
import { loadEnvFile } from "node:process";

try {
  loadEnvFile();
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
}

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: z.string().default("127.0.0.1"),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1),
  DIRECT_URL: z.string().min(1).optional(),
  PUBLIC_BASE_URL: z.string().url(),
  ALLOWED_ORIGINS: z.string().default("https://www.torn.com"),
  VAULT111_FACTION_ID: z.coerce.number().int().positive(),
  JWT_ISSUER: z.string().min(1),
  JWT_AUDIENCE: z.string().min(1),
  JWT_SECRET: z.string().min(32),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(300).max(3600).default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(30),
  KEY_ENCRYPTION_ACTIVE_VERSION: z.string().min(1),
  KEY_ENCRYPTION_KEYS_JSON: z.string().transform((value, ctx) => {
    try {
      return z.record(z.string(), z.string()).parse(JSON.parse(value));
    } catch {
      ctx.addIssue({ code: "custom", message: "Must be a JSON object of version:base64-key" });
      return z.NEVER;
    }
  }),
  TORN_API_BASE_URL: z.string().url().default("https://api.torn.com/v2"),
  TRUST_PROXY: z.enum(["true", "false"]).default("false").transform(v => v === "true")
});

const parsed = schema.parse({
  ...process.env,
  PUBLIC_BASE_URL: process.env.PUBLIC_BASE_URL || process.env.RENDER_EXTERNAL_URL
});

if (parsed.NODE_ENV === "production" && new URL(parsed.PUBLIC_BASE_URL).protocol !== "https:") {
  throw new Error("PUBLIC_BASE_URL must use HTTPS in production.");
}

export const config = parsed;
export const allowedOrigins = new Set(config.ALLOWED_ORIGINS.split(",").map(v => v.trim()));
