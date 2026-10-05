/**
 * Teste de aceitação da issue #241.
 *
 * "Sem hospital" no censo deve significar pessoas esperando internação sem leito:
 * a única fonte de verdade é `city.seekHospital.size`. StatsView e reportText apenas
 * propagam esse valor.
 *
 * O cenário mantém um hospital ativo e depois normaliza a fila para duas pessoas vivas
 * sem leito. Na implementação antiga, `withoutHospital` percorre toda a população com
 * `pop.hospital[p] < 0`, então o primeiro critério falha pelo motivo certo.
 */
import type { Command } from "@city/contract";
import { currentCensus, type Game, reportText, statsView } from "@city/sim";
import { describe, expect, it } from "vitest";
import { createTestGame } from "../helpers";

const HOSPITAL: Command = { type: "placeService", service: "hospital", x: 76, y: 141 };

let prepared: Game | null = null;

function cidadeComFilaControlada(): Game {
  if (prepared) return prepared;

  const game = createTestGame({
    seed: "censo-fila-hospital-241",
    scenario: "bairro-basico",
    days: 5,
    overrides: { economy: { mode: "sandbox" } },
    commands: [HOSPITAL],
  });

  let hospitalAtivo = false;
  for (let i = 0; i < game.sim.buildings.count; i++) {
    if (game.sim.buildings.isActive(i) && game.sim.buildings.typeOf(i).id === "hospital") {
      hospitalAtivo = true;
      break;
    }
  }
  expect(
    hospitalAtivo,
    "o cenário deveria ter um hospital ativo: sem hospital a regressão pedida pela issue não fica representada",
  ).toBe(true);

  for (const p of game.city.seekHospital.toArray()) game.city.seekHospital.delete(p);

  const esperando: number[] = [];
  for (let p = 0; p < game.city.pop.count && esperando.length < 2; p++) {
    if (game.city.pop.status[p] !== 1) continue;
    if (game.city.pop.hospital[p]! >= 0) continue;
    esperando.push(p);
  }

  expect(
    esperando.length,
    "o cenário precisa de duas pessoas vivas sem leito para montar uma fila de internação controlada",
  ).toBe(2);

  for (const p of esperando) game.city.seekHospital.add(p);

  prepared = game;
  return game;
}

describe("issue #241: censo usa a fila real de internação sem leito", () => {
  it("withoutHospital é exatamente city.seekHospital.size, não toda a população sem leito", () => {
    const game = cidadeComFilaControlada();
    const census = currentCensus(game);
    const waiting = game.city.seekHospital.size;

    expect(waiting).toBe(2);
    expect(
      census.population,
      "a cidade precisa ter mais gente que a fila para distinguir demanda real de população total",
    ).toBeGreaterThan(waiting);
    expect(
      census.withoutHospital,
      `withoutHospital deveria ser a fila seekHospital (${waiting}), mas veio ${census.withoutHospital}`,
    ).toBe(waiting);
    expect(census.withoutHospital).toBeLessThan(census.population);
  });

  it("StatsView e relatório propagam o mesmo número do censo", () => {
    const game = cidadeComFilaControlada();
    const waiting = game.city.seekHospital.size;

    expect(statsView(game).unmet.hospital).toBe(waiting);
    expect(reportText(game)).toContain(`sem hospital: ${waiting}`);
  });
});
