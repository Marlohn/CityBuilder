/**
 * Save de versão antiga (issue #167): save v1 ainda abre e migra para a versão atual.
 * Identificadores em inglês, explicação em português simples.
 */
import { checkInvariants, makeReplay, parseReplay, replayInto, statsView } from "@city/sim";
import { describe, expect, it } from "vitest";
import * as replayMod from "../../packages/sim/src/save/replay";
import { createTestGame } from "../helpers";

// Forma do save que o teste conhece (o Dev pode ter campos a mais no tipo real).
interface ReplayLike {
  format: string;
  version: number;
  seed: string;
  tick: number;
  commands: unknown[];
  overrides?: unknown;
}
type Migration = (r: ReplayLike) => ReplayLike;

// Versão atual do motor (vem do módulo por caminho relativo para não quebrar o tipo antes do Dev).
const REPLAY_VERSION: number = (() => {
  const v = (replayMod as unknown as { REPLAY_VERSION?: unknown }).REPLAY_VERSION;
  if (typeof v !== "number") throw new Error("o motor ainda não exporta REPLAY_VERSION");
  return v;
})();

// Migração com corrente injetada (o segundo argumento). Falha com texto claro se o motor não tem ainda.
function applyMigrations(r: ReplayLike, chain?: Record<number, Migration>): ReplayLike {
  const fn = (
    replayMod as unknown as {
      applyMigrations?: (r: ReplayLike, c?: Record<number, Migration>) => ReplayLike;
    }
  ).applyMigrations;
  if (typeof fn !== "function") throw new Error("o motor ainda não exporta applyMigrations");
  return fn(r, chain);
}

// Save v1 de verdade, escrito à mão (formato do commit 0d18fc0). Um dia de jogo para dar tempo de crescer.
const SAVE_V1 = {
  format: "citybuilder-replay",
  version: 1,
  seed: "save-v1",
  overrides: { world: { width: 160, height: 256 } },
  tick: 1440,
  commands: [
    {
      tick: 0,
      command: { type: "buildRoad", kind: "street", x0: 10, y0: 10, x1: 14, y1: 10 },
    },
    {
      tick: 1,
      command: { type: "zone", zone: "residential_low", x0: 10, y0: 11, x1: 14, y1: 16 },
    },
  ],
};
const SAVE_V1_TEXT = JSON.stringify(SAVE_V1);
const WORLD_160 = { world: { width: 160, height: 256 } };

// Cópia nova do save v1 como objeto (cada teste usa a sua, para um não sujar o outro).
function v1Like(): ReplayLike {
  return JSON.parse(SAVE_V1_TEXT) as ReplayLike;
}

describe("save de versão antiga (issue #167)", () => {
  it("a versão atual do save é a 2 (a v1 foi guardada)", () => {
    // A issue #167 sobe REPLAY_VERSION para 2 porque a migração 1 -> 2 passa a existir na corrente.
    expect(REPLAY_VERSION, "REPLAY_VERSION devia ser 2 depois da migração 1 -> 2").toBe(2);
  });

  it("abre save v1 e a cidade fica íntegra", () => {
    const replay = parseReplay(SAVE_V1_TEXT);
    expect(replay.version, "save v1 devia migrar para a versão atual do jogo").toBe(REPLAY_VERSION);
    const game = createTestGame({ seed: "save-v1", overrides: WORLD_160 });
    replayInto(game, replay);
    expect(checkInvariants(game.city), "cidade migrada quebrou regra que nunca pode quebrar").toEqual([]);
  });

  it("salvar depois de migrar usa a versão atual", () => {
    const replay = parseReplay(SAVE_V1_TEXT);
    const game = createTestGame({ seed: "save-v1", overrides: WORLD_160 });
    replayInto(game, replay);
    expect(makeReplay(game).version, "save novo devia sair na versão atual do jogo").toBe(REPLAY_VERSION);
  });

  it("salvar e reabrir dá a mesma cidade", () => {
    const seed = "save-igual";
    const commands = [
      { type: "buildRoad", kind: "street", x0: 10, y0: 10, x1: 14, y1: 10 },
      { type: "zone", zone: "residential_low", x0: 10, y0: 11, x1: 14, y1: 16 },
    ] as const;
    const direto = createTestGame({
      seed,
      overrides: WORLD_160,
      commands: [...commands],
      days: 1,
    });
    const replay = parseReplay(JSON.stringify(makeReplay(direto)));
    const reaberto = createTestGame({ seed, overrides: WORLD_160 });
    replayInto(reaberto, replay);
    const a = statsView(direto);
    const b = statsView(reaberto);
    expect(b.population, "população mudou ao salvar e reabrir").toBe(a.population);
    expect(b.money, "dinheiro mudou ao salvar e reabrir").toBe(a.money);
    expect(b.tick, "tick mudou ao salvar e reabrir").toBe(a.tick);
  });

  it("migra v1 até v3 na ordem", () => {
    const order: number[] = [];
    const chain: Record<number, Migration> = {
      2: (r) => {
        order.push(2);
        return { ...r, version: 2 };
      },
      3: (r) => {
        order.push(3);
        return { ...r, version: 3 };
      },
    };
    const out = applyMigrations(v1Like(), chain);
    expect(out.version, "save v1 com degraus 2 e 3 devia chegar na versão 3").toBe(3);
    expect(order, "degraus fora de ordem").toEqual([2, 3]);
  });

  it("recusa quando falta o degrau do meio", () => {
    const chain: Record<number, Migration> = {
      3: (r) => ({ ...r, version: 3 }),
    };
    let message = "";
    try {
      applyMigrations(v1Like(), chain);
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message, "devia recusar sem o degrau 2").toMatch(/2/);
    expect(message, "mensagem devia falar de migra em português").toMatch(/migra/i);
  });

  it("recusa save mais novo que o jogo", () => {
    const futureVersion = REPLAY_VERSION + 1;
    const future = { ...v1Like(), version: futureVersion };
    let message = "";
    try {
      applyMigrations(future, {});
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message, "mensagem devia citar a versão do save").toContain(String(futureVersion));
    expect(message, "mensagem devia citar a versão do jogo").toContain(String(REPLAY_VERSION));
  });

  it("recusa arquivo que não é save", () => {
    expect(() => parseReplay('{"hello":1}')).toThrow(/não é um save/);
  });
});
