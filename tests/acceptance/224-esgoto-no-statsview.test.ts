/**
 * Esgoto no StatsView (issue #224, papel QA).
 *
 * O `totals()` do motor passa a devolver `sewage` em PESSOAS EQUIVALENTES
 * (mesma unidade de water/power) e a visao (StatsView) mostra o numero
 * arredondado como os outros, nunca `undefined`.
 *
 * Na main o campo `sewage` ainda nao existe: cada `it` abaixo falha por ler
 * esse campo que falta (nunca por cidade vazia, NaN ou tempo). O tipo do campo
 * novo e declarado aqui no teste (cast nominal, sem `as any`), como o 102 faz.
 */
import { loadConfigAndData } from "@city/cli";
import { BSTATE, type Game, reportText, statsView } from "@city/sim";
import { describe, expect, it } from "vitest";
import { createTestGame } from "../helpers";

/** Regional de agua e luz do teste antigo de agua/luz (igual ao do 108). */
const REGIONAL = 60;
/** Regional de esgoto apertado (igual ao do 108). */
const REGIONAL_ESGOTO = 15;
/** Regional folgado: nada trava o crescimento (só a ETE muda entre as cidades). */
const FOLGADO = 4000;

/** Campo novo esperado na visao (ainda nao existe no motor). */
interface SewageField {
  capacity: number | null;
  used: number;
}

interface UtilitiesWithSewage {
  enabled: boolean;
  water: { capacity: number | null; used: number };
  power: { capacity: number | null; used: number };
  sewage: SewageField;
}

interface MalhaEte {
  /** Canto da ETE (3x3) que encosta no rio. */
  x: number;
  y: number;
  /** Rua vertical da malha. */
  X: number;
  /** Rua de servico (poço e subestação), na outra ponta da malha. */
  Y: number;
}

function stepDays(game: Game, days: number): void {
  game.sim.step(days * game.sim.clock.ticksPerDay);
}

/**
 * Le o hasSewage por cast nominal (igual ao 108): prova que a ETE esta ativa
 * sem depender do campo novo `sewage` do StatsView.
 */
function sewageOf(game: Game, b: number): number {
  const bs = game.sim.buildings as unknown as { hasSewage: Uint8Array };
  return bs.hasSewage[b]!;
}

/**
 * Ponto seco para a ETE (copiado do 108): retangulo 3x3 seco com agua perto,
 * mais as ruas da malha, tudo seco. Deterministico para a semente.
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

/** A malha da ETE (copiada do 108): rua vertical, zonas e rua de servico. */
function montaMalhaDaEte(s: Game["sim"], m: MalhaEte): void {
  s.enqueue({ type: "buildRoad", kind: "street", x0: m.X, y0: m.Y, x1: m.X, y1: m.y + 14 });
  s.enqueue({ type: "zone", zone: "residential_low", x0: m.X + 1, y0: m.Y + 1, x1: m.X + 2, y1: m.y + 13 });
  s.enqueue({ type: "zone", zone: "commercial", x0: m.X - 2, y0: m.Y + 1, x1: m.X - 1, y1: m.y + 13 });
  s.enqueue({ type: "buildRoad", kind: "street", x0: m.X, y0: m.Y, x1: m.X + 6, y1: m.Y });
  s.enqueue({ type: "placeService", service: "poco", x: m.X + 1, y: m.Y + 1 });
  s.enqueue({ type: "placeService", service: "subestacao", x: m.X + 3, y: m.Y + 1 });
}

/** Conta prédios com agua e quantos deles seguem sem esgoto (sanidade, como no 108). */
function aguaSemEsgoto(game: Game): { comAgua: number; semEsgoto: number } {
  const bs = game.sim.buildings;
  let comAgua = 0;
  let semEsgoto = 0;
  for (let b = 0; b < bs.count; b++) {
    if (!bs.isActive(b)) continue;
    if (bs.hasWater[b] !== 1) continue;
    comAgua++;
    if (sewageOf(game, b) !== 1) semEsgoto++;
  }
  return { comAgua, semEsgoto };
}

