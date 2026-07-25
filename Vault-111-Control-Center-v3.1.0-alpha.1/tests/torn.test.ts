import { beforeAll, describe, expect, it } from "vitest";

beforeAll(() => {
  process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
  process.env.PUBLIC_BASE_URL = "http://127.0.0.1:3000";
  process.env.VAULT111_FACTION_ID = "123";
  process.env.JWT_ISSUER = "test";
  process.env.JWT_AUDIENCE = "test";
  process.env.JWT_SECRET = "12345678901234567890123456789012";
  process.env.KEY_ENCRYPTION_ACTIVE_VERSION = "v1";
  process.env.KEY_ENCRYPTION_KEYS_JSON = JSON.stringify({
    v1: Buffer.alloc(32, 7).toString("base64")
  });
});

describe("Torn identity parsing", () => {
  it("parses the current v2 basic and faction selections", async () => {
    const { parseTornIdentity } = await import("../src/torn.js");

    expect(
      parseTornIdentity(
        { profile: { id: 42, name: " Vault Dweller " } },
        { faction: { id: 111, name: "Vault 111", position: "Leader" } }
      )
    ).toEqual({
      tornId: 42,
      name: "Vault Dweller",
      factionId: 111,
      factionPosition: "Leader"
    });
  });

  it("rejects incomplete identity responses with a safe client error", async () => {
    const { parseTornIdentity, TornApiError } = await import("../src/torn.js");

    expect(() => parseTornIdentity({}, {})).toThrow(TornApiError);
    try {
      parseTornIdentity({}, {});
    } catch (error) {
      expect(error).toMatchObject({ statusCode: 422, expose: true });
    }
  });
});

describe("Torn faction planning data", () => {
  it("normalizes members without retaining unnecessary fields", async () => {
    const { parseFactionMembers } = await import("../src/torn.js");
    const members = parseFactionMembers({
      members: [{
        id: 42,
        name: "Vault Dweller",
        position: "Member",
        level: 50,
        days_in_faction: 100,
        is_in_oc: false,
        last_action: { status: "Online", timestamp: 1_700_000_000, relative: "1 minute ago" },
        status: { state: "Okay", description: "Okay", details: null, until: null, color: "green" }
      }]
    });

    expect(members[0]).toMatchObject({
      id: 42,
      name: "Vault Dweller",
      isInOc: false,
      lastActionAt: 1_700_000_000
    });
  });

  it("does not publish key-owner CPR for an empty crime slot", async () => {
    const { parseFactionCrimes } = await import("../src/torn.js");
    const crimes = parseFactionCrimes({
      crimes: [{
        id: 9001,
        name: "Example Crime",
        difficulty: 5,
        status: "Recruiting",
        created_at: 1_700_000_000,
        planning_at: null,
        ready_at: null,
        expired_at: 1_800_000_000,
        executed_at: null,
        slots: [{
          position: "Driver",
          position_info: { id: 1 },
          item_requirement: null,
          user: null,
          checkpoint_pass_rate: 87
        }]
      }]
    });

    expect(crimes[0]!.payload.slots[0]).toMatchObject({
      position: "Driver",
      user: null,
      checkpoint_pass_rate: null
    });
  });
});

describe("Torn personal crime stats", () => {
  it("keeps only normalized crime fields and derives planner totals", async () => {
    const { parsePersonalCrimeStats } = await import("../src/torn.js");
    const result = parsePersonalCrimeStats({
      personalstats: {
        crimes: {
          offenses: {
            vandalism: 10,
            fraud: 20,
            theft: 30,
            counterfeiting: 40,
            illicit_services: 50,
            cybercrime: 60,
            extortion: 70,
            illegal_production: 80,
            organized_crimes: 90,
            total: 100
          },
          skills: {
            search_for_cash: 1,
            shoplifting: 2,
            pickpocketing: 3,
            burglary: 4,
            card_skimming: 5,
            forgery: 6,
            scamming: 7,
            cracking: 8,
            graffiti: 9,
            disposal: 10,
            arson: 11
          },
          total: 100,
          version: "2"
        }
      },
      unrelated: { private: 999 }
    });

    expect(result.stats).not.toHaveProperty("unrelated.private");
    expect(result.stats["crimes.offenses.cybercrime"]).toBe(60);
    expect(result.totals).toMatchObject({
      crimes: 100,
      organizedCrimes: 90,
      theft: 40,
      fraud: 78,
      hacking: 68,
      violence: 110,
      drugs: 130
    });
  });

  it("rejects an unsupported personal-stat response", async () => {
    const { parsePersonalCrimeStats } = await import("../src/torn.js");
    expect(() => parsePersonalCrimeStats({ personalstats: {} })).toThrow();
  });
});

