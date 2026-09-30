/**
 * Issue #49 - carro que trabalha fora fica na estrada de acesso e o relatorio mostra quantos sao.
 *
 * Hoje o carro que chega ao destino OUTSIDE_JOB vira VSTATE.outside e some da tela para sempre:
 * ele existe, tem dono e familia, mas nao aparece em lugar nenhum. E o relatorio so conta as
 * PESSOAS que trabalham fora, nao os CARROS.
 *
 * Regra que este teste trava: todo carro ou esta desenhado na tela (na rua, na estrada de saida ou
 * a caminho), e o relatorio diz quantos estao fora da cidade.
 */
import { checkInvariants, reportText } from "@city/sim";
import { describe, expect, it } from "vitest";
import { createTestGame } from "../helpers";

/** Leitura do metodo novo do motor (ainda nao existe na main): o arquivo compila e o teste falha. */
type TrafficComContagem = { vehiclesOutside?: () => number };
/** VSTATE.gone: o carro saiu da cidade com a familia (nao esta mais no mapa). */
const SAIU_COM_FAMILIA = 3;
/** OUTSIDE_JOB de packages/sim/src/people/population.ts. */
const TRABALHA_FORA = -2;

/** Bairro no fim da linha: a rua encosta na borda do mapa e nao ha comercio nem industria, */
/** entao os trabalhadores vao trabalhar no municipio vizinho (pela estrada de acesso). */
function cidade(seed: string, dias: number, over: Record<string, unknown> = {}) {
  const game = createTestGame({
    seed,
    overrides: { world: { width: 128, height: 128 }, economy: { mode: "sandbox" }, ...over },
  });
  const s = game.sim;
  s.enqueue({ type: "buildRoad", kind: "street", x0: 0, y0: 64, x1: 30, y1: 64 });
  s.enqueue({ type: "buildRoad", kind: "street", x0: 30, y0: 40, x1: 30, y1: 90 });
  s.enqueue({ type: "zone", zone: "residential_low", x0: 31, y0: 41, x1: 50, y1: 60 });
  s.enqueue({ type: "zone", zone: "residential_low", x0: 31, y0: 68, x1: 50, y1: 89 });
  s.step(dias * s.clock.ticksPerDay);
  return game;
}

/** Retangulo do mapa inteiro: quem esta dentro dele tem de aparecer. */
function mapaTodo(game: ReturnType<typeof createTestGame>) {
  const w = game.sim.world;
  return { x0: 0, y0: 0, x1: w.width - 1, y1: w.height - 1 };
}

/** O carro esta em algum quadradinho de via do mapa (rua, garagem ou estrada de saida)? */
function carroEmVia(game: ReturnType<typeof createTestGame>, v: number): boolean {
  const veh = game.traffic.vehicles;
  return veh.parkedAt[v]! >= 0 || veh.streetTile[v]! >= 0;
}

/** Um trabalhador fora com casa conhecida: { pessoa, carro, casa, viaDaCasa }. */
function trabalhadorForaComCasa(game: ReturnType<typeof createTestGame>) {
  const city = game.city;
  const veh = game.traffic.vehicles;
  for (let p = 0; p < city.pop.aliveCount; p++) {
    if (city.pop.job[p] !== TRABALHA_FORA) continue;
    const h = city.pop.household[p]!;
    if (h < 0) continue;
    const car = city.hh.car[h]!;
    if (car < 0 || veh.driver[car] !== p) continue;
    const casa = city.homeBuilding(p);
    const viaDaCasa = city.homeAccess(p);
    if (casa < 0 || viaDaCasa < 0) continue;
    return { pessoa: p, carro: car, casa, viaDaCasa };
  }
  return null;
}

/** Carros que ainda estao na cidade (exclui quem saiu com a familia). */
function carrosNaCidade(game: ReturnType<typeof createTestGame>): number {
  const veh = game.traffic.vehicles;
  let n = 0;
  for (let v = 0; v < veh.count; v++) if (veh.state[v] !== SAIU_COM_FAMILIA) n++;
  return n;
}

