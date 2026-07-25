-- CreateTable
CREATE TABLE "WarTarget" (
    "rankedWarId" INTEGER NOT NULL,
    "tornId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "level" INTEGER NOT NULL,
    "position" TEXT,
    "statusState" TEXT,
    "statusDescription" TEXT,
    "statusUntil" TIMESTAMP(3),
    "lastActionAt" TIMESTAMP(3),
    "isRevivable" BOOLEAN NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "syncedAt" TIMESTAMP(3) NOT NULL,
    "note" TEXT,
    "noteVersion" INTEGER NOT NULL DEFAULT 1,
    "noteUpdatedAt" TIMESTAMP(3),
    "noteUpdatedById" TEXT,

    CONSTRAINT "WarTarget_pkey" PRIMARY KEY ("rankedWarId","tornId")
);

-- CreateIndex
CREATE INDEX "WarTarget_rankedWarId_isActive_statusState_idx" ON "WarTarget"("rankedWarId", "isActive", "statusState");

-- AlterTable
ALTER TABLE "WarSyncState" ADD COLUMN "targetCount" INTEGER NOT NULL DEFAULT 0;

-- AddForeignKey
ALTER TABLE "WarTarget" ADD CONSTRAINT "WarTarget_rankedWarId_fkey" FOREIGN KEY ("rankedWarId") REFERENCES "RankedWar"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WarTarget" ADD CONSTRAINT "WarTarget_noteUpdatedById_fkey" FOREIGN KEY ("noteUpdatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
