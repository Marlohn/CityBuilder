/** O prefeito automático cresce a cidade com rio e lagos no mapa sem construir na água (issue #16). */
import { loadConfigAndData, runGame } from "@city/cli";
import { checkInvariants, statsView } from "@city/sim";
import { describe, expect, it } from "vitest";

describe("prefeito automático com água no mapa", () => {
  it("20 dias no modo livre: cidade cresce, nada na água, nenhuma regra quebrada", () => {
    const { config, data } = loadConfigAndData({ economy: { mode: "sandbox" } });
    const game = runGame({ config, data, seed: "rio-prefeito", days: 20, bot: true });
    const w = game.sim.world;
    let onWater = 0;
    for (let i = 0; i < w.size; i++) if (w.water[i] && (w.buildingAt[i]! >= 0 || w.roads[i])) onWater++;
    expect(onWater).toBe(0);
    expect(statsView(game).population).toBeGreaterThan(1000);
    expect(checkInvariants(game.city)).toEqual([]);
  });
});
