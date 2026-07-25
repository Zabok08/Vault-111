import { beforeAll, describe, expect, it } from "vitest";

beforeAll(() => {
  process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
  process.env.PUBLIC_BASE_URL = "http://127.0.0.1:3000";
  process.env.VAULT111_FACTION_ID = "123";
  process.env.JWT_ISSUER = "test";
  process.env.JWT_AUDIENCE = "test";
  process.env.JWT_SECRET = "12345678901234567890123456789012";
  process.env.KEY_ENCRYPTION_ACTIVE_VERSION = "v1";
  process.env.KEY_ENCRYPTION_KEYS_JSON = JSON.stringify({ v1: Buffer.alloc(32, 7).toString("base64") });
});

describe("API-key envelope encryption", () => {
  it("round-trips and binds ciphertext to a Torn user", async () => {
    const { encryptSecret, decryptSecret } = await import("../src/crypto.js");
    const encrypted = encryptSecret("secret-api-key", "torn-api-key:42");
    expect(encrypted).not.toContain("secret-api-key");
    expect(decryptSecret(encrypted, "torn-api-key:42")).toBe("secret-api-key");
    expect(() => decryptSecret(encrypted, "torn-api-key:43")).toThrow();
  });
});
