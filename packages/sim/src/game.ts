/**
 * Monta um jogo completo: a simulação com todos os sistemas ligados na ordem certa.
 * CLI, navegador e testes usam esta função, então todos rodam exatamente o mesmo jogo.
 */
import { type SimOptions, Simulation } from "./sim";

export interface Game {
  sim: Simulation;
}

export function createGame(opts: SimOptions): Game {
  const sim = new Simulation(opts);
  return { sim };
}
