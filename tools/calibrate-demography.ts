/**
 * Gera data/mortality-br-2023.json e data/fertility-br-2023.json.
 *
 * Por que calibrar em vez de copiar a tábua do IBGE? O arquivo da tábua completa não pôde ser
 * baixado no ambiente de desenvolvimento. Então usamos um modelo clássico (Gompertz-Makeham com
 * "pico de acidentes" nos homens jovens) e ajustamos os parâmetros até bater com os números
 * oficiais publicados pelo IBGE para 2023. Quando a tábua completa estiver disponível, basta
 * trocar o arquivo JSON (mesmo formato) e rodar os testes.
 *
 * Fontes (IBGE, Tábuas Completas de Mortalidade 2023 e Censo 2022):
 *  - e0: homens 73,1; mulheres 79,7.  e60: 20,7 / 24,0.  e80: 8,3 / 9,4.
 *  - Mortalidade infantil: 13,5 (H) e 11,4 (M) por mil.
 *  - Sobremortalidade masculina de 20 a 24 anos: 4,1 vezes.
 *  - Fecundidade: TFT 1,57 (2023); idade média 28,1 anos e 24,4% dos nascimentos entre 25 e 29 (2022).
 *
 * Uso: npx tsx tools/calibrate-demography.ts
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  fertilityShare,
  lifeExpectancy,
  meanAgeOfFertility,
  totalFertility,
} from "../packages/sim/src/demography/lifeTable";

const MAX_AGE = 110;

export const TARGETS = {
  female: { e0: 79.7, e60: 24.0, e80: 9.4, infant: 0.0114 },
  male: { e0: 73.1, e60: 20.7, e80: 8.3, infant: 0.0135 },
  maleExcess20to24: 4.1,
  fertility: { tfr: 1.57, meanAge: 28.1, share25to29: 0.244 },
};

function qxFrom(params: number[], infant: number, withHump: boolean): number[] {
  const [lnA, lnB, c, lnH] = params as [number, number, number, number];
  const A = Math.exp(lnA);
  const B = Math.exp(lnB);
  const H = withHump ? Math.exp(lnH) : 0;
  const q: number[] = [infant];
  for (let x = 1; x <= MAX_AGE; x++) {
    const hump = H * Math.exp(-(((x - 23) / 6) ** 2));
    const mu = A + B * Math.exp(c * x) + hump;
    q.push(Math.min(1, 1 - Math.exp(-mu)));
  }
  q[MAX_AGE] = 1;
  return q.map((v) => Math.round(v * 1e7) / 1e7);
}

function avgRange(q: number[], a: number, b: number): number {
  let s = 0;
  for (let x = a; x <= b; x++) s += q[x]!;
  return s / (b - a + 1);
}

/** Nelder-Mead simples (minimização sem derivadas). */
function nelderMead(f: (p: number[]) => number, start: number[], step: number[], iters = 4000): number[] {
  const n = start.length;
  let simplex = [start, ...start.map((_, i) => start.map((v, j) => (i === j ? v + step[i]! : v)))];
  let values = simplex.map(f);
  for (let k = 0; k < iters; k++) {
    const order = values.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0]);
    simplex = order.map(([, i]) => simplex[i]!);
    values = order.map(([v]) => v);
    const centroid = Array.from(
      { length: n },
      (_, j) => simplex.slice(0, n).reduce((s, p) => s + p[j]!, 0) / n,
    );
    const worst = simplex[n]!;
    const reflect = centroid.map((c, j) => c + (c - worst[j]!));
    const fr = f(reflect);
    if (fr < values[0]!) {
      const expand = centroid.map((c, j) => c + 2 * (c - worst[j]!));
      const fe = f(expand);
      if (fe < fr) [simplex[n], values[n]] = [expand, fe];
      else [simplex[n], values[n]] = [reflect, fr];
    } else if (fr < values[n - 1]!) {
      [simplex[n], values[n]] = [reflect, fr];
    } else {
      const contract = centroid.map((c, j) => c + 0.5 * (worst[j]! - c));
      const fc = f(contract);
      if (fc < values[n]!) [simplex[n], values[n]] = [contract, fc];
      else {
        const best = simplex[0]!;
        simplex = simplex.map((p) => p.map((v, j) => best[j]! + 0.5 * (v - best[j]!)));
        values = simplex.map(f);
      }
    }
  }
  const bestIdx = values.indexOf(Math.min(...values));
  return simplex[bestIdx]!;
}

