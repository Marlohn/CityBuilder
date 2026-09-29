/**
 * Ajuda a montar buffers de matrizes para thin instances.
 */
import { Matrix, type Mesh, Quaternion, Vector3 } from "@babylonjs/core";

const tmpM = new Matrix();
const tmpQ = new Quaternion();
const tmpS = new Vector3();
const tmpT = new Vector3();

export class InstanceBatch {
  private data = new Float32Array(16 * 64);
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

  /** Envia para a malha. */
  apply(mesh: Mesh) {
    if (this.count === 0) {
      mesh.thinInstanceCount = 0;
      mesh.isVisible = false;
      return;
    }
    mesh.isVisible = true;
    mesh.thinInstanceSetBuffer("matrix", this.data.subarray(0, this.count * 16), 16, false);
  }
}

/** Um lote por modelo. */
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
