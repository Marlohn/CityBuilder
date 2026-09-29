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

  constructor(private scene: Scene) {
    this.material = new StandardMaterial("ground-mat", scene);
    this.material.specularColor = new Color3(0.02, 0.02, 0.02);
    this.mesh = new Mesh("ground-empty", scene);
  }

  update(map: MapView, occupied: Uint8Array) {
    if (map.width !== this.width || map.height !== this.height) this.rebuild(map.width, map.height);
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
        if (map.roads[i]) {
          r = g = b = 105;
        } else if (occupied[i]) {
          r = 170;
          g = 170;
          b = 160;
        } else if (map.zones[i]) {
          const c = ZONE_COLORS[map.zones[i]!]!;
          [r, g, b] = c;
          border = true;
        }
        for (let py = 0; py < PX; py++) {
          for (let px = 0; px < PX; px++) {
            const edge = border && (px === 0 || py === 0);
            const k = ((ty * PX + py) * w + (tx * PX + px)) * 4;
            d[k] = edge ? r * 0.8 : r;
            d[k + 1] = edge ? g * 0.8 : g;
            d[k + 2] = edge ? b * 0.8 : b;
            d[k + 3] = 255;
          }
        }
      }
    }
    ctx.putImageData(img, 0, 0);
    tex.update(false);
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
