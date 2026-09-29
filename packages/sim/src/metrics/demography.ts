/**
 * Contadores demográficos por ano (para o placar de realismo): mortes e pessoas-ano por idade,
 * nascimentos por idade da mãe, idade ao casar, divórcios.
 */

const MAX_AGE = 111;

export interface YearDemography {
  /** [sexo][idade] */
  deaths: [Float64Array, Float64Array];
  exposure: [Float64Array, Float64Array];
  birthsByMotherAge: Float64Array;
  births: number;
  infantDeaths: number;
  marriageAgeSum: [number, number];
  marriageCount: [number, number];
  divorces: number;
  adults20plusYears: number;
}

function emptyYear(): YearDemography {
  return {
    deaths: [new Float64Array(MAX_AGE), new Float64Array(MAX_AGE)],
    exposure: [new Float64Array(MAX_AGE), new Float64Array(MAX_AGE)],
    birthsByMotherAge: new Float64Array(MAX_AGE),
    births: 0,
    infantDeaths: 0,
    marriageAgeSum: [0, 0],
    marriageCount: [0, 0],
    divorces: 0,
    adults20plusYears: 0,
  };
}

export class Demography {
  current = emptyYear();
  history: YearDemography[] = [];

  constructor(private windowYears: number) {}

  /** Uma pessoa viveu mais um ano (chamado no aniversário). */
  exposed(sex: number, age: number) {
    const a = Math.min(age, MAX_AGE - 1);
    this.current.exposure[sex as 0 | 1]![a]!++;
    if (age >= 20) this.current.adults20plusYears++;
  }

  death(sex: number, age: number) {
    const a = Math.min(age, MAX_AGE - 1);
    this.current.deaths[sex as 0 | 1]![a]!++;
    // Quem morre também viveu parte do ano: conta meio ano de exposição.
    this.current.exposure[sex as 0 | 1]![a]! += 0.5;
    if (age === 0) this.current.infantDeaths++;
  }

  birth(motherAge: number) {
    this.current.births++;
    this.current.birthsByMotherAge[Math.min(motherAge, MAX_AGE - 1)]!++;
  }

  firstMarriage(sex: number, age: number) {
    this.current.marriageAgeSum[sex as 0 | 1] += age;
    this.current.marriageCount[sex as 0 | 1]++;
  }

  divorce() {
    this.current.divorces++;
  }

  closeYear() {
    this.history.push(this.current);
    if (this.history.length > this.windowYears) this.history.shift();
    this.current = emptyYear();
  }

  /** Soma dos anos da janela. */
  window(): YearDemography {
    const s = emptyYear();
    for (const y of this.history) {
      for (const sex of [0, 1] as const) {
        for (let a = 0; a < MAX_AGE; a++) {
          s.deaths[sex][a]! += y.deaths[sex][a]!;
          s.exposure[sex][a]! += y.exposure[sex][a]!;
        }
        s.marriageAgeSum[sex] += y.marriageAgeSum[sex];
        s.marriageCount[sex] += y.marriageCount[sex];
      }
      for (let a = 0; a < MAX_AGE; a++) s.birthsByMotherAge[a]! += y.birthsByMotherAge[a]!;
      s.births += y.births;
      s.infantDeaths += y.infantDeaths;
      s.divorces += y.divorces;
      s.adults20plusYears += y.adults20plusYears;
    }
    return s;
  }
}
