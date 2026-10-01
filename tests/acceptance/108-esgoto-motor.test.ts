/**
 * Esgoto como terceiro tipo de utilidade (issue #108).
 *
 * O sewage entra no UtilitiesSystem pelo mesmo caminho da agua e da luz: a rede de
 * esgoto segue as ruas (componente da rede viaria), quem produz e a ETE (service: sewage)
 * ou a rede da regiao (regionalSewage, que chega pela estrada de acesso), e cada predio
 * consome `demandOf(homes, jobs) * sewageShareOfConsumption`.
 *
 * Este teste trava tres coisas que o desperdicio e a falta de esgoto precisam levar a serio:
 * - a rede de esgoto regional e a propria conta: com `regionalSewage` apertado existem
 *   predios com agua e sem esgoto ao mesmo tempo (e nao e por causa da agua que faltou).
 *   O criterio e medido por predio e nao por sobra: a sobra e conta do `recompute` e sobra
 *   residual nao diz se a malha encheu de esgoto (a regra da fossa septica, sem ETE na malha,
 *   deixa o esgoto sem tocar na construtora, entao a sobra pode ficar maior que a da agua);
 * - a ETE serve a malha dela e so a malha dela: placing uma ETE liga o esgoto daquela malha,
 *   derrubar a ETE desliga de novo, e outra malha de ruas sem ETE e sem saida continua sem esgoto;
 * - `served()` NAO olha esgoto (decisao escrita na issue): falta de esgoto nao tira o servico.
 *
 * Detalhes honestos do desenho (para ninguem "simplificar" depois):
 * - A ETE do catalogo tem `nearWater: 3`, entao o `it` da ETE usa mapa com agua e procura
 *   um ponto seco a 1..3 quadradinhos do rio, como o teste antigo da ETA faz. O ponto e
 *   procurado no mapa, nao fixo, para nao depender da semente cair num canto.
 * - A segunda malha do `it` de malhas so ganha predio enquanto tem ligacao com a borda
 *   (`growth.requiresOutsideConnection`): ela nasce ligada por uma rua de apoio ate a borda
 *   oeste e o `it` DEMOLE essa rua no meio. No fim as duas malhas estao separadas, sem
 *   saida, e a segunda continua com predios ativos de pe (ninguem sai de uma casa so por
 *   faltar esgoto - ver o `it` do served()).
 * - `hasSewage` ainda nao existe na main: o acesso vai por `sewageOf` (cast nominal, sem
 *   `as any`), que falha em execucao com `undefined[b]` ate a #108 criar o array de verdade.
 */
import { BSTATE, type Game } from "@city/sim";
import { describe, expect, it } from "vitest";
import { createTestGame } from "../helpers";

/** Regional de agua e luz do teste antigo de agua/luz: acaba antes dos lotes. */
const REGIONAL = 60;
/** Regional de esgoto apertado: a cidade cresce, mas o esgoto nao acompanha. */
const REGIONAL_ESGOTO = 15;

interface MalhaEte {
  /** Canto da ETE (3x3) que encosta no rio. */
  x: number;
  y: number;
  /** Rua vertical da malha. */
  X: number;
  /** Rua de servico (poço e subestação), na outra ponta da malha. */
  Y: number;
}

/**
 * Le o hasSewage por cast nominal: compila na main (onde o campo ainda nao existe) e falha
 * em execucao com `undefined[b]` ate a #108 criar o array de verdade.
 */
function sewageOf(game: Game, b: number): number {
  const bs = game.sim.buildings as unknown as { hasSewage: Uint8Array };
  return bs.hasSewage[b]!;
}

/**
 * Sobra de um tipo de utilidade na malha de um acesso. Cast nominal pelo mesmo motivo do
 * `sewageOf`: `Kind` ainda e "water" | "power" na main, entao ler "sewage" falha ate a #108.
 */
function spareDe(game: Game, access: number, kind: "water" | "power" | "sewage"): number {
  const u = game.utilities as unknown as {
    spareAt(access: number, kind: "water" | "power" | "sewage"): number;
  };
  return u.spareAt(access, kind);
}

function stepDays(game: Game, days: number): void {
  game.sim.step(days * game.sim.clock.ticksPerDay);
}

/** Rua + zonas iguais as do teste antigo de agua e luz. */
function ruaPrincipal(s: Game["sim"]): void {
  s.enqueue({ type: "buildRoad", kind: "street", x0: 30, y0: 24, x1: 30, y1: 64 });
  s.enqueue({ type: "zone", zone: "residential_low", x0: 31, y0: 24, x1: 32, y1: 63 });
  s.enqueue({ type: "zone", zone: "commercial", x0: 28, y0: 24, x1: 29, y1: 63 });
}

