/**
 * Escolhe a peça de via (modelo Kenney) e a rotação a partir dos vizinhos.
 * Direções do mapa: 0 norte (y-1), 1 leste (x+1), 2 sul (y+1), 3 oeste (x-1).
 * No mundo 3D: leste = +X, sul = +Z. Girar k x 90° leva a direção d para (d - k) mod 4.
 */

export type RoadPiece = "straight" | "bend" | "intersection" | "crossroad" | "end" | "square";

/** Ligações de cada peça na rotação 0 (medido renderizando os modelos vistos de cima). */
const BASE: Record<Exclude<RoadPiece, "crossroad" | "square">, number[]> = {
  straight: [1, 3],
  bend: [1, 2],
  intersection: [1, 2, 3],
  end: [3],
};

export const PIECE_MODEL: Record<RoadPiece, string> = {
  straight: "roads/road-straight",
  bend: "roads/road-bend",
  intersection: "roads/road-intersection",
  crossroad: "roads/road-crossroad",
  end: "roads/road-end-round",
  square: "roads/road-square",
};

function maskOf(dirs: number[]): number {
  return dirs.reduce((m, d) => m | (1 << d), 0);
}

function rotateMask(dirs: number[], k: number): number {
  return maskOf(dirs.map((d) => (((d - k) % 4) + 4) % 4));
}

/** Máscara de vizinhos (bit d ligado = tem via na direção d) -> peça e número de quartos de volta. */
export function roadPieceFor(mask: number): { piece: RoadPiece; quarterTurns: number } {
  const n = ((mask & 1) + ((mask >> 1) & 1) + ((mask >> 2) & 1) + ((mask >> 3) & 1)) as 0 | 1 | 2 | 3 | 4;
  if (n === 0) return { piece: "square", quarterTurns: 0 };
  if (n === 4) return { piece: "crossroad", quarterTurns: 0 };
  const candidates: (keyof typeof BASE)[] =
    n === 1
      ? ["end"]
      : n === 3
        ? ["intersection"]
        : (mask & 5) === 5 || (mask & 10) === 10
          ? ["straight"]
          : ["bend"];
  for (const piece of candidates) {
    for (let k = 0; k < 4; k++) {
      if (rotateMask(BASE[piece], k) === mask) return { piece, quarterTurns: k };
    }
  }
  return { piece: "square", quarterTurns: 0 };
}
