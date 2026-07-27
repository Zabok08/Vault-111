-- CreateTable
CREATE TABLE "RankedWar" (
    "id" INTEGER NOT NULL,
    "factionId" INTEGER NOT NULL,
    "factionName" TEXT NOT NULL,
    "opponentFactionId" INTEGER NOT NULL,
    "opponentName" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3),
    "targetScore" INTEGER NOT NULL,
    "factionScore" INTEGER NOT NULL,
    "opponentScore" INTEGER NOT NULL,
    "factionChain" INTEGER NOT NULL,
    "opponentChain" INTEGER NOT NULL,
    "winnerFactionId" INTEGER,
    "status" TEXT NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "syncedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RankedWar_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WarAttack" (
    "id" TEXT NOT NULL,
    "rankedWarId" INTEGER NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3) NOT NULL,
    "attackerTornId" INTEGER,
    "attackerName" TEXT,
    "attackerFactionId" INTEGER,
    "defenderTornId" INTEGER NOT NULL,
    "defenderName" TEXT NOT NULL,
    "defenderFactionId" INTEGER,
    "result" TEXT NOT NULL,
    "respectGain" DOUBLE PRECISION NOT NULL,
    "respectLoss" DOUBLE PRECISION NOT NULL,
    "chain" INTEGER,
    "isInterrupted" BOOLEAN NOT NULL,
    "syncedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WarAttack_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WarSyncState" (
    "factionId" INTEGER NOT NULL,
    "lastAttemptAt" TIMESTAMP(3),
    "lastSuccessAt" TIMESTAMP(3),
    "inProgressAt" TIMESTAMP(3),
    "syncedByTornId" INTEGER,
    "rankedWarId" INTEGER,
    "attackCount" INTEGER NOT NULL DEFAULT 0,
    "isTruncated" BOOLEAN NOT NULL DEFAULT false,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WarSyncState_pkey" PRIMARY KEY ("factionId")
);

-- CreateIndex
CREATE INDEX "RankedWar_factionId_status_startsAt_idx" ON "RankedWar"("factionId", "status", "startsAt");

-- CreateIndex
CREATE INDEX "WarAttack_rankedWarId_endedAt_idx" ON "WarAttack"("rankedWarId", "endedAt");

-- CreateIndex
CREATE INDEX "WarAttack_rankedWarId_attackerTornId_idx" ON "WarAttack"("rankedWarId", "attackerTornId");

-- AddForeignKey
ALTER TABLE "WarAttack" ADD CONSTRAINT "WarAttack_rankedWarId_fkey" FOREIGN KEY ("rankedWarId") REFERENCES "RankedWar"("id") ON DELETE CASCADE ON UPDATE CASCADE;
