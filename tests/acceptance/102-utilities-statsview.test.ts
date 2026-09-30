/**
 * Teste de aceitacao da issue #102 (papel QA).
 * A visao de estatisticas (StatsView) deve trazer agua e luz em pessoas equivalentes.
 * Hoje o campo utilities ainda nao existe: este teste deve falhar por isso.
 */
import { BSTATE, type Game, reportText, statsView } from "@city/sim";
import { describe, expect, it } from "vitest";
import { createTestGame } from "../helpers";

// Formato novo esperado na visao (ainda nao existe no motor).
interface UtilityNumbers {
  capacity: number | null;
  used: number;
}

interface UtilitiesField {
  enabled: boolean;
  water: UtilityNumbers;
  power: UtilityNumbers;
}

// Soma manual do consumo dos predios (pessoas equivalentes, arredondada).
function manualUse(game: Game): number {
  const buildings = game.sim.buildings;
  let total = 0;
  for (let b = 0; b < buildings.count; b++) {
    const state = buildings.state[b];
    if (state === BSTATE.demolished || state === BSTATE.abandoned) continue;
    const type = buildings.typeOf(b);
    if (type.service === "water" || type.service === "power") continue;
    total += game.utilities.demandOf(type.homes, type.jobs);
  }
  return Math.round(total);
}

describe("issue #102: a visao traz agua e luz", () => {
  it("a visao traz agua e luz com numero (cidade com 30 dias)", () => {
    // Cidade padrao depois de 30 dias.
    const game = createTestGame({ seed: "avaliacao-livre", scenario: "bairro-basico", days: 30 });
    const s = statsView(game) as unknown as { utilities: UtilitiesField };

    // O sistema vem ligado por padrao.
    expect(s.utilities.enabled, "a visao devia dizer que agua e luz estao ligadas").toBe(true);

    // Agua com numero valido e capacidade maior ou igual ao uso.
    expect(typeof s.utilities.water.used, "o uso de agua devia ser um numero").toBe("number");
    expect(Number.isFinite(s.utilities.water.used), "o uso de agua devia ser finito").toBe(true);
    expect(s.utilities.water.capacity, "a capacidade de agua devia ser um numero (nao null)").toEqual(
      expect.any(Number),
    );
    expect(
      (s.utilities.water.capacity as number) >= s.utilities.water.used,
      "a capacidade de agua devia cobrir o uso",
    ).toBe(true);

    // Luz com numero valido e capacidade maior ou igual ao uso.
    expect(typeof s.utilities.power.used, "o uso de luz devia ser um numero").toBe("number");
    expect(Number.isFinite(s.utilities.power.used), "o uso de luz devia ser finito").toBe(true);
    expect(s.utilities.power.capacity, "a capacidade de luz devia ser um numero (nao null)").toEqual(
      expect.any(Number),
    );
    expect(
      (s.utilities.power.capacity as number) >= s.utilities.power.used,
      "a capacidade de luz devia cobrir o uso",
    ).toBe(true);
  });

  it("com o sistema desligado a capacidade e null e o uso continua", () => {
    // Mesma cidade, mas com agua e luz desligadas.
    const game = createTestGame({
      seed: "avaliacao-livre",
      scenario: "bairro-basico",
      days: 30,
      overrides: { utilities: { enabled: false } },
    });
    const s = statsView(game) as unknown as { utilities: UtilitiesField };

    expect(s.utilities.enabled, "a visao devia dizer que agua e luz estao desligadas").toBe(false);
    expect(s.utilities.water.capacity, "sem o sistema, a capacidade de agua devia ser null").toBeNull();
    expect(s.utilities.power.capacity, "sem o sistema, a capacidade de luz devia ser null").toBeNull();

    // O uso continua: e o consumo dos predios (numero maior que zero).
    const soma = manualUse(game);
    expect(typeof s.utilities.water.used, "o uso de agua devia continuar sendo um numero").toBe("number");
    expect(s.utilities.water.used, "o uso de agua devia ser maior que zero").toBeGreaterThan(0);
    expect(
      s.utilities.water.used,
      `o uso de agua devia bater com a soma dos predios (soma manual = ${soma})`,
    ).toBe(soma);

    // O null precisa sobreviver ao JSON (nao pode virar undefined nem sumir).
    const parsed = JSON.parse(JSON.stringify(s)) as { utilities: UtilitiesField };
    expect(parsed.utilities.water.capacity, "o JSON devia trazer capacity null para agua").toBeNull();
    expect(parsed.utilities.power.capacity, "o JSON devia trazer capacity null para luz").toBeNull();
  });

  it("o uso bate com a soma manual dos predios", () => {
    // Mesma cidade do primeiro criterio.
    const game = createTestGame({ seed: "avaliacao-livre", scenario: "bairro-basico", days: 30 });
    const s = statsView(game) as unknown as { utilities: UtilitiesField };
    const soma = manualUse(game);

    expect(
      s.utilities.water.used,
      `o uso de agua da visao devia ser a soma dos predios (soma manual = ${soma})`,
    ).toBe(soma);
    expect(
      s.utilities.power.used,
      `o uso de luz da visao devia ser a soma dos predios (soma manual = ${soma})`,
    ).toBe(soma);
  });

  it("a cidade cresce e o uso nao diminui", () => {
    // Mesma semente, so com mais dias: a cidade cresceu, o uso nao pode cair.
    const antes = createTestGame({ seed: "cresce-agua", scenario: "bairro-basico", days: 30 });
    const depois = createTestGame({ seed: "cresce-agua", scenario: "bairro-basico", days: 50 });
    const sAntes = statsView(antes) as unknown as { utilities: UtilitiesField };
    const sDepois = statsView(depois) as unknown as { utilities: UtilitiesField };

    expect(
      sDepois.utilities.water.used >= sAntes.utilities.water.used,
      "com mais dias de cidade, o uso de agua nao devia diminuir",
    ).toBe(true);
    expect(
      sDepois.utilities.power.used >= sAntes.utilities.power.used,
      "com mais dias de cidade, o uso de luz nao devia diminuir",
    ).toBe(true);
    expect(
      (sAntes.utilities.water.capacity as number) >= sAntes.utilities.water.used,
      "no dia 30 a capacidade de agua devia cobrir o uso",
    ).toBe(true);
    expect(
      (sDepois.utilities.water.capacity as number) >= sDepois.utilities.water.used,
      "no dia 50 a capacidade de agua devia cobrir o uso",
    ).toBe(true);
    expect(
      (sAntes.utilities.power.capacity as number) >= sAntes.utilities.power.used,
      "no dia 30 a capacidade de luz devia cobrir o uso",
    ).toBe(true);
    expect(
      (sDepois.utilities.power.capacity as number) >= sDepois.utilities.power.used,
      "no dia 50 a capacidade de luz devia cobrir o uso",
    ).toBe(true);
  });

  it("o relatorio em texto nao quebra", () => {
    // Mesma cidade do primeiro criterio.
    const game = createTestGame({ seed: "avaliacao-livre", scenario: "bairro-basico", days: 30 });
    const texto = reportText(game);

    expect(texto, "o relatorio nao devia mostrar a palavra undefined").not.toContain("undefined");
    expect(texto, "o relatorio nao devia mostrar a palavra NaN").not.toContain("NaN");
  });
});
