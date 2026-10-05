/** `npm run check`: tipos, estilo, camadas e suíte Vitest normal. */
import { spawnSync } from "node:child_process";

interface Step {
  id: string;
  label: string;
  cmd: string;
  args: string[];
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
const results: { step: Step; ok: boolean; tail: string }[] = [];

for (const step of STEPS) {
  if (only && step.id !== only) continue;
  const started = Date.now();
  const r = spawnSync(step.cmd, step.args, {
    encoding: "utf8",
    env: { ...process.env, FORCE_COLOR: "0" },
    maxBuffer: 64 * 1024 * 1024,
  });
  const out = `${r.stdout ?? ""}\n${r.stderr ?? ""}`;
  const ok = r.status === 0;
  results.push({ step, ok, tail: ok ? "" : relevantLines(out) });
  process.stdout.write(`${ok ? "✔" : "✘"} ${step.label} (${((Date.now() - started) / 1000).toFixed(1)}s)\n`);
}

const failed = results.filter((r) => !r.ok);
if (failed.length === 0) {
  process.stdout.write("\nTUDO OK\n");
  process.exit(0);
}
process.stdout.write(`\nQUEBROU: ${failed.map((f) => f.step.id).join(", ")}\n`);
for (const f of failed) {
  process.stdout.write(`\n--- ${f.step.label} ---\n${f.tail}\n`);
  process.stdout.write(`Para rodar só esta etapa: npm run check -- --only=${f.step.id}\n`);
  if (f.step.id === "lint")
    process.stdout.write("Muitos erros de estilo se corrigem com: npm run format\n");
}
process.exit(1);

function relevantLines(out: string): string {
  const lines = out.split("\n").filter((l) => l.trim() !== "");
  const important = lines.filter((l) =>
    /error|erro|fail|✘|×|FAIL|expected|received|AssertionError|at .*\.(ts|tsx):\d+|\.tsx?:\d+|semente|seed|reproduzir/i.test(
      l,
    ),
  );
  return (important.length > 0 ? important : lines).slice(0, 60).join("\n");
}
