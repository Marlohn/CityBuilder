/**
 * Chão do mapa: um plano com uma textura pintada por quadradinho (grama, zonas, lotes).
 * A textura só é repintada quando o mapa muda.
 */
import {
  Color3,
  DynamicTexture,
  Mesh,
  MeshBuilder,
  type Scene,
  StandardMaterial,
  Texture,
} from "@babylonjs/core";
import type { MapView } from "@city/contract";
import { ACCESS_BORDER, ACCESS_ROAD, accessRoadHighlight } from "./accessRoad";

const PX = 4; // pixels por quadradinho

/** Cores (0-255) de cada zona vazia, na ordem de ZONE_KINDS. */
export const ZONE_COLORS: [number, number, number][] = [
  [0, 0, 0],
  [150, 205, 120],
  [95, 175, 110],
  [120, 160, 225],
  [225, 200, 110],
];

export class GroundLayer {
  readonly mesh: Mesh;
  private texture: DynamicTexture | null = null;
  private material: StandardMaterial;
  private width = 0;
  private height = 0;
  /** Destaque da estrada de acesso (recalculado só quando a posição dela muda). */
  private highlight: Uint8Array = new Uint8Array(0);
  private highlightKey = "";

  constructor(private scene: Scene) {
    this.material = new StandardMaterial("ground-mat", scene);
    this.material.specularColor = new Color3(0.02, 0.02, 0.02);
    this.mesh = new Mesh("ground-empty", scene);
  }

  update(map: MapView, occupied: Uint8Array) {
    if (map.width !== this.width || map.height !== this.height) this.rebuild(map.width, map.height);
    this.refreshHighlight(map);
    const tex = this.texture!;
    const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;
    const w = map.width * PX;
    const h = map.height * PX;
    const img = ctx.createImageData(w, h);
    const d = img.data;
    for (let ty = 0; ty < map.height; ty++) {
      for (let tx = 0; tx < map.width; tx++) {
        const i = ty * map.width + tx;
        const noise = ((i * 2654435761) >>> 24) / 255; // variação estável por quadradinho
        let r = 110 + noise * 14;
        let g = 160 + noise * 16;
        let b = 80 + noise * 8;
        let border = false;
        let available = true;
        if (map.water?.[i]) {
          // Água: azul, um pouco mais escuro perto da margem (dá sensação de profundidade).
          const edge =
            (tx > 0 && !map.water[i - 1]) ||
            (tx < map.width - 1 && !map.water[i + 1]) ||
            (ty > 0 && !map.water[i - map.width]) ||
            (ty < map.height - 1 && !map.water[i + map.width]);
          r = edge ? 95 : 60 + noise * 8;
          g = edge ? 150 : 120 + noise * 10;
          b = edge ? 190 : 185 + noise * 10;
          available = false;
        } else if (map.roads[i]) {
          r = g = b = 105;
          available = false;
        } else if (occupied[i]) {
          r = 170;
          g = 170;
          b = 160;
          available = false;
        } else if (map.zones[i]) {
          const c = ZONE_COLORS[map.zones[i]!]!;
          [r, g, b] = c;
          border = true;
          available = false;
        }
        // Estrada de acesso: faixa dourada no chão ao lado da avenida que entra pelo oeste.
        const mark = this.highlight[i] ?? 0;
        if (mark === ACCESS_BORDER && available) {
          r = 224 + noise * 12;
          g = 182 + noise * 12;
          b = 84;
        }
        for (let py = 0; py < PX; py++) {
          for (let px = 0; px < PX; px++) {
            const edge = border && (px === 0 || py === 0);
            // Borda dourada dentro do quadradinho da avenida (a via é coberta pelo modelo 3D).
            const roadEdge = mark === ACCESS_ROAD && (py === 0 || py === PX - 1);
            const k = ((ty * PX + py) * w + (tx * PX + px)) * 4;
            d[k] = edge ? r * 0.8 : roadEdge ? 244 : r;
            d[k + 1] = edge ? g * 0.8 : roadEdge ? 208 : g;
            d[k + 2] = edge ? b * 0.8 : roadEdge ? 96 : b;
            d[k + 3] = 255;
          }
        }
      }
    }
    ctx.putImageData(img, 0, 0);
    tex.update(false);
  }

  private refreshHighlight(map: MapView) {
    const a = map.accessRoad;
    const key = a ? `${map.width}x${map.height}:${a.x0},${a.y0},${a.x1},${a.y1}` : "";
    if (key === this.highlightKey) return;
    this.highlightKey = key;
    this.highlight = accessRoadHighlight(a, map.width, map.height);
  }

  private rebuild(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.mesh.dispose();
    const plane = MeshBuilder.CreateGround("ground", { width, height, subdivisions: 1 }, this.scene);
    plane.position.set(width / 2, 0, height / 2);
    plane.receiveShadows = true;
    plane.isPickable = false;
    this.texture?.dispose();
    this.texture = new DynamicTexture(
      "ground-tex",
      { width: width * PX, height: height * PX },
      this.scene,
      false,
      Texture.NEAREST_SAMPLINGMODE,
    );
    this.texture.wrapU = Texture.CLAMP_ADDRESSMODE;
    this.texture.wrapV = Texture.CLAMP_ADDRESSMODE;
    // A linha 0 do canvas é y = 0 (Z pequeno). Conferido com print: não precisa inverter V.
    this.material.diffuseTexture = this.texture;
    plane.material = this.material;
    (this as { mesh: Mesh }).mesh = plane;
  }
}
