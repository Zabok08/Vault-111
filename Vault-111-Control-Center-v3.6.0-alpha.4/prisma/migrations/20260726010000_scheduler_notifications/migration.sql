CREATE TYPE "ScheduleEventType" AS ENUM (
    'CHAIN',
    'RANKED_WAR',
    'OC',
    'FACTION',
    'MEETING',
    'OTHER'
);

CREATE TABLE "ScheduleEvent" (
    "id" TEXT NOT NULL,
    "factionId" INTEGER NOT NULL,
    "type" "ScheduleEventType" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdByUserId" TEXT NOT NULL,
    "updatedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScheduleEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "NotificationPreference" (
    "userId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "browserNotifications" BOOLEAN NOT NULL DEFAULT false,
    "eventTypes" "ScheduleEventType"[] NOT NULL DEFAULT ARRAY[
        'CHAIN'::"ScheduleEventType",
        'RANKED_WAR'::"ScheduleEventType",
        'OC'::"ScheduleEventType",
        'FACTION'::"ScheduleEventType",
        'MEETING'::"ScheduleEventType",
        'OTHER'::"ScheduleEventType"
    ],
    "reminderMinutes" INTEGER[] NOT NULL DEFAULT ARRAY[60, 15],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationPreference_pkey" PRIMARY KEY ("userId")
);

CREATE INDEX "ScheduleEvent_factionId_startsAt_idx"
ON "ScheduleEvent"("factionId", "startsAt");

CREATE INDEX "ScheduleEvent_factionId_type_startsAt_idx"
ON "ScheduleEvent"("factionId", "type", "startsAt");

ALTER TABLE "ScheduleEvent"
ADD CONSTRAINT "ScheduleEvent_createdByUserId_fkey"
FOREIGN KEY ("createdByUserId") REFERENCES "User"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ScheduleEvent"
ADD CONSTRAINT "ScheduleEvent_updatedByUserId_fkey"
FOREIGN KEY ("updatedByUserId") REFERENCES "User"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "NotificationPreference"
ADD CONSTRAINT "NotificationPreference_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
