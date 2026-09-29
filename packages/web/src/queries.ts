/** Respostas às perguntas da tela (pessoa, lista de pessoas, save, relatório de bug). */
import type { FromWorker, ToWorker } from "@city/contract";
import { type Game, peopleList, personView } from "@city/sim";

export function answerQuery(game: Game, msg: ToWorker): FromWorker | null {
  switch (msg.type) {
    case "queryPerson":
      return { type: "person", requestId: msg.requestId, person: personView(game.city, msg.id) };
    case "queryPeople": {
      const r = peopleList(game.city, msg.filter, msg.offset, msg.limit, msg.buildingId);
      return { type: "people", requestId: msg.requestId, total: r.total, items: r.items };
    }
    default:
      return null;
  }
}
