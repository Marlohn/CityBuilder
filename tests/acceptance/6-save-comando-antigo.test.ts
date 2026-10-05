/**
 * Save com comando que o jogo não entende (issue #168):
 * o jogo recusa o save com mensagem em português em vez de abrir pela metade.
 * Identificadores em inglês, explicação em português simples.
 */
import { spawnSync } from "node:child_process";
import { existsSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
  applyMigrations,
  checkInvariants,
  type Migration,
  parseReplay,
  REPLAY_VERSION,
  type Replay,
  replayInto,
} from "@city/sim";
import { afterEach, describe, expect, it } from "vitest";
import { createTestGame } from "../helpers";

// Mundo pequeno só para abrir o save depressa nos testes que carregam a cidade.
const WORLD_160 = { world: { width: 160, height: 256 } };

// Estrada válida que abre todos os saves inválidos (prova que o resto do save está bom).
const VALID_ROAD = { type: "buildRoad", kind: "street", x0: 10, y0: 10, x1: 14, y1: 10 };

// Save com um comando que nunca existiu no jogo (nome de comando escrito errado).
const SAVE_UNKNOWN_TYPE_TEXT = JSON.stringify({
  format: "citybuilder-replay",
  version: 2,
  seed: "save-comando-antigo",
  tick: 4320,
  commands: [
    { tick: 0, command: VALID_ROAD },
    { tick: 4320, command: { type: "moveServico", building: 1, x: 2, y: 3 } },
  ],
});

// Abre o texto do save e devolve a mensagem de erro (vazio quando o jogo aceitou).
function refuseMessage(saveText: string): string {
  try {
    parseReplay(saveText);
  } catch (e) {
    return (e as Error).message;
  }
  return "";
}

