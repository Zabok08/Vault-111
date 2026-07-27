import Fastify from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import { ZodError } from "zod";
import { config, allowedOrigins } from "./config.js";
import { db } from "./db.js";
import { registerRoutes } from "./routes.js";

const app = Fastify({
  logger: {
    level: config.NODE_ENV === "production" ? "info" : "debug",
    redact: ["req.headers.authorization", "body.apiKey", "body.refreshToken", "accessToken", "refreshToken"]
  },
  trustProxy: config.TRUST_PROXY,
  bodyLimit: 64 * 1024,
  requestTimeout: 45_000
});

await app.register(helmet, { contentSecurityPolicy: false });
await app.register(cors, {
  origin(origin, callback) {
    if (!origin || allowedOrigins.has(origin)) callback(null, true);
    else callback(new Error("Origin not allowed"), false);
  },
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Authorization", "Content-Type"]
});
await app.register(rateLimit, { max: 120, timeWindow: "1 minute" });
await registerRoutes(app);

app.setErrorHandler((error, request, reply) => {
  const errorInfo = error as { statusCode?: number; code?: string; name?: string; expose?: boolean };
  const databaseUnavailable =
    errorInfo.name === "PrismaClientInitializationError" || errorInfo.code === "P1001";
  const statusCode = error instanceof ZodError
    ? 400
    : databaseUnavailable
      ? 503
      : (errorInfo.statusCode ?? 500);
  const message = databaseUnavailable
    ? "Database unavailable. Start PostgreSQL and try again."
    : error instanceof Error
      ? error.message
      : "Unknown error";
  const expose = statusCode < 500 || databaseUnavailable || errorInfo.expose === true;
  if (statusCode >= 500) request.log.error(error);
  reply.code(statusCode).send({
    error: expose ? message : "Internal server error",
    requestId: request.id,
    ...(error instanceof ZodError ? { details: error.flatten() } : {})
  });
});

app.addHook("onClose", async () => db.$disconnect());

try {
  await app.listen({ host: config.HOST, port: config.PORT });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
