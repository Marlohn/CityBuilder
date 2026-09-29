/**
 * Carrega modelos GLB (Kenney) e cria uma malha-fonte por modelo, usada com "thin instances"
 * (desenho em lote: milhares de cópias com uma única chamada à placa de vídeo).
 */
import {
  type AbstractMesh,
  Color3,
  LoadAssetContainerAsync,
  Mesh,
  MeshBuilder,
  type Scene,
  StandardMaterial,
  Vector3,
} from "@babylonjs/core";
import "@babylonjs/loaders/glTF";

export interface ModelInfo {
  mesh: Mesh;
  /** Tamanho do modelo original (x, y, z). */
  size: Vector3;
}

export class ModelLibrary {
  private models = new Map<string, ModelInfo>();

  constructor(
    private scene: Scene,
    private baseUrl: string,
  ) {}

  has(name: string): boolean {
    return this.models.has(name);
  }

  get(name: string): ModelInfo {
    const m = this.models.get(name);
    if (!m) throw new Error(`modelo não carregado: ${name}`);
    return m;
  }

  /** Carrega vários modelos em paralelo. Modelos "proc/..." são gerados por código. */
  async load(names: string[]): Promise<void> {
    const unique = [...new Set(names)].filter((n) => !this.models.has(n));
    await Promise.all(
      unique.map(async (name) => {
        const mesh = name.startsWith("proc/") ? this.procedural(name) : await this.loadGlb(name);
        mesh.isPickable = false;
        mesh.alwaysSelectAsActiveMesh = true;
        mesh.thinInstanceCount = 0;
        mesh.refreshBoundingInfo();
        const bb = mesh.getBoundingInfo().boundingBox;
        this.models.set(name, { mesh, size: bb.maximum.subtract(bb.minimum) });
      }),
    );
  }

  private async loadGlb(name: string): Promise<Mesh> {
    const container = await LoadAssetContainerAsync(`${this.baseUrl}/${name}.glb`, this.scene);
    container.addAllToScene();
    const parts = container.meshes.filter((m): m is Mesh => m instanceof Mesh && m.getTotalVertices() > 0);
    for (const p of parts) p.computeWorldMatrix(true);
    const merged = Mesh.MergeMeshes(parts, true, true, undefined, false, true);
    for (const m of container.meshes) if (!m.isDisposed()) m.dispose();
    if (!merged) throw new Error(`não consegui juntar as malhas de ${name}`);
    merged.name = name;
    return merged;
  }

  /** Modelos simples feitos por código (serviços públicos e canteiro de obra). */
  private procedural(name: string): Mesh {
    const s = this.scene;
    const mat = (r: number, g: number, b: number, alpha = 1) => {
      const m = new StandardMaterial(`${name}-mat-${r}-${g}-${b}`, s);
      m.diffuseColor = new Color3(r, g, b);
      m.specularColor = new Color3(0.05, 0.05, 0.05);
      m.alpha = alpha;
      return m;
    };
    const parts: Mesh[] = [];
    const box = (w: number, h: number, d: number, x: number, y: number, z: number, m: StandardMaterial) => {
      const b = MeshBuilder.CreateBox(`${name}-part`, { width: w, height: h, depth: d }, s);
      b.position.set(x, y + h / 2, z);
      b.material = m;
      parts.push(b);
      return b;
    };
    if (name === "proc/school") {
      // Escola térrea em "U" com pátio e quadra (como o projeto padrão do FNDE), 1 x 1 unidade.
      const wall = mat(0.93, 0.86, 0.7);
      const roof = mat(0.55, 0.22, 0.18);
      const court = mat(0.3, 0.55, 0.75);
      box(0.9, 0.16, 0.25, 0, 0, -0.3, wall);
      box(0.25, 0.16, 0.5, -0.33, 0, 0.05, wall);
      box(0.25, 0.16, 0.5, 0.33, 0, 0.05, wall);
      box(0.92, 0.03, 0.27, 0, 0.16, -0.3, roof);
      box(0.27, 0.03, 0.52, -0.33, 0.16, 0.05, roof);
      box(0.27, 0.03, 0.52, 0.33, 0.16, 0.05, roof);
      box(0.34, 0.01, 0.3, 0, 0, 0.25, court);
    } else if (name === "proc/clinic") {
      // UBS: prédio térreo branco com cruz vermelha no teto.
      const wall = mat(0.96, 0.96, 0.96);
      const red = mat(0.85, 0.12, 0.12);
      const trim = mat(0.2, 0.55, 0.35);
      box(0.8, 0.28, 0.6, 0, 0, 0, wall);
      box(0.82, 0.04, 0.62, 0, 0.28, 0, trim);
      box(0.3, 0.02, 0.08, 0, 0.32, 0, red);
      box(0.08, 0.02, 0.3, 0, 0.32, 0, red);
    } else if (name === "proc/construction") {
      // Canteiro de obra: laje, pilares e tapume.
      const concrete = mat(0.7, 0.7, 0.68);
      const fence = mat(0.95, 0.75, 0.2);
      box(0.9, 0.03, 0.9, 0, 0, 0, concrete);
      for (const [x, z] of [
        [-0.35, -0.35],
        [0.35, -0.35],
        [-0.35, 0.35],
        [0.35, 0.35],
      ] as const)
        box(0.05, 0.4, 0.05, x, 0.03, z, concrete);
      box(0.95, 0.12, 0.02, 0, 0, 0.47, fence);
      box(0.95, 0.12, 0.02, 0, 0, -0.47, fence);
    } else if (name.startsWith("proc/person-")) {
      // Pessoa: corpo, cabeça e pernas (1 unidade = altura). Cor da roupa varia.
      const shirts: Record<string, [number, number, number]> = {
        a: [0.85, 0.25, 0.2],
        b: [0.2, 0.45, 0.85],
        c: [0.95, 0.8, 0.2],
        d: [0.3, 0.7, 0.35],
      };
      const [r, g, b] = shirts[name.slice(-1)] ?? [0.8, 0.8, 0.8];
      const skin = mat(0.85, 0.65, 0.5);
      const pants = mat(0.2, 0.22, 0.3);
      box(0.22, 0.45, 0.14, 0, 0, 0, pants);
      box(0.3, 0.35, 0.18, 0, 0.45, 0, mat(r, g, b));
      box(0.18, 0.18, 0.18, 0, 0.82, 0, skin);
    } else {
      box(1, 1, 1, 0, 0, 0, mat(1, 0, 1));
    }
    const merged = Mesh.MergeMeshes(parts, true, true, undefined, false, true);
    if (!merged) throw new Error(`falha ao criar ${name}`);
    merged.name = name;
    return merged;
  }

  all(): AbstractMesh[] {
    return [...this.models.values()].map((m) => m.mesh);
  }
}

export { Vector3 };
