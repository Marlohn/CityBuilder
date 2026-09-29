/**
 * EXEMPLO de teste de aceitação (modelo para o QA copiar).
 * Tarefa fictícia: "com a avenida inicial e uma área residencial, famílias chegam de fora".
 * Um `it` por critério do "tá pronto quando", semente fixa, mensagem de erro em português.
 */
import { checkInvariants, statsView } from "@city/sim";
import { describe, expect, it } from "vitest";
import { createTestGame } from "../helpers";

describe("exemplo: a cidade começa a crescer", () => {
  const game = createTestGame({
    seed: "aceitacao-exemplo",
    overrides: { world: { width: 128, height: 128 } },
    days: 3,
    commands: [
      { type: "buildRoad", kind: "street", x0: 30, y0: 52, x1: 30, y1: 64 },
      { type: "zone", zone: "residential_low", x0: 31, y0: 52, x1: 32, y1: 63 },
      { type: "zone", zone: "commercial", x0: 28, y0: 52, x1: 29, y1: 63 },
    ],
  });

  it("famílias chegam de fora do mapa", () => {
    const s = statsView(game);
    expect(
      s.population,
      "ninguém chegou: veja npm run sim -- report --seed=aceitacao-exemplo",
    ).toBeGreaterThan(0);
  });

  it("ninguém surge do nada (regras que nunca podem quebrar)", () => {
    expect(checkInvariants(game.city)).toEqual([]);
  });
});