/** Rua de servico da montagem antiga (onde vao o poco e a subestacao). */
function ruaDeServico(s: Game["sim"]): void {
  s.enqueue({ type: "buildRoad", kind: "street", x0: 30, y0: 23, x1: 36, y1: 23 });
  s.enqueue({ type: "buildRoad", kind: "street", x0: 36, y0: 23, x1: 36, y1: 34 });
}

/**
 * Ponto seco para a ETE: um retangulo 3x3 seco com agua a ate `nearWater` (3) de distancia,
 * mais as ruas da malha e o lugar do poco e da subestacao, tudo seco. Varre o mapa na ordem
 * dos indices, entao o ponto e deterministico para a semente. Igual ao teste antigo da ETA.
 */
function achaPontoDaEte(game: Game): MalhaEte | null {
  const w = game.sim.world;
  const seca = (tx: number, ty: number): boolean => w.inBounds(tx, ty) && !w.water[w.idx(tx, ty)];
  const agua = (tx: number, ty: number): boolean => w.inBounds(tx, ty) && !!w.water[w.idx(tx, ty)];
  for (let i = 0; i < w.size; i++) {
    const x = w.xOf(i);
    const y = w.yOf(i);
    const X = x - 4; // rua vertical da malha
    const Y = y - 14; // rua de servico, na outra ponta
    if (X < 8 || X + 8 > w.width || Y - 2 < 0 || Y + 16 >= w.height) continue;
    let ok = true;
    for (let ty = y + 1; ok && ty <= y + 3; ty++)
      for (let tx = x - 3; ok && tx <= x - 1; tx++) ok = seca(tx, ty); // ETE 3x3
    if (!ok) continue;
    let perto = false;
    for (let ty = y - 2; !perto && ty <= y + 6; ty++)
      for (let tx = x - 6; !perto && tx <= x + 2; tx++) perto = agua(tx, ty);
    if (!perto) continue;
    for (let ty = Y; ok && ty <= y + 14; ty++) ok = seca(X, ty); // rua vertical
    for (let tx = X; ok && tx <= X + 6; tx++) ok = seca(tx, Y); // rua de servico
    for (let ty = Y + 1; ok && ty <= Y + 2; ty++) ok = ok && seca(X + 1, ty) && seca(X + 3, ty); // poco e subestacao
    if (ok) return { x, y, X, Y };
  }
  return null;
}

/** A malha da ETE: rua vertical, zonas dos dois lados e rua de servico no outro extremo. */
function montaMalhaDaEte(s: Game["sim"], m: MalhaEte): void {
  s.enqueue({ type: "buildRoad", kind: "street", x0: m.X, y0: m.Y, x1: m.X, y1: m.y + 14 });
  s.enqueue({ type: "zone", zone: "residential_low", x0: m.X + 1, y0: m.Y + 1, x1: m.X + 2, y1: m.y + 13 });
  s.enqueue({ type: "zone", zone: "commercial", x0: m.X - 2, y0: m.Y + 1, x1: m.X - 1, y1: m.y + 13 });
  s.enqueue({ type: "buildRoad", kind: "street", x0: m.X, y0: m.Y, x1: m.X + 6, y1: m.Y });
  s.enqueue({ type: "placeService", service: "poco", x: m.X + 1, y: m.Y + 1 });
  s.enqueue({ type: "placeService", service: "subestacao", x: m.X + 3, y: m.Y + 1 });
}

/**
 * Contagem por tipo na malha da ETE. `soComAgua` filtra os predios com agua ligada, para
 * provar que a falta de esgoto e falta de esgoto - e nao falta de agua.
 */
function conta(
  game: Game,
  soComAgua = false,
): {
  ativos: number;
  comAgua: number;
  comLuz: number;
  comEsgoto: number;
  aguaSemEsgoto: number;
  alvoDeServed: number;
} {
  const bs = game.sim.buildings;
  const out = { ativos: 0, comAgua: 0, comLuz: 0, comEsgoto: 0, aguaSemEsgoto: 0, alvoDeServed: 0 };
  for (let b = 0; b < bs.count; b++) {
    if (!bs.isActive(b)) continue;
    const comAgua = bs.hasWater[b] === 1;
    if (soComAgua && !comAgua) continue;
    out.ativos++;
    if (comAgua) out.comAgua++;
    if (bs.hasPower[b] === 1) out.comLuz++;
    const comEsgoto = sewageOf(game, b) === 1;
    if (comEsgoto) out.comEsgoto++;
    if (comAgua && !comEsgoto) out.aguaSemEsgoto++;
    // Alvo do `it` do served(): agua e luz sim, esgoto nao.
    if (comAgua && bs.hasPower[b] === 1 && !comEsgoto) out.alvoDeServed++;
  }
  return out;
}

