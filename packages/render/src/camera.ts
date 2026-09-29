/**
 * Contas da câmera e do clique, sem Babylon (testáveis sem navegador).
 * Coordenadas do mundo: x e z no chão (1 unidade = 1 quadradinho), y para cima.
 */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** Ponto onde o raio encosta no chão (y = 0), ou null se o raio for paralelo ao chão. */
export function rayGround(o: Vec3, d: Vec3): { x: number; z: number } | null {
  if (Math.abs(d.y) < 1e-9) return null;
  const t = -o.y / d.y;
  if (t < 0) return null;
  return { x: o.x + d.x * t, z: o.z + d.z * t };
}

/**
 * Raio contra caixa alinhada aos eixos (método das "fatias"). Devolve a distância até a entrada
 * na caixa, ou null se não encosta.
 */
export function rayBox(o: Vec3, d: Vec3, min: Vec3, max: Vec3): number | null {
  let tmin = -Infinity;
  let tmax = Infinity;
  for (const k of ["x", "y", "z"] as const) {
    if (Math.abs(d[k]) < 1e-12) {
      if (o[k] < min[k] || o[k] > max[k]) return null;
      continue;
    }
    const t1 = (min[k] - o[k]) / d[k];
    const t2 = (max[k] - o[k]) / d[k];
    tmin = Math.max(tmin, Math.min(t1, t2));
    tmax = Math.min(tmax, Math.max(t1, t2));
  }
  if (tmax < Math.max(tmin, 0)) return null;
  return Math.max(tmin, 0);
}

export interface PickBox {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Altura desenhada (em quadradinhos). */
  height: number;
}

/**
 * O que o clique acerta: primeiro o prédio mais perto da câmera que o raio atravessa, senão o chão.
 * Devolve o quadradinho do mapa (o do prédio atingido, se for um prédio).
 */
export function pickTile(
  o: Vec3,
  d: Vec3,
  boxes: readonly PickBox[],
): { x: number; y: number; box: number } | null {
  let best = Infinity;
  let hit = -1;
  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i]!;
    const t = rayBox(o, d, { x: b.x, y: 0, z: b.y }, { x: b.x + b.w, y: b.height, z: b.y + b.h });
    if (t !== null && t < best) {
      best = t;
      hit = i;
    }
  }
  if (hit >= 0) {
    const b = boxes[hit]!;
    const px = o.x + d.x * best;
    const pz = o.z + d.z * best;
    return {
      x: Math.min(b.x + b.w - 1, Math.max(b.x, Math.floor(px))),
      y: Math.min(b.y + b.h - 1, Math.max(b.y, Math.floor(pz))),
      box: hit,
    };
  }
  const g = rayGround(o, d);
  return g ? { x: Math.floor(g.x), y: Math.floor(g.z), box: -1 } : null;
}

/**
 * Direções da tela projetadas no chão para uma câmera que olha para o alvo com o ângulo `alpha`
 * (convenção da ArcRotateCamera: a câmera fica em alvo + raio·(cos α·sen β, cos β, sen α·sen β)).
 * "up" = para cima na tela (W), "right" = para a direita na tela (D).
 */
export function screenAxesOnGround(alpha: number): {
  up: { x: number; z: number };
  right: { x: number; z: number };
} {
  // A câmera olha do ponto (cos α, sen α) para o alvo: "para frente" no chão é o oposto disso.
  const up = { x: -Math.cos(alpha), z: -Math.sin(alpha) };
  // Direita na tela = "para frente" girado 90° (conferido no navegador pelo teste tests/e2e/camera.spec.ts).
  const right = { x: up.z, z: -up.x };
  return { up, right };
}