describe("carro que trabalha fora", () => {
  it("fica desenhado na via de saida, nunca invisivel dentro do mapa", () => {
    const game = cidade("carro-fora49", 20);
    const s = game.sim;
    const rect = mapaTodo(game);
    // Por dia e por quadro: todo carro tem de estar desenhado ou na estrada de saida.
    // Carro que saiu da cidade com a familia (VSTATE.gone, 3) nao conta: ele nao esta no mapa.
    // Aqui usamos o numero 3 de proposito: e o unico estado que significa "saiu da cidade", e o
    // teste nao deve depender do que a mudanca faz com o estado do carro que trabalha fora.
    let ticksInvisiveis = 0;
    let picoInvisivel = 0;
    for (let t = 0; t < 2 * s.clock.ticksPerDay; t++) {
      s.step(1);
      const pts = game.traffic.positions(rect, 0, undefined, true);
      // Um ponto desenhado por carro: x, y, angle, model.
      const desenhados = pts.length / 4;
      const veiculos = carrosNaCidade(game);
      const fora = veiculos - desenhados;
      if (fora > picoInvisivel) picoInvisivel = fora;
      ticksInvisiveis += fora;
    }
    expect(
      ticksInvisiveis,
      "carro ficou invisivel dentro do mapa: " +
        ticksInvisiveis +
        " ticks com carro nao desenhado em 2 dias (pico de " +
        picoInvisivel +
        " carros invisiveis no mesmo quadro)",
    ).toBe(0);
  }, 600000);

  it("sai pela estrada de acesso, fica no mapa e volta para casa todo dia", () => {
    const game = cidade("carro-fora49", 20);
    const s = game.sim;
    const alvo = trabalhadorForaComCasa(game);
    expect(
      alvo,
      "a cidade nao produziu carro de trabalhador fora com casa conhecida, o teste nao prova nada",
    ).not.toBeNull();
    const { pessoa, carro, casa, viaDaCasa } = alvo!;
    const veh = game.traffic.vehicles;
    const tpd = s.clock.ticksPerDay;
    // Conta, por dia, quantos quadros o carro passou fora de casa SEM estar em um quadradinho
    // do mapa (isto e, invisivel). Nao olhamos o estado interno do carro de proposito: o teste
    // vale tanto se o dev deixar o carro parado na via de saida como se criar um estado novo.
    const semLugar: number[] = [];
    for (let t = 0; t < tpd; t++) {
      s.step(1);
      const emCasa = veh.parkedAt[carro] === casa || veh.streetTile[carro] === viaDaCasa;
      if (!emCasa && !carroEmVia(game, carro)) semLugar.push(t);
    }
    expect(
      semLugar.length,
      "dos " +
        tpd +
        " ticks de 1 dia, o carro " +
        carro +
        " (motorista " +
        pessoa +
        ", casa " +
        casa +
        ") passou " +
        semLugar.length +
        " ticks sem estar em casa e sem estar em um quadradinho do mapa: " +
        "o carro some da tela em vez de ficar na estrada de acesso",
    ).toBe(0);
    // Nos dois dias seguintes o carro tem de voltar para casa pelo menos uma vez por dia.
    for (let dia = 1; dia <= 2; dia++) {
      let voltou = 0;
      for (let t = 0; t < tpd; t++) {
        s.step(1);
        if (veh.parkedAt[carro] === casa || veh.streetTile[carro] === viaDaCasa) voltou++;
      }
      expect(
        voltou,
        "no dia " +
          dia +
          " depois de trabalhar fora, o carro " +
          carro +
          " nunca voltou para casa (casa " +
          casa +
          ", via da casa " +
          viaDaCasa +
          "): ficou preso na estrada de saida",
      ).toBeGreaterThan(0);
    }
  }, 600000);

  it("o motor conta os carros fora da cidade", () => {
    const game = cidade("carro-fora49", 20);
    const contar = (game.traffic as unknown as TrafficComContagem).vehiclesOutside;
    expect(typeof contar, "falta no motor o metodo de leitura que conta os carros fora da cidade").toBe(
      "function",
    );
    const fora = contar!.call(game.traffic);
    expect(fora, "a cidade tem trabalhador fora, entao tem de ter carro fora").toBeGreaterThan(0);
    expect(fora, "mais carros fora da cidade do que carros que existem").toBeLessThanOrEqual(
      game.traffic.vehicles.count,
    );
    // Quem trabalha dentro nao pode ter carro na estrada de saida.
    const dentro = cidade("carro-fora49", 20, {
      population: { outsideJobs: { enabled: false } },
    });
    const contarDentro = (dentro.traffic as unknown as TrafficComContagem).vehiclesOutside;
    expect(contarDentro!.call(dentro.traffic), "cidade sem trabalho fora nao pode ter carro fora").toBe(0);
    // Quem trabalha quase todo fora tem de ter mais carro fora.
    const muitoFora = cidade("carro-fora49", 20, {
      population: { outsideJobs: { share: 1, minWorkers: 1 } },
    });
    const contarMuito = (muitoFora.traffic as unknown as TrafficComContagem).vehiclesOutside;
    const muito = contarMuito!.call(muitoFora.traffic);
    expect(
      muito,
      "cidade em que todo mundo trabalha fora tem de ter mais carros fora do que a cidade com poucos trabalhadores fora: " +
        muito +
        " contra " +
        fora,
    ).toBeGreaterThan(fora);
  }, 600000);

  it("o relatorio mostra a linha dos carros fora da cidade", () => {
    const jogo = cidade("carro-fora49", 25);
    const texto = reportText(jogo);
    const pessoas = texto.indexOf("## Pessoas");
    expect(pessoas, "o relatorio nao tem a secao de Pessoas").toBeGreaterThanOrEqual(0);
    const linha = texto.slice(pessoas).match(/carros fora da cidade: *([0-9.]+)/);
    expect(linha, "o relatorio nao tem a linha 'carros fora da cidade' perto de '## Pessoas'").not.toBeNull();
    const numero = Number(linha![1]!.replace(/\./g, ""));
    expect(numero, "numero de carros fora impossivel: a cidade tem trabalhador fora").toBeGreaterThan(0);
    expect(numero, "o relatorio mostra mais carros fora do que carros que existem").toBeLessThanOrEqual(
      jogo.traffic.vehicles.count,
    );
    // Mesma semente, mesmo numero.
    const outro = cidade("carro-fora49", 25);
    const outra = reportText(outro).match(/carros fora da cidade: *([0-9.]+)/);
    expect(outra![1], "mesma semente deu numero diferente de carros fora").toBe(linha![1]);
  }, 600000);

  it("os invariantes continuam vazios", () => {
    const game = cidade("carro-fora49", 20);
    game.sim.step(5 * game.sim.clock.ticksPerDay);
    expect(checkInvariants(game.city), "todo carro tem dono e esta em algum lugar").toEqual([]);
  }, 600000);
});
