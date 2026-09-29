/**
 * Diretora (IA opcional). Olha o relatório da cidade e pode pedir ajustes grandes e raros
 * (ex.: onda de migração, recessão na indústria), só da lista permitida e dentro dos limites da config.
 *
 * Garantias:
 * - Desligada por padrão; o jogo funciona 100% sem ela.
 * - Ela não mexe na cidade direto: devolve comandos. Comandos entram no save/replay, então a cidade
 *   continua reproduzível mesmo que o LLM responda diferente na próxima vez.
 * - Resposta inválida (texto solto, JSON quebrado, item fora da lista) = nenhum ajuste, com o motivo.
 */
import { type Command, DIRECTOR_PARAMS } from "@city/contract";
import { type Game, reportText } from "@city/sim";
import { z } from "zod";
import type { LlmClient } from "./client";

export const DecisionSchema = z.object({
  /** Manchete para o jogador (o "jornal da cidade"). */
  headline: z.string().max(200),
  actions: z
    .array(
      z.object({
        param: z.enum(DIRECTOR_PARAMS),
        factor: z.number(),
        reason: z.string().max(500),
      }),
    )
    .max(10),
});
export type Decision = z.infer<typeof DecisionSchema>;

export interface DirectorResult {
  headline: string;
  commands: Command[];
  /** Ajustes recusados e respostas inválidas, com o motivo (vão para o log). */
  rejected: string[];
}

const PARAM_TEXT: Record<(typeof DIRECTOR_PARAMS)[number], string> = {
  immigration: "chegada de famílias de fora (1 = normal)",
  industryGrowth: "crescimento da indústria da região (1 = normal)",
};

export function buildPrompt(game: Game): string {
  const cfg = game.sim.config.director;
  const limits = DIRECTOR_PARAMS.map(
    (p) =>
      `- ${p}: ${PARAM_TEXT[p]}, de ${cfg.limits[p][0]} a ${cfg.limits[p][1]} (hoje ${game.sim.modifiers[p]})`,
  ).join("\n");
  return [
    "Você é a diretora de uma cidade brasileira simulada. Sua função é dar vida à cidade com eventos",
    "grandes e raros que acontecem em cidades reais (ex.: uma fábrica nova na região, uma recessão, uma",
    "onda de migração), sem tirar a cidade da realidade. Na dúvida, não mude nada.",
    "",
    "Você só pode ajustar estes multiplicadores, dentro dos limites:",
    limits,
    "",
    `Máximo de ${cfg.maxActions} ajustes. Para voltar ao normal, use 1.`,
    "Responda SÓ com um JSON neste formato, sem texto fora dele:",
    '{"headline": "manchete curta em português", "actions": [{"param": "industryGrowth", "factor": 0.5, "reason": "por quê, ligado aos números"}]}',
    "",
    "Relatório da cidade:",
    reportText(game),
  ].join("\n");
}

/** Acha o JSON na resposta (modelos às vezes cercam com ``` ou texto). */
export function parseDecision(text: string): Decision {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("resposta sem JSON");
  return DecisionSchema.parse(JSON.parse(text.slice(start, end + 1)));
}

/** Transforma a decisão em comandos, conferindo limites e quantidade (a sim confere de novo). */
export function toCommands(game: Game, d: Decision): DirectorResult {
  const cfg = game.sim.config.director;
  const commands: Command[] = [];
  const rejected: string[] = [];
  for (const a of d.actions) {
    const [min, max] = cfg.limits[a.param];
    if (commands.length >= cfg.maxActions)
      rejected.push(`${a.param}: passou do máximo de ${cfg.maxActions} ajustes`);
    else if (!(a.factor >= min && a.factor <= max))
      rejected.push(`${a.param}: ${a.factor} fora do limite (${min} a ${max})`);
    else commands.push({ type: "directorAdjust", param: a.param, factor: a.factor, reason: a.reason });
  }
  return { headline: d.headline, commands, rejected };
}

/** Pergunta ao LLM e devolve os comandos. Nunca lança erro: falha vira "nenhum ajuste" com motivo. */
export async function decide(game: Game, client: LlmClient): Promise<DirectorResult> {
  let text: string;
  try {
    text = await client.complete(buildPrompt(game));
  } catch (e) {
    return { headline: "", commands: [], rejected: [`LLM falhou: ${(e as Error).message}`] };
  }
  try {
    return toCommands(game, parseDecision(text));
  } catch (e) {
    const msg =
      e instanceof z.ZodError
        ? e.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")
        : (e as Error).message;
    return { headline: "", commands: [], rejected: [`resposta inválida: ${msg}`] };
  }
}
