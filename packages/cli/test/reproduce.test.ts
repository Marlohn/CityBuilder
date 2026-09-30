/**
 * Issue #97: linha "reproduzir" da CLI perde flags (--bot/--sandbox/--scenario).
 * Hoje packages/cli/src/main.ts monta a linha na mão (linha 119) só com
 * --scenario/--seed/--days. Este teste cobra a função pura reproduceCommand
 * (packages/cli/src/command.ts, junto com parseArgs) que monta o comando
 * completo na ordem fixa: --scenario, --bot, --sandbox, --seed, --days.
 * Falha agora (função não existe) e passa quando o Dev implementar.
 */

import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { reproduceCommand } from "../src/command";

describe("reproduceCommand (issue #97)", () => {
  it("sem nenhuma flag devolve só report com --seed e --days", () => {
    const cmd = reproduceCommand({}, "semente-base", 10);
    expect(cmd).toContain("report");
    expect(cmd).toContain("--seed=semente-base");
    expect(cmd).toContain("--days=10");
    expect(cmd).not.toContain("--bot");
    expect(cmd).not.toContain("--sandbox");
    expect(cmd).not.toContain("--scenario");
  });

  it("com --bot contém --bot e não contém --sandbox", () => {
    const cmd = reproduceCommand({ bot: "true" }, "semente-base", 10);
    expect(cmd).toContain("report");
    expect(cmd).toContain("--bot");
    expect(cmd).not.toContain("--sandbox");
  });

  it("com --sandbox contém --sandbox e não contém --bot", () => {
    const cmd = reproduceCommand({ sandbox: "true" }, "semente-base", 10);
    expect(cmd).toContain("report");
    expect(cmd).toContain("--sandbox");
    expect(cmd).not.toContain("--bot");
  });

  it("com as duas flags mantém --bot antes de --sandbox, uma vez cada", () => {
    const cmd = reproduceCommand({ bot: "true", sandbox: "true" }, "semente-base", 10);
    expect(cmd).toContain("--bot");
    expect(cmd).toContain("--sandbox");
    expect(cmd.split("--bot").length - 1).toBe(1);
    expect(cmd.split("--sandbox").length - 1).toBe(1);
    expect(cmd.indexOf("--bot")).toBeLessThan(cmd.indexOf("--sandbox"));
  });

  it("com scenario inclui --scenario=bairro-basico", () => {
    const cmd = reproduceCommand({ scenario: "bairro-basico" }, "semente-base", 10);
    expect(cmd).toContain("--scenario=bairro-basico");
  });

  it("ordem fixa completa ignora --log, --json, --save e --progress", () => {
    const cmd = reproduceCommand(
      {
        scenario: "bairro-basico",
        bot: "true",
        sandbox: "true",
        log: "info",
        json: "true",
        save: "c.json",
        progress: "true",
      },
      "avaliacao-livre",
      40,
    );
    expect(cmd).toBe(
      "npm run sim -- report --scenario=bairro-basico --bot --sandbox --seed=avaliacao-livre --days=40",
    );
    expect(cmd).not.toContain("--log");
    expect(cmd).not.toContain("--json");
    expect(cmd).not.toContain("--save");
    expect(cmd).not.toContain("--progress");
  });

  it("chamar duas vezes com os mesmos argumentos devolve a mesma string", () => {
    const opts: Record<string, string> = { scenario: "bairro-basico", bot: "true" };
    const primeira = reproduceCommand(opts, "semente-base", 10);
    const segunda = reproduceCommand(opts, "semente-base", 10);
    expect(segunda).toBe(primeira);
  });

  it("a linha reproduzir da CLI real já traz --bot e --sandbox", () => {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
    const output = execFileSync(
      "npx",
      ["tsx", "packages/cli/src/main.ts", "report", "--bot", "--sandbox", "--seed=qa97", "--days=3"],
      { cwd: root, encoding: "utf8", timeout: 120000 },
    );
    const lines = String(output)
      .split("\n")
      .filter((line) => line.includes("reproduzir:"));
    const last = lines[lines.length - 1];
    expect(last).toBeDefined();
    expect(last).toContain("--bot");
    expect(last).toContain("--sandbox");
    expect(last).toContain("--seed=qa97");
    expect(last).toContain("--days=3");
  });
});
