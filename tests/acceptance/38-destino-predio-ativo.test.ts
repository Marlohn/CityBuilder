/**
 * Issue #38 — achar o destino da viagem: o prédio ativo mais próximo de um tipo.
 *
 * Para mandar alguém para a loja, para a UBS ou para a escola, o motor precisa achar um prédio de
 * verdade perto de onde a pessoa está. Hoje só existe `VacancyMarket`
 * (`packages/sim/src/markets/markets.ts`), que devolve prédios COM VAGA (used < capacity). Uma loja
 * não tem "vaga" para o cliente: a pessoa entra se o prédio estiver em uso. Esta tarefa cria o jeito
 * de achar o destino de uma viagem: o prédio ATIVO mais próximo de um filtro de tipo do catálogo
 * (por `service` ou por `zone`), na mesma malha de vias de onde a pessoa saiu e dentro da distância
 * máxima pedida.
 *
 * Cidade de teste (semente fixa, mapa 160 x 160, sem água, dinheiro infinito):
 *   - malha principal, ligada à estrada de acesso que vem da borda oeste em y = 80: casas em cima
 *     da avenida (y de 60 a 79) e comércio embaixo (y de 81 a 99);
 *   - uma rua separada (y = 70, x de 47 a 90) que NÃO encosta na malha principal, com uma UBS
 *     colada nela: essa UBS está mais perto no papel (384 m), mas ninguém sai de casa para chegar lá;
 *   - uma UBS na malha principal, longe da origem (1.152 m).
 *
 * Um `it` por regra do "tá pronto quando" da issue #38.
 */
import { BSTATE, type BuildingType, checkInvariants, type Game, Rng } from "@city/sim";
import { describe, expect, it } from "vitest";
import { createTestGame } from "../helpers";

/** O que o método novo devolve: prédio escolhido e distância em metros (o mesmo formato do `findNear`). */
interface Destino {
  building: number;
  meters: number;
}

/** Filtro de tipo: recebe o tipo do catálogo (`data/buildings.yaml`) e diz se ele serve. */
type Filtro = (tipo: BuildingType) => boolean;

/** Assinatura do método novo, na mesma ordem do `VacancyMarket.findNear` de hoje. */
type Finder = (
  rng: Rng,
  fromTile: number,
  filtro: Filtro,
  samples: number,
  maxMeters?: number,
) => Destino | null;

/** Nomes e lugares aceitos para o método novo: o teste fixa o comportamento, não o nome exato. */
const NOMES = [
  "findActiveNear",
  "findActiveNearest",
  "findActiveByType",
  "findByType",
  "findDestination",
  "nearestActive",
];

/**
 * Acha o método novo que devolve o prédio ativo mais próximo de um tipo. Ele pode estar em
 * `city.markets` ou em um dos quatro mercados; a assinatura é a de cima.
 */
function acharFinder(game: Game): Finder {
  const alvos: unknown[] = [game.city.markets, ...Object.values(game.city.markets)];
  for (const alvo of alvos) {
    for (
      let obj = alvo as Record<string, unknown> | null;
      obj;
      obj = Object.getPrototypeOf(obj) as Record<string, unknown> | null
    ) {
      for (const nome of NOMES) {
        const f = obj[nome];
        if (typeof f === "function") return (f as Finder).bind(alvo);
      }
    }
  }
  throw new Error(
    `issue #38: não achei o método que devolve o prédio ativo mais próximo de um tipo. ` +
      `Procurei ${NOMES.join(", ")} em city.markets e nos quatro mercados.`,
  );
}

const SEMENTE = "destino-38";
const AVENIDA = 80; // linha da malha principal (e da estrada de acesso que vem da borda oeste)
const RUA_SEPARADA = 70; // rua que não encosta na malha principal
const ORIGEM = { x: 48, y: AVENIDA }; // via de onde a pessoa sai
const CIDADE = {
  world: { width: 160, height: 160, water: { enabled: false } },
  economy: { mode: "sandbox" },
} as const;

/** A cidade do teste: malha principal com casas e comércio, mais uma malha separada com uma UBS. */
function cidadeComLojasEUbs(): Game {
  return createTestGame({
    seed: SEMENTE,
    days: 5,
    overrides: { ...CIDADE },
    commands: [
      { type: "buildRoad", kind: "street", x0: 47, y0: RUA_SEPARADA, x1: 90, y1: RUA_SEPARADA },
      { type: "buildRoad", kind: "avenue", x0: 47, y0: AVENIDA, x1: 130, y1: AVENIDA },
      { type: "buildRoad", kind: "street", x0: 47, y0: 100, x1: 130, y1: 100 },
      { type: "buildRoad", kind: "street", x0: 90, y0: AVENIDA, x1: 90, y1: 100 },
      { type: "zone", zone: "residential_low", x0: 48, y0: 60, x1: 129, y1: 79 },
      { type: "zone", zone: "commercial", x0: 48, y0: 81, x1: 129, y1: 99 },
      { type: "placeService", service: "ubs", x: 62, y: RUA_SEPARADA + 1 },
      { type: "placeService", service: "ubs", x: 120, y: AVENIDA + 1 },
    ],
  });
}

