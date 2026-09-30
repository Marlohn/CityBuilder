/**
 * Issue #39 — volta de compras, saúde e lazer: um motivo novo por dia, com destino real e volta.
 *
 * Hoje os únicos motivos de viagem são 1 (trabalho) e 2 (escola): não existe nenhum motivo >= 3.
 * Este teste sonda um dia inteiro da cidade de referência (cenário `bairro-basico`,
 * semente "avaliacao-livre", 40 dias com o prefeito automático e dinheiro infinito) e cobra:
 * viagem de motivo novo ao longo do dia inteiro, proporção perto da config, destino real
 * (comércio para compras/lazer, UBS para saúde), desejo não atendido novo sem renumerar os
 * antigos, textos em português e invariantes. Escrito antes do código (QA vermelho de propósito).
 */

import type { Game } from "@city/sim";
import { checkInvariants, personView } from "@city/sim";
import { describe, expect, it } from "vitest";
import { EV, UNMET } from "../../packages/sim/src/people/events";
import { createTestGame } from "../helpers";

// Cidade de referência da issue: cenário bairro-basico, semente fixa, prefeito automático.
const SEED = "avaliacao-livre";
const SCENARIO = "bairro-basico";
const DAYS = 40;

// Cidade só de casas (sem comércio e sem UBS), para provar o desejo não atendido novo.
const NO_DEST_SEED = "sem-destino";
const NO_DEST_DAYS = 30;

// Motivo novo = qualquer tripPurpose >= 3 (1 = trabalho, 2 = escola, 0 = em casa).
const NEW_PURPOSE_MIN = 3;
// Códigos de UNMET que já existem hoje (o código novo tem de ser um valor fora desta lista).
const OLD_UNMET_CODES = [1, 2, 3, 4, 5, 6, 7];
// Texto genérico de fallback do eventText, que o texto novo nunca pode ser.
const GENERIC_UNMET_TEXT = "teve um desejo não atendido";

function newMainCity(): Game {
  return createTestGame({
    seed: SEED,
    scenario: SCENARIO,
    days: DAYS,
    bot: true,
    overrides: { economy: { mode: "sandbox" } },
  });
}

let cachedHouses: Game | null = null;
// A cidade só de casas não sofre mutação nos testes E e G, então é criada uma vez só.
function housesCity(): Game {
  if (!cachedHouses) {
    cachedHouses = createTestGame({
      seed: NO_DEST_SEED,
      days: NO_DEST_DAYS,
      overrides: {
        world: { width: 160, height: 160, water: { enabled: false } },
        economy: { mode: "sandbox" },
      },
      commands: [
        { type: "buildRoad", kind: "avenue", x0: 20, y0: 80, x1: 130, y1: 80 },
        { type: "zone", zone: "residential_low", x0: 21, y0: 70, x1: 129, y1: 79 },
      ],
    });
  }
  return cachedHouses;
}

/** Sonda de um dia inteiro: lê o relógio ANTES de cada passo (mesma convenção da issue #37). */
interface DayProbe {
  /** Observações pessoa-tick fora de casa com motivo novo, por hora do dia (0..23). */
  perHour: number[];
  /** Observações pessoa-tick fora de casa com motivo novo, por motivo. */
  perPurpose: Record<number, number>;
  /** Total de observações com motivo novo no dia. */
  totalNew: number;
  /** Total de observações fora de casa a trabalho (motivo 1) no dia. */
  workTotal: number;
  /** Destinos de carro vistos por motivo novo (um por carro em movimento por tick). */
  carDests: Record<number, number[]>;
}

function probeDay(game: Game): DayProbe {
  const perHour: number[] = Array(24).fill(0);
  const perPurpose: Record<number, number> = {};
  const carDests: Record<number, number[]> = {};
  let totalNew = 0;
  let workTotal = 0;
  const pop = game.city.pop;
  const vehicles = game.traffic.vehicles;
  const ticksPerDay = game.sim.clock.ticksPerDay;
  for (let tick = 0; tick < ticksPerDay; tick++) {
    // O relógio ANTES do passo é o momento do tick medido.
    const tod = game.sim.clock.tickOfDay;
    game.sim.step(1);
    const hour = Math.floor(tod / 60);
    for (let p = 0; p < pop.count; p++) {
      if (pop.tripState[p]! === 0) continue;
      const purpose = pop.tripPurpose[p]!;
      if (purpose >= NEW_PURPOSE_MIN) {
        perHour[hour]!++;
        perPurpose[purpose] = (perPurpose[purpose] ?? 0) + 1;
        totalNew++;
      } else if (purpose === 1) {
        workTotal++;
      }
    }
    for (const v of vehicles.moving.toArray()) {
      const driver = vehicles.driver[v]!;
      if (driver < 0) continue;
      if (pop.tripPurpose[driver]! < NEW_PURPOSE_MIN) continue;
      const purpose = pop.tripPurpose[driver]!;
      (carDests[purpose] ??= []).push(vehicles.destBuilding[v]!);
    }
  }
  return { perHour, perPurpose, totalNew, workTotal, carDests };
}

