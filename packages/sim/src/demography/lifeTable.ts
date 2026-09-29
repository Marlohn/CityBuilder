/**
 * Contas de demografia sem funções transcendentes (determinísticas em qualquer plataforma).
 */

/**
 * Expectativa de vida na idade `fromAge` a partir das probabilidades anuais de morte (qx).
 * Supõe mortes no meio do ano, exceto no 1º ano de vida (a0 = 0,1, típico de mortalidade infantil baixa).
 * O último grupo é aberto: quem chega lá vive em média 1/qx anos.
 */
export function lifeExpectancy(qx: ArrayLike<number>, fromAge = 0): number {
  const n = qx.length;
  let l = 1;
  let total = 0;
  for (let x = fromAge; x < n; x++) {
    const q = qx[x] ?? 1;
    const d = l * q;
    const last = x === n - 1;
    if (last) {
      total += q > 0 ? l / q : 0;
      break;
    }
    const a = x === 0 ? 0.1 : 0.5;
    total += l - d * (1 - a);
    l -= d;
  }
  return total;
}

/** Soma das taxas por idade = número médio de filhos por mulher (TFT). */
export function totalFertility(rates: ArrayLike<number>): number {
  let s = 0;
  for (let i = 0; i < rates.length; i++) s += rates[i] ?? 0;
  return s;
}

/** Idade média da fecundidade. */
export function meanAgeOfFertility(rates: ArrayLike<number>, minAge: number): number {
  let s = 0;
  let w = 0;
  for (let i = 0; i < rates.length; i++) {
    const r = rates[i] ?? 0;
    s += r * (minAge + i + 0.5);
    w += r;
  }
  return w > 0 ? s / w : 0;
}

/** Fração da fecundidade entre as idades [a, b] (inclusive). */
export function fertilityShare(rates: ArrayLike<number>, minAge: number, a: number, b: number): number {
  let part = 0;
  let total = 0;
  for (let i = 0; i < rates.length; i++) {
    const r = rates[i] ?? 0;
    const age = minAge + i;
    total += r;
    if (age >= a && age <= b) part += r;
  }
  return total > 0 ? part / total : 0;
}

/** Converte taxa central de mortalidade (mortes / pessoas-ano) em probabilidade anual. */
export function mxToQx(mx: number): number {
  const q = mx / (1 + 0.5 * mx);
  return q > 1 ? 1 : q;
}
