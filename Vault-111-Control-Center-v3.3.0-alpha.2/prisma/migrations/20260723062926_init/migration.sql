-- CreateEnum
CREATE TYPE "AppRole" AS ENUM ('OWNER', 'ADMIN', 'OC_PLANNER', 'WAR_MANAGER', 'OFFICER', 'MEMBER');

-- CreateEnum
CREATE TYPE "AssignmentSource" AS ENUM ('OPTIMIZER', 'MANUAL', 'TORN');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "tornId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "factionId" INTEGER NOT NULL,
    "factionPosition" TEXT,
    "role" "AppRole" NOT NULL DEFAULT 'MEMBER',
    "isSuspended" BOOLEAN NOT NULL DEFAULT false,
    "encryptedApiKey" TEXT,
    "apiKeyFingerprint" TEXT,
    "apiKeyUpdatedAt" TIMESTAMP(3),
    "lastVerifiedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "refreshTokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "replacedById" TEXT,
    "userAgent" TEXT,
    "ipHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OcCrime" (
    "id" TEXT NOT NULL,
    "factionId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "tornPayload" JSONB NOT NULL,
    "syncedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OcCrime_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OcAssignment" (
    "id" TEXT NOT NULL,
    "crimeId" TEXT NOT NULL,
    "roleKey" TEXT NOT NULL,
    "assignedTornId" INTEGER,
    "assignedUserId" TEXT,
    "locked" BOOLEAN NOT NULL DEFAULT false,
    "source" "AssignmentSource" NOT NULL DEFAULT 'MANUAL',
    "expectedVersion" INTEGER NOT NULL,
    "changedByUserId" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OcAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoleMapping" (
    "id" TEXT NOT NULL,
    "factionId" INTEGER NOT NULL,
    "factionPosition" TEXT NOT NULL,
    "appRole" "AppRole" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RoleMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "actorUserId" TEXT,
    "action" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "resourceId" TEXT,
    "requestId" TEXT,
    "ipHash" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_tornId_key" ON "User"("tornId");

-- CreateIndex
CREATE INDEX "User_factionId_role_idx" ON "User"("factionId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "Session_refreshTokenHash_key" ON "Session"("refreshTokenHash");

-- CreateIndex
CREATE INDEX "Session_userId_expiresAt_idx" ON "Session"("userId", "expiresAt");

-- CreateIndex
CREATE INDEX "OcCrime_factionId_status_idx" ON "OcCrime"("factionId", "status");

-- CreateIndex
CREATE INDEX "OcAssignment_assignedTornId_idx" ON "OcAssignment"("assignedTornId");

-- CreateIndex
CREATE UNIQUE INDEX "OcAssignment_crimeId_roleKey_key" ON "OcAssignment"("crimeId", "roleKey");

-- CreateIndex
CREATE UNIQUE INDEX "RoleMapping_factionId_factionPosition_key" ON "RoleMapping"("factionId", "factionPosition");

-- CreateIndex
CREATE INDEX "AuditEvent_createdAt_idx" ON "AuditEvent"("createdAt");

-- CreateIndex
CREATE INDEX "AuditEvent_actorUserId_createdAt_idx" ON "AuditEvent"("actorUserId", "createdAt");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OcAssignment" ADD CONSTRAINT "OcAssignment_crimeId_fkey" FOREIGN KEY ("crimeId") REFERENCES "OcCrime"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OcAssignment" ADD CONSTRAINT "OcAssignment_assignedUserId_fkey" FOREIGN KEY ("assignedUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OcAssignment" ADD CONSTRAINT "OcAssignment_changedByUserId_fkey" FOREIGN KEY ("changedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
