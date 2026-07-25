import { config } from "./config.js";
import { z } from "zod";

export class TornApiError extends Error {
  public readonly expose = true;

  constructor(message: string, public readonly statusCode = 502) {
    super(message);
  }
}

async function tornGet<T>(path: string, apiKey: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${config.TORN_API_BASE_URL}${path}`, {
      headers: { Authorization: `ApiKey ${apiKey}`, Accept: "application/json" },
      signal: AbortSignal.timeout(10_000)
    });
  } catch {
    throw new TornApiError("Could not reach the Torn API", 502);
  }
  const body = await response.json().catch(() => null) as {
    error?: { code?: number; error?: string; message?: string };
  } | null;
  if (!response.ok || body?.error) {
    const code = Number(body?.error?.code || 0);
    const statusCode =
      response.status === 401 || [1, 2, 10, 13, 18].includes(code)
        ? 401
        : response.status === 403 || code === 16
          ? 403
        : code === 5
          ? 429
          : 502;
    const detail = body?.error?.error || body?.error?.message;
    throw new TornApiError(
      detail ? `Torn API: ${detail}` : "Torn API verification failed",
      statusCode
    );
  }
  return body as T;
}

const timestampSchema = z.number().int().nonnegative();
const nullableTimestampSchema = timestampSchema.nullable();

const factionMemberSchema = z.object({
  id: z.number().int().positive(),
  name: z.string().trim().min(1).max(100),
  position: z.string().trim().max(100),
  level: z.number().int().nonnegative(),
  days_in_faction: z.number().int().nonnegative(),
  is_in_oc: z.boolean(),
  last_action: z.object({
    timestamp: timestampSchema
  }).passthrough(),
  status: z.object({
    state: z.string().max(100)
  }).passthrough()
}).passthrough();

const factionMembersResponseSchema = z.object({
  members: z.array(factionMemberSchema).max(500)
}).passthrough();

const factionCrimeUserSchema = z.object({
  id: z.number().int().positive(),
  joined_at: timestampSchema,
  progress: z.number().finite()
}).passthrough();

const factionCrimeSlotSchema = z.object({
  position: z.string().trim().min(1).max(150),
  position_info: z.object({}).passthrough(),
  user: factionCrimeUserSchema.nullable(),
  checkpoint_pass_rate: z.number().finite().min(0).max(100)
}).passthrough();

const factionCrimeSchema = z.object({
  id: z.union([z.number().int().positive(), z.string().min(1).max(128)]),
  name: z.string().trim().min(1).max(200),
  difficulty: z.number().int().nonnegative(),
  status: z.string().trim().min(1).max(100),
  created_at: timestampSchema,
  planning_at: nullableTimestampSchema,
  ready_at: nullableTimestampSchema,
  expired_at: nullableTimestampSchema,
  executed_at: nullableTimestampSchema,
  slots: z.array(factionCrimeSlotSchema).min(1).max(50)
}).passthrough();

const factionCrimesResponseSchema = z.object({
  crimes: z.array(factionCrimeSchema).max(100)
}).passthrough();

const crimeStatNameSchema = z.string().regex(/^[a-z0-9_]{1,64}$/);
const crimeStatValueSchema = z.number().finite().nonnegative();
const crimeStatBucketSchema = z.record(crimeStatNameSchema, crimeStatValueSchema);
const personalCrimeStatsResponseSchema = z.object({
  personalstats: z.object({
    crimes: z.object({
      offenses: crimeStatBucketSchema,
      skills: crimeStatBucketSchema,
      total: crimeStatValueSchema,
      version: z.string().max(32).optional()
    }).passthrough()
  }).passthrough()
}).passthrough();

export type TornFactionMember = ReturnType<typeof parseFactionMembers>[number];
export type TornFactionCrime = ReturnType<typeof parseFactionCrimes>[number];

export function parseFactionMembers(value: unknown) {
  const { members } = factionMembersResponseSchema.parse(value);
  return members.map(member => ({
    id: member.id,
    name: member.name,
    position: member.position || null,
    level: member.level,
    daysInFaction: member.days_in_faction,
    isInOc: member.is_in_oc,
    status: member.status.state || null,
    lastActionAt: member.last_action.timestamp || null,
    payload: {
      status: member.status,
      last_action: member.last_action
    }
  }));
}

export function parseFactionCrimes(value: unknown) {
  const { crimes } = factionCrimesResponseSchema.parse(value);
  return crimes.map(crime => ({
    id: String(crime.id),
    name: crime.name,
    difficulty: crime.difficulty,
    status: crime.status,
    createdAt: crime.created_at,
    planningAt: crime.planning_at,
    readyAt: crime.ready_at,
    expiredAt: crime.expired_at,
    executedAt: crime.executed_at,
    payload: {
      id: String(crime.id),
      name: crime.name,
      difficulty: crime.difficulty,
      status: crime.status,
      created_at: crime.created_at,
      planning_at: crime.planning_at,
      ready_at: crime.ready_at,
      expired_at: crime.expired_at,
      executed_at: crime.executed_at,
      slots: crime.slots.map(slot => ({
        position: slot.position,
        position_info: slot.position_info,
        user: slot.user
          ? {
              id: slot.user.id,
              joined_at: slot.user.joined_at,
              progress: slot.user.progress
            }
          : null,
        // Empty-slot CPR belongs to the key owner and must not become a shared recommendation.
        checkpoint_pass_rate: slot.user ? slot.checkpoint_pass_rate : null
      }))
    }
  }));
}

function sumSelected(record: Record<string, number>, names: string[]) {
  return names.reduce((total, name) => total + Number(record[name] || 0), 0);
}

export function parsePersonalCrimeStats(value: unknown) {
  const crimes = personalCrimeStatsResponseSchema.parse(value).personalstats.crimes;
  if (Object.keys(crimes.offenses).length > 100 || Object.keys(crimes.skills).length > 100) {
    throw new TornApiError("Torn API returned too many personal crime-stat fields", 502);
  }

  const stats: Record<string, number> = {
    "crimes.total": crimes.total
  };
  for (const [name, amount] of Object.entries(crimes.offenses)) {
    stats[`crimes.offenses.${name}`] = amount;
  }
  for (const [name, amount] of Object.entries(crimes.skills)) {
    stats[`crimes.skills.${name}`] = amount;
  }

  const offenses = crimes.offenses;
  const skills = crimes.skills;
  const totals: Record<string, number> = {
    crimes: crimes.total,
    organizedCrimes: Number(offenses.organized_crimes || 0),
    theft:
      sumSelected(offenses, ["theft"]) +
      sumSelected(skills, ["search_for_cash", "shoplifting", "pickpocketing", "burglary"]),
    fraud:
      sumSelected(offenses, ["fraud", "counterfeiting"]) +
      sumSelected(skills, ["card_skimming", "forgery", "scamming"]),
    hacking:
      sumSelected(offenses, ["cybercrime"]) +
      sumSelected(skills, ["cracking"]),
    violence:
      sumSelected(offenses, ["vandalism", "extortion"]) +
      sumSelected(skills, ["graffiti", "disposal", "arson"]),
    drugs: sumSelected(offenses, ["illicit_services", "illegal_production"]),
    racing: 0,
    busts: 0,
    jail: 0
  };

  return { stats, totals };
}

export async function fetchFactionPlanningData(apiKey: string) {
  const [membersResponse, crimesResponse] = await Promise.all([
    tornGet<unknown>("/faction/members", apiKey),
    tornGet<unknown>("/faction/crimes?cat=available&limit=100", apiKey)
  ]);
  try {
    return {
      members: parseFactionMembers(membersResponse),
      crimes: parseFactionCrimes(crimesResponse)
    };
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new TornApiError("Torn API returned an unsupported faction-data format", 502);
    }
    throw error;
  }
}

export async function fetchPersonalCrimeStats(apiKey: string) {
  const response = await tornGet<unknown>("/user/personalstats?cat=crimes", apiKey);
  try {
    return parsePersonalCrimeStats(response);
  } catch (error) {
    if (error instanceof TornApiError) throw error;
    if (error instanceof z.ZodError) {
      throw new TornApiError("Torn API returned an unsupported personal crime-stat format", 502);
    }
    throw error;
  }
}

type UserIdentity = {
  id?: number;
  player_id?: number;
  name?: string;
};
type BasicResponse = UserIdentity & {
  profile?: UserIdentity;
  user?: UserIdentity;
};
type FactionIdentity = {
  id?: number;
  faction_id?: number;
  name?: string;
  faction_name?: string;
  position?: string;
};
type FactionResponse = {
  faction?: FactionIdentity;
  profile?: {
    faction?: FactionIdentity;
  };
};

export function parseTornIdentity(
  basic: BasicResponse,
  factionResponse: FactionResponse
) {
  const user = basic.profile ?? basic.user ?? basic;
  const faction = factionResponse.faction ?? factionResponse.profile?.faction;
  const tornId = Number(user.id ?? user.player_id ?? 0);
  const name = user.name?.trim();
  const factionId = Number(faction?.id ?? faction?.faction_id ?? 0);
  if (!tornId || !name || !factionId) {
    throw new TornApiError("Torn identity or faction could not be verified", 422);
  }
  return {
    tornId,
    name,
    factionId,
    factionPosition: faction?.position?.trim() || null
  };
}

export async function verifyTornIdentity(apiKey: string) {
  const [basic, faction] = await Promise.all([
    tornGet<BasicResponse>("/user/basic", apiKey),
    tornGet<FactionResponse>("/user/faction", apiKey)
  ]);
  return parseTornIdentity(basic, faction);
}
