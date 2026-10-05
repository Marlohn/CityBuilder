/**
 * `npm run check`: roda todas as verificações e responde em texto curto.
 * Pensado para agentes (LLMs): no fim sai "TUDO OK" ou a lista do que quebrou,
 * com as últimas linhas relevantes de cada falha.
 *
 * Opções: --local (tipos/estilo/camadas), --only=<etapa>, --full (suíte completa).
 * No Hermes, CITYBUILDER_LOCAL_CHECK=1 evita repetir a suíte do CI no mini PC.
 */
import { spawnSync } from "node:child_process";

interface Step {
  id: string;
  label: string;
  cmd: string;
  args: string[];
  env?: Record<string, string>;
}

const STEPS: Step[] = [
  { id: "types", label: "Tipos (TypeScript)", cmd: "npx", args: ["tsc", "-p", "tsconfig.json", "--noEmit"] },
  { id: "lint", label: "Estilo (Biome)", cmd: "npx", args: ["biome", "check", "."] },
  {
    id: "layers",
    label: "Camadas (dependency-cruiser)",
    cmd: "npx",
    args: ["depcruise", "packages", "--config", ".dependency-cruiser.cjs", "--output-type", "err"],
  },
  { id: "tests", label: "Testes (Vitest)", cmd: "npx", args: ["vitest", "run", "--reporter=dot"] },
];

const only = process.argv.find((a) => a.startsWith("--only="))?.split("=")[1];
const fast = process.argv.includes("--fast");
const local =
  !process.env.CI &&
  !process.argv.includes("--full") &&
  (process.argv.includes("--local") || process.env.CITYBUILDER_LOCAL_CHECK === "1");
const results: { step: Step; ok: boolean; ms: number; tail: string }[] = [];

for (const step of STEPS) {
  if (only && step.id !== only) continue;
  if (local && !only && step.id === "tests") continue;
  const t0 = Date.now();
  const r = spawnSync(step.cmd, step.args, {
    encoding: "utf8",
    env: { ...process.env, ...(fast ? { FAST: "1" } : {}), FORCE_COLOR: "0", ...step.env },
    maxBuffer: 64 * 1024 * 1024,
  });
  const out = `${r.stdout ?? ""}\n${r.stderr ?? ""}`;
  const ok = r.status === 0;
  const tail = ok ? "" : relevantLines(out);
  results.push({ step, ok, ms: Date.now() - t0, tail });
  process.stdout.write(`${ok ? "✔" : "✘"} ${step.label} (${((Date.now() - t0) / 1000).toFixed(1)}s)\n`);
}

const failed = results.filter((r) => !r.ok);
if (failed.length === 0) {
  process.stdout.write(
    local && !only
      ? "\nCHECK LOCAL OK (tipos, estilo, camadas). Rode o teste afetado; a suíte completa é obrigatória no CI antes do merge.\n"
      : "\nTUDO OK\n",
  );
  process.exit(0);
}
process.stdout.write(`\nQUEBROU: ${failed.map((f) => f.step.id).join(", ")}\n`);
for (const f of failed) {
  process.stdout.write(`\n--- ${f.step.label} ---\n${f.tail}\n`);
  process.stdout.write(`Para rodar só esta etapa: npm run check -- --only=${f.step.id}\n`);
  if (f.step.id === "lint")
    process.stdout.write("Muitos erros de estilo se corrigem sozinhos com: npm run format\n");
}
process.exit(1);

/** Pega as linhas que importam (erros, falhas, arquivos) e limita o tamanho. */
function relevantLines(out: string): string {
  const lines = out.split("\n").filter((l) => l.trim() !== "");
  const important = lines.filter((l) =>
    /error|erro|fail|✘|×|FAIL|expected|received|AssertionError|at .*\.(ts|tsx):\d+|\.tsx?:\d+|semente|seed|reproduzir/i.test(
      l,
    ),
  );
  const pick = (important.length > 0 ? important : lines).slice(0, 60);
  return pick.join("\n");
}
