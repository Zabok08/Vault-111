import {
  ScheduleEventType,
  type ScheduleEvent
} from "@prisma/client";
import type { Principal } from "./auth.js";
import { hasPermission } from "./auth.js";
import { db } from "./db.js";

export const scheduleEventTypes = Object.values(ScheduleEventType);
const WAR_EVENT_TYPES = new Set<ScheduleEventType>([
  ScheduleEventType.CHAIN,
  ScheduleEventType.RANKED_WAR
]);
const RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
const RECENT_WINDOW_MS = 24 * 60 * 60 * 1000;
const MAX_FUTURE_MS = 365 * 24 * 60 * 60 * 1000;

function httpError(message: string, statusCode: number) {
  return Object.assign(new Error(message), {
    statusCode,
    expose: true
  });
}

export function allowedScheduleEventTypes(principal: Principal) {
  if (hasPermission(principal, "schedule.manage")) {
    return [...scheduleEventTypes];
  }
  const allowed: ScheduleEventType[] = [];
  if (hasPermission(principal, "schedule.manage_war")) {
    allowed.push(ScheduleEventType.CHAIN, ScheduleEventType.RANKED_WAR);
  }
  if (hasPermission(principal, "schedule.manage_oc")) {
    allowed.push(ScheduleEventType.OC);
  }
  return allowed;
}

function requireScheduleType(
  principal: Principal,
  type: ScheduleEventType
) {
  if (!allowedScheduleEventTypes(principal).includes(type)) {
    throw httpError("Forbidden", 403);
  }
}

function validateEventTimes(startsAt: Date, endsAt: Date | null) {
  const now = Date.now();
  if (startsAt.getTime() < now - 5 * 60 * 1000) {
    throw httpError("Scheduled events must start in the future", 400);
  }
  if (startsAt.getTime() > now + MAX_FUTURE_MS) {
    throw httpError("Scheduled events cannot be more than one year away", 400);
  }
  if (endsAt && endsAt <= startsAt) {
    throw httpError("Event end time must be after its start time", 400);
  }
}

function serializeManualEvent(
  event: ScheduleEvent & {
    createdBy: { tornId: number; name: string };
    updatedBy: { tornId: number; name: string };
  },
  editableTypes: ScheduleEventType[]
) {
  return {
    id: event.id,
    source: "manual" as const,
    type: event.type,
    title: event.title,
    description: event.description,
    startsAt: event.startsAt,
    endsAt: event.endsAt,
    version: event.version,
    createdAt: event.createdAt,
    updatedAt: event.updatedAt,
    createdBy: event.createdBy,
    updatedBy: event.updatedBy,
    editable: editableTypes.includes(event.type)
  };
}

export function normalizeReminderMinutes(values: number[]) {
  const normalized = [...new Set(values)]
    .filter(value => Number.isInteger(value) && value >= 0 && value <= 10_080)
    .sort((a, b) => b - a);
  if (!normalized.length || normalized.length > 5) {
    throw httpError("Choose between one and five valid reminder times", 400);
  }
  return normalized;
}

export async function readScheduleSnapshot(principal: Principal) {
  const now = new Date();
  const recent = new Date(now.getTime() - RECENT_WINDOW_MS);
  const cleanupBefore = new Date(now.getTime() - RETENTION_MS);
  const ocHorizon = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  const editableTypes = allowedScheduleEventTypes(principal);

  await db.scheduleEvent.deleteMany({
    where: {
      factionId: principal.factionId,
      startsAt: { lt: cleanupBefore },
      OR: [
        { endsAt: null },
        { endsAt: { lt: cleanupBefore } }
      ]
    }
  });

  const [manualEvents, war, crimes, preference] = await Promise.all([
    db.scheduleEvent.findMany({
      where: {
        factionId: principal.factionId,
        OR: [
          { endsAt: { gte: recent } },
          { endsAt: null, startsAt: { gte: recent } }
        ]
      },
      orderBy: { startsAt: "asc" },
      take: 100,
      include: {
        createdBy: { select: { tornId: true, name: true } },
        updatedBy: { select: { tornId: true, name: true } }
      }
    }),
    db.rankedWar.findFirst({
      where: {
        factionId: principal.factionId,
        startsAt: { gte: recent }
      },
      orderBy: { startsAt: "desc" },
      select: {
        id: true,
        opponentName: true,
        startsAt: true,
        endsAt: true,
        status: true
      }
    }),
    db.ocCrime.findMany({
      where: {
        factionId: principal.factionId,
        isActive: true,
        readyAt: {
          gte: now,
          lte: ocHorizon
        }
      },
      orderBy: { readyAt: "asc" },
      take: 50,
      select: {
        id: true,
        name: true,
        readyAt: true,
        status: true
      }
    }),
    db.notificationPreference.findUnique({
      where: { userId: principal.id }
    })
  ]);

  const automaticEvents = [
    ...(war && war.startsAt.getTime() >= now.getTime()
      ? [{
          id: `war:${war.id}:start`,
          source: "automatic" as const,
          type: ScheduleEventType.RANKED_WAR,
          title: `Ranked War vs ${war.opponentName}`,
          description: `Automatically synchronized ranked-war start (${war.status}).`,
          startsAt: war.startsAt,
          endsAt: war.endsAt,
          version: null,
          createdAt: null,
          updatedAt: null,
          createdBy: null,
          updatedBy: null,
          editable: false
        }]
      : []),
    ...crimes.map(crime => ({
      id: `oc:${crime.id}:ready`,
      source: "automatic" as const,
      type: ScheduleEventType.OC,
      title: `${crime.name} ready`,
      description: `Automatically synchronized ${crime.status} crime ready time.`,
      startsAt: crime.readyAt!,
      endsAt: null,
      version: null,
      createdAt: null,
      updatedAt: null,
      createdBy: null,
      updatedBy: null,
      editable: false
    }))
  ];

  const events = [
    ...manualEvents.map(event => serializeManualEvent(event, editableTypes)),
    ...automaticEvents
  ]
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())
    .slice(0, 100);

  return {
    serverTime: now,
    permissions: {
      allowedEventTypes: editableTypes
    },
    preferences: preference
      ? {
          enabled: preference.enabled,
          browserNotifications: preference.browserNotifications,
          eventTypes: preference.eventTypes,
          reminderMinutes: preference.reminderMinutes
        }
      : {
          enabled: true,
          browserNotifications: false,
          eventTypes: [...scheduleEventTypes],
          reminderMinutes: [60, 15]
        },
    retentionDays: 90,
    events
  };
}

