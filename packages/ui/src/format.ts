/** Formatação em português do Brasil. */

export function money(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1e9) return `${sign}R$ ${(abs / 1e9).toFixed(2).replace(".", ",")} bi`;
  if (abs >= 1e6) return `${sign}R$ ${(abs / 1e6).toFixed(1).replace(".", ",")} mi`;
  if (abs >= 1e3) return `${sign}R$ ${(abs / 1e3).toFixed(0)} mil`;
  return `${sign}R$ ${abs.toFixed(0)}`;
}

export function int(n: number): string {
  return Math.round(n)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

export function clock(minuteOfDay: number): string {
  const h = Math.floor(minuteOfDay / 60);
  const m = Math.floor(minuteOfDay % 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function pct(n: number, digits = 0): string {
  return `${(n * 100).toFixed(digits).replace(".", ",")}%`;
}
