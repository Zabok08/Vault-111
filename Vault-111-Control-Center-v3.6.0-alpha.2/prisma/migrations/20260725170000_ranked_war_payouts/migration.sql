-- CreateEnum
CREATE TYPE "WarPayoutStatus" AS ENUM ('DRAFT', 'FINALIZED');

-- Existing WarAttack rows were collected by the previous ranked-war-only
-- ingestion, so preserve their classification while adding the new field.
ALTER TABLE "WarAttack" ADD COLUMN "isRankedWar" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "WarAttack" ALTER COLUMN "isRankedWar" SET DEFAULT false;

-- CreateTable
CREATE TABLE "WarPayoutPlan" (
    "id" TEXT NOT NULL,
    "rankedWarId" INTEGER NOT NULL,
    "factionId" INTEGER NOT NULL,
    "poolAmount" BIGINT NOT NULL DEFAULT 0,
    "status" "WarPayoutStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedByUserId" TEXT NOT NULL,
    "finalizedAt" TIMESTAMP(3),
    "finalizedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WarPayoutPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WarPayoutAdjustment" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "tornId" INTEGER NOT NULL,
    "amount" BIGINT NOT NULL DEFAULT 0,
    "note" TEXT,
    "updatedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WarPayoutAdjustment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WarPayoutEntry" (
    "planId" TEXT NOT NULL,
    "tornId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "position" TEXT,
    "warHits" INTEGER NOT NULL,
    "chainHits" INTEGER NOT NULL,
    "outsideChainHits" INTEGER NOT NULL,
    "points" DOUBLE PRECISION NOT NULL,
    "share" DOUBLE PRECISION NOT NULL,
    "baseAmount" BIGINT NOT NULL,
    "adjustmentAmount" BIGINT NOT NULL,
    "finalAmount" BIGINT NOT NULL,
    "adjustmentNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WarPayoutEntry_pkey" PRIMARY KEY ("planId","tornId")
);

-- CreateIndex
CREATE UNIQUE INDEX "WarPayoutPlan_rankedWarId_key" ON "WarPayoutPlan"("rankedWarId");

-- CreateIndex
CREATE INDEX "WarPayoutPlan_factionId_status_idx" ON "WarPayoutPlan"("factionId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "WarPayoutAdjustment_planId_tornId_key" ON "WarPayoutAdjustment"("planId", "tornId");

-- CreateIndex
CREATE INDEX "WarPayoutAdjustment_tornId_idx" ON "WarPayoutAdjustment"("tornId");

-- CreateIndex
CREATE INDEX "WarPayoutEntry_planId_finalAmount_idx" ON "WarPayoutEntry"("planId", "finalAmount");

-- AddForeignKey
ALTER TABLE "WarPayoutPlan" ADD CONSTRAINT "WarPayoutPlan_rankedWarId_fkey" FOREIGN KEY ("rankedWarId") REFERENCES "RankedWar"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WarPayoutPlan" ADD CONSTRAINT "WarPayoutPlan_updatedByUserId_fkey" FOREIGN KEY ("updatedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WarPayoutPlan" ADD CONSTRAINT "WarPayoutPlan_finalizedByUserId_fkey" FOREIGN KEY ("finalizedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WarPayoutAdjustment" ADD CONSTRAINT "WarPayoutAdjustment_planId_fkey" FOREIGN KEY ("planId") REFERENCES "WarPayoutPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WarPayoutAdjustment" ADD CONSTRAINT "WarPayoutAdjustment_updatedByUserId_fkey" FOREIGN KEY ("updatedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WarPayoutEntry" ADD CONSTRAINT "WarPayoutEntry_planId_fkey" FOREIGN KEY ("planId") REFERENCES "WarPayoutPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
