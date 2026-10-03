/**
 * Destaque da estrada de acesso (a avenida que entra pelo oeste e liga a cidade ao resto do país).
 * Conta pura, sem Babylon, para o chão pintar o mapa e para o teste conferir.
 */
import type { TileRect } from "@city/contract";

/** Quadradinho dentro da própria avenida. */
export const ACCESS_ROAD = 1;
/** Quadradinho da faixa ao lado da avenida (o modelo 3D da via cobre o dela, então o aviso vai na vizinhança). */
export const ACCESS_BORDER = 2;

/**
 * Marca do destaque: 1 nos quadradinhos da avenida de acesso e 2 na faixa logo acima e logo abaixo
 * dela (também onde houver via, para o destaque ficar inteiro mesmo com rua encostando).
 */
export function accessRoadHighlight(
  rect: TileRect | null | undefined,
  width: number,
  height: number,
): Uint8Array {
  const mask = new Uint8Array(width * height);
  if (!rect) return mask;
  const ax = Math.max(0, Math.min(rect.x0, rect.x1));
  const bx = Math.min(width - 1, Math.max(rect.x0, rect.x1));
  const ay = Math.max(0, Math.min(rect.y0, rect.y1));
  const by = Math.min(height - 1, Math.max(rect.y0, rect.y1));
  for (let y = ay; y <= by; y++) {
    for (let x = ax; x <= bx; x++) mask[y * width + x] = ACCESS_ROAD;
  }
  for (const y of [ay - 1, by + 1]) {
    if (y < 0 || y >= height) continue;
    for (let x = ax; x <= bx; x++) mask[y * width + x] = ACCESS_BORDER;
  }
  return mask;
}