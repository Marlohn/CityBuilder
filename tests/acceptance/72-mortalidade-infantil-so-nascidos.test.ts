/**
 * Issue #72 — mortalidade infantil: só conta quem nasceu na cidade.
 *
 * O numerador (`infantDeaths`) contava toda morte com idade 0, mas o denominador (`births`) só
 * conta quem nasceu na cidade. O bebê que chegou com a família imigrante entrava no numerador e
 * não no denominador, inflando a taxa do placar.
 *
 * Este teste trava a regra: em `Demography`, morte de bebê só conta quando o primeiro
 * evento da pessoa é `EV.born`. Semente fixa, sem relógio e sem `Math.random`.
 */
import { checkInvariants, statsView } from "@city/sim";
import { describe, expect, it } from "vitest";
import { EV } from "../../packages/sim/src/people/events";
import { createTestGame } from "../helpers";

/** Cidade de referência da issue: cenário bairro-basico, semente fixa, prefeito automático. */
const SEED = "bebe-imigrante";
const SCENARIO = "bairro-basico";
const DAYS = 40;

interface Contagem {
  /** Bebês que nasceram na cidade e morreram com 1 ano de vida. */
  nat: number;
  /** Bebês que chegaram de fora (primeiro evento = `EV.arrived`) e morreram com 1 ano de vida. */
  im: number;
  /** O que o Demography contou. */
  contador: number;
  /** A taxa que o placar mostra. */
  taxa: number | null;
}

function medir(overrides: Record<string, unknown> = {}): Contagem {
  const game = createTestGame({
    seed: SEED,
    scenario: SCENARIO,
    days: DAYS,
    bot: true,
    // Janela maior que os dias simulados: o placar cobre todos os anos do teste.
    overrides: { economy: { mode: "sandbox" }, realism: { windowYears: 50 }, ...overrides },
  });
  const city = game.city;
  let nat = 0;
  let im = 0;
  for (let p = 0; p < city.pop.count; p++) {
    const evs = city.events.of(p);
    if (evs.length === 0) continue;
    const morreu = evs.find((e) => city.events.type[e] === EV.died);
    if (morreu === undefined || city.events.a[morreu] !== 1) continue;
    // O primeiro evento diz de onde a pessoa veio: nasceu aqui ou chegou de fora.
    if (city.events.type[evs[0]!] === EV.born) nat++;
    else im++;
  }
  const w = game.demo.window();
  return {
    nat,
    im,
    contador: w.infantDeaths,
    taxa: game.realism.find((r) => r.id === "infantMortality")?.value ?? null,
  };
}

describe("issue #72: mortalidade infantil conta só quem nasceu na cidade", () => {
  const m = medir();

  it("o teste tem cidade com imigrante e com nascimentos (senão não prova nada)", () => {
    expect(
      m.im,
      "a cidade do teste não tem bebê imigrante morto com 1 ano: escolha outra semente/seed",
    ).toBeGreaterThan(0);
    expect(m.nat, "a cidade do teste não tem nascimento nenhum").toBeGreaterThan(0);
  });

  it("morte de bebê que chegou de fora NÃO entra em infantDeaths", () => {
    expect(
      m.contador,
      `infantDeaths contou ${m.contador} pessoas, mas só ${m.nat} nasceram na cidade: ` +
        `bebê que chegou com a família imigrante está entrando no numerador`,
    ).toBe(m.nat);
  });

  it("morte de bebê que nasceu na cidade CONTA em infantDeaths", () => {
    expect(
      m.contador,
      `infantDeaths contou ${m.contador} e deveria contar pelo menos os ${m.nat} nascidos na cidade`,
    ).toBeGreaterThanOrEqual(m.nat);
  });

  it("a taxa do placar fica dentro da faixa real (6 a 20 por mil)", () => {
    expect(m.taxa, `a taxa do placar não saiu: ${JSON.stringify(m)}`).not.toBeNull();
    const taxa = m.taxa!;
    const faixa = { min: 6, max: 20, fonte: "IBGE 2023: 12,5 por mil (config/realism.yaml)" };
    expect(
      taxa,
      `mortalidade infantil fora da faixa real: ${taxa.toFixed(1)} por mil ` +
        `(esperado entre ${faixa.min} e ${faixa.max}; ${faixa.fonte})`,
    ).toBeGreaterThanOrEqual(faixa.min);
    expect(
      taxa,
      `mortalidade infantil fora da faixa real: ${taxa.toFixed(1)} por mil ` +
        `(esperado entre ${faixa.min} e ${faixa.max}; ${faixa.fonte})`,
    ).toBeLessThanOrEqual(faixa.max);
  });

  it("nada quebra junto: invariantes e população", () => {
    const game = createTestGame({
      seed: SEED,
      scenario: SCENARIO,
      days: DAYS,
      bot: true,
      overrides: { economy: { mode: "sandbox" }, realism: { windowYears: 50 } },
    });
    expect(checkInvariants(game.city), "regra que nunca pode quebrar").toEqual([]);
    expect(statsView(game).population, "a cidade esvaziou").toBeGreaterThan(0);
  });
});
