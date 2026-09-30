/** Pure CLI helpers (no side effects, no fs). */

export function parseArgs(argv: string[]): { pos: string[]; opts: Record<string, string> } {
  const pos: string[] = [];
  const opts: Record<string, string> = {};
  for (const a of argv) {
    if (a.startsWith("--")) {
      const [k, v] = a.slice(2).split("=");
      opts[k!] = v ?? "true";
    } else pos.push(a);
  }
  return { pos, opts };
}

export function reproduceCommand(opts: Record<string, string>, seed: string, days: number): string {
  return (
    "npm run sim -- report" +
    (opts.scenario ? ` --scenario=${opts.scenario}` : "") +
    (opts.bot ? " --bot" : "") +
    (opts.sandbox ? " --sandbox" : "") +
    ` --seed=${seed} --days=${days}`
  );
}
