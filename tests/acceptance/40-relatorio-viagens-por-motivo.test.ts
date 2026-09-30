/**
 * Issue #40 — relatório mostra as viagens de ontem, por motivo.
 *
 * Hoje o relatório (`packages/sim/src/view/report.ts`) não tem nenhuma linha de
 * viagens por motivo, e `YearCounters` (`packages/sim/src/city.ts`) só conta
 * nascimentos/mortes/chegadas/saídas/casamentos/divórcios (mais os desejos não
 * atendidos): não existe contagem de viagens de ontem por motivo. Este teste cobra
 * a linha nova em português, com números maiores que zero, somando mais que os
 * trabalhadores com carro, reproduzível na mesma semente, nos dois cenários da
 * issue, com a contagem morando no motor (`city.lastYear`, virado no fim do ano
 * em `game.ts`) e não no contrato nem no StatsView. Escrito antes do código
 * (QA vermelho de propósito).
 */

import { type Game, reportText, statsView } from "@city/sim";
import { describe, expect, it } from "vitest";
import { createTestGame } from "../helpers";

// Cidade de referência da issue: cenário bairro-basico, prefeito automático,
// dinheiro infinito, 40 dias.
const MAIN_SEED = "avaliacao-livre";
const SCENARIO = "bairro-basico";
const MAIN_DAYS = 40;

// Segundo cenário da issue: mesmo bairro, outra semente, 25 dias.
const SECOND_SEED = "relatorio-1";
const SECOND_DAYS = 25;

// Números da linha "Viagens de ontem: ...", já sem o ponto de milhar.
interface TripsLine {
  /** Viagens de trabalho ontem. */
  work: number;
  /** Viagens de escola ontem. */
  school: number;
  /** Viagens de compras ontem. */
  shopping: number;
  /** Viagens de saúde ontem. */
  health: number;
  /** Viagens de lazer ontem. */
  leisure: number;
  /** Viagens feitas a pé ontem. */
  walk: number;
}

function newMainCity(): Game {
  return createTestGame({
    seed: MAIN_SEED,
    scenario: SCENARIO,
    days: MAIN_DAYS,
    bot: true,
    overrides: { economy: { mode: "sandbox" } },
  });
}

function newSecondCity(): Game {
  return createTestGame({
    seed: SECOND_SEED,
    scenario: SCENARIO,
    days: SECOND_DAYS,
    bot: true,
    overrides: { economy: { mode: "sandbox" } },
  });
}

/** "1.234" (ponto de milhar do relatório) vira 1234. */
function toCount(raw: string): number {
  return Number(raw.replace(/\./g, ""));
}

/**
 * Acha a linha nova no texto do relatório. Aceita "saude/saúde" e "a pe/a pé"
 * para não quebrar por acento, mas cobra as cinco etiquetas de motivo.
 */
function parseTripsLine(report: string): TripsLine | null {
  const found = report.match(
    /Viagens de ontem:\s*trabalho\s+([\d.]+)\s*·\s*escola\s+([\d.]+)\s*·\s*compras\s+([\d.]+)\s*·\s*sa[uú]de\s+([\d.]+)\s*·\s*lazer\s+([\d.]+)\s*\(\s*a\s*p[eé]\s+([\d.]+)\s*\)/,
  );
  if (!found) return null;
  return {
    work: toCount(found[1]!),
    school: toCount(found[2]!),
    shopping: toCount(found[3]!),
    health: toCount(found[4]!),
    leisure: toCount(found[5]!),
    walk: toCount(found[6]!),
  };
}

/**
 * Trabalhadores com carro, com o que já existe hoje no motor/view.
 * Verificado em `packages/sim/src/view/people.ts`: `personView` NÃO tem
 * `isDriver` (só id, casa, job, school...), então conta aqui: pessoa viva com
 * emprego (`pop.job[p] !== -1`, inclui quem trabalha fora da cidade) morando
 * numa família que tem carro (`city.hh.cars[h] > 0`).
 */
function countWorkersWithCar(game: Game): number {
  const pop = game.city.pop;
  const hh = game.city.hh;
  let total = 0;
  for (let p = 0; p < pop.count; p++) {
    if (pop.status[p] !== 1) continue;
    if (pop.job[p]! === -1) continue;
    const h = pop.household[p]!;
    if (h < 0) continue;
    if (hh.cars[h]! > 0) total++;
  }
  return total;
}

