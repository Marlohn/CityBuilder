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

/**
 * Métrica de teste: "teste <arquivo>" (ex.: "teste tests/e2e/camera.spec.ts"). Para itens de tela e
 * ferramenta, que não têm número no relatório: conta como resolvido quando o teste existe (o CI garante
 * que ele passa, senão nada entra na main).
 */
export function testPath(expr: string): string | null {
  const m = /^teste:?\s+(\S+)$/i.exec(expr.trim());
  return m ? m[1]! : null;
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
export function checkMetric(
  expr: string,
  metrics: Record<string, number>,
  testExists: (path: string) => boolean = () => false,
): MetricCheck {
  const path = testPath(expr);
  if (path) {
    const ok = testExists(path);
    return { id: path, ok, value: ok ? 1 : 0, expected: expr.trim() };
  }
  const id = metricId(expr);
  const test = parseMetric(expr);
  const value = id in metrics ? metrics[id]! : null;
  return { id, ok: value !== null && test(value), value, expected: expr.trim() };
}

export function isValidMetric(expr: string, known?: Record<string, number>): string | null {
  if (testPath(expr)) return null;
  try {
    parseMetric(expr);
  } catch (e) {
    return (e as Error).message;
  }
  if (known && !(metricId(expr) in known)) return `métrica "${metricId(expr)}" não existe no relatório`;
  return null;
}
