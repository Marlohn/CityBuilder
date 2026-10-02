/**
 * Teste de aceitação da issue #202 — os números de regra 150 (crianças sem escola),
 * 500 (pessoas sem UBS) e 60 (raio "já tem serviço perto") saem do código do prefeito
 * e passam a ser lidos de MayorOptions: schoolTrigger, clinicTrigger e nearbyTiles.
 *
 * O teste DEVE falhar na main (campos ainda não existem) e passar depois que o Dev implementar.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { AutoMayor, DEFAULT_MAYOR, type MayorOptions } from "@city/bots";
import { loadConfigAndData } from "@city/cli";
import { BSTATE, createGame } from "@city/sim";
import { describe, expect, it } from "vitest";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const ROOT = join(__dirname, "..", "..", "..");

const OVERRIDES = { economy: { mode: "sandbox" } };

/**
 * Roda o prefeito automático com as opções dadas até o dia pedido e devolve o jogo.
 * Mesma construção usada nos fatos medidos na main.
 */
function city(opts: Partial<MayorOptions>, dia: number, seed = "avaliacao-livre") {
  const { config, data } = loadConfigAndData(OVERRIDES);
  const game = createGame({ config, data, seed });
  const mayor = new AutoMayor(game, seed, { ...DEFAULT_MAYOR, ...opts } as MayorOptions);
  const end = Math.round(40 * game.sim.clock.ticksPerDay);
  while (game.sim.clock.tick < end) {
    mayor.update();
    game.sim.step(1);
    if (game.sim.clock.day >= dia) break;
  }
  return game;
}

/** Conta prédios de um tipo que não foram demolidos. */
function conta(game: ReturnType<typeof city>, id: string): number {
  const b = game.sim.buildings;
  let n = 0;
  for (let i = 0; i < b.count; i++) {
    if (b.typeOf(i).id === id && b.state[i] !== BSTATE.demolished) n++;
  }
  return n;
}

/** Cache de cidades já rodadas (chave = JSON das opções + dia) para não repetir simulação. */
const cacheCidades = new Map<string, ReturnType<typeof city>>();
function cidade(opts: Partial<MayorOptions>, dia: number): ReturnType<typeof city> {
  const key = JSON.stringify({ opts, dia });
  const hit = cacheCidades.get(key);
  if (hit) return hit;
  const g = city(opts, dia);
  cacheCidades.set(key, g);
  return g;
}

