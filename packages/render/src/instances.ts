/**
 * Ajuda a montar buffers de matrizes para thin instances.
 */
import { Matrix, type Mesh, Quaternion, Vector3 } from "@babylonjs/core";

const tmpM = new Matrix();
const tmpQ = new Quaternion();
const tmpS = new Vector3();
const tmpT = new Vector3();

export interface BatchStats {
  chunks: number;
  batches: number;
  instances: number;
  visibleChunks: number;
  visibleBatches: number;
  visibleInstances: number;
  bufferUpdates: number;
}

export class InstanceBatch {
  private data = new Float32Array(16 * 64);
  private appliedData = new Float32Array(0);
  private appliedCount = 0;
  bufferUpdates = 0;
  count = 0;

  reset() {
    this.count = 0;
  }

  push(x: number, y: number, z: number, rotY: number, sx: number, sy: number, sz: number) {
    if ((this.count + 1) * 16 > this.data.length) {
      const bigger = new Float32Array(this.data.length * 2);
      bigger.set(this.data);
      this.data = bigger;
    }
    Quaternion.RotationYawPitchRollToRef(rotY, 0, 0, tmpQ);
    tmpS.set(sx, sy, sz);
    tmpT.set(x, y, z);
    Matrix.ComposeToRef(tmpS, tmpQ, tmpT, tmpM);
    tmpM.copyToArray(this.data, this.count * 16);
    this.count++;
  }

  /** Envia somente quando o conteúdo mudou; chunks estáticos não refazem o buffer a cada update. */
  apply(mesh: Mesh) {
    if (this.count === 0) {
      const changed = this.appliedCount !== 0;
      mesh.thinInstanceCount = 0;
      mesh.isVisible = false;
      this.appliedCount = 0;
      if (changed) this.bufferUpdates++;
      return changed;
    }

    mesh.isVisible = true;
    const length = this.count * 16;
    if (this.appliedCount === this.count && this.matchesApplied(length)) return false;

    mesh.thinInstanceSetBuffer("matrix", this.data.subarray(0, length), 16, false);
    mesh.thinInstanceRefreshBoundingInfo(true);
    if (this.appliedData.length < length) this.appliedData = new Float32Array(length);
    this.appliedData.set(this.data.subarray(0, length), 0);
    this.appliedCount = this.count;
    this.bufferUpdates++;
    return true;
  }

  private matchesApplied(length: number): boolean {
    for (let i = 0; i < length; i++) {
      if (this.data[i] !== this.appliedData[i]) return false;
    }
    return true;
  }
}

/** Um lote por modelo. Mantido para o renderer padrão. */
export class BatchSet {
  private batches = new Map<string, InstanceBatch>();

  get(model: string): InstanceBatch {
    let b = this.batches.get(model);
    if (!b) {
      b = new InstanceBatch();
      this.batches.set(model, b);
    }
    return b;
  }

  resetAll() {
    for (const b of this.batches.values()) b.reset();
  }

  applyAll(meshFor: (model: string) => Mesh) {
    for (const [model, b] of this.batches) b.apply(meshFor(model));
  }
}

interface ChunkBatch {
  model: string;
  chunkX: number;
  chunkY: number;
  batch: InstanceBatch;
  mesh: Mesh | null;
}

/**
 * Batching espacial: cada combinação chunk + modelo recebe uma malha-fonte própria.
 * Assim o bounding box das thin instances fica limitado ao chunk e o frustum culling
 * não mantém a cidade inteira ativa só porque um modelo aparece em muitos lugares.
 */
export class ChunkedBatchSet {
  private batches = new Map<string, ChunkBatch>();

  constructor(
    private readonly chunkSize: number,
    private readonly sourceFor: (model: string) => Mesh,
    private readonly configureMesh?: (mesh: Mesh, model: string) => void,
  ) {}

  get(model: string, x: number, z: number): InstanceBatch {
    const chunkX = Math.floor(x / this.chunkSize);
    const chunkY = Math.floor(z / this.chunkSize);
    const key = `${chunkX}:${chunkY}:${model}`;
    let entry = this.batches.get(key);
    if (!entry) {
      entry = { model, chunkX, chunkY, batch: new InstanceBatch(), mesh: null };
      this.batches.set(key, entry);
    }
    return entry.batch;
  }

  resetAll() {
    for (const entry of this.batches.values()) entry.batch.reset();
  }

  applyAll() {
    for (const entry of this.batches.values()) {
      if (entry.batch.count === 0) {
        if (entry.mesh) entry.batch.apply(entry.mesh);
        continue;
      }
      if (!entry.mesh) entry.mesh = this.createMesh(entry);
      entry.batch.apply(entry.mesh);
    }
  }

  stats(activeMeshNames?: ReadonlySet<string>): BatchStats {
    const chunks = new Set<string>();
    const visibleChunks = new Set<string>();
    let batches = 0;
    let instances = 0;
    let visibleBatches = 0;
    let visibleInstances = 0;
    let bufferUpdates = 0;

    for (const entry of this.batches.values()) {
      if (entry.batch.count === 0) continue;
      batches++;
      instances += entry.batch.count;
      bufferUpdates += entry.batch.bufferUpdates;
      const chunk = `${entry.chunkX}:${entry.chunkY}`;
      chunks.add(chunk);
      if (entry.mesh && activeMeshNames?.has(entry.mesh.name)) {
        visibleBatches++;
        visibleInstances += entry.batch.count;
        visibleChunks.add(chunk);
      }
    }

    return {
      chunks: chunks.size,
      batches,
      instances,
      visibleChunks: visibleChunks.size,
      visibleBatches,
      visibleInstances,
      bufferUpdates,
    };
  }

  private createMesh(entry: ChunkBatch): Mesh {
    const source = this.sourceFor(entry.model);
    const name = `poc-v4-chunk/${entry.chunkX}/${entry.chunkY}/${entry.model}`;
    const mesh = source.clone(name, null, true);
    if (!mesh) throw new Error(`não consegui criar batch espacial de ${entry.model}`);
    mesh.isPickable = false;
    mesh.alwaysSelectAsActiveMesh = false;
    mesh.thinInstanceCount = 0;
    this.configureMesh?.(mesh, entry.model);
    return mesh;
  }
}
