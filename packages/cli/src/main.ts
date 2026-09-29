/**
 * CLI: roda a cidade sem tela.
 *
 *   npm run sim -- report  [--scenario=bairro-basico] [--seed=x] [--days=20] [--log=info] [--json]
 *   npm run sim -- person <id> [--scenario=...] [--days=...]
 *   npm run sim -- replay <arquivo.json>
 *   npm run sim -- scenarios
 */
import { readFileSync, writeFileSync } from "node:fs";
import type { TimedCommand } from "@city/contract";
import { personView, reportText, statsView } from "@city/sim";
import { listScenarios, loadConfigAndData, loadScenario } from "./files";
import { runGame } from "./run";

function args() {
  const pos: string[] = [];
  const opts: Record<string, string> = {};
  for (const a of process.argv.slice(2)) {
    if (a.startsWith("--")) {
      const [k, v] = a.slice(2).split("=");
      opts[k!] = v ?? "true";
    } else pos.push(a);
  }
  return { pos, opts };
}

function main() {
  const { pos, opts } = args();
  const cmd = pos[0] ?? "report";
  if (cmd === "scenarios") {
    console.log(listScenarios().join("\n"));
    return;
  }
  if (cmd === "replay") {
    const file = pos[1];
    if (!file) throw new Error("uso: npm run sim -- replay <arquivo.json>");
    const r = JSON.parse(readFileSync(file, "utf8")) as {
      seed: string;
      tick: number;
      commands: TimedCommand[];
      overrides?: unknown;
    };
    const { config, data } = loadConfigAndData(r.overrides);
    const startTick = Math.floor(((config.time.startHour ?? 0) * 60) / config.time.minutesPerTick);
    const days = (r.tick - startTick) / (1440 / config.time.minutesPerTick);
    const game = runGame({ config, data, seed: r.seed, days, timed: r.commands });
    console.log(reportText(game));
    return;
  }
  const scenario = opts.scenario ? loadScenario(opts.scenario) : undefined;
  const overrides = {
    ...(scenario?.overrides ?? {}),
    ...(opts.log ? { logging: { default: opts.log } } : {}),
  };
  const { config, data } = loadConfigAndData(overrides);
  const seed = opts.seed ?? scenario?.seed ?? "cli";
  const days = Number(opts.days ?? scenario?.days ?? 10);
  const t0 = Date.now();
  const game = runGame({
    config,
    data,
    seed,
    days,
    ...(scenario ? { scenario } : {}),
    onDay: opts.progress
      ? (g, d) => {
          const s = statsView(g);
          console.error(`dia ${d}: população ${s.population}, prédios ${g.sim.buildings.count}`);
        }
      : undefined,
  });
  if (opts.log) game.sim.log.sink = (e) => console.error(JSON.stringify(e));
  const elapsed = (Date.now() - t0) / 1000;
  if (cmd === "person") {
    const id = Number(pos[1]);
    const p = personView(game.city, id);
    if (!p) throw new Error(`pessoa ${id} não existe`);
    console.log(`${p.name} (#${p.id}) — ${p.age} anos — ${p.status} — ${p.education}`);
    for (const h of p.history) console.log(`  ${h.year}: ${h.text}`);
    return;
  }
  if (opts.json) {
    const out = opts.json === "true" ? "out/report.json" : opts.json;
    writeFileSync(out, JSON.stringify(statsView(game), null, 2));
  }
  console.log(reportText(game));
  console.log(
    `\n(simulado em ${elapsed.toFixed(1)} s reais; reproduzir: npm run sim -- report${opts.scenario ? ` --scenario=${opts.scenario}` : ""} --seed=${seed} --days=${days})`,
  );
}

try {
  main();
} catch (e) {
  console.error(`ERRO: ${(e as Error).message}`);
  process.exit(1);
}