describe("save com comando que o jogo não entende (issue #168)", () => {
  it("recusa comando com type que não existe", () => {
    const message = refuseMessage(SAVE_UNKNOWN_TYPE_TEXT);
    expect(message, "o jogo devia recusar o save com comando desconhecido em vez de abrir").not.toBe("");
    expect(message, "a mensagem devia citar o tick do comando com problema").toContain("4320");
    expect(message, "a mensagem devia citar o nome do comando que ninguém entende").toContain("moveServico");
    expect(message, "a mensagem devia citar a versão do save").toContain(String(REPLAY_VERSION));
  });

  it("recusa comando zone com campo faltando", () => {
    // Falta o campo zone: o jogo não tem como adivinhar o que zonear.
    const saveText = JSON.stringify({
      format: "citybuilder-replay",
      version: 2,
      seed: "save-comando-antigo",
      tick: 20,
      commands: [
        { tick: 0, command: VALID_ROAD },
        { tick: 10, command: { type: "zone", x0: 10, y0: 11, x1: 14, y1: 16 } },
      ],
    });
    const message = refuseMessage(saveText);
    expect(message, "o jogo devia recusar zone sem o campo zone").not.toBe("");
    expect(message, "a mensagem devia citar o tick do comando com problema").toContain("10");
  });

  it("recusa comando zone com coordenada fora do limite", () => {
    // O mapa só vai de 0 a 4095: 5000 não existe em lugar nenhum.
    const saveText = JSON.stringify({
      format: "citybuilder-replay",
      version: 2,
      seed: "save-comando-antigo",
      tick: 40,
      commands: [
        { tick: 0, command: VALID_ROAD },
        {
          tick: 20,
          command: { type: "zone", zone: "residential_low", x0: 10, y0: 11, x1: 5000, y1: 16 },
        },
      ],
    });
    const message = refuseMessage(saveText);
    expect(message, "o jogo devia recusar coordenada fora do mapa").not.toBe("");
    expect(message, "a mensagem devia citar o tick do comando com problema").toContain("20");
  });

  it("abre quando o único problema é limite de jogo em runtime", () => {
    // factor 5 passa no formato (0 a 10) mas estoura o limite da config (0.5 a 2):
    // isso é recusado na hora de jogar, com motivo, e o resto do save continua.
    const saveText = JSON.stringify({
      format: "citybuilder-replay",
      version: 2,
      seed: "save-limite-runtime",
      overrides: WORLD_160,
      tick: 1440,
      commands: [
        { tick: 0, command: VALID_ROAD },
        {
          tick: 1,
          command: { type: "zone", zone: "residential_low", x0: 10, y0: 11, x1: 14, y1: 16 },
        },
        {
          tick: 2,
          command: { type: "directorAdjust", param: "immigration", factor: 5, reason: "teste" },
        },
      ],
    });
    expect(
      () => parseReplay(saveText),
      "limite de jogo não é save quebrado: o jogo devia aceitar o formato",
    ).not.toThrow();
    const replay = parseReplay(saveText);
    const game = createTestGame({ seed: "save-limite-runtime", overrides: WORLD_160 });
    replayInto(game, replay);
    expect(
      checkInvariants(game.city),
      "cidade carregada com ajuste recusado quebrou regra que nunca pode quebrar",
    ).toEqual([]);
  });

  it("save v1 com comandos válidos continua abrindo", () => {
    const saveText = JSON.stringify({
      format: "citybuilder-replay",
      version: 1,
      seed: "save-v1",
      overrides: WORLD_160,
      tick: 1440,
      commands: [
        { tick: 0, command: VALID_ROAD },
        {
          tick: 1,
          command: { type: "zone", zone: "residential_low", x0: 10, y0: 11, x1: 14, y1: 16 },
        },
      ],
    });
    const replay = parseReplay(saveText);
    expect(replay.version, "save v1 devia migrar para a versão atual do jogo").toBe(REPLAY_VERSION);
    const game = createTestGame({ seed: "save-v1", overrides: WORLD_160 });
    replayInto(game, replay);
    expect(checkInvariants(game.city), "cidade migrada da v1 quebrou regra que nunca pode quebrar").toEqual(
      [],
    );
  });

  it("abre depois de uma migração que reescreve o type velho", () => {
    // Save v1 com o nome antigo do comando: sem a migração ninguém entende moveServico.
    const oldSave = {
      format: "citybuilder-replay",
      version: 1,
      seed: "save-tipo-antigo",
      overrides: WORLD_160,
      tick: 1440,
      commands: [
        { tick: 0, command: VALID_ROAD },
        { tick: 1, command: { type: "moveServico", building: 1, x: 2, y: 3 } },
      ],
    };
    const oldText = JSON.stringify(oldSave);
    // Sem reescrever o nome velho o jogo recusa: prova que hoje nada passa batido.
    const refused = refuseMessage(oldText);
    expect(refused, "o jogo devia recusar o nome de comando velho sem migração").not.toBe("");
    expect(refused, "a recusa devia citar o nome velho do comando").toContain("moveServico");
    // A migração 1 -> 2 conserta o nome antes de validar: depois dela tudo é entendido.
    const renameChain = {
      2: (r: Replay) => ({
        ...r,
        version: 2,
        commands: r.commands.map((timed) => {
          const raw = timed.command as unknown as { type: string };
          if (raw.type === "moveServico") {
            return {
              ...timed,
              command: { type: "moveService", building: 1, x: 2, y: 3 },
            };
          }
          return timed;
        }),
      }),
    } as unknown as Record<number, Migration>;
    const migrated = applyMigrations(oldSave as unknown as Replay, renameChain);
    expect(migrated.version, "migração devia carimbar a versão 2").toBe(2);
    // Depois da migração o mesmo save abre: a validação vem DEPOIS da migração.
    expect(
      () => parseReplay(JSON.stringify(migrated)),
      "save migrado devia abrir: a validação do comando roda depois da migração",
    ).not.toThrow();
    const jogo = createTestGame({ seed: "save-tipo-antigo", overrides: WORLD_160 });
    replayInto(jogo, parseReplay(JSON.stringify(migrated)));
    expect(checkInvariants(jogo.city), "cidade do save migrado quebrou regra que nunca pode quebrar").toEqual(
      [],
    );
  });

  describe("linha de comando", () => {
    // Arquivo temporário do save inválido (apagado depois de cada teste).
    let tmpFile = "";
    afterEach(() => {
      if (tmpFile !== "" && existsSync(tmpFile)) unlinkSync(tmpFile);
      tmpFile = "";
    });

    it("npm run sim -- replay sai com erro e mensagem em português", () => {
      const baseDir = process.env.TMPDIR ?? tmpdir();
      tmpFile = path.join(baseDir, "save-comando-antigo-168.json");
      writeFileSync(tmpFile, SAVE_UNKNOWN_TYPE_TEXT);
      const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
      const out = spawnSync("npx", ["tsx", "packages/cli/src/main.ts", "replay", tmpFile], {
        cwd: repoRoot,
        timeout: 120000,
        encoding: "utf8",
      });
      expect(out.status, "replay com comando desconhecido devia sair com erro").not.toBe(0);
      const joined = `${out.stdout ?? ""}\n${out.stderr ?? ""}`;
      expect(joined, "a saída devia citar o tick do comando com problema").toContain("4320");
      expect(joined, "a saída devia citar o nome do comando que ninguém entende").toContain("moveServico");
      expect(joined, "a saída devia explicar o erro em português").toMatch(/inválid|invalido/i);
    });
  });
});
