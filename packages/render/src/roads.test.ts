import { describe, expect, it } from "vitest";
import { roadPieceFor } from "./roads";

const N = 1;
const E = 2;
const S = 4;
const W = 8;

describe("roadPieceFor", () => {
  it("reta leste-oeste não gira; norte-sul gira", () => {
    expect(roadPieceFor(E | W)).toEqual({ piece: "straight", quarterTurns: 0 });
    expect(roadPieceFor(N | S).piece).toBe("straight");
    expect(roadPieceFor(N | S).quarterTurns % 2).toBe(1);
  });
  it("curvas nos quatro cantos", () => {
    for (const m of [N | E, E | S, S | W, W | N]) expect(roadPieceFor(m).piece).toBe("bend");
    expect(roadPieceFor(E | S)).toEqual({ piece: "bend", quarterTurns: 0 });
  });
  it("T e cruzamento", () => {
    expect(roadPieceFor(E | S | W)).toEqual({ piece: "intersection", quarterTurns: 0 });
    expect(roadPieceFor(N | E | S).piece).toBe("intersection");
    expect(roadPieceFor(N | E | S | W).piece).toBe("crossroad");
  });
  it("final de via e via solta", () => {
    expect(roadPieceFor(W)).toEqual({ piece: "end", quarterTurns: 0 });
    expect(roadPieceFor(N).piece).toBe("end");
    expect(roadPieceFor(0).piece).toBe("square");
  });
  it("toda máscara tem uma peça", () => {
    for (let m = 0; m < 16; m++) expect(roadPieceFor(m).piece).toBeTruthy();
  });
});
