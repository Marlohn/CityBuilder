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

export interface TileRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
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
    this.ensure(this.count + 1);
    Quaternion.RotationYawPitchRollToRef(rotY, 0, 0, tmpQ);
    tmpS.set(sx, sy, sz);
    tmpT.set(x, y, z);
    Matrix.ComposeToRef(tmpS, tmpQ, tmpT, tmpM);
    tmpM.copyToArray(this.data, this.count * 16);
    this.count++;
  }

  append(other: InstanceBatch) {
    if (other.count === 0) return;
    const start = this.count * 16;
    const length = other.count * 16;
    this.ensure(this.count + other.count);
    this.data.set(other.data.subarray(0, length), start);
    this.count += other.count;
  }

  /** Envia somente quando o conteúdo mudou; batches estáticos não refazem o buffer sem necessidade. */
  apply(mesh: Mesh, refreshBounds = true) {
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
    if (refreshBounds) mesh.thinInstanceRefreshBoundingInfo(true);
    if (this.appliedData.length < length) this.appliedData = new Float32Array(length);
    this.appliedData.set(this.data.subarray(0, length), 0);
    this.appliedCount = this.count;
    this.bufferUpdates++;
    return true;
  }

  private ensure(count: number) {
    const needed = count * 16;
    if (needed <= this.data.length) return;
    let length = this.data.length;
    while (length < needed) length *= 2;
    const bigger = new Float32Array(length);
    bigger.set(this.data);
    this.data = bigger;
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
}

/**
 * Armazena matrizes estaticamente por chunk, mas compacta somente os chunks visíveis
 * em um único buffer GPU por modelo.
 *
 * Babylon mantém buffers de thin instances na Geometry; clones compartilham Geometry e,
 * portanto, sobrescrevem os buffers uns dos outros. Esta estratégia preserva uma única
 * Geometry/mesh por GLB e ainda faz o custo GPU acompanhar a janela espacial visível.
 */
export class ChunkedBatchSet {
  private readonly batches = new Map<string, ChunkBatch>();
  private readonly renderBatches = new Map<string, InstanceBatch>();
  private readonly configuredModels = new Set<string>();
  private visibleChunkKeys = new Set<string>();
  private dirtyModels = new Set<string>();

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
      entry = { model, chunkX, chunkY, batch: new InstanceBatch() };
      this.batches.set(key, entry);
    }
    return entry.batch;
  }

  resetAll() {
    for (const entry of this.batches.values()) {
      if (entry.batch.count > 0) this.dirtyModels.add(entry.model);
      entry.batch.reset();
    }
  }

  resetChunks(chunks: ReadonlySet<string>) {
    for (const entry of this.batches.values()) {
      if (!chunks.has(this.chunkKey(entry.chunkX, entry.chunkY))) continue;
      if (entry.batch.count > 0) this.dirtyModels.add(entry.model);
      entry.batch.reset();
    }
  }

  /**
   * Marca as mudanças concluídas. Se atingem chunks visíveis, atualiza apenas os modelos afetados.
   */
  applyAll() {
    for (const entry of this.batches.values()) this.dirtyModels.add(entry.model);
    this.flushDirtyVisible();
  }

  applyChunks(chunks: ReadonlySet<string>) {
    for (const entry of this.batches.values()) {
      if (chunks.has(this.chunkKey(entry.chunkX, entry.chunkY))) this.dirtyModels.add(entry.model);
    }
    this.flushDirtyVisible();
  }

  /**
   * Atualiza a janela espacial. Só recompõe buffers quando a câmera atravessa fronteiras de chunk.
   * Uma margem de 1 chunk evita popping nas bordas do frustum aproximado.
   */
  setVisibleRect(rect: TileRect) {
    const minX = Math.floor(Math.min(rect.x0, rect.x1) / this.chunkSize) - 1;
    const maxX = Math.floor(Math.max(rect.x0, rect.x1) / this.chunkSize) + 1;
    const minY = Math.floor(Math.min(rect.y0, rect.y1) / this.chunkSize) - 1;
    const maxY = Math.floor(Math.max(rect.y0, rect.y1) / this.chunkSize) + 1;
    const next = new Set<string>();

    for (const entry of this.batches.values()) {
      if (entry.batch.count === 0) continue;
      if (entry.chunkX < minX || entry.chunkX > maxX || entry.chunkY < minY || entry.chunkY > maxY) continue;
      next.add(this.chunkKey(entry.chunkX, entry.chunkY));
    }

    if (this.sameSet(next, this.visibleChunkKeys)) {
      this.flushDirtyVisible();
      return;
    }

    this.visibleChunkKeys = next;
    for (const entry of this.batches.values()) this.dirtyModels.add(entry.model);
    this.flushDirtyVisible();
  }

  stats(): BatchStats {
    const chunks = new Set<string>();
    const visibleChunks = new Set<string>();
    let batches = 0;
    let instances = 0;
    let visibleBatches = 0;
    let visibleInstances = 0;

    for (const entry of this.batches.values()) {
      if (entry.batch.count === 0) continue;
      const chunk = this.chunkKey(entry.chunkX, entry.chunkY);
      batches++;
      instances += entry.batch.count;
      chunks.add(chunk);
      if (this.visibleChunkKeys.has(chunk)) {
        visibleBatches++;
        visibleInstances += entry.batch.count;
        visibleChunks.add(chunk);
      }
    }

    let bufferUpdates = 0;
    for (const batch of this.renderBatches.values()) bufferUpdates += batch.bufferUpdates;

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

  private flushDirtyVisible() {
    if (this.dirtyModels.size === 0) return;
    for (const model of this.dirtyModels) this.rebuildModel(model);
    this.dirtyModels.clear();
  }

  private rebuildModel(model: string) {
    let render = this.renderBatches.get(model);
    if (!render) {
      render = new InstanceBatch();
      this.renderBatches.set(model, render);
    }
    render.reset();

    for (const entry of this.batches.values()) {
      if (entry.model !== model || entry.batch.count === 0) continue;
      if (!this.visibleChunkKeys.has(this.chunkKey(entry.chunkX, entry.chunkY))) continue;
      render.append(entry.batch);
    }

    const mesh = this.sourceFor(model);
    if (!this.configuredModels.has(model)) {
      mesh.isPickable = false;
      mesh.alwaysSelectAsActiveMesh = false;
      this.configureMesh?.(mesh, model);
      this.configuredModels.add(model);
    }
    render.apply(mesh, true);
  }

  private chunkKey(x: number, y: number): string {
    return `${x}:${y}`;
  }

  private sameSet(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
    if (a.size !== b.size) return false;
    for (const key of a) if (!b.has(key)) return false;
    return true;
  }
}
