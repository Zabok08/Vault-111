-- Member analytics are opt-in and are kept separate from public faction-member data.
ALTER TABLE "User"
ADD COLUMN "analyticsConsentAt" TIMESTAMP(3);

CREATE TABLE "MemberAnalytics" (
    "factionId" INTEGER NOT NULL,
    "tornId" INTEGER NOT NULL,
    "strength" DECIMAL(30,0),
    "defense" DECIMAL(30,0),
    "speed" DECIMAL(30,0),
    "dexterity" DECIMAL(30,0),
    "battleTotal" DECIMAL(30,0),
    "cannabis" INTEGER,
    "ecstasy" INTEGER,
    "ketamine" INTEGER,
    "lsd" INTEGER,
    "opium" INTEGER,
    "pcp" INTEGER,
    "shrooms" INTEGER,
    "speedDrug" INTEGER,
    "vicodin" INTEGER,
    "xanax" INTEGER,
    "drugTotal" INTEGER,
    "overdoses" INTEGER,
    "rehabilitationCount" INTEGER,
    "rehabilitationFees" BIGINT,
    "drugCooldownSeconds" INTEGER,
    "battleSyncedAt" TIMESTAMP(3),
    "drugsSyncedAt" TIMESTAMP(3),
    "cooldownSyncedAt" TIMESTAMP(3),
    "previousBattleTotal" DECIMAL(30,0),
    "previousDrugTotal" INTEGER,
    "previousXanax" INTEGER,
    "previousSyncedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MemberAnalytics_pkey" PRIMARY KEY ("factionId","tornId")
);

CREATE TABLE "MemberAnalyticsSnapshot" (
    "id" TEXT NOT NULL,
    "factionId" INTEGER NOT NULL,
    "tornId" INTEGER NOT NULL,
    "bucketAt" TIMESTAMP(3) NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL,
    "strength" DECIMAL(30,0),
    "defense" DECIMAL(30,0),
    "speed" DECIMAL(30,0),
    "dexterity" DECIMAL(30,0),
    "battleTotal" DECIMAL(30,0),
    "cannabis" INTEGER,
    "ecstasy" INTEGER,
    "ketamine" INTEGER,
    "lsd" INTEGER,
    "opium" INTEGER,
    "pcp" INTEGER,
    "shrooms" INTEGER,
    "speedDrug" INTEGER,
    "vicodin" INTEGER,
    "xanax" INTEGER,
    "drugTotal" INTEGER,
    "overdoses" INTEGER,
    "rehabilitationCount" INTEGER,
    "rehabilitationFees" BIGINT,
    "drugCooldownSeconds" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MemberAnalyticsSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MemberAnalytics_factionId_syncedAt_idx"
ON "MemberAnalytics"("factionId", "syncedAt");

CREATE INDEX "MemberAnalyticsSnapshot_factionId_tornId_capturedAt_idx"
ON "MemberAnalyticsSnapshot"("factionId", "tornId", "capturedAt");

CREATE UNIQUE INDEX "MemberAnalyticsSnapshot_factionId_tornId_bucketAt_key"
ON "MemberAnalyticsSnapshot"("factionId", "tornId", "bucketAt");
