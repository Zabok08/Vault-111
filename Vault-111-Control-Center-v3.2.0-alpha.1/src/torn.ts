import { config } from "./config.js";
import { z } from "zod";

export class TornApiError extends Error {
  public readonly expose = true;

  constructor(message: string, public readonly statusCode = 502) {
    super(message);
  }
}

async function tornGet<T>(path: string, apiKey: string): Promise<T> {
  const baseUrl = config.TORN_API_BASE_URL.replace(/\/+$/, "");
  let url = `${baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
  if (/^https?:\/\//i.test(path)) {
    const candidate = new URL(path);
    const base = new URL(baseUrl);
    const basePath = base.pathname.replace(/\/+$/, "");
    if (
      candidate.origin !== base.origin ||
      !candidate.pathname.startsWith(`${basePath}/faction/attacks`)
    ) {
      throw new TornApiError("Torn API returned an unsafe pagination link", 502);
    }
    url = candidate.toString();
  }
  let response: Response;
  try {
    response = await fetch(url, {
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

const warTargetMemberSchema = factionMemberSchema.extend({
  is_revivable: z.boolean(),
  status: z.object({
    state: z.string().max(100),
    description: z.string().max(500),
    until: nullableTimestampSchema
  }).passthrough()
});

const warTargetMembersResponseSchema = z.object({
  members: z.array(warTargetMemberSchema).max(500)
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

const rankedWarFactionSchema = z.object({
  id: z.number().int().positive(),
  name: z.string().trim().min(1).max(100),
  score: z.number().int().nonnegative(),
  chain: z.number().int().nonnegative()
}).passthrough();

const rankedWarBaseSchema = z.object({
  start: timestampSchema,
  end: nullableTimestampSchema,
  target: z.number().int().positive(),
  winner: z.number().int().positive().nullable(),
  factions: z.array(rankedWarFactionSchema).length(2)
}).passthrough();

const currentRankedWarSchema = rankedWarBaseSchema.extend({
  war_id: z.number().int().positive()
});

const historicalRankedWarSchema = rankedWarBaseSchema.extend({
  id: z.number().int().positive()
});

const factionWarsResponseSchema = z.object({
  wars: z.object({
    ranked: currentRankedWarSchema.nullable()
  }).passthrough()
}).passthrough();

const factionRankedWarsResponseSchema = z.object({
  rankedwars: z.array(historicalRankedWarSchema).max(100)
}).passthrough();

const attackFactionSchema = z.object({
  id: z.number().int().positive(),
  name: z.string().trim().min(1).max(100)
}).passthrough();

const attackPlayerSchema = z.object({
  id: z.number().int().positive(),
  name: z.string().trim().min(1).max(100),
  faction: attackFactionSchema.nullable()
}).passthrough();

const factionAttackSchema = z.object({
  id: z.union([z.number().int().positive(), z.string().min(1).max(128)]),
  started: timestampSchema,
  ended: timestampSchema,
  attacker: attackPlayerSchema.nullable(),
  defender: attackPlayerSchema,
  result: z.string().trim().min(1).max(50),
  respect_gain: z.number().finite(),
  respect_loss: z.number().finite(),
  chain: z.number().int().nonnegative().nullable(),
  is_interrupted: z.boolean(),
  is_ranked_war: z.boolean()
}).passthrough();

const factionAttacksResponseSchema = z.object({
  attacks: z.array(factionAttackSchema).max(1000),
  _metadata: z.object({
    links: z.object({
      next: z.string().url().nullable()
    }).passthrough()
  }).passthrough().optional()
}).passthrough();

export type TornFactionMember = ReturnType<typeof parseFactionMembers>[number];
export type TornFactionCrime = ReturnType<typeof parseFactionCrimes>[number];
export type TornRankedWar = NonNullable<ReturnType<typeof parseFactionRankedWar>>;
export type TornWarAttack = ReturnType<typeof parseFactionAttacks>[number];
export type TornWarTarget = ReturnType<typeof parseFactionWarTargets>[number];

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

export function parseFactionWarTargets(value: unknown) {
  const { members } = warTargetMembersResponseSchema.parse(value);
  return members.map(member => ({
    id: member.id,
    name: member.name,
    level: member.level,
    position: member.position || null,
    statusState: member.status.state || null,
    statusDescription: member.status.description || null,
    statusUntil: member.status.until,
    lastActionAt: member.last_action.timestamp || null,
    isRevivable: member.is_revivable
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

export function parseFactionRankedWar(
  currentValue: unknown,
  historyValue: unknown,
  factionId: number,
  nowEpochSeconds = Math.floor(Date.now() / 1000)
) {
  const current = factionWarsResponseSchema.parse(currentValue).wars.ranked;
  const history = factionRankedWarsResponseSchema.parse(historyValue).rankedwars;
  const selected = current
    ? { ...current, id: current.war_id }
    : history
        .slice()
        .sort((a, b) => b.start - a.start)
        .map(war => ({ ...war, id: war.id }))[0];
  if (!selected) return null;

  const faction = selected.factions.find(candidate => candidate.id === factionId);
  const opponent = selected.factions.find(candidate => candidate.id !== factionId);
  if (!faction || !opponent) {
    throw new TornApiError("Torn API returned a ranked war for an unexpected faction", 502);
  }

  const status =
    selected.end !== null && selected.end <= nowEpochSeconds
      ? "finished"
      : selected.start > nowEpochSeconds
        ? "scheduled"
        : "active";
  return {
    id: selected.id,
    factionId: faction.id,
    factionName: faction.name,
    opponentFactionId: opponent.id,
    opponentName: opponent.name,
    startsAt: selected.start,
    endsAt: selected.end,
    targetScore: selected.target,
    factionScore: faction.score,
    opponentScore: opponent.score,
    factionChain: faction.chain,
    opponentChain: opponent.chain,
    winnerFactionId: selected.winner,
    status
  };
}

function normalizeFactionAttacks(
  parsed: z.infer<typeof factionAttacksResponseSchema>,
  factionId: number,
  opponentFactionId: number,
  startsAt: number,
  endsAt: number | null
) {
  return parsed.attacks
    .filter(attack =>
      attack.attacker?.faction?.id === factionId &&
      attack.ended >= startsAt &&
      (endsAt === null || attack.started <= endsAt)
    )
    .map(attack => ({
      id: String(attack.id),
      startedAt: attack.started,
      endedAt: attack.ended,
      attackerTornId: attack.attacker?.id ?? null,
      attackerName: attack.attacker?.name ?? null,
      attackerFactionId: attack.attacker?.faction?.id ?? null,
      defenderTornId: attack.defender.id,
      defenderName: attack.defender.name,
      defenderFactionId: attack.defender.faction?.id ?? null,
      result: attack.result,
      respectGain: Math.max(0, attack.respect_gain),
      respectLoss: Math.max(0, attack.respect_loss),
      chain: attack.chain,
      isInterrupted: attack.is_interrupted,
      isRankedWar: attack.is_ranked_war && attack.defender.faction?.id === opponentFactionId
    }));
}

export function parseFactionAttacks(
  value: unknown,
  factionId: number,
  opponentFactionId: number,
  startsAt: number,
  endsAt: number | null
) {
  return normalizeFactionAttacks(
    factionAttacksResponseSchema.parse(value),
    factionId,
    opponentFactionId,
    startsAt,
    endsAt
  );
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

export async function fetchFactionWarData(apiKey: string, factionId: number) {
  try {
    const [currentResponse, historyResponse] = await Promise.all([
      tornGet<unknown>("/faction/wars", apiKey),
      tornGet<unknown>("/faction/rankedwars?limit=1&sort=DESC", apiKey)
    ]);
    const war = parseFactionRankedWar(currentResponse, historyResponse, factionId);
    if (!war) {
      return {
        war: null,
        attacks: [],
        targets: [],
        targetsLoaded: false,
        truncated: false
      };
    }

    const now = Math.floor(Date.now() / 1000);
    let targets: TornWarTarget[] = [];
    let targetsLoaded = false;
    if (war.status !== "finished") {
      const targetResponse = await tornGet<unknown>(
        `/faction/${war.opponentFactionId}/members`,
        apiKey
      );
      targets = parseFactionWarTargets(targetResponse);
      targetsLoaded = true;
    }
    if (war.startsAt > now) {
      return { war, attacks: [], targets, targetsLoaded, truncated: false };
    }

    const query = new URLSearchParams({
      filters: "outgoing",
      from: String(war.startsAt),
      to: String(Math.min(war.endsAt ?? now, now)),
      limit: "100",
      sort: "ASC"
    });
    let next: string | null = `/faction/attacks?${query.toString()}`;
    const seen = new Set<string>();
    const attacks: TornWarAttack[] = [];
    const maxPages = 20;
    let pages = 0;

    while (next && pages < maxPages && !seen.has(next)) {
      seen.add(next);
      const response = await tornGet<unknown>(next, apiKey);
      const parsed = factionAttacksResponseSchema.parse(response);
      attacks.push(
        ...normalizeFactionAttacks(
          parsed,
          factionId,
          war.opponentFactionId,
          war.startsAt,
          war.endsAt
        )
      );
      next = parsed._metadata?.links.next ?? null;
      pages += 1;
    }

    const uniqueAttacks = Array.from(
      new Map(attacks.map(attack => [attack.id, attack])).values()
    );
    return {
      war,
      attacks: uniqueAttacks,
      targets,
      targetsLoaded,
      truncated: Boolean(next)
    };
  } catch (error) {
    if (error instanceof TornApiError) throw error;
    if (error instanceof z.ZodError) {
      throw new TornApiError("Torn API returned an unsupported ranked-war format", 502);
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