export function calibrateMortality() {
  const fit = (t: typeof TARGETS.female, withHump: boolean, femaleQ?: number[]) => {
    const loss = (p: number[]) => {
      const q = qxFrom(p, t.infant, withHump);
      let l =
        (lifeExpectancy(q, 0) - t.e0) ** 2 +
        (lifeExpectancy(q, 60) - t.e60) ** 2 +
        (lifeExpectancy(q, 80) - t.e80) ** 2;
      if (femaleQ) {
        const ratio = avgRange(q, 20, 24) / avgRange(femaleQ, 20, 24);
        l += (ratio - TARGETS.maleExcess20to24) ** 2;
      }
      return l;
    };
    const start = [Math.log(0.0003), Math.log(0.00003), 0.1, Math.log(0.001)];
    let best = nelderMead(loss, start, [0.5, 0.5, 0.01, 0.5]);
    for (let r = 0; r < 6; r++) best = nelderMead(loss, best, [0.2, 0.2, 0.005, 0.2]);
    return qxFrom(best, t.infant, withHump);
  };
  const qxFemale = fit(TARGETS.female, false);
  const qxMale = fit(TARGETS.male, true, qxFemale);
  return { qxFemale, qxMale };
}

export function calibrateFertility() {
  const minAge = 15;
  const maxAge = 49;
  // Curva gama deslocada: início em `shift` anos. Três parâmetros para conseguir respeitar
  // a média, a fatia de 25-29 e a regra "25-29 é o grupo com maior fecundidade" (IBGE 2022).
  const shape = (p: number[]) => {
    const [a, lnb, shift] = p as [number, number, number];
    const b = Math.exp(lnb);
    const raw: number[] = [];
    for (let age = minAge; age <= maxAge; age++) {
      const x = Math.max(0.01, age + 0.5 - shift);
      raw.push(x ** (a - 1) * Math.exp(-x / b));
    }
    const s = raw.reduce((u, v) => u + v, 0);
    return raw.map((v) => (v / s) * TARGETS.fertility.tfr);
  };
  const loss = (p: number[]) => {
    const r = shape(p);
    const s2529 = fertilityShare(r, minAge, 25, 29);
    const others = [
      fertilityShare(r, minAge, 15, 19),
      fertilityShare(r, minAge, 20, 24),
      fertilityShare(r, minAge, 30, 34),
      fertilityShare(r, minAge, 35, 39),
    ];
    // Penaliza qualquer grupo que passe o de 25-29 (margem de 0,5 ponto).
    const penalty = others.reduce((acc, s) => acc + Math.max(0, s - (s2529 - 0.005)) ** 2, 0);
    return (
      (meanAgeOfFertility(r, minAge) - TARGETS.fertility.meanAge) ** 2 +
      100 * (s2529 - TARGETS.fertility.share25to29) ** 2 +
      1000 * penalty
    );
  };
  let best = nelderMead(loss, [4, Math.log(3.5), 12], [0.5, 0.2, 1]);
  for (let r = 0; r < 10; r++) best = nelderMead(loss, best, [0.2, 0.1, 0.5]);
  const rates = shape(best).map((v) => Math.round(v * 1e7) / 1e7);
  return { minAge, rates };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { qxFemale, qxMale } = calibrateMortality();
  const mortality = {
    source:
      "Calibrado (Gompertz-Makeham + pico de acidentes) para IBGE Tábuas Completas de Mortalidade 2023: e0 73,1/79,7; e60 20,7/24,0; e80 8,3/9,4; mortalidade infantil 13,5/11,4 por mil; sobremortalidade masculina 20-24 = 4,1x. Gerado por tools/calibrate-demography.ts.",
    maxAge: MAX_AGE,
    qxFemale,
    qxMale,
  };
  writeFileSync("data/mortality-br-2023.json", `${JSON.stringify(mortality)}\n`);
  const { minAge, rates } = calibrateFertility();
  const fertility = {
    source:
      "Calibrado (curva gama) para IBGE: TFT 1,57 (2023), idade média 28,1 e 24,4% entre 25-29 anos (Censo 2022). Gerado por tools/calibrate-demography.ts.",
    minAge,
    rates,
  };
  writeFileSync("data/fertility-br-2023.json", `${JSON.stringify(fertility)}\n`);
  console.log("e0 F", lifeExpectancy(qxFemale).toFixed(2), "M", lifeExpectancy(qxMale).toFixed(2));
  console.log("e60 F", lifeExpectancy(qxFemale, 60).toFixed(2), "M", lifeExpectancy(qxMale, 60).toFixed(2));
  console.log("e80 F", lifeExpectancy(qxFemale, 80).toFixed(2), "M", lifeExpectancy(qxMale, 80).toFixed(2));
  console.log("excesso 20-24", (avgRange(qxMale, 20, 24) / avgRange(qxFemale, 20, 24)).toFixed(2));
  console.log(
    "TFT",
    totalFertility(rates).toFixed(3),
    "idade média",
    meanAgeOfFertility(rates, minAge).toFixed(2),
    "25-29",
    fertilityShare(rates, minAge, 25, 29).toFixed(3),
  );
}
