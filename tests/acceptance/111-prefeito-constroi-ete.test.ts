/**
 * Issue #111 — o prefeito automático tem que construir a ETE quando falta esgoto.
 *
 * Regra travada: quando `currentCensus(game).withoutSewage > 300`, o prefeito automático
 * (`AutoMayor` em `packages/bots/src/mayor.ts`) tem que lançar a obra de uma ETE
 * (`placeService` com `service: "ete"`). Na main ele não faz isso: aos 90 dias quase
 * 24 mil pessoas seguem sem esgoto e nenhuma ETE é construída.
 *
 * Por que cada cenário é controlado:
 * - Cidade vazia construída só pelo prefeito (`bot: true`), dinheiro infinito
 *   (`economy.mode: "sandbox"`), semente fixa "avaliacao-livre", 90 dias: nela a
 *   população passa de 24 mil, os sem esgoto passam de 24 mil e só a partir do
 *   dia ~45 existe terreno válido para a ETE (3x3 livre, encostado em via e a até
 *   3 quadradinhos da água). Sem esse cenário o teste passaria à toa.
 * - O teste roda dia a dia com `createRun` (igual ao teste da issue #99) porque
 *   precisa parar no dia exato em que a ETE fica pronta: a obra leva
 *   `constructionMonths: 28` e a ETE só entra na malha em `BSTATE.active`.
 * - O cenário de dinheiro contado usa a config normal (modo `budget`, 60 dias): os dias em que
 *   falta esgoto, o caixa do começo do dia não paga a ETE e já existe lugar de ETE na cidade (a
 *   partir do dia ~54 nesta semente). Aí o prefeito tem que guardar dinheiro (o mesmo `saving`
 *   dos outros serviços) em vez de abrir rua nova ou insistir em obra recusada. Os dias são
 *   achados rodando a simulação, não congelados no teste.
 *
 * Semente fixa, sem `Math.random` e sem relógio: o mesmo teste dá sempre o mesmo resultado.
 */
import { createRun, loadConfigAndData } from "@city/cli";
import { BSTATE, currentCensus, type Game, statsView } from "@city/sim";
import { describe, expect, it } from "vitest";

/** Cidade de referência da issue: cidade vazia construída pelo prefeito, dinheiro infinito. */
const SEED = "avaliacao-livre";
const DAYS = 90;
const OVERRIDES = { economy: { mode: "sandbox" } };
/** Dias da cidade com dinheiro contado (modo `budget`, config normal). */
const BUDGET_DAYS = 60;
/** Gente sem esgoto que obriga o prefeito a construir a ETE. */
const SEWAGE_TRIGGER = 300;

/** Roda o bot do zero até o dia pedido e devolve o jogo naquele dia. */
const gamesPorDia = new Map<number, Game>();
function gameNoDia(dia: number): Game {
  const pronto = gamesPorDia.get(dia);
  if (pronto) return pronto;
  const { config, data } = loadConfigAndData(OVERRIDES);
  const run = createRun({ config, data, seed: SEED, days: DAYS, bot: true });
  while (run.game.sim.clock.day < dia) {
    if (!run.nextDay()) break;
  }
  gamesPorDia.set(dia, run.game);
  return run.game;
}

/** ETEs que contam como "o prefeito construiu" (tudo que não foi demolido). */
function standingEtes(game: Game): number[] {
  const b = game.sim.buildings;
  const out: number[] = [];
  for (let id = 0; id < b.count; id++) {
    if (b.typeOf(id).id !== "ete" || b.state[id] === BSTATE.demolished) continue;
    out.push(id);
  }
  return out;
}

/** Primeiro dia com alguma ETE pronta (`state === active`), rodando dia a dia; -1 se nunca. */
function firstEteReadyDay(): number {
  const { config, data } = loadConfigAndData(OVERRIDES);
  const run = createRun({ config, data, seed: SEED, days: DAYS, bot: true });
  while (true) {
    const ready = standingEtes(run.game).some((id) => run.game.sim.buildings.state[id] === BSTATE.active);
    if (ready) return run.game.sim.clock.day;
    if (!run.nextDay()) return -1;
  }
}