describe("issue #202: prefeito lê schoolTrigger, clinicTrigger e nearbyTiles de MayorOptions", () => {
  it("os três números de regra saíram do código", { timeout: 600000 }, () => {
    const bruto = readFileSync(join(ROOT, "packages/bots/src/mayor.ts"), "utf8");
    // Comentários podem citar o número como fonte (a issue pede JSDoc com a conta); o que
    // não pode sobrar é o número chumbado na CONDIÇÃO do código.
    const source = bruto.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    // Na main estes números ainda estão chumbados: > 150, > 500, >= 60.
    // O teste espera que NÃO existam — se existirem, o número continua fixo no código.
    expect(
      source,
      "o número 150 (crianças sem escola) ainda está chumbado na condição do código como '> 150'",
    ).not.toContain("> 150");
    expect(source, "o número 500 (pessoas sem UBS) ainda está chumbado no código como '> 500'").not.toContain(
      "> 500",
    );
    expect(
      source,
      "o número 60 (raio 'já tem serviço perto') ainda está chumbado no código como '>= 60'",
    ).not.toContain(">= 60");
  });

  it("cada campo novo de MayorOptions existe e o DEFAULT_MAYOR traz os mesmos valores de hoje", {
    timeout: 600000,
  }, () => {
    // A conduta atual do prefeito (DEFAULT_MAYOR) não pode mudar: 150 crianças sem escola,
    // 500 pessoas sem UBS, raio 60 quadradinhos. O teste trava esses valores.
    expect(
      DEFAULT_MAYOR.schoolTrigger,
      "schoolTrigger deve ser 150 para manter a conduta atual do prefeito",
    ).toBe(150);
    expect(
      DEFAULT_MAYOR.clinicTrigger,
      "clinicTrigger deve ser 500 para manter a conduta atual do prefeito",
    ).toBe(500);
    expect(DEFAULT_MAYOR.nearbyTiles, "nearbyTiles deve ser 60 para manter a conduta atual do prefeito").toBe(
      60,
    );
  });

  it("com DEFAULT_MAYOR a cidade de referência sai exatamente igual à de hoje", { timeout: 600000 }, () => {
    // Esta prova garante que a tarefa não mudou o prefeito: mesmos gatilhos + mesmo raio
    // devem gerar a mesma cidade (congelamos o começo no dia 16 e o fim no dia 40).
    const game16 = cidade({}, 16);
    const game40 = cidade({}, 40);

    expect(conta(game16, "escola"), "dia 16 deve ter exatamente 1 escola (conduta congelada)").toBe(1);
    expect(conta(game16, "ubs"), "dia 16 deve ter exatamente 2 UBS (conduta congelada)").toBe(2);

    expect(conta(game40, "escola"), "dia 40 deve ter exatamente 3 escolas (conduta congelada)").toBe(3);
    expect(conta(game40, "ubs"), "dia 40 deve ter exatamente 5 UBS (conduta congelada)").toBe(5);
  });

  it("mudar os gatilhos muda a conduta", { timeout: 600000 }, () => {
    // Mesma semente nos quatro cenários: só o gatilho muda.
    // schoolTrigger alto (nunca dispara) => 0 escolas no dia 30.
    const g1 = cidade({ schoolTrigger: 100000 }, 30);
    expect(conta(g1, "escola"), "schoolTrigger 100000 (gatilho nunca dispara) => 0 escolas no dia 30").toBe(
      0,
    );

    // schoolTrigger baixo (dispara logo) => pelo menos 2 escolas no dia 17.
    const g2 = cidade({ schoolTrigger: 1 }, 17);
    expect(
      conta(g2, "escola"),
      "schoolTrigger 1 (gatilho dispara logo) => >= 2 escolas no dia 17",
    ).toBeGreaterThanOrEqual(2);

    // clinicTrigger alto (nunca dispara) => 0 UBS no dia 40.
    const g3 = cidade({ clinicTrigger: 100000 }, 40);
    expect(conta(g3, "ubs"), "clinicTrigger 100000 (gatilho nunca dispara) => 0 UBS no dia 40").toBe(0);

    // clinicTrigger baixo (dispara logo) => pelo menos 2 UBS no dia 17.
    const g4 = cidade({ clinicTrigger: 1 }, 17);
    expect(
      conta(g4, "ubs"),
      "clinicTrigger 1 (gatilho dispara logo) => >= 2 UBS no dia 17",
    ).toBeGreaterThanOrEqual(2);
  });

  it("mudar o raio muda a conduta", { timeout: 600000 }, () => {
    // Mesma semente nos dois cenários: só o raio muda.
    // nearbyTiles 0 => raio zero não protege, bot repete serviço em cada ponto de demanda.
    // Medido na main: 7 escolas no dia 16 (hoje 1). Testamos >= 2 para ser robusto.
    const g1 = cidade({ nearbyTiles: 0 }, 16);
    expect(
      conta(g1, "escola"),
      "nearbyTiles 0 (raio zero) => >= 2 escolas no dia 16 (hoje 1)",
    ).toBeGreaterThanOrEqual(2);

    // nearbyTiles 500 => raio maior protege mais, bot constrói menos.
    // Medido na main: exatamente 2 escolas no dia 25 (hoje 3).
    const g2 = cidade({ nearbyTiles: 500 }, 25);
    expect(
      conta(g2, "escola"),
      "nearbyTiles 500 (raio maior) => exatamente 2 escolas no dia 25 (hoje 3)",
    ).toBe(2);
  });
});
