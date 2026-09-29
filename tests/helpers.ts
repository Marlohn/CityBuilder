/**
 * Ajudante para testes de aceitação (QA) e testes de integração: cria uma cidade pronta em uma linha.
 *
 *   const game = createTestGame({ seed: "minha-tarefa", scenario: "bairro-basico", days: 10 });
 *   const s = statsView(game);
 *
 * Sempre com semente fixa: o mesmo teste dá sempre o mesmo resultado.
 */
import { loadConfigAndData, loadScenario, runGame } from "@city/cli";
import type { Command } from "@city/contract";
import type { Game } from "@city/sim";

export interface TestGameOptions {
  seed: string;
  /** Nome de um arquivo em scenarios/ (sem .yaml). */
  scenario?: string;
  /** Dias do jogo a simular (1 dia = 1 ano de vida). Padrão: 0 (cidade recém-criada). */
  days?: number;
  /** Mudanças na config só para este teste (ex.: { economy: { mode: "sandbox" } }). */
  overrides?: Record<string, unknown>;
  /** Liga o prefeito automático. */
  bot?: boolean;
  /** Comandos dados no começo (antes do primeiro tick). */
  commands?: Command[];
}

export function createTestGame(opts: TestGameOptions): Game {
  const scenario = opts.scenario ? loadScenario(opts.scenario) : undefined;
  const { config, data } = loadConfigAndData({ ...(scenario?.overrides ?? {}), ...(opts.overrides ?? {}) });
  return runGame({
    config,
    data,
    seed: opts.seed,
    days: opts.days ?? 0,
    ...(scenario ? { scenario } : {}),
    ...(opts.bot ? { bot: true } : {}),
    ...(opts.commands ? { commands: opts.commands } : {}),
  });
}
