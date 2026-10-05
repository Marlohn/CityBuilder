/** `npm run check`: tipos, estilo, camadas e suíte Vitest normal. Para na primeira falha. */
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

const only = process.argv.find((arg) => arg.startsWith("--only="))?.split("=")[1];

for (const step of STEPS) {
  if (only && step.id !== only) continue;

  const started = Date.now();
  const result = spawnSync(step.cmd, step.args, {
    encoding: "utf8",
    env: { ...process.env, FORCE_COLOR: "0" },
    maxBuffer: 64 * 1024 * 1024,
  });
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  const ok = result.status === 0;
  process.stdout.write(`${ok ? "✔" : "✘"} ${step.label} (${((Date.now() - started) / 1000).toFixed(1)}s)\n`);

  if (ok) continue;

  process.stdout.write(`\nQUEBROU: ${step.id}\n`);
  process.stdout.write(`\n--- ${step.label} ---\n${step.id === "lint" ? output : relevantLines(output)}\n`);
  process.stdout.write(`Para rodar só esta etapa: npm run check -- --only=${step.id}\n`);
  if (step.id === "lint") {
    process.stdout.write("Muitos erros de estilo se corrigem com: npm run format\n");
  }
  process.exit(1);
}

process.stdout.write("\nTUDO OK\n");

function relevantLines(output: string): string {
  const lines = output.split("\n").filter((line) => line.trim() !== "");
  const important = lines.filter((line) =>
    /error|erro|fail|✘|×|FAIL|expected|received|AssertionError|at .*\.(ts|tsx):\d+|\.tsx?:\d+|semente|seed|reproduzir/i.test(
      line,
    ),
  );
  return (important.length > 0 ? important : lines).slice(0, 60).join("\n");
}
