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

describe("Torn member analytics", () => {
  it("normalizes battle stats without retaining modifiers", async () => {
    const { parseBattleStats } = await import("../src/torn.js");
    const result = parseBattleStats({
      battlestats: {
        strength: { value: 1000, modifier: 5, modifiers: [{ effect: "education", value: 5, type: "percent" }] },
        defense: { value: 2000, modifier: 0, modifiers: [] },
        speed: { value: 3000, modifier: 0, modifiers: [] },
        dexterity: { value: 4000, modifier: 0, modifiers: [] },
        total: 10000
      }
    });

    expect(result).toEqual({
      strength: 1000,
      defense: 2000,
      speed: 3000,
      dexterity: 4000,
      total: 10000
    });
    expect(result).not.toHaveProperty("modifiers");
  });

  it("normalizes per-drug totals, rehabilitation totals, and cooldowns", async () => {
    const { parseDrugStats, parseCooldowns } = await import("../src/torn.js");
    const drugs = parseDrugStats({
      personalstats: {
        drugs: {
          cannabis: 1,
          ecstasy: 2,
          ketamine: 3,
          lsd: 4,
          opium: 5,
          pcp: 6,
          shrooms: 7,
          speed: 8,
          vicodin: 9,
          xanax: 10,
          total: 55,
          overdoses: 2,
          rehabilitations: { amount: 3, fees: 250000 }
        }
      }
    });
    const cooldowns = parseCooldowns({
      cooldowns: { drug: 3600, medical: 0, booster: 7200 }
    });

    expect(drugs).toMatchObject({
      total: 55,
      xanax: 10,
      overdoses: 2,
      rehabilitationCount: 3,
      rehabilitationFees: 250000
    });
    expect(cooldowns).toEqual({ drug: 3600, medical: 0, booster: 7200 });
  });

  it("rejects incomplete private analytics responses", async () => {
    const { parseBattleStats, parseDrugStats, parseCooldowns } = await import("../src/torn.js");
    expect(() => parseBattleStats({ battlestats: {} })).toThrow();
    expect(() => parseDrugStats({ personalstats: { drugs: {} } })).toThrow();
    expect(() => parseCooldowns({ cooldowns: {} })).toThrow();
  });
});

describe("Torn ranked-war data", () => {
  it("normalizes only the public opponent fields needed by the target list", async () => {
    const { parseFactionWarTargets } = await import("../src/torn.js");
    const targets = parseFactionWarTargets({
      members: [{
        id: 88,
        name: "Synth",
        position: "Member",
        level: 75,
        days_in_faction: 200,
        is_in_oc: false,
        is_revivable: true,
        is_on_wall: false,
        has_early_discharge: false,
        last_action: {
          status: "Online",
          timestamp: 1_700_000_000,
          relative: "1 minute ago"
        },
        status: {
          state: "Hospital",
          description: "Hospitalized by Vault Dweller",
          details: null,
          until: 1_700_003_600,
          color: "red"
        },
        revive_setting: "Everyone",
        unrelated: { private: "discarded" }
      }]
    });

    expect(targets).toEqual([{
      id: 88,
      name: "Synth",
      level: 75,
      position: "Member",
      statusState: "Hospital",
      statusDescription: "Hospitalized by Vault Dweller",
      statusUntil: 1_700_003_600,
      lastActionAt: 1_700_000_000,
      isRevivable: true
    }]);
    expect(targets[0]).not.toHaveProperty("unrelated");
  });

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

  it("retains all outgoing attacks in the war window and classifies true ranked-war hits", async () => {
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

    expect(attacks).toHaveLength(3);
    expect(attacks[0]).toMatchObject({
      id: "abc",
      attackerTornId: 42,
      defenderTornId: 88,
      result: "Hospitalized",
      respectGain: 4.25,
      isRankedWar: true
    });
    expect(attacks.find(attack => attack.id === "not-ranked")?.isRankedWar).toBe(false);
    expect(attacks.find(attack => attack.id === "wrong-opponent")?.isRankedWar).toBe(false);
  });
});
