/** Respostas às perguntas da tela (pessoa, lista de pessoas, save, relatório de bug). */
import type { FromWorker, ToWorker } from "@city/contract";
import type { Game } from "@city/sim";

export function answerQuery(_game: Game, msg: ToWorker): FromWorker | null {
  switch (msg.type) {
    case "queryPerson":
      return { type: "person", requestId: msg.requestId, person: null };
    case "queryPeople":
      return { type: "people", requestId: msg.requestId, total: 0, items: [] };
    default:
      return null;
  }
}
