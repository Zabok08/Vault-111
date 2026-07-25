-- CreateTable
CREATE TABLE "MemberCrimeStats" (
    "factionId" INTEGER NOT NULL,
    "tornId" INTEGER NOT NULL,
    "stats" JSONB NOT NULL,
    "totals" JSONB NOT NULL,
    "syncedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MemberCrimeStats_pkey" PRIMARY KEY ("factionId","tornId")
);

-- CreateIndex
CREATE INDEX "MemberCrimeStats_factionId_syncedAt_idx"
ON "MemberCrimeStats"("factionId", "syncedAt");
