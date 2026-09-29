/** Arrays numéricos que crescem sozinhos (dobram de tamanho quando enchem). */

type TypedArray =
  | Int8Array
  | Uint8Array
  | Int16Array
  | Uint16Array
  | Int32Array
  | Uint32Array
  | Float32Array
  | Float64Array;

export function growTo<T extends TypedArray>(arr: T, minLength: number, fill = 0): T {
  if (arr.length >= minLength) return arr;
  let len = Math.max(16, arr.length);
  while (len < minLength) len *= 2;
  const Ctor = arr.constructor as new (n: number) => T;
  const out = new Ctor(len);
  out.set(arr);
  if (fill !== 0) out.fill(fill, arr.length);
  return out;
}