/** Prédios ativos do outro lado da cidade (fora da malha da ETE). */
function ativosLongeDaEte(game: Game, m: MalhaEte): number[] {
  const bs = game.sim.buildings;
  const out: number[] = [];
  for (let b = 0; b < bs.count; b++) if (bs.isActive(b) && bs.x[b]! < m.X - 3) out.push(b);
  return out;
}

describe("esgoto no motor (issue #108)", () => {
  it("a rede de esgoto regional e pequena: o esgoto nao acompanha a da agua nos predios", () => {
    const cidade = (seed: string, regionalSewage: number): Game =>
      createTestGame({
        seed,
        overrides: {
          world: { width: 128, height: 128, water: { enabled: false } },
          economy: { mode: "sandbox" },
          utilities: {
            regionalWater: REGIONAL,
            regionalPower: REGIONAL,
            regionalSewage,
            sewageShareOfConsumption: 0.8,
          },
        },
      });
    // Mesma semente e mesma malha nas duas cidades: so `regionalSewage` muda.
    const apertada = cidade("esgoto-108-regional", REGIONAL_ESGOTO);
    const folgada = cidade("esgoto-108-regional", REGIONAL);
    ruaPrincipal(apertada.sim);
    ruaPrincipal(folgada.sim);
    stepDays(apertada, 3);
    stepDays(folgada, 3);
    const cAbert = conta(apertada);
    expect(cAbert.comAgua, "sanidade: a rede regional de agua liga predios").toBeGreaterThan(0);
    expect(cAbert.comLuz, "sanidade: a rede regional de luz liga predios").toBeGreaterThan(0);

    // O gargalo da cidade e o esgoto, nao a agua: a rede de agua e de luz tem sobra, mas a
    // de esgoto e pequena demais para a cidade, entao existem predios COM agua e SEM esgoto.
    // Medido por predio, nao por sobra: sobra residual e conta do `recompute` e o criterio
    // fala em predios ligados. A sobra so e comparada entre as duas cidades (mesma semente,
    // mesma malha): crescer a rede regional de esgoto aumenta a sobra.
    const cAperto = conta(apertada, true);
    expect(cAperto.comAgua, "sanidade: a cidade apertada tem predios com agua").toBeGreaterThan(0);
    expect(
      cAperto.aguaSemEsgoto,
      `com regionalSewage ${REGIONAL_ESGOTO} a rede de esgoto regional nao acompanha a de agua: ` +
        "tem que existir predio com agua e sem esgoto",
    ).toBeGreaterThan(0);
    // Com a rede regional de esgoto do mesmo tamanho da de agua, a malha enche de esgoto.
    const c2 = conta(folgada, true);
    expect(c2.comAgua, "sanidade: a cidade folgada tem predios com agua").toBeGreaterThan(0);
    expect(c2.comEsgoto, "com regionalSewage do mesmo tamanho, todo predio com agua tem esgoto").toBe(
      c2.comAgua,
    );
    const acesso = (game: Game): number => {
      const bs = game.sim.buildings;
      for (let b = 0; b < bs.count; b++) if (bs.isActive(b)) return bs.access[b]!;
      return -1;
    };
    const accApertada = acesso(apertada);
    const accFolgada = acesso(folgada);
    expect(accApertada, "sanidade: existe acesso na cidade apertada").toBeGreaterThanOrEqual(0);
    expect(accFolgada, "sanidade: existe acesso na cidade folgada").toBeGreaterThanOrEqual(0);
    if (accApertada < 0 || accFolgada < 0) return;
    expect(
      spareDe(folgada, accFolgada, "sewage"),
      `a sobra de esgoto cresce quando a rede regional cresce (apertada: ${spareDe(
        apertada,
        accApertada,
        "sewage",
      )})`,
    ).toBeGreaterThan(spareDe(apertada, accApertada, "sewage"));
  });

  it("com uma ETE na mesma malha todo predio ativo passa a ter esgoto", () => {
    const game = createTestGame({
      seed: "esgoto-108-ete",
      overrides: {
        world: { width: 128, height: 128 },
        economy: { mode: "sandbox" },
        utilities: {
          regionalWater: REGIONAL,
          regionalPower: REGIONAL,
          regionalSewage: REGIONAL_ESGOTO,
          sewageShareOfConsumption: 0.8,
        },
      },
    });
    const malha = achaPontoDaEte(game);
    expect(malha, "a semente tem que ter um ponto seco com agua perto para a ETE").not.toBeNull();
    if (!malha) return;
    montaMalhaDaEte(game.sim, malha);
    game.sim.step(1);
    for (const r of game.sim.drainResults()) expect(r.ok, r.reason).toBe(true);
    stepDays(game, 5);
    const antes = conta(game, true);
    expect(antes.ativos, "sanidade: a malha da ETE tem predios com agua antes da ETE").toBeGreaterThan(0);
    expect(antes.aguaSemEsgoto, "antes da ETE: alguem tem agua e nao tem esgoto").toBeGreaterThan(0);

    game.sim.enqueue({ type: "placeService", service: "ete", x: malha.x - 3, y: malha.y + 1 });
    game.sim.step(1);
    for (const r of game.sim.drainResults()) expect(r.ok, r.reason).toBe(true);
    stepDays(game, 4); // a ETE leva 2 anos (24 meses) de obra, e o recompute roda depois
    const depois = conta(game);
    expect(depois.ativos, "sanidade: a malha continua com predios").toBeGreaterThan(0);
    const semEsgoto = depois.comAgua - depois.comEsgoto;
    expect(semEsgoto, "com a ETE na malha, todo predio com agua tem esgoto").toBe(0);
  });

  it("derrubar a ETE desliga o esgoto da malha de novo", () => {
    const game = createTestGame({
      seed: "esgoto-108-ete-caida",
      overrides: {
        world: { width: 128, height: 128 },
        economy: { mode: "sandbox" },
        utilities: {
          regionalWater: REGIONAL,
          regionalPower: REGIONAL,
          regionalSewage: REGIONAL_ESGOTO,
          sewageShareOfConsumption: 0.8,
        },
      },
    });
    const malha = achaPontoDaEte(game);
    expect(malha, "a semente tem que ter um ponto seco com agua perto para a ETE").not.toBeNull();
    if (!malha) return;
    montaMalhaDaEte(game.sim, malha);
    game.sim.enqueue({ type: "placeService", service: "ete", x: malha.x - 3, y: malha.y + 1 });
    game.sim.step(1);
    for (const r of game.sim.drainResults()) expect(r.ok, r.reason).toBe(true);
    stepDays(game, 6);
    const comEte = conta(game, true);
    expect(comEte.ativos, "sanidade: a malha da ETE tem predios").toBeGreaterThan(0);
    expect(comEte.aguaSemEsgoto, "com a ETE, ninguem fica sem esgoto").toBe(0);

    game.sim.enqueue({
      type: "bulldoze",
      x0: malha.x - 3,
      y0: malha.y + 1,
      x1: malha.x - 1,
      y1: malha.y + 3,
    });
    game.sim.step(1);
    for (const r of game.sim.drainResults()) expect(r.ok, r.reason).toBe(true);
    stepDays(game, 3);
    const semEte = conta(game, true);
    expect(semEte.ativos, "os predios continuam de pe depois da demolicao da ETE").toBeGreaterThan(0);
    expect(
      semEte.aguaSemEsgoto,
      "sem ETE e com o regional de esgoto apertado, alguem volta a ficar com agua e sem esgoto",
    ).toBeGreaterThan(0);
  });

  it("outra malha sem ETE e sem saida continua sem esgoto", () => {
    const game = createTestGame({
      seed: "esgoto-108-malhas",
      overrides: {
        world: { width: 128, height: 128 },
        economy: { mode: "sandbox" },
        utilities: {
          regionalWater: REGIONAL,
          regionalPower: REGIONAL,
          regionalSewage: REGIONAL_ESGOTO,
          sewageShareOfConsumption: 0.8,
        },
      },
    });
    const malha = achaPontoDaEte(game);
    expect(malha, "a semente tem que ter um ponto seco com agua perto para a ETE").not.toBeNull();
    if (!malha) return;
    montaMalhaDaEte(game.sim, malha);
    // Segunda malha, do outro lado da cidade. Ela nasce ligada por uma rua de apoio ate a
    // borda oeste (sem saida `growth` nao constroi nada) com poco e subestacao proprios;
    // a rua de apoio e demolida depois, deixando duas malhas separadas e sem saida.
    game.sim.enqueue({ type: "buildRoad", kind: "street", x0: 20, y0: 70, x1: 20, y1: 100 });
    game.sim.enqueue({ type: "zone", zone: "residential_low", x0: 21, y0: 72, x1: 22, y1: 99 });
    game.sim.enqueue({ type: "zone", zone: "commercial", x0: 18, y0: 72, x1: 19, y1: 99 });
    game.sim.enqueue({ type: "buildRoad", kind: "street", x0: 16, y0: 70, x1: 20, y1: 70 });
    game.sim.enqueue({ type: "placeService", service: "poco", x: 17, y: 71 });
    game.sim.enqueue({ type: "placeService", service: "subestacao", x: 18, y: 71 });
    game.sim.enqueue({ type: "buildRoad", kind: "street", x0: 0, y0: 70, x1: 16, y1: 70 });
    game.sim.enqueue({ type: "placeService", service: "ete", x: malha.x - 3, y: malha.y + 1 });
    game.sim.step(1);
    for (const r of game.sim.drainResults()) expect(r.ok, r.reason).toBe(true);
    stepDays(game, 6);
    const longe = ativosLongeDaEte(game, malha);
    expect(longe.length, "sanidade: a outra malha tem predios ativos").toBeGreaterThan(0);

    // Corta a ligacao: agora sao duas malhas separadas e a segunda esta sem ETE e sem saida.
    game.sim.enqueue({ type: "bulldoze", x0: 0, y0: 70, x1: 8, y1: 70 });
    game.sim.step(1);
    for (const r of game.sim.drainResults()) expect(r.ok, r.reason).toBe(true);
    stepDays(game, 3);
    const depoisDoCorte = ativosLongeDaEte(game, malha);
    expect(depoisDoCorte.length, "a outra malha continua com predios ativos depois do corte").toBeGreaterThan(
      0,
    );
    const comEsgoto = depoisDoCorte.filter((b) => sewageOf(game, b) === 1);
    expect(comEsgoto, "prédio da outra malha (sem ETE e sem saida) fica com esgoto").toEqual([]);
  });

  it("served() continua exigindo so agua e luz: falta de esgoto nao tira o servico", () => {
    const game = createTestGame({
      seed: "esgoto-108-served",
      overrides: {
        world: { width: 128, height: 128 },
        economy: { mode: "sandbox" },
        utilities: {
          regionalWater: REGIONAL,
          regionalPower: REGIONAL,
          regionalSewage: REGIONAL_ESGOTO,
          sewageShareOfConsumption: 0.8,
        },
      },
    });
    const malha = achaPontoDaEte(game);
    expect(malha, "a semente tem que ter um ponto seco com agua perto para a ETE").not.toBeNull();
    if (!malha) return;
    montaMalhaDaEte(game.sim, malha);
    stepDays(game, 5);
    const bs = game.sim.buildings;
    const alvo = conta(game).alvoDeServed;
    expect(alvo, "tem que existir prédio com agua e luz mas sem esgoto").toBeGreaterThan(0);
    const b = [...Array(bs.count).keys()].find(
      (i) => bs.isActive(i) && bs.hasWater[i] === 1 && bs.hasPower[i] === 1 && sewageOf(game, i) === 0,
    );
    expect(b, "o alvo do served() tem que ser um prédio ativo de verdade").toBeDefined();
    expect(
      b === undefined ? false : game.utilities.served(b),
      "agua e luz bastam: falta de esgoto nao tira o serviço (decisão escrita na #108)",
    ).toBe(true);
  });

  it("o consumo de esgoto e a mesma demanda vezes a fracao: fracao menor, sobra maior", () => {
    // Mesma semente, mesma malha e mesmo regional de esgoto: so `sewageShareOfConsumption` muda.
    // O consumo de esgoto e `demandOf(homes, jobs) * fracao`, entao a rede sobra mais com a
    // fracao menor. Medido pela sobra (`spareAt`), que e a conta pura, sem depender de
    // quantos predios a construtora lancou.
    const cidade = (seed: string, fracao: number): Game =>
      createTestGame({
        seed,
        overrides: {
          world: { width: 128, height: 128, water: { enabled: false } },
          economy: { mode: "sandbox" },
          utilities: {
            regionalWater: REGIONAL,
            regionalPower: REGIONAL,
            regionalSewage: 40,
            sewageShareOfConsumption: fracao,
          },
        },
      });
    const cheia = cidade("esgoto-108-fracao", 1);
    const meia = cidade("esgoto-108-fracao", 0.5);
    ruaPrincipal(cheia.sim);
    ruaPrincipal(meia.sim);
    stepDays(cheia, 4);
    stepDays(meia, 4);
    const cCheia = conta(cheia);
    const cMeia = conta(meia);
    expect(cCheia.comAgua, "sanidade: a cidade com fracao 1 tem predios com agua").toBeGreaterThan(0);
    expect(cMeia.comAgua, "sanidade: a cidade com fracao 0.5 tem predios com agua").toBeGreaterThan(0);
    const acesso = (game: Game): number => {
      const bs = game.sim.buildings;
      for (let b = 0; b < bs.count; b++) if (bs.isActive(b)) return bs.access[b]!;
      return -1;
    };
    const accCheia = acesso(cheia);
    const accMeia = acesso(meia);
    expect(accCheia, "sanidade: existe acesso na cidade com fracao 1").toBeGreaterThanOrEqual(0);
    expect(accMeia, "sanidade: existe acesso na cidade com fracao 0.5").toBeGreaterThanOrEqual(0);
    if (accCheia < 0 || accMeia < 0) return;
    const sobraCheia = spareDe(cheia, accCheia, "sewage");
    const sobraMeia = spareDe(meia, accMeia, "sewage");
    expect(
      sobraMeia,
      `fracao 0.5 tem que deixar mais sobra de esgoto que a fracao 1 (cheia: ${sobraCheia}, meia: ${sobraMeia})`,
    ).toBeGreaterThan(sobraCheia);
  });

  it("canSupply mantem assinatura e efeito: sem sobra a construtora para, com poco e subestacao volta", () => {
    const game = createTestGame({
      seed: "esgoto-108-crescer",
      overrides: {
        world: { width: 128, height: 128, water: { enabled: false } },
        economy: { mode: "sandbox" },
        utilities: {
          regionalWater: REGIONAL,
          regionalPower: REGIONAL,
          regionalSewage: REGIONAL,
          sewageShareOfConsumption: 0.5,
        },
      },
    });
    const s = game.sim;
    ruaPrincipal(s);
    ruaDeServico(s);
    stepDays(game, 3);
    const before = s.buildings.count;
    expect(before, "sanidade: a cidade comeca a crescer").toBeGreaterThan(0);
    stepDays(game, 2);
    expect(s.buildings.count, "sem sobra na malha, nada novo (mesma regra de antes da sewage)").toBe(before);
    s.enqueue({ type: "placeService", service: "poco", x: 35, y: 26 });
    s.enqueue({ type: "placeService", service: "subestacao", x: 34, y: 28 });
    s.step(1);
    for (const r of s.drainResults()) expect(r.ok, r.reason).toBe(true);
    stepDays(game, 3);
    expect(s.buildings.count, "com poco e subestacao, cresce de novo").toBeGreaterThan(before + 2);
  });

  it("a cidade roda com a fracao de esgoto na config (o pacote inteiro continua verde)", () => {
    const game = createTestGame({
      seed: "esgoto-108-sanidade",
      overrides: {
        world: { width: 128, height: 128, water: { enabled: false } },
        economy: { mode: "sandbox" },
        utilities: {
          regionalWater: REGIONAL,
          regionalPower: REGIONAL,
          regionalSewage: REGIONAL,
          sewageShareOfConsumption: 0.8,
        },
      },
      commands: [
        { type: "buildRoad", kind: "street", x0: 30, y0: 24, x1: 30, y1: 64 },
        { type: "zone", zone: "residential_low", x0: 31, y0: 24, x1: 32, y1: 63 },
        { type: "zone", zone: "commercial", x0: 28, y0: 24, x1: 29, y1: 63 },
      ],
      days: 3,
    });
    const bs = game.sim.buildings;
    expect(bs.count, "a cidade cresce com a fracao de esgoto na config").toBeGreaterThan(0);
    // O array de esgoto precisa acompanhar o Buildings (mesma regra do `ensure` do motor).
    const temArray = (bs as unknown as { hasSewage?: Uint8Array }).hasSewage;
    expect(temArray, "Buildings tem que ter o array hasSewage").toBeInstanceOf(Uint8Array);
    expect(
      temArray?.length,
      "hasSewage e UINT8 array: precisa ser Uint8Array igual a hasWater/hasPower",
    ).toBeGreaterThanOrEqual(bs.count);
  });
});
