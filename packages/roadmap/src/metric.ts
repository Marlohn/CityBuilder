/**
 * Métrica de sucesso: "<id> <operador> <valor>".
 * Operadores: <, <=, >, >=, = e "entre a e b" (ex.: "realism.tfr entre 1,3 e 1,9").
 */

export interface MetricCheck {
  id: string;
  ok: boolean;
  value: number | null;
  expected: string;
}

function num(s: string): number {
  // Aceita "4.200" (milhar) e "1,5" (decimal) como se escreve no Brasil.
  const t = s.trim();
  const normalized = /^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(t)
    ? t.replace(/\./g, "").replace(",", ".")
    : t.replace(",", ".");
  const v = Number(normalized);
  if (!Number.isFinite(v)) throw new Error(`número inválido: "${s}"`);
  return v;
}

export function parseMetric(expr: string): (v: number) => boolean {
  const e = expr.trim();
  const between = /^(\S+)\s+entre\s+(\S+)\s+e\s+(\S+)$/i.exec(e);
  if (between) {
    const lo = num(between[2]!);
    const hi = num(between[3]!);
    return (v) => v >= lo && v <= hi;
  }
  const m = /^(\S+)\s*(<=|>=|<|>|=)\s*(\S+)$/.exec(e);
  if (!m) throw new Error(`métrica fora do formato "<id> <operador> <valor>": "${expr}"`);
  const target = num(m[3]!);
  switch (m[2]) {
    case "<":
      return (v) => v < target;
    case "<=":
      return (v) => v <= target;
    case ">":
      return (v) => v > target;
    case ">=":
      return (v) => v >= target;
    default:
      return (v) => v === target;
  }
}

export function metricId(expr: string): string {
  return expr.trim().split(/\s|<|>|=/)[0] ?? "";
}

/** Confere a métrica contra os números medidos. Métrica desconhecida = não passou (value null). */
export function checkMetric(expr: string, metrics: Record<string, number>): MetricCheck {
  const id = metricId(expr);
  const test = parseMetric(expr);
  const value = id in metrics ? metrics[id]! : null;
  return { id, ok: value !== null && test(value), value, expected: expr.trim() };
}

export function isValidMetric(expr: string, known?: Record<string, number>): string | null {
  try {
    parseMetric(expr);
  } catch (e) {
    return (e as Error).message;
  }
  if (known && !(metricId(expr) in known)) return `métrica "${metricId(expr)}" não existe no relatório`;
  return null;
}