/** Conta os eventos EV.unmet por código (campo `a`) numa cidade. */
function countUnmetByCode(game: Game): Record<number, number> {
  const out: Record<number, number> = {};
  const events = game.city.events;
  for (let e = 0; e < events.count; e++) {
    if (events.type[e]! !== EV.unmet) continue;
    const code = events.a[e]!;
    out[code] = (out[code] ?? 0) + 1;
  }
  return out;
}

describe("issue #39: volta de compras, saúde e lazer", () => {
  it("a cidade tem viagens com destino real ao longo do dia inteiro, e não só de manhã e no fim da tarde", () => {
    const game = newMainCity();
    const probe = probeDay(game);
    const distinct = Object.keys(probe.perPurpose).map(Number);
    expect(
      distinct.length,
      `hoje não existe motivo novo nenhum: só há viagens de trabalho (1) e escola (2), ` +
        `então compras, saúde e lazer ainda não viram viagem (total de observações novas: ${probe.totalNew})`,
    ).toBeGreaterThan(0);
    expect(
      probe.totalNew,
      `só ${probe.totalNew} observações de motivo novo no dia (queremos ao menos 100): ` +
        `as voltas de compras, saúde e lazer ainda não estão acontecendo`,
    ).toBeGreaterThanOrEqual(100);
    const hoursWith = probe.perHour.filter((c) => c > 0).length;
    expect(
      hoursWith,
      `viagem de motivo novo em só ${hoursWith} das 24 horas (queremos ao menos 8): ` +
        `as voltas precisam se espalhar pelo dia, não só de manhã e no fim da tarde`,
    ).toBeGreaterThanOrEqual(8);
    const middayHas = probe.perHour.slice(10, 16).some((c) => c > 0);
    expect(
      middayHas,
      `nenhuma viagem de motivo novo entre 10h e 15h (observações por hora: ${probe.perHour.join(",")}): ` +
        `quem resolve uma volta no meio do dia tinha de aparecer na sonda`,
    ).toBe(true);
  });

  it("a proporção das viagens novas fica perto da config", () => {
    const game = newMainCity();
    const probe = probeDay(game);
    const distinct = Object.keys(probe.perPurpose)
      .map(Number)
      .sort((a, b) => a - b);
    expect(
      distinct.length,
      `hoje não existe motivo novo nenhum para medir proporção: só há trabalho (1) e escola (2)`,
    ).toBeGreaterThan(0);
    // A config manda as proporções em traffic.routine.shareByPurpose (ver config/traffic.yaml).
    const share = game.sim.config.traffic.routine.shareByPurpose as unknown as Record<string, number>;
    const extraKeys = Object.keys(share).filter((k) => k !== "work" && k !== "education" && k !== "other");
    const dica =
      `a config mandou ${JSON.stringify(share)} e foi medido ${JSON.stringify(probe.perPurpose)} ` +
      `(total de viagens novas no dia: ${probe.totalNew})`;
    if (extraKeys.length > 0) {
      // A config já divide o "other" entre compras, saúde e lazer: cada motivo novo tem de ficar
      // perto do valor mandado (margem de 10 pontos percentuais). Como o teste não depende do nome
      // do export novo do código-fonte, compara as listas ordenadas (medido x mandado).
      const measured = distinct.map((p) => probe.perPurpose[p]! / probe.totalNew).sort((a, b) => a - b);
      const expected = extraKeys.map((k) => share[k]!).sort((a, b) => a - b);
      expect(
        measured.length,
        `a config divide o other em ${extraKeys.length} motivos (${extraKeys.join(",")}), ` +
          `mas foram medidos ${measured.length} motivos novos: ${dica}`,
      ).toBe(expected.length);
      for (let i = 0; i < expected.length; i++) {
        expect(
          Math.abs(measured[i]! - expected[i]!),
          `participação longe da config: ${dica}`,
        ).toBeLessThanOrEqual(0.1);
      }
    } else {
      // A config ainda só tem "other" (a divisão entre compras, saúde e lazer está PENDENTE sem
      // fonte): então nenhum dos três motivos novos pode dominar a lista (cada um entre 20% e 50%).
      for (const p of distinct) {
        const part = probe.perPurpose[p]! / probe.totalNew;
        expect(
          part,
          `motivo ${p} com ${(part * 100).toFixed(1)}% das viagens novas (queremos 20% a 50%): ${dica}`,
        ).toBeGreaterThanOrEqual(0.2);
        expect(
          part,
          `motivo ${p} com ${(part * 100).toFixed(1)}% das viagens novas (queremos 20% a 50%): ${dica}`,
        ).toBeLessThanOrEqual(0.5);
      }
    }
    // As viagens novas têm de ser uma fatia real do dia, não um resto simbólico.
    expect(
      probe.workTotal,
      "nenhuma viagem de trabalho medida no dia: a comparação com as viagens novas não vale nada",
    ).toBeGreaterThan(0);
    expect(
      probe.totalNew,
      `viagens novas (${probe.totalNew}) abaixo de 10% das viagens de trabalho (${probe.workTotal}): ` +
        `as voltas precisam ser uma fatia real do dia`,
    ).toBeGreaterThanOrEqual(0.1 * probe.workTotal);
  });

  it("cada motivo novo vai para um destino que existe", () => {
    const game = newMainCity();
    const probe = probeDay(game);
    const distinct = Object.keys(probe.perPurpose)
      .map(Number)
      .sort((a, b) => a - b);
    expect(
      distinct.length,
      `hoje não existe motivo novo nenhum para conferir destino: só há trabalho (1) e escola (2)`,
    ).toBeGreaterThan(0);
    // A conferência só consegue olhar os carros (viagens de motivo novo feitas a pé não têm
    // veículo com destino): para não passar vazio, cada motivo novo com carro precisa de ao
    // menos 20 destinos conferidos.
    const minChecked = 20;
    const buildings = game.sim.buildings;
    let healthKinds = 0;
    let commercialKinds = 0;
    for (const p of distinct) {
      const dests = probe.carDests[p] ?? [];
      expect(
        dests.length,
        `motivo novo ${p} com só ${dests.length} destinos de carro conferidos (queremos ao menos ${minChecked}): ` +
          `sem carro na sonda não dá para provar o destino real; se a implementação fizer essas ` +
          `viagens a pé, ela precisa de carros suficientes na sonda para a conferência valer`,
      ).toBeGreaterThanOrEqual(minChecked);
      let health = 0;
      let commercial = 0;
      for (const d of dests) {
        expect(
          d,
          `viagem de motivo novo ${p} com destino -1: todo motivo novo precisa de um prédio de verdade`,
        ).not.toBe(-1);
        expect(
          d >= 0 && d < buildings.count,
          `viagem de motivo novo ${p} com destino ${d} sem prédio válido ` +
            `(${buildings.count} prédios na cidade): o destino tem de existir`,
        ).toBe(true);
        const tipo = buildings.typeOf(d);
        const isHealth = tipo.service === "health";
        const isCommercial = tipo.zone === "commercial";
        expect(
          isHealth || isCommercial,
          `viagem de motivo novo ${p} para o prédio ${d}, que não é UBS nem comércio: ` +
            `saúde vai para UBS (service health) e compras/lazer vão para o comércio (zone commercial)`,
        ).toBe(true);
        if (isHealth) health++;
        else commercial++;
      }
      // Cada motivo novo tem um destino só: ou é saúde (UBS) ou é compras/lazer (comércio).
      expect(
        health === dests.length || commercial === dests.length,
        `motivo novo ${p} mistura destinos: ${health} para UBS e ${commercial} para comércio ` +
          `(de ${dests.length} conferidos): cada motivo vai para um tipo só de destino`,
      ).toBe(true);
      if (health === dests.length) healthKinds++;
      else commercialKinds++;
    }
    expect(
      healthKinds,
      `nenhum motivo novo vai para UBS: a saúde tinha de ir para a UBS da pessoa ` +
        `(motivos novos medidos: ${distinct.join(",")})`,
    ).toBeGreaterThanOrEqual(1);
    expect(
      commercialKinds,
      `nenhum motivo novo vai para o comércio: compras e lazer vão para o prédio comercial ativo ` +
        `mais perto (motivos novos medidos: ${distinct.join(",")})`,
    ).toBeGreaterThanOrEqual(1);
  });

  it("quem não tem como ir registra o desejo não atendido novo, sem renumerar os antigos", () => {
    const game = housesCity();
    const counts = countUnmetByCode(game);
    const fresh = Object.keys(counts)
      .map(Number)
      .filter((c) => !OLD_UNMET_CODES.includes(c));
    const freshCount = fresh.reduce((sum, c) => sum + counts[c]!, 0);
    expect(
      freshCount,
      `numa cidade só de casas (sem comércio e sem UBS) ninguém registrou o desejo novo ` +
        `(motivos de unmet medidos: ${JSON.stringify(counts)}): quem quis resolver uma volta e não ` +
        `tinha loja perto ou não tinha como ir a pé tinha de registrar o código novo de UNMET`,
    ).toBeGreaterThan(0);
    // Os códigos antigos continuam significando a mesma coisa (1 escola, 2 faculdade, 3 saúde,
    // 4 moradia, 5 emprego, 6 transporte, 7 estacionamento): save antigo não pode quebrar.
    expect(
      {
        school: UNMET.school,
        university: UNMET.university,
        health: UNMET.health,
        housing: UNMET.housing,
        job: UNMET.job,
        transit: UNMET.transit,
        parking: UNMET.parking,
      },
      "algum código antigo de UNMET mudou de número: isso quebra save antigo",
    ).toEqual({ school: 1, university: 2, health: 3, housing: 4, job: 5, transit: 6, parking: 7 });
  });

  it("nenhum código de EV nem de UNMET foi renumerado", () => {
    // Valores de hoje, fixados aqui porque o save antigo gravou estes números: se qualquer um
    // deles mudar, o save antigo passa a significar outra coisa.
    expect(EV, "algum código de EV foi renumerado: isso quebra save antigo").toEqual({
      arrived: 1,
      born: 2,
      died: 3,
      movedHome: 4,
      married: 5,
      divorced: 6,
      jobStart: 7,
      jobEnd: 8,
      schoolStart: 9,
      schoolEnd: 10,
      graduated: 11,
      retired: 12,
      leftCity: 13,
      boughtCar: 14,
      childBorn: 15,
      widowed: 16,
      unmet: 17,
      lostHome: 18,
      movedToRelatives: 19,
    });
    // Só os códigos antigos são fixados: o código novo da issue #39 entra além destes, sem
    // renumerar nenhum deles.
    expect(
      {
        school: UNMET.school,
        university: UNMET.university,
        health: UNMET.health,
        housing: UNMET.housing,
        job: UNMET.job,
        transit: UNMET.transit,
        parking: UNMET.parking,
      },
      "algum código antigo de UNMET foi renumerado: isso quebra save antigo",
    ).toEqual({ school: 1, university: 2, health: 3, housing: 4, job: 5, transit: 6, parking: 7 });
  });

  it("o texto novo aparece em português e nenhum texto antigo sumiu", () => {
    const game = housesCity();
    const events = game.city.events;
    // Uma pessoa que tenha o evento EV.unmet com o código novo (valor fora de 1..7).
    let holder = -1;
    let holderEvent = -1;
    for (let e = 0; e < events.count; e++) {
      if (events.type[e]! !== EV.unmet) continue;
      if (OLD_UNMET_CODES.includes(events.a[e]!)) continue;
      holder = events.person[e]!;
      holderEvent = e;
      break;
    }
    expect(
      holder,
      `ninguém tem o evento de desejo não atendido novo: sem o código novo de UNMET não há texto novo ` +
        `para conferir (códigos medidos: ${JSON.stringify(countUnmetByCode(game))})`,
    ).toBeGreaterThanOrEqual(0);
    const view = personView(game.city, holder);
    expect(view, `a pessoa ${holder} tinha de ter ficha para ler a história`).not.toBeNull();
    const order = events.of(holder);
    const text = view!.history[order.indexOf(holderEvent)]!.text;
    expect(
      text.length,
      `o texto do desejo novo da pessoa ${holder} está vazio: tem de ser uma frase em português`,
    ).toBeGreaterThan(0);
    expect(
      text,
      `o texto do desejo novo da pessoa ${holder} ainda é o genérico "${GENERIC_UNMET_TEXT}": ` +
        `tem de ser uma frase em português falando de loja/UBS/perto de casa ou de não ter como ir a pé`,
    ).not.toBe(GENERIC_UNMET_TEXT);
    expect(
      /loja|compra|mercado|ubs|perto de casa|a p[eé]|como ir|volta/i.test(text),
      `o texto novo "${text}" não fala de loja/UBS/perto de casa nem de não ter como ir a pé: ` +
        `tem de ser uma frase em português sobre a volta que não deu`,
    ).toBe(true);
    // Os textos antigos continuam aparecendo quando o código tem exemplo na cidade:
    // para cada código de UNMET com pelo menos um evento, o texto correspondente tem de
    // existir, ser diferente do genérico e falar do assunto certo. Código sem exemplo na
    // cidade não é exigido (não há texto para conferir, não é texto que sumiu).
    const counts = countUnmetByCode(game);
    const expectedByCode: Record<number, string[]> = {
      [UNMET.school]: ["escola"],
      [UNMET.university]: ["faculdade"],
      [UNMET.health]: ["ubs"],
      [UNMET.housing]: ["casa"],
      [UNMET.job]: ["emprego"],
      [UNMET.transit]: ["longe", "ir"],
      [UNMET.parking]: ["estacionar"],
    };
    // Textos de UNMET por código, reunidos de várias histórias (mesma fonte de antes).
    const textsByCode = new Map<number, string[]>();
    const pop = game.city.pop;
    for (let p = 0; p < pop.count; p++) {
      const v = personView(game.city, p);
      if (!v) continue;
      const orderP = events.of(p);
      for (let i = 0; i < orderP.length; i++) {
        const e = orderP[i]!;
        if (events.type[e]! !== EV.unmet) continue;
        const code = events.a[e]!;
        if (!(code in expectedByCode)) continue;
        const list = textsByCode.get(code) ?? [];
        list.push(v.history[i]!.text);
        textsByCode.set(code, list);
      }
      let done = true;
      for (const key of Object.keys(expectedByCode).map(Number)) {
        if ((counts[key] ?? 0) > 0 && (textsByCode.get(key) ?? []).length === 0) {
          done = false;
          break;
        }
      }
      if (done) break;
    }
    for (const [codeStr, words] of Object.entries(expectedByCode)) {
      const code = Number(codeStr);
      const total = counts[code] ?? 0;
      if (total === 0) continue;
      const list = textsByCode.get(code) ?? [];
      const joined = list.join("\n");
      const lowered = joined.toLowerCase();
      expect(
        list.length,
        `código ${code} tem ${total} desejos não atendidos na cidade mas nenhum texto foi ` +
          `encontrado nas histórias: o texto antigo sumiu (códigos medidos: ${JSON.stringify(counts)})`,
      ).toBeGreaterThan(0);
      for (const t of list) {
        expect(
          t,
          `o texto do código ${code} ("${t}") ainda é o genérico "${GENERIC_UNMET_TEXT}": ` +
            `tem de ser uma frase em português sobre o assunto certo (código ${code} tem ` +
            `${total} exemplos na cidade)`,
        ).not.toBe(GENERIC_UNMET_TEXT);
      }
      expect(
        words.some((w) => lowered.includes(w)),
        `nenhuma pessoa fala mais de "${words.join('" ou "')}" nos desejos não atendidos do código ` +
          `${code} (${total} exemplos na cidade): algum texto antigo de UNMET sumiu ` +
          `(textos do código ${code}: ${list.slice(0, 3).join(" | ")})`,
      ).toBe(true);
    }
  });

  it("regras do mundo que nunca podem quebrar", () => {
    const game = newMainCity();
    expect(checkInvariants(game.city)).toEqual([]);
  });

  it("mesma semente dá o mesmo resultado", () => {
    const first = probeDay(newMainCity());
    const second = probeDay(newMainCity());
    expect(
      second.perHour,
      "mesma semente deu viagens por hora diferentes: a sonda de motivo novo precisa ser estável",
    ).toEqual(first.perHour);
    expect(
      second.perPurpose,
      "mesma semente deu viagens por motivo diferentes: o sorteio do motivo do dia precisa ser estável",
    ).toEqual(first.perPurpose);
  });
});
