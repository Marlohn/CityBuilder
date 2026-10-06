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

export interface TilePoint {
  x: number;
  y: number;
}

function pointInPolygon(point: TilePoint, polygon: readonly TilePoint[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]!;
    const b = polygon[j]!;
    const crosses =
      (a.y > point.y) !== (b.y > point.y) &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x;
    if (crosses) inside = !inside;
  }
  return inside;
}

function orientation(a: TilePoint, b: TilePoint, c: TilePoint): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function onSegment(a: TilePoint, b: TilePoint, p: TilePoint): boolean {
  const eps = 1e-6;
  return (
    Math.abs(orientation(a, b, p)) <= eps &&
    p.x >= Math.min(a.x, b.x) - eps &&
    p.x <= Math.max(a.x, b.x) + eps &&
    p.y >= Math.min(a.y, b.y) - eps &&
    p.y <= Math.max(a.y, b.y) + eps
  );
}

function segmentsIntersect(a: TilePoint, b: TilePoint, c: TilePoint, d: TilePoint): boolean {
  const abC = orientation(a, b, c);
  const abD = orientation(a, b, d);
  const cdA = orientation(c, d, a);
  const cdB = orientation(c, d, b);
  if ((abC > 0) !== (abD > 0) && (cdA > 0) !== (cdB > 0)) return true;
  return onSegment(a, b, c) || onSegment(a, b, d) || onSegment(c, d, a) || onSegment(c, d, b);
}

function polygonIntersectsRect(
  polygon: readonly TilePoint[],
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): boolean {
  const corners: TilePoint[] = [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
  ];
  if (corners.some((corner) => pointInPolygon(corner, polygon))) return true;
  if (polygon.some((point) => point.x >= x0 && point.x <= x1 && point.y >= y0 && point.y <= y1)) return true;

  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i]!;
    const b = polygon[(i + 1) % polygon.length]!;
    for (let j = 0; j < corners.length; j++) {
      const c = corners[j]!;
      const d = corners[(j + 1) % corners.length]!;
      if (segmentsIntersect(a, b, c, d)) return true;
    }
  }
  return false;
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
  private viewCenterChunkX = 0;
  private viewCenterChunkY = 0;

  constructor(
    private readonly chunkSize: number,
    private readonly sourceFor: (model: string) => Mesh,
    private readonly configureMesh?: (mesh: Mesh, model: string) => void,
    private readonly maxDistanceForModel?: (model: string) => number | undefined,
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
   * Atualiza a janela espacial usando a projeção real do frustum no chão.
   * A margem de meio chunk evita popping sem transformar o frustum em um quadrado gigante.
   */
  setVisiblePolygon(polygon: readonly TilePoint[], center: TilePoint) {
    if (polygon.length < 3) return;
    const xs = polygon.map((point) => point.x);
    const ys = polygon.map((point) => point.y);
    const margin = this.chunkSize * 0.5;
    const minX = Math.floor((Math.min(...xs) - margin) / this.chunkSize);
    const maxX = Math.floor((Math.max(...xs) + margin) / this.chunkSize);
    const minY = Math.floor((Math.min(...ys) - margin) / this.chunkSize);
    const maxY = Math.floor((Math.max(...ys) + margin) / this.chunkSize);
    const next = new Set<string>();
    const tested = new Set<string>();

    for (const entry of this.batches.values()) {
      if (entry.batch.count === 0) continue;
      const chunk = this.chunkKey(entry.chunkX, entry.chunkY);
      if (tested.has(chunk)) continue;
      tested.add(chunk);
      if (entry.chunkX < minX || entry.chunkX > maxX || entry.chunkY < minY || entry.chunkY > maxY) continue;

      const x0 = entry.chunkX * this.chunkSize - margin;
      const y0 = entry.chunkY * this.chunkSize - margin;
      const x1 = (entry.chunkX + 1) * this.chunkSize + margin;
      const y1 = (entry.chunkY + 1) * this.chunkSize + margin;
      if (polygonIntersectsRect(polygon, x0, y0, x1, y1)) next.add(chunk);
    }

    const centerChunkX = Math.floor(center.x / this.chunkSize);
    const centerChunkY = Math.floor(center.y / this.chunkSize);
    const centerChanged = centerChunkX !== this.viewCenterChunkX || centerChunkY !== this.viewCenterChunkY;
    if (this.sameSet(next, this.visibleChunkKeys) && !centerChanged) {
      this.flushDirtyVisible();
      return;
    }

    this.visibleChunkKeys = next;
    this.viewCenterChunkX = centerChunkX;
    this.viewCenterChunkY = centerChunkY;
    for (const entry of this.batches.values()) this.dirtyModels.add(entry.model);
    this.flushDirtyVisible();
  }

  setVisibleRect(rect: TileRect) {
    this.setVisiblePolygon(
      [
        { x: rect.x0, y: rect.y0 },
        { x: rect.x1, y: rect.y0 },
        { x: rect.x1, y: rect.y1 },
        { x: rect.x0, y: rect.y1 },
      ],
      { x: (rect.x0 + rect.x1) / 2, y: (rect.y0 + rect.y1) / 2 },
    );
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
      if (this.isEntryVisible(entry)) {
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
      if (!this.isEntryVisible(entry)) continue;
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

  private isEntryVisible(entry: ChunkBatch): boolean {
    if (!this.visibleChunkKeys.has(this.chunkKey(entry.chunkX, entry.chunkY))) return false;
    const maxDistance = this.maxDistanceForModel?.(entry.model);
    if (maxDistance === undefined) return true;
    const dx = (entry.chunkX - this.viewCenterChunkX) * this.chunkSize;
    const dy = (entry.chunkY - this.viewCenterChunkY) * this.chunkSize;
    const paddedDistance = maxDistance + this.chunkSize;
    return dx * dx + dy * dy <= paddedDistance * paddedDistance;
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