describe("Torn ranked-war data", () => {
  it("normalizes the current ranked war from the faction perspective", async () => {
    const { parseFactionRankedWar } = await import("../src/torn.js");
    const war = parseFactionRankedWar(
      {
        wars: {
          ranked: {
            war_id: 7001,
            start: 1_700_000_000,
            end: null,
            target: 12_500,
            winner: null,
            factions: [
              { id: 123, name: "Vault 111", score: 5_500, chain: 18 },
              { id: 456, name: "The Institute", score: 4_900, chain: 12 }
            ]
          }
        }
      },
      { rankedwars: [] },
      123,
      1_700_000_100
    );

    expect(war).toEqual({
      id: 7001,
      factionId: 123,
      factionName: "Vault 111",
      opponentFactionId: 456,
      opponentName: "The Institute",
      startsAt: 1_700_000_000,
      endsAt: null,
      targetScore: 12_500,
      factionScore: 5_500,
      opponentScore: 4_900,
      factionChain: 18,
      opponentChain: 12,
      winnerFactionId: null,
      status: "active"
    });
  });

  it("uses the newest completed war when there is no current war", async () => {
    const { parseFactionRankedWar } = await import("../src/torn.js");
    const war = parseFactionRankedWar(
      { wars: { ranked: null } },
      {
        rankedwars: [{
          id: 7000,
          start: 1_600_000_000,
          end: 1_600_100_000,
          target: 10_000,
          winner: 123,
          factions: [
            { id: 456, name: "The Institute", score: 8_000, chain: 5 },
            { id: 123, name: "Vault 111", score: 10_000, chain: 25 }
          ]
        }]
      },
      123,
      1_700_000_000
    );

    expect(war).toMatchObject({
      id: 7000,
      opponentFactionId: 456,
      winnerFactionId: 123,
      status: "finished"
    });
  });

  it("retains only outgoing attacks belonging to the selected ranked war", async () => {
    const { parseFactionAttacks } = await import("../src/torn.js");
    const player = (id: number, name: string, factionId: number, factionName: string) => ({
      id,
      name,
      level: 50,
      faction: { id: factionId, name: factionName }
    });
    const base = {
      started: 1_700_000_010,
      ended: 1_700_000_020,
      result: "Hospitalized",
      respect_gain: 4.25,
      respect_loss: 0,
      chain: 10,
      is_interrupted: false
    };
    const attacks = parseFactionAttacks(
      {
        attacks: [
          {
            ...base,
            id: "abc",
            attacker: player(42, "Dweller", 123, "Vault 111"),
            defender: player(88, "Synth", 456, "The Institute"),
            is_ranked_war: true
          },
          {
            ...base,
            id: "not-ranked",
            attacker: player(42, "Dweller", 123, "Vault 111"),
            defender: player(88, "Synth", 456, "The Institute"),
            is_ranked_war: false
          },
          {
            ...base,
            id: "wrong-opponent",
            attacker: player(42, "Dweller", 123, "Vault 111"),
            defender: player(99, "Raider", 999, "Raiders"),
            is_ranked_war: true
          }
        ]
      },
      123,
      456,
      1_700_000_000,
      null
    );

    expect(attacks).toHaveLength(1);
    expect(attacks[0]).toMatchObject({
      id: "abc",
      attackerTornId: 42,
      defenderTornId: 88,
      result: "Hospitalized",
      respectGain: 4.25
    });
  });
});
