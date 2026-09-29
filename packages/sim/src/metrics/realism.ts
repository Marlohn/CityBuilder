/**
 * Placar de realismo: calcula indicadores da cidade e compara com faixas reais (config/realism.yaml).
 * Fora da faixa = alerta (vira sinal para o roadmap).
 */
import type { RealismItem } from "@city/contract";
import type { City } from "../city";
import type { Census } from "../people/census";
import type { Demography, YearDemography } from "./demography";

/** Expectativa de vida ao nascer a partir de mortes e pessoas-ano (grupos de 5 anos). */
export function periodLifeExpectancy(w: YearDemography): number | null {
  const groups: [number, number][] = [
    [0, 1],
    [1, 4],
  ];
  for (let a = 5; a < 85; a += 5) groups.push([a, 5]);
  groups.push([85, 26]);
  let l = 1;
  let e = 0;
  let totalExposure = 0;
  for (let gi = 0; gi < groups.length; gi++) {
    const [start, n] = groups[gi]!;
    let deaths = 0;
    let exposure = 0;
    for (let a = start; a < Math.min(start + n, 111); a++) {
      deaths += w.deaths[0][a]! + w.deaths[1][a]!;
      exposure += w.exposure[0][a]! + w.exposure[1][a]!;
    }
    totalExposure += exposure;
    const m = exposure > 0 ? deaths / exposure : 0;
    const last = gi === groups.length - 1;
    if (last) {
      e += m > 0 ? l / m : l * 5;
      break;
    }
    const a0 = start === 0 ? 0.1 : 0.5;
    const q = Math.min(1, (n * m) / (1 + n * (1 - a0) * m));
    const d = l * q;
    e += n * (l - d) + n * a0 * d;
    l -= d;
  }
  return totalExposure > 0 ? e : null;
}

export function totalFertilityRate(w: YearDemography): number | null {
  let tfr = 0;
  let exposure = 0;
  for (let a = 15; a <= 49; a++) {
    const ex = w.exposure[0][a]!;
    exposure += ex;
    if (ex > 0) tfr += w.birthsByMotherAge[a]! / ex;
  }
  return exposure > 0 ? tfr : null;
}

export function computeRealism(city: City, demo: Demography, c: Census): RealismItem[] {
  const cfg = city.config.realism;
  const w = demo.window();
  const enough = c.population >= cfg.minPopulation && demo.history.length > 0;
  const ms = cfg.minSamples;
  let deaths = 0;
  for (let a = 0; a < 111; a++) deaths += w.deaths[0][a]! + w.deaths[1][a]!;
  const marriages = w.marriageCount[0] + w.marriageCount[1];
  const workers = c.employedLocal + c.employedOutside;
  const labor = workers + c.byRole[3]!;
  const values: Record<string, number | null> = {
    lifeExpectancy: deaths >= ms.deaths ? periodLifeExpectancy(w) : null,
    infantMortality: w.births >= ms.births ? (w.infantDeaths / w.births) * 1000 : null,
    tfr: w.births >= Math.min(100, ms.births) ? totalFertilityRate(w) : null,
    unemployment: labor > 0 ? (c.byRole[3]! / labor) * 100 : null,
    employmentLevel: c.pop14plus > 0 ? (workers / c.pop14plus) * 100 : null,
    householdSize: c.households > 0 ? c.population / c.households : null,
    householdsWithCar: c.households > 0 ? (c.householdsWithCar / c.households) * 100 : null,
    commuteUnder30: c.commuteKnown > 0 ? (c.commuteUnder30 / c.commuteKnown) * 100 : null,
    marriageAgeMale: marriages >= ms.marriages ? w.marriageAgeSum[1] / Math.max(1, w.marriageCount[1]) : null,
    marriageAgeFemale:
      marriages >= ms.marriages ? w.marriageAgeSum[0] / Math.max(1, w.marriageCount[0]) : null,
    divorceRate: w.divorces >= ms.divorces ? (w.divorces / w.adults20plusYears) * 1000 : null,
    higherEducation: c.youth18to24 > 0 ? 0 : null,
    schoolEnrollment:
      c.children6to17 > 0 ? ((c.children6to17 - c.childrenWithoutSchool) / c.children6to17) * 100 : null,
  };
  return cfg.items.map((item) => {
    const v = values[item.id] ?? null;
    const status: RealismItem["status"] =
      !enough || v === null ? "insufficient-data" : v < item.min ? "low" : v > item.max ? "high" : "ok";
    return { ...item, value: v === null ? null : Math.round(v * 100) / 100, status };
  });
}
