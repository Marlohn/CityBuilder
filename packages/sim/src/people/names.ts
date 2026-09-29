/** Sorteia nomes brasileiros com a mesma frequência do Censo (IBGE). */
import type { NamesData } from "../config/schema";
import type { Rng } from "../core/rng";

function cumulative(list: [string, number][]): Float64Array {
  const out = new Float64Array(list.length);
  let s = 0;
  for (let i = 0; i < list.length; i++) {
    s += list[i]![1];
    out[i] = s;
  }
  return out;
}

export class NamePicker {
  private cumF: Float64Array;
  private cumM: Float64Array;
  private cumS: Float64Array;

  constructor(readonly data: NamesData) {
    this.cumF = cumulative(data.female);
    this.cumM = cumulative(data.male);
    this.cumS = cumulative(data.surnames);
  }

  first(rng: Rng, male: boolean): number {
    return rng.pickCumulative(male ? this.cumM : this.cumF);
  }

  surname(rng: Rng): number {
    return rng.pickCumulative(this.cumS);
  }

  fullName(male: boolean, first: number, a: number, b: number): string {
    const f = (male ? this.data.male : this.data.female)[first]?.[0] ?? "?";
    const sa = this.data.surnames[a]?.[0] ?? "";
    const sb = this.data.surnames[b]?.[0] ?? "";
    return sa === sb ? `${f} ${sa}` : `${f} ${sa} ${sb}`;
  }
}
