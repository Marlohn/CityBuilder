import { parseCommand } from "@city/contract";

// A validação dos comandos roda DEPOIS da migração (ver parseReplay em replay.ts):
// renomear ou reescrever um comando velho é trabalho da migração (MIGRATIONS),
// que converte o save antigo para o formato atual antes de qualquer checagem.
// Este arquivo só recusa o que continua inválido depois de migrado, com mensagem
// em português que cita tick, type e versão do save.
// Este arquivo NÃO mexe no CommandSchema do contrato: nenhum type pode ser
// removido ou renomeado aqui, e o schema nunca é afrouxado para aceitar
// comando quebrado (a correção é escrever uma migração, ver receita 3.15 do guia).

// Formato mínimo do save que esta validação precisa (só versão e comandos):
// fica aqui em vez de importar de replay.ts para não criar ciclo entre módulos.
// Todo Replay de verdade passa aqui (tipagem estrutural).
interface Replay {
  version?: unknown;
  commands?: unknown;
}

interface IssueDetail {
  tick?: unknown;
  type?: unknown;
  timed?: unknown;
  cause?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function causeMessage(cause: unknown): string {
  if (typeof cause === "string" && cause.length > 0) return cause;
  if (cause instanceof Error && cause.message.length > 0) return cause.message;
  if (isRecord(cause) && typeof cause.message === "string" && cause.message.length > 0) {
    return cause.message;
  }
  return "formato que o jogo não entende";
}

function saveVersionText(replay: Replay): string {
  const version = (replay as { version?: unknown }).version;
  return typeof version === "number" ? String(version) : "desconhecida";
}

function tickTextFrom(detail: IssueDetail, timed: unknown): string {
  if (typeof detail.tick === "number") return String(detail.tick);
  if (isRecord(timed) && typeof timed.tick === "number") return String(timed.tick);
  return "desconhecido";
}

function typeTextFrom(detail: IssueDetail, timed: unknown): string {
  if (typeof detail.type === "string" && detail.type.length > 0) return detail.type;
  if (isRecord(timed) && isRecord(timed.command)) {
    const type = timed.command.type;
    if (typeof type === "string" && type.length > 0) return type;
  }
  return "desconhecido";
}

/** Monta a mensagem em português para um comando que o jogo não entende. */
export function describeCommandIssue(replay: Replay, error: unknown): string {
  const detail: IssueDetail = isRecord(error) ? (error as IssueDetail) : { cause: error };
  // O item original pode vir dentro do detalhe (validateReplayCommands sempre manda).
  const timed: unknown = detail.timed ?? (isRecord(error) && "tick" in (error as object) ? error : undefined);
  const tickText = tickTextFrom(detail, timed);
  const typeText = typeTextFrom(detail, timed);
  const reason = causeMessage(detail.cause ?? error);
  const saveVersion = saveVersionText(replay);
  return (
    `comando inválido no tick ${tickText} (type "${typeText}"): ${reason}. ` +
    `O save é da versão ${saveVersion}. Pode ser de uma versão mais nova deste jogo.`
  );
}

/** Recusa o save no primeiro comando que o jogo não entende (mesmo formato da tela). */
export function validateReplayCommands(replay: Replay): void {
  const commands = (replay as { commands?: unknown }).commands;
  // parseReplay já recusou save sem lista de comandos; aqui não há o que checar.
  if (!Array.isArray(commands)) return;
  for (const timed of commands) {
    if (!isRecord(timed)) {
      throw new Error(
        describeCommandIssue(replay, {
          timed,
          cause: "o item da lista de comandos não é um objeto com tick e command",
        }),
      );
    }
    const tick = (timed as { tick?: unknown }).tick;
    const command = (timed as { command?: unknown }).command;
    if (typeof tick !== "number" || Number.isNaN(tick)) {
      throw new Error(
        describeCommandIssue(replay, { timed, tick, cause: "falta o tick numérico do comando" }),
      );
    }
    if (!isRecord(command)) {
      throw new Error(describeCommandIssue(replay, { timed, tick, cause: "falta o objeto command" }));
    }
    const type = (command as { type?: unknown }).type;
    try {
      // O mesmo parseCommand que a tela usa: formato inválido recusa aqui;
      // limite de regra em runtime (ex.: factor da diretora) continua valendo só na hora de jogar.
      parseCommand(command);
    } catch (cause) {
      throw new Error(
        describeCommandIssue(replay, {
          timed,
          tick,
          type: typeof type === "string" ? type : undefined,
          cause,
        }),
      );
    }
  }
}
