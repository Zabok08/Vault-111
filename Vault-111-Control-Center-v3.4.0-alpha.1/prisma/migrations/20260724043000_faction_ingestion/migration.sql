-- AlterTable
ALTER TABLE "OcCrime"
ADD COLUMN "difficulty" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "createdAtTorn" TIMESTAMP(3),
ADD COLUMN "planningAt" TIMESTAMP(3),
ADD COLUMN "readyAt" TIMESTAMP(3),
ADD COLUMN "expiredAt" TIMESTAMP(3),
ADD COLUMN "executedAt" TIMESTAMP(3),
ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Replace the old status-only lookup with the active shared-planner lookup.
DROP INDEX IF EXISTS "OcCrime_factionId_status_idx";
CREATE INDEX "OcCrime_factionId_isActive_status_idx" ON "OcCrime"("factionId", "isActive", "status");

-- CreateTable
CREATE TABLE "FactionMember" (
    "factionId" INTEGER NOT NULL,
    "tornId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "position" TEXT,
    "level" INTEGER NOT NULL,
    "daysInFaction" INTEGER NOT NULL,
    "isInOc" BOOLEAN NOT NULL,
    "status" TEXT,
    "lastActionAt" TIMESTAMP(3),
    "tornPayload" JSONB NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FactionMember_pkey" PRIMARY KEY ("factionId","tornId")
);

-- CreateTable
CREATE TABLE "FactionSyncState" (
    "factionId" INTEGER NOT NULL,
    "lastAttemptAt" TIMESTAMP(3),
    "lastSuccessAt" TIMESTAMP(3),
    "inProgressAt" TIMESTAMP(3),
    "syncedByTornId" INTEGER,
    "memberCount" INTEGER NOT NULL DEFAULT 0,
    "crimeCount" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FactionSyncState_pkey" PRIMARY KEY ("factionId")
);

-- CreateIndex
CREATE INDEX "FactionMember_factionId_isActive_isInOc_idx"
ON "FactionMember"("factionId", "isActive", "isInOc");
