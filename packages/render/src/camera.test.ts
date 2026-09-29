import { describe, expect, it } from "vitest";
import { pickTile, rayBox, rayGround, screenAxesOnGround } from "./camera";

describe("clique e câmera (contas)", () => {
  const o = { x: 0, y: 10, z: 0 };
  const d = { x: 1, y: -1, z: 1 };

  it("raio encosta no chão", () => {
    expect(rayGround(o, d)).toEqual({ x: 10, z: 10 });
    expect(rayGround(o, { x: 1, y: 0, z: 0 })).toBeNull();
  });

  it("raio contra caixa", () => {
    expect(rayBox(o, d, { x: 5, y: 0, z: 5 }, { x: 6, y: 6, z: 6 })).toBeCloseTo(5);
    expect(rayBox(o, d, { x: 50, y: 0, z: 0 }, { x: 51, y: 1, z: 1 })).toBeNull();
  });

  it("clique no corpo do prédio pega o prédio, não o chão atrás", () => {
    // Prédio alto em (5..6, 5..6): o raio o atravessa antes de chegar ao chão em (10, 10).
    const hit = pickTile(o, d, [{ x: 5, y: 5, w: 1, h: 1, height: 6 }]);
    expect(hit).toEqual({ x: 5, y: 5, box: 0 });
    // Sem prédio no caminho: o chão.
    expect(pickTile(o, d, [{ x: 30, y: 30, w: 1, h: 1, height: 6 }])).toEqual({ x: 10, y: 10, box: -1 });
  });

  it("eixos da tela no chão são perpendiculares e unitários", () => {
    for (const a of [0, 0.7, -2.3]) {
      const { up, right } = screenAxesOnGround(a);
      expect(up.x * right.x + up.z * right.z).toBeCloseTo(0);
      expect(Math.hypot(up.x, up.z)).toBeCloseTo(1);
    }
  });
});