describe("issue #40: relatório mostra as viagens de ontem, por motivo", () => {
  it("o relatório tem a linha nova em português, com números maiores que zero", () => {
    const game = newMainCity();
    const report = reportText(game);
    const trips = parseTripsLine(report);
    expect(
      trips,
      `relatório sem a linha nova. Esperado algo como "Viagens de ontem: trabalho N · escola N · ` +
        `compras N · saúde N · lazer N (a pé N)". Reproduza com ` +
        `npm run sim -- report --bot --sandbox --seed=${MAIN_SEED} --days=${MAIN_DAYS}`,
    ).not.toBeNull();
    for (const [label, value] of Object.entries(trips!)) {
      expect(
        value,
        `viagens de ontem com ${label}=${value} (queremos número maior que zero): ` +
          `cada motivo precisa ter ao menos uma viagem no dia anterior`,
      ).toBeGreaterThan(0);
    }
  });

  it("a soma das viagens de ontem é maior que o número de trabalhadores com carro", () => {
    const game = newMainCity();
    const report = reportText(game);
    const trips = parseTripsLine(report);
    expect(
      trips,
      `relatório sem a linha nova, então não dá para somar as viagens de ontem. ` +
        `Reproduza com npm run sim -- report --bot --sandbox --seed=${MAIN_SEED} --days=${MAIN_DAYS}`,
    ).not.toBeNull();
    const drivers = countWorkersWithCar(game);
    expect(
      drivers,
      `nenhum trabalhador com carro na cidade de referência: sem eles a comparação não vale nada`,
    ).toBeGreaterThan(0);
    const total = trips!.work + trips!.school + trips!.shopping + trips!.health + trips!.leisure;
    expect(
      total,
      `soma das viagens de ontem (${total} = ${trips!.work}+${trips!.school}+${trips!.shopping}+` +
        `${trips!.health}+${trips!.leisure}) não passa do número de trabalhadores com carro ` +
        `(${drivers}): a pé e os motivos novos (escola, compras, saúde, lazer) têm de aparecer na conta`,
    ).toBeGreaterThan(drivers);
  });

  it("a mesma semente dá sempre o mesmo número", () => {
    const first = parseTripsLine(reportText(newMainCity()));
    const second = parseTripsLine(reportText(newMainCity()));
    expect(
      first,
      `relatório sem a linha nova na primeira cidade, então não dá para comparar a repetição. ` +
        `Reproduza com npm run sim -- report --bot --sandbox --seed=${MAIN_SEED} --days=${MAIN_DAYS}`,
    ).not.toBeNull();
    expect(
      second,
      `relatório sem a linha nova na segunda cidade, então não dá para comparar a repetição.`,
    ).not.toBeNull();
    expect(
      second,
      `mesma semente (${MAIN_SEED}) deu números diferentes de viagens de ontem: ` +
        `a contagem precisa ser reproduzível (sorteio só pelo Rng, sem Math.random nem relógio)`,
    ).toEqual(first);
  });

  it("a linha aparece também com a semente relatorio-1 e 25 dias", () => {
    const game = newSecondCity();
    const report = reportText(game);
    const trips = parseTripsLine(report);
    expect(
      trips,
      `relatório do cenário ${SCENARIO} com seed "${SECOND_SEED}" e ${SECOND_DAYS} dias sem a linha nova. ` +
        `Reproduza com npm run sim -- report --bot --sandbox --seed=${SECOND_SEED} --days=${SECOND_DAYS}`,
    ).not.toBeNull();
    for (const [label, value] of Object.entries(trips!)) {
      expect(
        value,
        `viagens de ontem com ${label}=${value} no cenário ${SECOND_SEED} ` +
          `(queremos número maior que zero)`,
      ).toBeGreaterThan(0);
    }
  });

  it("a contagem fica no motor (city.lastYear), não no contrato nem no StatsView", () => {
    const game = newMainCity();
    const report = reportText(game);
    const trips = parseTripsLine(report);
    expect(
      trips,
      `relatório sem a linha nova, então não dá para conferir de onde vêm os números. ` +
        `Reproduza com npm run sim -- report --bot --sandbox --seed=${MAIN_SEED} --days=${MAIN_DAYS}`,
    ).not.toBeNull();
    // Os números do relatório têm de existir nos contadores do motor: `YearCounters`
    // (`packages/sim/src/city.ts`), virados em `city.lastYear` no fim do ano em
    // `game.ts`. Hoje `lastYear` só tem nascimentos/mortes/chegadas/saídas/
    // casamentos/divórcios (mais desejos não atendidos): nenhum valor de viagem.
    const lastYear = game.city.lastYear as unknown as Record<string, unknown>;
    const motorValues = Object.values(lastYear).filter((v): v is number => typeof v === "number");
    for (const [label, value] of Object.entries(trips!)) {
      expect(
        motorValues.includes(value),
        `número de ${label} (${value}) do relatório não está em nenhum contador numérico de ` +
          `city.lastYear (valores hoje: ${motorValues.join(",")}): a contagem das viagens de ` +
          `ontem tem de morar no YearCounters do motor, virado em city.lastYear no fim do ano`,
      ).toBe(true);
    }
    // E não no contrato (`packages/contract/src/view.ts`, tipo StatsView) nem no
    // StatsView: a visão pronta para a tela não carrega contadores de viagem.
    const viewKeys = Object.keys(statsView(game));
    const tripKeys = viewKeys.filter(
      (k) =>
        /^(?:trips|viagens?)/i.test(k) ||
        [
          "tripsWork",
          "tripsSchool",
          "tripsShopping",
          "tripsHealth",
          "tripsLeisure",
          "tripsWalk",
          "viagensOntem",
        ].includes(k),
    );
    expect(
      tripKeys,
      `StatsView com chaves de viagem (${tripKeys.join(",")}): a contagem fica no motor ` +
        `(YearCounters/city.lastYear), não em packages/contract nem em StatsView`,
    ).toEqual([]);
  });
});