export async function createScheduleEvent(input: {
  principal: Principal;
  type: ScheduleEventType;
  title: string;
  description: string | null;
  startsAt: Date;
  endsAt: Date | null;
}) {
  requireScheduleType(input.principal, input.type);
  validateEventTimes(input.startsAt, input.endsAt);
  return db.scheduleEvent.create({
    data: {
      factionId: input.principal.factionId,
      type: input.type,
      title: input.title,
      description: input.description,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      createdByUserId: input.principal.id,
      updatedByUserId: input.principal.id
    }
  });
}

async function readEditableEvent(
  principal: Principal,
  id: string
) {
  const event = await db.scheduleEvent.findFirst({
    where: {
      id,
      factionId: principal.factionId
    }
  });
  if (!event) throw httpError("Scheduled event not found", 404);
  requireScheduleType(principal, event.type);
  return event;
}

export async function updateScheduleEvent(input: {
  principal: Principal;
  id: string;
  type: ScheduleEventType;
  title: string;
  description: string | null;
  startsAt: Date;
  endsAt: Date | null;
  expectedVersion: number;
}) {
  await readEditableEvent(input.principal, input.id);
  requireScheduleType(input.principal, input.type);
  validateEventTimes(input.startsAt, input.endsAt);
  const updated = await db.scheduleEvent.updateMany({
    where: {
      id: input.id,
      factionId: input.principal.factionId,
      version: input.expectedVersion
    },
    data: {
      type: input.type,
      title: input.title,
      description: input.description,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      updatedByUserId: input.principal.id,
      version: { increment: 1 }
    }
  });
  if (!updated.count) {
    throw httpError("Scheduled event changed; refresh before editing", 409);
  }
  return db.scheduleEvent.findUniqueOrThrow({
    where: { id: input.id }
  });
}

export async function deleteScheduleEvent(input: {
  principal: Principal;
  id: string;
  expectedVersion: number;
}) {
  await readEditableEvent(input.principal, input.id);
  const deleted = await db.scheduleEvent.deleteMany({
    where: {
      id: input.id,
      factionId: input.principal.factionId,
      version: input.expectedVersion
    }
  });
  if (!deleted.count) {
    throw httpError("Scheduled event changed; refresh before deleting", 409);
  }
}

export async function saveNotificationPreferences(input: {
  principal: Principal;
  enabled: boolean;
  browserNotifications: boolean;
  eventTypes: ScheduleEventType[];
  reminderMinutes: number[];
}) {
  const eventTypes = [...new Set(input.eventTypes)];
  if (!eventTypes.length || eventTypes.some(type => !scheduleEventTypes.includes(type))) {
    throw httpError("Choose at least one valid event type", 400);
  }
  const reminderMinutes = normalizeReminderMinutes(input.reminderMinutes);
  return db.notificationPreference.upsert({
    where: { userId: input.principal.id },
    create: {
      userId: input.principal.id,
      enabled: input.enabled,
      browserNotifications: input.browserNotifications,
      eventTypes,
      reminderMinutes
    },
    update: {
      enabled: input.enabled,
      browserNotifications: input.browserNotifications,
      eventTypes,
      reminderMinutes
    }
  });
}