/**
 * Existe algum lugar onde uma ETE cabe hoje: 3x3 livre de via/prédio/água, encostado numa via e a até
 * 3 quadradinhos do rio ou lago (as mesmas três regras do comando `placeService`). Sem lugar assim o
 * prefeito não tem o que fazer, e o teste não pode cobrar dele que pare a cidade por isso.
 */
function temLugarDeEte(game: Game): boolean {
  const w = game.sim.world;
  const t = game.sim.buildings.catalog.find((tipo) => tipo.id === "ete")!;
  for (let y = 0; y < w.height; y++) {
    for (let x = 0; x < w.width; x++) {
      let fits = true;
      for (let dy = 0; dy < t.h && fits; dy++) {
        for (let dx = 0; dx < t.w; dx++) {
          if (!w.inBounds(x + dx, y + dy)) {
            fits = false;
            break;
          }
          const i = w.idx(x + dx, y + dy);
          if (w.roads[i] !== 0 || w.buildingAt[i]! >= 0 || w.water[i]) {
            fits = false;
            break;
          }
        }
      }
      if (!fits) continue;
      let perto = false;
      for (let ty = y - t.nearWater; ty < y + t.h + t.nearWater && !perto; ty++)
        for (let tx = x - t.nearWater; tx < x + t.w + t.nearWater; tx++)
          if (w.inBounds(tx, ty) && w.water[w.idx(tx, ty)]) {
            perto = true;
            break;
          }
      if (!perto) continue;
      if (game.sim.network.findAccess(x, y, t.w, t.h)[0] >= 0) return true;
    }
  }
  return false;
}

/** Quantos comandos `buildRoad` o prefeito já mandou até este dia (para provar que não abriu rua nova). */
function countBuildRoads(game: Game): number {
  let total = 0;
  for (const entry of game.sim.commandLog) {
    if (entry.command.type === "buildRoad") total++;
  }
  return total;
}