/** Um sorteio novo e sempre igual a cada chamada (mesma semente, mesma sequência). */
const rng = (nome: string) => new Rng(`${SEMENTE}/${nome}`);

const tile = (game: Game, x: number, y: number) => game.sim.world.idx(x, y);
const origem = (game: Game) => tile(game, ORIGEM.x, ORIGEM.y);

/** Distância, em metros, da origem até a via de acesso do prédio. */
function distancia(game: Game, b: number): number {
  return game.sim.world.manhattanMeters(origem(game), game.sim.buildings.access[b]!);
}

/** Todos os prédios (em uso, em obra ou demolidos) que casam com o filtro. */
function comFiltro(game: Game, filtro: Filtro): number[] {
  const b = game.sim.buildings;
  return [...Array(b.count).keys()].filter((id) => filtro(b.typeOf(id)));
}

/** Prédios em uso do tipo pedido que estão na mesma malha de vias da origem (a régua do teste). */
function ativosNaMesmaMalha(game: Game, filtro: Filtro): number[] {
  const { sim } = game;
  sim.network.refresh();
  const comp = sim.network.component[origem(game)]!;
  return comFiltro(game, filtro).filter(
    (b) => sim.buildings.isActive(b) && sim.network.component[sim.buildings.access[b]!] === comp,
  );
}

/** O mais perto dentro da malha, com desempate pelo menor id (como manda a issue). */
function maisProximo(game: Game, filtro: Filtro): Destino | null {
  let melhor: number | null = null;
  for (const b of ativosNaMesmaMalha(game, filtro)) {
    if (melhor === null || distancia(game, b) < distancia(game, melhor)) melhor = b;
    else if (distancia(game, b) === distancia(game, melhor) && b < melhor) melhor = b;
  }
  return melhor === null ? null : { building: melhor, meters: distancia(game, melhor) };
}

