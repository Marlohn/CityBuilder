/**
 * CLI: roda a cidade sem tela.
 *
 *   npm run sim -- report  [--scenario=bairro-basico] [--seed=x] [--days=20] [--log=info] [--json]
 *   npm run sim -- person <id> [--scenario=...] [--days=...]
 *   npm run sim -- replay <arquivo.json>
 *   npm run sim -- report --bot [--days=40] [--sandbox]   (prefeito automático)
 *   npm run sim -- report ... --save=cidade.json          (grava um save que abre no navegador)
 *   npm run sim -- scenarios
 *   npm run sim -- director [--bot] [--days=30] [--recorded=respostas.json] [--record=respostas.json]
 *       IA diretora (opcional). Sem --recorded usa um LLM de verdade: DIRECTOR_BASE_URL, DIRECTOR_MODEL e
 *       DIRECTOR_API_KEY (qualquer API no formato da OpenAI: OpenRouter, Ollama...). Grava o replay em
 *       out/director-replay.json, que depois abre sem LLM (npm run sim -- replay out/director-replay.json).
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { type LlmClient, OpenAiCompatibleClient, RecordedClient, RecordingClient } from "@city/director";
import {
  checkInvariants,
  createGame,
  makeReplay,
  parseReplay,
  personView,
  replayInto,
  reportText,
  statsView,
} from "@city/sim";
import { listScenarios, loadConfigAndData, loadScenario } from "./files";
import { runGame, runGameDirected } from "./run";

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
    const text = readFileSync(file, "utf8");
    const r = parseReplay(text);
    const { config, data } = loadConfigAndData(r.overrides);
    const game = createGame({ config, data, seed: r.seed });
    replayInto(game, r);
    console.log(reportText(game));
    const violations = checkInvariants(game.city);
    console.log(violations.length ? `\nVIOLAÇÕES:\n${violations.join("\n")}` : "\nNenhuma regra quebrada.");
    const note = (JSON.parse(text) as { note?: string }).note;
    if (note) console.log(`\nNota de quem reportou: ${note}`);
    return;
  }
  if (cmd === "bench") {
    bench(opts);
    return;
  }
  if (cmd === "director") {
    director(opts).catch((e: unknown) => {
      console.error(`ERRO: ${(e as Error).message}`);
      process.exit(1);
    });
    return;
  }
  const scenario = opts.scenario ? loadScenario(opts.scenario) : undefined;
  const overrides = {
    ...(scenario?.overrides ?? {}),
    ...(opts.log ? { logging: { default: opts.log } } : {}),
    ...(opts.sandbox ? { economy: { mode: "sandbox" } } : {}),
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
    bot: opts.bot === "true",
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
  if (opts.save) {
    writeFileSync(opts.save, JSON.stringify(makeReplay(game, overrides)));
    console.error(`save gravado em ${opts.save} (abra no jogo com o botão 📂 Abrir)`);
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

/**
 * Cidade de estresse: prefeito automático + crescimento acelerado até a população alvo.
 * Mostra quanto tempo cada dia levou e o pico de trabalho (contadores determinísticos).
 */
function bench(opts: Record<string, string>) {
  const scenario = loadScenario("estresse");
  const target = Number(opts.target ?? 50000);
  const maxDays = Number(opts.days ?? scenario.days);
  const { config, data } = loadConfigAndData(scenario.overrides);
  const seed = opts.seed ?? scenario.seed;
  let reachedDay = -1;
  let last = Date.now();
  const rows: { day: number; population: number; msPerDay: number }[] = [];
  const game = runGame({
    config,
    data,
    seed,
    days: maxDays,
    bot: true,
    scenario,
    onDay: (g, d) => {
      const now = Date.now();
      const pop = g.city.pop.aliveCount;
      rows.push({ day: d, population: pop, msPerDay: now - last });
      if (d % 5 === 0) console.error(`dia ${d}: ${pop} pessoas (${now - last} ms no último dia)`);
      last = now;
      if (reachedDay < 0 && pop >= target) reachedDay = d;
    },
    stopWhen: (g) => reachedDay >= 0 && g.sim.clock.day >= reachedDay + Number(opts.extra ?? 2),
  });
  const recent = rows.slice(-3);
  const msPerDay = recent.reduce((s, r) => s + r.msPerDay, 0) / Math.max(1, recent.length);
  const s = statsView(game);
  const out = {
    seed,
    targetPopulation: target,
    reachedDay,
    population: s.population,
    msPerGameDay: Math.round(msPerDay),
    realTimeFactorAt1x: Math.round(((config.time.realSecondsPerDayAt1x * 1000) / msPerDay) * 10) / 10,
    peakPerTick: game.sim.perf.peak,
    systemsMs: s.perf.systems,
  };
  writeFileSync("out/bench.json", JSON.stringify(out, null, 2));
  console.log(reportText(game));
  console.log(`\n## Estresse`);
  console.log(`População alvo ${target} alcançada no dia ${reachedDay}. Agora: ${s.population}.`);
  console.log(`Custo por dia do jogo (últimos dias): ${out.msPerGameDay} ms.`);
  console.log(
    `Na velocidade 1x um dia dura ${config.time.realSecondsPerDayAt1x} s: sobra ${out.realTimeFactorAt1x}x de folga.`,
  );
}

async function director(opts: Record<string, string>) {
  const scenario = opts.scenario ? loadScenario(opts.scenario) : undefined;
  const overrides = { ...(scenario?.overrides ?? {}), director: { enabled: true } };
  const { config, data } = loadConfigAndData(overrides);
  let client: LlmClient;
  if (opts.recorded) {
    client = new RecordedClient(JSON.parse(readFileSync(opts.recorded, "utf8")) as Record<string, string>);
  } else {
    const baseUrl = process.env.DIRECTOR_BASE_URL;
    const model = process.env.DIRECTOR_MODEL;
    if (!baseUrl || !model)
      throw new Error("defina DIRECTOR_BASE_URL e DIRECTOR_MODEL (ou use --recorded=arquivo.json)");
    client = new OpenAiCompatibleClient({
      baseUrl,
      model,
      ...(process.env.DIRECTOR_API_KEY ? { apiKey: process.env.DIRECTOR_API_KEY } : {}),
    });
  }
  const recorder = opts.record ? new RecordingClient(client) : null;
  const seed = opts.seed ?? scenario?.seed ?? "diretora";
  const days = Number(opts.days ?? scenario?.days ?? 30);
  const game = await runGameDirected({
    config,
    data,
    seed,
    days,
    ...(scenario ? { scenario } : {}),
    bot: opts.bot === "true" || !scenario,
    client: recorder ?? client,
    onDecision: (day, r) => {
      console.log(`dia ${day}: ${r.headline || "(sem manchete)"}`);
      for (const c of r.commands)
        if (c.type === "directorAdjust") console.log(`  ${c.param} = ${c.factor}: ${c.reason}`);
      for (const x of r.rejected) console.log(`  recusado: ${x}`);
    },
  });
  if (recorder) writeFileSync(opts.record!, JSON.stringify(recorder.recorded, null, 2));
  mkdirSync("out", { recursive: true });
  writeFileSync("out/director-replay.json", JSON.stringify(makeReplay(game, overrides)));
  console.log(`\n${reportText(game)}`);
  console.log("\nreplay gravado em out/director-replay.json");
}

try {
  main();
} catch (e) {
  console.error(`ERRO: ${(e as Error).message}`);
  process.exit(1);
}