describe("issue #111: prefeito constrói a ETE quando falta esgoto", () => {
  it("aos 90 dias o prefeito construiu uma ETE, sempre num endereço válido", { timeout: 600000 }, () => {
    const game = gameNoDia(DAYS);
    const etes = standingEtes(game);
    // Primeiro: prova que o prefeito construiu ao menos uma, senão o resto passa à toa.
    expect(
      etes.length,
      `o prefeito automático não construiu ETE nenhuma em ${DAYS} dias com ` +
        `${currentCensus(game).withoutSewage} pessoas sem esgoto (gatilho: mais de ${SEWAGE_TRIGGER}): ` +
        `sem ETE construída o teste não prova nada`,
    ).toBeGreaterThanOrEqual(1);
    const world = game.sim.world;
    const b = game.sim.buildings;
    for (const id of etes) {
      const tipo = b.typeOf(id);
      const x = b.x[id]!;
      const y = b.y[id]!;
      // Cada quadradinho do terreno tem que estar livre de via e de água, como exige o `placeService`.
      for (let dy = 0; dy < tipo.h; dy++) {
        for (let dx = 0; dx < tipo.w; dx++) {
          const i = world.idx(x + dx, y + dy);
          expect(
            world.roads[i],
            `a ETE #${id} em (${x}, ${y}) ocupa o quadradinho (${x + dx}, ${y + dy}) com via: ` +
              `o prefeito construiu a ETE num endereço inválido (o placeService proíbe via no terreno)`,
          ).toBe(0);
          expect(
            world.water[i],
            `a ETE #${id} em (${x}, ${y}) ocupa o quadradinho (${x + dx}, ${y + dy}) com água: ` +
              `o prefeito construiu a ETE num endereço inválido (o placeService proíbe água no terreno)`,
          ).toBe(0);
        }
      }
      // Perto de rio ou lago: mesma conta do `nearWater` do motor (quadrado de
      // (y - d, y + h + d) em (x - d, x + w + d), só valendo quadradinho dentro do mapa).
      const d = tipo.nearWater;
      let near = false;
      for (let ty = y - d; ty < y + tipo.h + d && !near; ty++) {
        for (let tx = x - d; tx < x + tipo.w + d && !near; tx++) {
          if (world.inBounds(tx, ty) && world.water[world.idx(tx, ty)]) near = true;
        }
      }
      expect(
        near,
        `a ETE #${id} em (${x}, ${y}) ficou a mais de ${d} quadradinhos de rio ou lago: ` +
          `o prefeito construiu a ETE num endereço inválido (a ETE precisa despejar no rio ou lago)`,
      ).toBe(true);
    }
  });

  it("a ETE que o prefeito construiu aumenta a sobra de esgoto da malha", { timeout: 600000 }, () => {
    // O dia em que a obra ficou pronta: a ETE só entra na malha em `BSTATE.active`.
    const ready = firstEteReadyDay();
    expect(
      ready,
      `nenhuma ETE ficou pronta (state active) em ${DAYS} dias: sem ETE ativa ` +
        `não dá para provar que ela aumenta a sobra de esgoto da malha`,
    ).toBeGreaterThan(0);
    const game = gameNoDia(ready);
    const b = game.sim.buildings;
    // Um acesso de prédio residencial: é nele que se mede a sobra da malha de ruas.
    let acesso = -1;
    for (let id = 0; id < b.count && acesso < 0; id++) {
      if (b.typeOf(id).homes <= 0) continue;
      if (b.state[id] === BSTATE.demolished) continue;
      if (b.access[id]! < 0) continue;
      acesso = b.access[id]!;
    }
    expect(
      acesso,
      `no dia ${ready} não há prédio residencial com acesso à malha de ruas: ` +
        `sem esse cenário o teste não prova nada`,
    ).toBeGreaterThanOrEqual(0);
    const sobra = game.utilities.spareAt(acesso, "sewage");
    expect(
      sobra,
      `no dia ${ready} a sobra de esgoto na malha do acesso ${acesso} é ${sobra} ` +
        `(esperado mais de 1000): sem a ETE na malha só sobra a rede regional menos ` +
        `a demanda de esgoto da malha (~1); com a ETE ativa a sobra tinha que ser de dezenas de milhares`,
    ).toBeGreaterThan(1000);
  });

  it("`unmet.sewer` cai depois que a obra fica pronta", { timeout: 600000 }, () => {
    const ready = firstEteReadyDay();
    expect(
      ready,
      `nenhuma ETE ficou pronta (state active) em ${DAYS} dias: sem ETE ativa ` +
        `não dá para provar que o esgoto cobriu a malha`,
    ).toBeGreaterThan(0);
    const game = gameNoDia(ready);
    const censo = currentCensus(game);
    const semEsgoto = statsView(game).unmet.sewer;
    expect(
      semEsgoto,
      `no dia ${ready} ${semEsgoto} de ${censo.population} pessoas seguem sem esgoto ` +
        `(esperado menos de 5% da população): a ETE ficou pronta mas o esgoto não cobriu a malha`,
    ).toBeLessThan(censo.population * 0.05);
  });

  it("sem dinheiro para a ETE o prefeito guarda e não abre rua nova", { timeout: 600000 }, () => {
    // Dinheiro contado: config normal (modo `budget`), mesma semente, 60 dias.
    const { config, data } = loadConfigAndData();
    const run = createRun({ config, data, seed: SEED, days: BUDGET_DAYS, bot: true });
    // Custo lido do catálogo, nunca escrito à mão: se o preço mudar o cenário acompanha.
    const tipoEte = run.game.sim.buildings.catalog.find((tipo) => tipo.id === "ete");
    expect(
      tipoEte,
      `o catálogo de prédios não tem a ETE (id "ete"): sem o custo dela o teste não prova nada`,
    ).toBeDefined();
    const custoEte = tipoEte!.cost;
    // Roda dia a dia guardando o retrato de cada dia. O resultado do comando só sai
    // depois do `sim.step`, então drena todo dia, logo depois do `nextDay` que virou o dia.
    const dinheiro: number[] = [run.game.sim.treasury.money];
    const semEsgotoPorDia: number[] = [currentCensus(run.game).withoutSewage];
    const ruasAteODia: number[] = [countBuildRoads(run.game)];
    const recusadosNoDia: number[] = [0];
    const temLugar: boolean[] = [temLugarDeEte(run.game)];
    while (run.game.sim.clock.day < BUDGET_DAYS) {
      if (!run.nextDay()) break;
      let recusados = 0;
      for (const r of run.game.sim.drainResults()) {
        if (r.command.type === "placeService" && !r.ok) recusados++;
      }
      dinheiro.push(run.game.sim.treasury.money);
      semEsgotoPorDia.push(currentCensus(run.game).withoutSewage);
      ruasAteODia.push(countBuildRoads(run.game));
      recusadosNoDia.push(recusados);
      temLugar.push(temLugarDeEte(run.game));
    }
    // Todos os dias em que falta esgoto, o caixa do COMEÇO do dia (o do fim do dia anterior) não paga
    // a ETE e EXISTE lugar de ETE na cidade. São esses dias que medem a regra: o prefeito sabe que
    // precisa da ETE e não tem dinheiro, então entra no mesmo `saving` dos outros serviços (guarda)
    // e não abre rua nova nem insiste em obra recusada. Dias sem lugar válido ficam de fora: sem
    // lugar o prefeito não tem o que pedir, e a cidade não pode parar por causa disso.
    // O primeiro assert prova que esse caso existe de verdade nesta semente.
    const semDinheiro: number[] = [];
    for (let d = 1; d <= dinheiro.length - 1; d++) {
      if (semEsgotoPorDia[d - 1]! > SEWAGE_TRIGGER && dinheiro[d - 1]! < custoEte && temLugar[d - 1]!)
        semDinheiro.push(d);
    }
    expect(
      semDinheiro.length,
      `o cenário de dinheiro contado não tem nenhum dia com mais de ${SEWAGE_TRIGGER} pessoas ` +
        `sem esgoto, menos de R$ ${custoEte} em caixa e lugar de ETE na cidade em ${BUDGET_DAYS} dias: ` +
        `sem esse caso o teste não prova nada`,
    ).toBeGreaterThan(0);
    const comRua = semDinheiro.filter((d) => ruasAteODia[d]! > ruasAteODia[d - 1]!);
    const primeiro = comRua[0] ?? semDinheiro[0]!;
    const ruaDoDia = comRua.length === 0 ? 0 : ruasAteODia[primeiro]! - ruasAteODia[primeiro - 1]!;
    expect(
      ruaDoDia,
      `nos dias ${comRua.join(", ")} o prefeito abriu rua nova (${ruaDoDia} comando(s) buildRoad no dia ` +
        `${primeiro}) começando o dia com R$ ${dinheiro[primeiro - 1]!} em caixa, sem os R$ ${custoEte} da ` +
        `ETE e com ${semEsgotoPorDia[primeiro - 1]!} pessoas sem esgoto: sem dinheiro para a ETE ele tinha ` +
        `que guardar, não abrir rua nova`,
    ).toBe(0);
    const comRecusa = semDinheiro.filter((d) => recusadosNoDia[d]! > 1);
    const primeiroRecusa = comRecusa[0] ?? primeiro;
    const recusaDoDia = comRecusa.length === 0 ? 0 : recusadosNoDia[primeiroRecusa]!;
    expect(
      recusaDoDia,
      `nos dias ${comRecusa.join(", ")} o prefeito insiste em serviço que não paga: no dia ${primeiroRecusa} ` +
        `houve ${recusaDoDia} placeService recusado(s) começando com R$ ${dinheiro[primeiroRecusa - 1]!} em ` +
        `caixa, sem os R$ ${custoEte} da ETE: sem dinheiro ele tinha que guardar, não insistir em obra recusada`,
    ).toBeLessThanOrEqual(1);
  });
});