describe("issue #38: destino da viagem é o prédio ativo mais próximo do tipo", () => {
  const cidade = cidadeComLojasEUbs();

  it("devolve o prédio em uso mais próximo do tipo pedido, com a distância em metros", () => {
    const esperado = maisProximo(cidade, (t) => t.zone === "commercial");
    expect(esperado, "a cidade do teste precisa ter comércio em uso perto da origem").not.toBeNull();
    const achado = acharFinder(cidade)(rng("comercial"), origem(cidade), (t) => t.zone === "commercial", 32);
    expect(achado, "havia comércio no alcance, então o método não podia devolver null").not.toBeNull();
    expect(achado?.building, "o destino tem de ser o prédio em uso mais perto, não outro").toBe(
      esperado?.building,
    );
    expect(achado?.meters, "a distância devolvida tem de ser a distância real até a via do prédio").toBe(
      esperado?.meters,
    );
    expect(
      cidade.sim.buildings.isActive(achado?.building ?? -1),
      "o destino de uma viagem é um prédio em uso, nunca uma obra ou um terreno vazio",
    ).toBe(true);
  });

  it("filtra por service e por zone, e nunca devolve um prédio de outro tipo", () => {
    const achar = acharFinder(cidade);
    const ubs = achar(rng("saude"), origem(cidade), (t) => t.service === "health", 32);
    expect(ubs, "a cidade do teste precisa ter UBS na malha principal").not.toBeNull();
    expect(
      cidade.sim.buildings.typeOf(ubs?.building ?? -1).service,
      "pedi service = health e o método devolveu outro tipo de prédio",
    ).toBe("health");
    const loja = achar(rng("loja"), origem(cidade), (t) => t.zone === "commercial", 32);
    expect(loja, "a cidade do teste precisa ter comércio na malha principal").not.toBeNull();
    expect(
      cidade.sim.buildings.typeOf(loja?.building ?? -1).zone,
      "pedi zone = commercial e o método devolveu outro tipo de prédio",
    ).toBe("commercial");
    expect(
      achar(rng("industria"), origem(cidade), (t) => t.zone === "industrial", 32),
      "esta cidade não tem indústria: sem prédio do tipo no alcance, tem de devolver null",
    ).toBeNull();
  });

  it("nunca devolve prédio de outra malha de vias, mesmo estando mais perto no papel", () => {
    const { sim } = cidade;
    sim.network.refresh();
    const comp = sim.network.component[origem(cidade)]!;
    const ubsSeparada = comFiltro(cidade, (t) => t.service === "health").find(
      (b) => sim.network.component[sim.buildings.access[b]!] !== comp,
    );
    const ubsDaMalha = maisProximo(cidade, (t) => t.service === "health");
    expect(
      ubsSeparada,
      "a cidade do teste precisa ter uma UBS em outra malha de vias, senão o teste não prova nada",
    ).toBeGreaterThanOrEqual(0);
    expect(
      distancia(cidade, ubsSeparada ?? -1),
      "a UBS de outra malha tinha de estar mais perto no papel, senão o teste não prova nada",
    ).toBeLessThan(ubsDaMalha?.meters ?? 0);
    const achado = acharFinder(cidade)(rng("malha"), origem(cidade), (t) => t.service === "health", 32);
    expect(
      achado?.building,
      "a pessoa não atravessa a cidade a pé: a malha de vias tem de valer, e a UBS de outra malha nunca é destino",
    ).toBe(ubsDaMalha?.building);
  });

  it("nunca devolve prédio em obra nem prédio demolido", () => {
    const jogo = cidadeComLojasEUbs();
    const { sim } = jogo;
    const achar = acharFinder(jogo);
    const comercial = (t: BuildingType) => t.zone === "commercial";
    const proximo = achar(rng("obra-1"), origem(jogo), comercial, 32);
    expect(proximo, "a cidade do teste precisa ter comércio em uso").not.toBeNull();
    const b = proximo?.building ?? -1;

    // O jogador derruba o prédio mais perto: ele continua no histórico, mas ninguém entra nele.
    const x0 = sim.buildings.x[b]!;
    const y0 = sim.buildings.y[b]!;
    sim.enqueue({
      type: "bulldoze",
      x0,
      y0,
      x1: x0 + sim.buildings.w[b]! - 1,
      y1: y0 + sim.buildings.h[b]! - 1,
    });
    sim.step(1);
    sim.drainResults();
    expect(
      sim.buildings.state[b],
      `o bulldoze tinha de derrubar o prédio ${b}, senão o teste não prova nada`,
    ).toBe(BSTATE.demolished);
    const depois = achar(rng("obra-2"), origem(jogo), comercial, 32);
    expect(depois?.building, "um prédio demolido não pode ser o destino de ninguém").not.toBe(b);
    expect(
      depois?.meters,
      "depois do bulldoze o destino tem de ser o próximo prédio em uso, e não o mesmo de antes",
    ).toBeGreaterThan(proximo?.meters ?? 0);
    expect(
      ativosNaMesmaMalha(jogo, comercial).map((x) => distancia(jogo, x)),
      "o destino tem de estar entre os prédios em uso da malha",
    ).toContain(depois?.meters);

    // E uma obra nova, colada na origem: em obra não é destino. O terreno é limpo no mesmo tick.
    sim.enqueue({
      type: "bulldoze",
      x0: ORIGEM.x,
      y0: AVENIDA + 1,
      x1: ORIGEM.x + 1,
      y1: AVENIDA + 2,
    });
    sim.enqueue({ type: "placeService", service: "ubs", x: ORIGEM.x, y: AVENIDA + 1 });
    sim.step(1);
    sim.drainResults();
    const obra = comFiltro(jogo, (t) => t.service === "health").find(
      (id) => sim.buildings.state[id] === BSTATE.constructing,
    );
    expect(obra, "a cidade do teste precisa ter uma UBS em obra colada na origem").toBeGreaterThanOrEqual(0);
    expect(
      distancia(jogo, obra ?? -1),
      "a UBS em obra tinha de ser a mais perto de todas, senão o teste não prova nada",
    ).toBe(0);
    const achado = achar(rng("obra-3"), origem(jogo), (t) => t.service === "health", 32);
    expect(achado?.building, "quem ainda está em obra não recebe ninguém").not.toBe(obra);
  });

  it("respeita a distância máxima pedida e devolve null quando não há nada no alcance", () => {
    const achar = acharFinder(cidade);
    const perto = maisProximo(cidade, (t) => t.zone === "commercial");
    expect(perto, "a cidade do teste precisa ter comércio em uso").not.toBeNull();
    const limite = (perto?.meters ?? 0) - 16; // 16 m = 1 quadradinho
    expect(
      achar(rng("limite-1"), origem(cidade), (t) => t.zone === "commercial", 32, limite),
      `o comércio mais perto fica a ${perto?.meters} m: com o limite em ${limite} m não podia devolver nada, nem um prédio mais longe`,
    ).toBeNull();
    const noLimite = achar(
      rng("limite-2"),
      origem(cidade),
      (t) => t.zone === "commercial",
      32,
      perto?.meters,
    );
    expect(
      noLimite?.building,
      `com o limite em ${perto?.meters} m (exatamente a distância do mais perto) o prédio tem de caber`,
    ).toBe(perto?.building);
  });

  it("devolve null (e não trava) quando não existe prédio do tipo", () => {
    const vazia = createTestGame({ seed: SEMENTE, days: 2, overrides: { ...CIDADE } });
    const achar = acharFinder(vazia);
    const via = tile(vazia, 20, AVENIDA); // sobra só a estrada de acesso
    expect(
      achar(rng("vazia-1"), via, (t) => t.zone === "commercial", 32),
      "cidade sem prédio nenhum: null, sem exceção",
    ).toBeNull();
    expect(
      achar(rng("vazia-2"), via, (t) => t.service === "health", 32),
      "cidade sem prédio nenhum: null, sem exceção",
    ).toBeNull();
    expect(
      achar(rng("vazia-3"), -1, (t) => t.zone === "residential_low", 32),
      "sem via de saída e sem prédio do tipo: null, sem exceção",
    ).toBeNull();
  });

  it("com muitas opções e poucas amostras, o sorteio é reprodutível: mesma semente, mesmo resultado", () => {
    const a = cidadeComLojasEUbs();
    const b = cidadeComLojasEUbs();
    expect(
      a.sim.buildings.count,
      "as duas cidades têm de ser iguais para a comparação de semente valer",
    ).toBe(b.sim.buildings.count);
    const acharA = acharFinder(a);
    const acharB = acharFinder(b);
    const respostasA: string[] = [];
    const respostasB: string[] = [];
    for (let x = ORIGEM.x; x <= 129; x++) {
      const da = acharA(rng("sorteio"), tile(a, x, AVENIDA), (t) => t.zone === "commercial", 2, 1200);
      const db = acharB(rng("sorteio"), tile(b, x, AVENIDA), (t) => t.zone === "commercial", 2, 1200);
      respostasA.push(da ? `${da.building}@${da.meters}` : "null");
      respostasB.push(db ? `${db.building}@${db.meters}` : "null");
    }
    const diferentes = respostasA.filter((v, i) => v !== respostasB[i]).length;
    expect(
      respostasB,
      `mesma semente tem de dar o mesmo resultado: ${diferentes} de ${respostasA.length} respostas ` +
        `saíram diferentes (${comFiltro(a, (t) => t.zone === "commercial").length} opções, 2 amostras)`,
    ).toEqual(respostasA);
  });

  it("não mexe no comportamento dos quatro mercados que já existem", () => {
    // Respostas de hoje (semente destino-38, 5 dias, via de saída 48,80), medidas antes desta tarefa:
    // a casa não tem vaga sobrando, a escola não tem aluno nem vaga, o emprego e a UBS sim.
    // Se qualquer uma destas respostas mudar, algum dos quatro mercados foi mexido: a issue #38 diz
    // que eles não podem mudar.
    const { city } = cidade;
    const via = origem(cidade);
    const Antes = {
      housing: null,
      jobs: { building: 89, meters: 688 },
      schools: null,
      clinics: { building: 1, meters: 1152 },
    };
    expect(
      {
        housing: city.markets.housing.findNear(rng("m1"), via, 6),
        jobs: city.markets.jobs.findNear(rng("m2"), via, 6),
        schools: city.markets.schools.findNear(rng("m3"), via, 6),
        clinics: city.markets.clinics.findNear(rng("m4"), via, 6),
      },
      "os quatro mercados têm de continuar devolvendo exatamente o que devolvem hoje (nenhum mudou)",
    ).toEqual(Antes);
    expect(
      cidade.sim.buildings.typeOf(Antes.jobs.building).jobs,
      "o mercado de emprego só devolve prédio com vaga de trabalho",
    ).toBeGreaterThan(0);
    expect(
      cidade.sim.buildings.typeOf(Antes.clinics.building).service,
      "o mercado de UBS só devolve prédio de saúde",
    ).toBe("health");
  });

  it("nada surge do nada: as regras que nunca podem quebrar continuam valendo", () => {
    expect(checkInvariants(cidade.city)).toEqual([]);
  });
});