/** Soma na mão do consumo em pessoas equivalentes (só prédios que não são serviço). */
function somaSemServico(game: Game): number {
  const bs = game.sim.buildings;
  let total = 0;
  for (let b = 0; b < bs.count; b++) {
    const st = bs.state[b];
    if (st === BSTATE.demolished || st === BSTATE.abandoned) continue;
    const t = bs.typeOf(b);
    if (t.service !== undefined) continue; // nenhum serviço entra no uso, nem a ETE
    total += game.utilities.demandOf(t.homes, t.jobs);
  }
  return total;
}

/** Soma na mão do consumo dos prédios com `service: sewage` (a ETE). */
function somaServicoEsgoto(game: Game): number {
  const bs = game.sim.buildings;
  let total = 0;
  for (let b = 0; b < bs.count; b++) {
    const st = bs.state[b];
    if (st === BSTATE.demolished || st === BSTATE.abandoned) continue;
    const t = bs.typeOf(b);
    if (t.service !== "sewage") continue;
    total += game.utilities.demandOf(t.homes, t.jobs);
  }
  return total;
}

describe("esgoto no StatsView (issue #224)", () => {
  it("a visao traz o uso e a capacidade do esgoto, nunca undefined", () => {
    const game = createTestGame({ seed: "esgoto-224-statsview", scenario: "bairro-basico", days: 20 });
    const s = statsView(game) as unknown as { utilities: UtilitiesWithSewage };

    // Sanidade (passa na main): a cidade cresceu e a agua tem uso.
    expect(game.sim.buildings.count, "sanidade: a cidade tem prédios").toBeGreaterThan(0);
    expect(s.utilities.water.used, "sanidade: a cidade usa agua").toBeGreaterThan(0);

    // O campo novo (falha na main: `sewage` ainda nao existe na visao).
    expect(s.utilities.sewage, "a visao devia trazer o esgoto em utilities.sewage").toBeDefined();
    expect(typeof s.utilities.sewage.used, "o uso de esgoto devia ser um numero").toBe("number");
    expect(Number.isFinite(s.utilities.sewage.used), "o uso de esgoto devia ser finito").toBe(true);
    expect(s.utilities.sewage.used, "a cidade usa esgoto").toBeGreaterThan(0);
    expect(typeof s.utilities.sewage.capacity, "a capacidade de esgoto devia ser numero (nao null)").toBe(
      "number",
    );
    expect(
      (s.utilities.sewage.capacity as number) >= s.utilities.sewage.used,
      "a capacidade de esgoto devia cobrir o uso",
    ).toBe(true);

    // O null/numero precisa sobreviver ao JSON (nao pode virar undefined nem sumir).
    const parsed = JSON.parse(JSON.stringify(s)) as { utilities: UtilitiesWithSewage };
    expect(parsed.utilities.sewage, "o JSON devia trazer o esgoto").toBeDefined();
    expect(typeof parsed.utilities.sewage.used, "o JSON devia trazer o uso de esgoto").toBe("number");
    expect(typeof parsed.utilities.sewage.capacity, "o JSON devia trazer a capacidade de esgoto").toBe(
      "number",
    );

    // O relatório em texto nao pode vazar undefined nem NaN.
    const texto = reportText(game);
    expect(texto, "o relatorio nao devia mostrar a palavra undefined").not.toContain("undefined");
    expect(texto, "o relatorio nao devia mostrar a palavra NaN").not.toContain("NaN");
  });

  it("o uso do esgoto segue a fracao da config", () => {
    // A fração vem da config de verdade (hoje 0.8): se alguém mudar a config,
    // o teste acompanha. Nada de colar 0.8 aqui. A conta usa a soma sem
    // serviço (só prédios que não são serviço) vezes a fração, e não
    // water.used: water.used também soma prédios de serviço que não são
    // água/luz (escola, UBS, ETE...) enquanto o esgoto só soma os prédios
    // sem serviço, então water.used vezes a fração daria maior que o uso real.
    const { config } = loadConfigAndData();
    const fracao: number = config.utilities.sewageShareOfConsumption;
    // Mesma cidade do primeiro critério.
    const game = createTestGame({ seed: "esgoto-224-statsview", scenario: "bairro-basico", days: 20 });
    const s = statsView(game) as unknown as { utilities: UtilitiesWithSewage };

    expect(s.utilities.water.used, "sanidade: a cidade usa agua").toBeGreaterThan(0);
    expect(somaSemServico(game), "sanidade: a cidade tem casas sem serviço").toBeGreaterThan(0);
    // Falha na main: `sewage` ainda nao existe na visao.
    expect(s.utilities.sewage, "a visao devia trazer o esgoto em utilities.sewage").toBeDefined();
    const esperado = somaSemServico(game) * fracao;
    expect(
      Math.abs(s.utilities.sewage.used - esperado),
      `o uso de esgoto devia ser a soma sem serviço vezes a fracao da config (${fracao})`,
    ).toBeLessThanOrEqual(1);

    // A fração da config está mesmo sendo usada: mesma semente e mesmo
    // cenário, só muda sewageShareOfConsumption (1 contra 0.5).
    const cheia = createTestGame({
      seed: "esgoto-224-fracao",
      scenario: "bairro-basico",
      days: 20,
      overrides: { utilities: { sewageShareOfConsumption: 1 } },
    });
    const metade = createTestGame({
      seed: "esgoto-224-fracao",
      scenario: "bairro-basico",
      days: 20,
      overrides: { utilities: { sewageShareOfConsumption: 0.5 } },
    });
    const sCheia = statsView(cheia) as unknown as { utilities: UtilitiesWithSewage };
    const sMetade = statsView(metade) as unknown as { utilities: UtilitiesWithSewage };
    expect(sCheia.utilities.sewage, "a visao devia trazer o esgoto em utilities.sewage").toBeDefined();
    expect(sMetade.utilities.sewage, "a visao devia trazer o esgoto em utilities.sewage").toBeDefined();
    expect(
      sMetade.utilities.sewage.used,
      "com a fração pela metade o uso de esgoto devia ser menor",
    ).toBeLessThan(sCheia.utilities.sewage.used);
    expect(
      Math.abs(sMetade.utilities.sewage.used - somaSemServico(metade) * 0.5),
      "o uso de esgoto devia ser a soma sem serviço vezes 0.5",
    ).toBeLessThanOrEqual(1);
  });

  it("com o sistema desligado a capacidade e null e o uso continua", () => {
    // Mesma semente e cenário do primeiro critério, só com o sistema desligado.
    const game = createTestGame({
      seed: "esgoto-224-statsview",
      scenario: "bairro-basico",
      days: 20,
      overrides: { utilities: { enabled: false } },
    });
    const s = statsView(game) as unknown as { utilities: UtilitiesWithSewage };

    expect(s.utilities.enabled, "a visao devia dizer que o sistema esta desligado").toBe(false);
    expect(s.utilities.water.capacity, "sanidade: sem o sistema a agua e null").toBeNull();
    // Falha na main: `sewage` ainda nao existe (undefined nao e null).
    expect(s.utilities.sewage?.capacity, "sem o sistema, a capacidade de esgoto devia ser null").toBeNull();
    expect(
      s.utilities.sewage?.used,
      "o uso de esgoto devia continuar sendo um numero maior que zero",
    ).toBeGreaterThan(0);

    // O null precisa sobreviver ao JSON.
    const parsed = JSON.parse(JSON.stringify(s)) as { utilities: UtilitiesWithSewage };
    expect(parsed.utilities.sewage?.capacity, "o JSON devia trazer capacity null para o esgoto").toBeNull();
  });

  it("a sobra responde ao regional de esgoto e a ETE", () => {
    const cidade = (regionalSewage: number): Game =>
      createTestGame({
        seed: "esgoto-108-ete",
        overrides: {
          world: { width: 128, height: 128 },
          economy: { mode: "sandbox" },
          utilities: {
            regionalWater: REGIONAL,
            regionalPower: REGIONAL,
            regionalSewage,
            sewageShareOfConsumption: 0.8,
          },
        },
      });

    // Parte (a): mesma semente e mesma malha, só `regionalSewage` muda.
    const apertada = cidade(REGIONAL_ESGOTO);
    const folgada = cidade(REGIONAL);
    const malhaA = achaPontoDaEte(apertada);
    const malhaF = achaPontoDaEte(folgada);
    expect(malhaA, "a semente tem que ter um ponto seco com agua perto para a ETE").not.toBeNull();
    expect(malhaF, "a semente tem que ter um ponto seco com agua perto para a ETE").not.toBeNull();
    if (!malhaA || !malhaF) return;
    montaMalhaDaEte(apertada.sim, malhaA);
    montaMalhaDaEte(folgada.sim, malhaF);
    apertada.sim.step(1);
    folgada.sim.step(1);
    for (const r of apertada.sim.drainResults()) expect(r.ok, r.reason).toBe(true);
    for (const r of folgada.sim.drainResults()) expect(r.ok, r.reason).toBe(true);
    stepDays(apertada, 5);
    stepDays(folgada, 5);
    const sA = statsView(apertada) as unknown as { utilities: UtilitiesWithSewage };
    const sF = statsView(folgada) as unknown as { utilities: UtilitiesWithSewage };
    // Sanidade (passa na main): a malha tem prédios (poço e subestação; sem
    // saída para a borda o growth não lança casas, como explica o 108).
    expect(apertada.sim.buildings.count, "sanidade: a cidade apertada tem prédios").toBeGreaterThan(0);
    expect(folgada.sim.buildings.count, "sanidade: a cidade folgada tem prédios").toBeGreaterThan(0);
    // Falha na main: `sewage` ainda nao existe na visao.
    expect(sA.utilities.sewage, "a visao devia trazer o esgoto em utilities.sewage").toBeDefined();
    expect(sF.utilities.sewage, "a visao devia trazer o esgoto em utilities.sewage").toBeDefined();
    expect(
      (sA.utilities.sewage.capacity as number) >= sA.utilities.sewage.used,
      "na cidade apertada a capacidade de esgoto devia cobrir o uso",
    ).toBe(true);
    expect(
      (sF.utilities.sewage.capacity as number) >= sF.utilities.sewage.used,
      "na cidade folgada a capacidade de esgoto devia cobrir o uso",
    ).toBe(true);
    const sobraApertada = (sA.utilities.sewage.capacity as number) - sA.utilities.sewage.used;
    const sobraFolgada = (sF.utilities.sewage.capacity as number) - sF.utilities.sewage.used;
    expect(
      sobraFolgada,
      `com mais rede regional a sobra de esgoto devia ser maior (apertada: ${sobraApertada})`,
    ).toBeGreaterThan(sobraApertada);

    // Parte (b): mesma semente e mesma malha, com ETE contra sem ETE.
    const comEte = cidade(REGIONAL_ESGOTO);
    const semEte = cidade(REGIONAL_ESGOTO);
    const malhaCom = achaPontoDaEte(comEte);
    const malhaSem = achaPontoDaEte(semEte);
    expect(malhaCom, "a semente tem que ter um ponto seco com agua perto para a ETE").not.toBeNull();
    expect(malhaSem, "a semente tem que ter um ponto seco com agua perto para a ETE").not.toBeNull();
    if (!malhaCom || !malhaSem) return;
    montaMalhaDaEte(comEte.sim, malhaCom);
    montaMalhaDaEte(semEte.sim, malhaSem);
    comEte.sim.enqueue({ type: "placeService", service: "ete", x: malhaCom.x - 3, y: malhaCom.y + 1 });
    comEte.sim.step(1);
    semEte.sim.step(1);
    for (const r of comEte.sim.drainResults()) expect(r.ok, r.reason).toBe(true);
    for (const r of semEte.sim.drainResults()) expect(r.ok, r.reason).toBe(true);
    stepDays(comEte, 6);
    stepDays(semEte, 6);
    // Sanidade (passa na main, como no 108): a ETE terminou a obra e serve a malha.
    const servida = aguaSemEsgoto(comEte);
    expect(servida.comAgua, "sanidade: a malha com ETE tem prédios com agua").toBeGreaterThan(0);
    expect(servida.semEsgoto, "sanidade: com a ETE ativa ninguem fica sem esgoto").toBe(0);
    // Falha na main: `sewage` ainda nao existe na visao.
    const sCom = statsView(comEte) as unknown as { utilities: UtilitiesWithSewage };
    const sSem = statsView(semEte) as unknown as { utilities: UtilitiesWithSewage };
    expect(sCom.utilities.sewage, "a visao devia trazer o esgoto em utilities.sewage").toBeDefined();
    expect(sSem.utilities.sewage, "a visao devia trazer o esgoto em utilities.sewage").toBeDefined();
    const sobraCom = (sCom.utilities.sewage.capacity as number) - sCom.utilities.sewage.used;
    const sobraSem = (sSem.utilities.sewage.capacity as number) - sSem.utilities.sewage.used;
    expect(sobraCom, `com a ETE a sobra de esgoto devia ser maior (sem ETE: ${sobraSem})`).toBeGreaterThan(
      sobraSem,
    );
  });

  it("a ETE nao entra no uso de esgoto", () => {
    // A fração vem da config de verdade (hoje 0.8): a conta manual usa a mesma.
    const { config } = loadConfigAndData();
    const fracao: number = config.utilities.sewageShareOfConsumption;
    // Regionais folgados: nada trava o crescimento, a única diferença é a ETE.
    const cidade = (): Game =>
      createTestGame({
        seed: "esgoto-224-ete-uso",
        overrides: {
          world: { width: 128, height: 128 },
          economy: { mode: "sandbox" },
          utilities: {
            regionalWater: FOLGADO,
            regionalPower: FOLGADO,
            regionalSewage: FOLGADO,
            sewageShareOfConsumption: fracao,
          },
        },
      });
    const comEte = cidade();
    const malhaCom = achaPontoDaEte(comEte);
    expect(malhaCom, "a semente tem que ter um ponto seco com agua perto para a ETE").not.toBeNull();
    if (!malhaCom) return;
    montaMalhaDaEte(comEte.sim, malhaCom);
    // Rua de saída até a borda oeste (igual à rua de apoio do 108): com saída
    // o growth lança casas e o uso de esgoto passa a ser maior que zero.
    comEte.sim.enqueue({
      type: "buildRoad",
      kind: "street",
      x0: 0,
      y0: malhaCom.Y,
      x1: malhaCom.X,
      y1: malhaCom.Y,
    });
    comEte.sim.enqueue({ type: "placeService", service: "ete", x: malhaCom.x - 3, y: malhaCom.y + 1 });
    comEte.sim.step(1);
    for (const r of comEte.sim.drainResults()) expect(r.ok, r.reason).toBe(true);
    stepDays(comEte, 6);

    // Sanidade (passa na main): a ETE terminou a obra e tem consumo próprio.
    const bs = comEte.sim.buildings;
    let eteAtiva = 0;
    for (let b = 0; b < bs.count; b++) {
      if (bs.isActive(b) && bs.typeOf(b).id === "ete") eteAtiva++;
    }
    expect(eteAtiva, "sanidade: a ETE terminou a obra e está ativa").toBeGreaterThan(0);
    const somaEte = somaServicoEsgoto(comEte);
    expect(somaEte, "sanidade: a ETE tem consumo próprio que precisa ficar fora do uso").toBeGreaterThan(0);
    expect(
      somaEte * fracao,
      "sanidade: o consumo da ETE vezes a fracao é grande demais para ser arredondamento",
    ).toBeGreaterThan(1);
    expect(
      somaSemServico(comEte),
      "sanidade: a cidade tem casas usando esgoto (a rua de saída liberou o growth)",
    ).toBeGreaterThan(0);

    // Falha na main: `sewage` ainda nao existe na visao.
    const sCom = statsView(comEte) as unknown as { utilities: UtilitiesWithSewage };
    expect(sCom.utilities.sewage, "a visao devia trazer o esgoto em utilities.sewage").toBeDefined();
    // A própria ETE não consome o esgoto que ela trata: o uso é a soma sem
    // serviço vezes a fração da config (±1 de arredondamento).
    const soma = somaSemServico(comEte);
    const esperado = soma * fracao;
    expect(
      Math.abs(sCom.utilities.sewage.used - esperado),
      `o uso de esgoto devia ser a soma sem serviço vezes a fracao (${fracao})`,
    ).toBeLessThanOrEqual(1);
  });
});
