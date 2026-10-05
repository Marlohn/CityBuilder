/**
 * Motor de roadmap na linha de comando.
 *
 *   npm run roadmap:signals                 roda as cidades de teste e grava roadmap/signals.json
 *   npm run roadmap:build                   lê issues + sinais e grava ROADMAP.md
 *       [--issues=arquivo.json]             issues de um arquivo (formato da API do GitHub) em vez da API
 *       [--publish]                         também atualiza a issue "Roadmap" (etiqueta roadmap-gerado)
 *   npm run roadmap:check                   confere a métrica dos itens com a etiqueta "entregue"
 *
 * Para ler as issues pela API: GITHUB_TOKEN (opcional em repo público) e GITHUB_REPOSITORY=dono/repo
 * (se faltar, usa o remote "origin" do git).
 */
import { execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "@city/cli";
import { computeRoadmap, renderRoadmap } from "./build";
import { collectSignals, loadRoadmapConfig } from "./collect";
import { fromGithubApi } from "./items";
import type { IssueInput, SignalsFile } from "./types";

const SIGNALS_PATH = join(ROOT, "roadmap", "signals.json");
const ROADMAP_PATH = join(ROOT, "ROADMAP.md");
const PUBLISH_LABEL = "roadmap-gerado";

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

function repoName(): string {
  if (process.env.GITHUB_REPOSITORY) return process.env.GITHUB_REPOSITORY;
  const url = execSync("git remote get-url origin", { cwd: ROOT, encoding: "utf8" }).trim();
  const m = /github\.com[/:]([^/]+\/[^/.]+)/.exec(url) ?? /\/git\/([^/]+\/[^/.]+)/.exec(url);
  if (!m) throw new Error(`não achei o repositório no remote "${url}"; defina GITHUB_REPOSITORY=dono/repo`);
  return m[1]!;
}

async function github(path: string, init: RequestInit = {}): Promise<unknown> {
  const headers: Record<string, string> = {
    accept: "application/vnd.github+json",
    "x-github-api-version": "2022-11-28",
  };
  if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const res = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: { ...headers, ...(init.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`GitHub ${init.method ?? "GET"} ${path}: ${res.status} ${await res.text()}`);
  return res.json();
}

async function fetchIssues(repo: string): Promise<IssueInput[]> {
  const all: unknown[] = [];
  for (let page = 1; page <= 20; page++) {
    const batch = (await github(`/repos/${repo}/issues?state=all&per_page=100&page=${page}`)) as unknown[];
    all.push(...batch);
    if (batch.length < 100) break;
  }
  return fromGithubApi(all);
}

async function publish(repo: string, body: string) {
  const text = body.length > 60000 ? `${body.slice(0, 60000)}\n\n… (cortado; veja o artifact \`roadmap\` da execução do workflow)` : body;
  const found = (await github(`/repos/${repo}/issues?state=open&labels=${PUBLISH_LABEL}`)) as {
    number: number;
  }[];
  const json = { "content-type": "application/json" };
  if (found[0]) {
    await github(`/repos/${repo}/issues/${found[0].number}`, {
      method: "PATCH",
      headers: json,
      body: JSON.stringify({ body: text }),
    });
    console.log(`issue #${found[0].number} atualizada`);
  } else {
    const created = (await github(`/repos/${repo}/issues`, {
      method: "POST",
      headers: json,
      body: JSON.stringify({
        title: "🗺️ Roadmap (gerado automaticamente)",
        body: text,
        labels: [PUBLISH_LABEL],
      }),
    })) as { number: number };
    console.log(`issue #${created.number} criada`);
  }
}

function readSignals(): SignalsFile | null {
  return existsSync(SIGNALS_PATH) ? (JSON.parse(readFileSync(SIGNALS_PATH, "utf8")) as SignalsFile) : null;
}

async function loadIssues(opts: Record<string, string>): Promise<IssueInput[]> {
  if (opts.issues) return fromGithubApi(JSON.parse(readFileSync(opts.issues, "utf8")) as unknown[]);
  return fetchIssues(repoName());
}

async function main() {
  const { pos, opts } = args();
  const cmd = pos[0] ?? "build";
  const cfg = loadRoadmapConfig();
  if (cmd === "signals") {
    const t0 = Date.now();
    const file = collectSignals(cfg, (m) => console.error(m));
    writeFileSync(SIGNALS_PATH, `${JSON.stringify(file, null, 2)}\n`);
    console.log(
      `${file.signals.length} sinais em ${((Date.now() - t0) / 1000).toFixed(0)} s → roadmap/signals.json`,
    );
    for (const s of file.signals) console.log(`- ${s.urgent ? "[URGENTE] " : ""}${s.id}: ${s.title}`);
    return;
  }
  if (cmd === "build" || cmd === "check") {
    const signals = readSignals();
    const issues = await loadIssues(opts);
    const roadmap = computeRoadmap(issues, signals, cfg, (p) => existsSync(join(ROOT, p)));
    if (cmd === "check") {
      let failed = 0;
      for (const d of roadmap.deliveries) {
        const ok = d.check?.ok ?? false;
        if (!ok) failed++;
        console.log(
          `${ok ? "OK" : "NÃO RESOLVEU"} #${d.item.number} ${d.item.title}: ${d.check ? `${d.check.id} = ${d.check.value} (esperado ${d.check.expected})` : d.error}`,
        );
      }
      if (roadmap.deliveries.length === 0) console.log('nenhum item com a etiqueta "entregue"');
      process.exitCode = failed > 0 ? 1 : 0;
      return;
    }
    const md = renderRoadmap(roadmap, signals, cfg);
    writeFileSync(ROADMAP_PATH, md);
    console.log(
      `ROADMAP.md: agora ${roadmap.plan.now.length}, próximo ${roadmap.plan.next.length}, depois ${roadmap.plan.later.length}, bloqueados ${roadmap.plan.blocked.length}, incompletos ${roadmap.incomplete.length}, ideias ${roadmap.ideas.length}, sinais sem item ${roadmap.unlinked.length}`,
    );
    if (opts.publish) await publish(repoName(), md);
    return;
  }
  console.error(`comando desconhecido: ${cmd} (use signals, build ou check)`);
  process.exitCode = 2;
}

main().catch((e: unknown) => {
  console.error((e as Error).message);
  process.exitCode = 1;
});
