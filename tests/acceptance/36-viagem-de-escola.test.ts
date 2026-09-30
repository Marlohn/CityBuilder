/**
 * Issue #36 — viagem de escola: ida e volta a partir da matrícula.
 *
 * Hoje a única viagem do motor é casa → trabalho → casa (`packages/sim/src/traffic/trafficSystem.ts`).
 * A escola existe como matrícula (`pop.school[p]`) e a config já tem `routine.schoolStartMinute`
 * (420 = 7h) e `routine.schoolDurationMinutes` (300 = 5h de aula), mas ninguém lê os dois: a criança
 * nunca sai de casa. Esta tarefa cria a primeira viagem que não é para o trabalho.
 *
 * Cidade de teste: o cenário `bairro-basico` (escola em (61,141) e UBS), semente fixa `escola-1`,
 * 25 dias. O teste roda o jogo tick a tick (mesmo laço de `createRun`/do CLI) para poder olhar cada
 * momento do dia — o relatório só mostra o pico, e aqui interessa a HORA da viagem.
 *
 * Um `it` por critério do "tá pronto quando" da issue #36.
 */
import { scenarioCommands } from "@city/bots";
import { loadConfigAndData, loadScenario } from "@city/cli";
import { checkInvariants, createGame, type Game } from "@city/sim";
import { describe, expect, it } from "vitest";

const SEMENTE = "escola-1";
const DIAS = 25;
/** Medido na `main` antes da task: `npm run sim -- report --scenario=bairro-basico --seed=escola-1 --days=25`. */
const PICO_TRIPS_ANTES = 18;
/** Início do turno (7h) menos 1h de margem: a ida tem que ser de manhã. */
const MANHA: readonly [number, number] = [360, 540];
/** 12h (fim da aula, 420 + 300) até 19h: a volta sai aqui e ninguém deve ir para a escola depois das 13h. */
const VOLTA: readonly [number, number] = [700, 1140];
const TARDE = 780;

/** Uma viagem observada num tick do dia. */
interface Viagem {
  /** Minuto do dia em que a viagem foi registrada. */
  minuto: number;
  /** Quem viajou (a pessoa; no carro, o motorista). */
  pessoa: number;
  /** Prédio de destino (carro) ou -1 quando foi a pé. */
  destino: number;
  /** Via de saída (a pé). */
  sai?: number;
  /** Via de chegada (a pé). */
  che?: number;
}

/** Tudo o que o teste observa durante a simulação, tick a tick. */
interface Observado {
  viagens: Viagem[];
  /** Pico de `tripsStarted` por tick em toda a simulação. */
  picoTrips: number;
  /** Pessoas que ficaram mais de um dia de jogo em viagem (tripState 1 ou 3). */
  presos: number[];
  /** Partidas no mesmo minuto para a mesma pessoa. */
  colisoes: string[];
  /** Quantas vezes alguém com emprego chegou ao trabalho (tripState 2). */
  chegaramNoTrabalho: number;
  /** Prédios de escola existentes e funcionando. */
  escolas: number[];
}

/** Simula o cenário dia a dia, tick a tick, e anota o que acontece. */
function rodar(): { game: Game; obs: Observado } {
  const scenario = loadScenario("bairro-basico");
  const { config, data } = loadConfigAndData(scenario?.overrides ?? {});
  const game = createGame({ config, data, seed: SEMENTE });
  const sim = game.sim;
  if (scenario) for (const s of scenarioCommands(scenario)) sim.enqueue(s.command);

  const obs: Observado = {
    viagens: [],
    picoTrips: 0,
    presos: [],
    colisoes: [],
    chegaramNoTrabalho: 0,
    escolas: [],
  };
  const pop = game.city.pop;
  const bs = game.sim.buildings;
  const veh = game.traffic.vehicles;
  const partidaNoMinuto = new Map<string, Set<number>>(); // "dia@minuto" → quem saiu
  const desde = new Map<number, number>(); // pessoa → tick em que entrou em viagem
  const tpd = sim.clock.ticksPerDay;
  let seqAnterior = 0;

  for (let t = 0; t < DIAS * tpd; t++) {
    sim.step(1);
    const minuto = sim.clock.minuteOfDay;
    const hora = `${sim.clock.day}@${minuto}`;

    // Viagens que entraram no log da tela (o log conta todas desde o começo do jogo).
    if (game.traffic.tripSeq > seqAnterior) {
      for (const v of game.traffic.tripLog.slice(seqAnterior)) {
        if (v.kind === "walk") {
          obs.viagens.push({
            minuto,
            pessoa: v.id,
            destino: -1,
            sai: v.from ?? -1,
            che: v.to ?? -1,
          });
          marcaPartida(obs, partidaNoMinuto, hora, v.id);
        } else if (veh.state[v.id] === 1 /* VSTATE.moving */ && veh.driver[v.id]! >= 0) {
          const p = veh.driver[v.id]!;
          obs.viagens.push({ minuto, pessoa: p, destino: veh.destBuilding[v.id]!, deCarro: true } as Viagem);
          marcaPartida(obs, partidaNoMinuto, hora, p);
        }
      }
      seqAnterior = game.traffic.tripSeq;
    }

    // Estado de viagem de cada um: quem trabalha chega, e quem está em viagem há demais está preso.
    for (let p = 0; p < pop.count; p++) {
      if (pop.status[p] !== 1 /* PSTATUS.alive */) {
        desde.delete(p);
        continue;
      }
      const st = pop.tripState[p]!;
      if (st === 2) obs.chegaramNoTrabalho++;
      if (st === 1 || st === 3) {
        if (!desde.has(p)) desde.set(p, sim.clock.tick);
        else if (sim.clock.tick - desde.get(p)! > tpd) obs.presos.push(p);
      } else desde.delete(p);
    }

    obs.picoTrips = Math.max(obs.picoTrips, sim.perf.peak.tripsStarted ?? 0);
  }

  for (let b = 0; b < bs.count; b++)
    if (bs.typeOf(b).service === "school" && bs.isActive(b)) obs.escolas.push(b);
  return { game, obs };
}

/** Marca a partida e anota colisão: a mesma pessoa não pode sair para dois lugares no mesmo minuto. */
function marcaPartida(obs: Observado, mapa: Map<string, Set<number>>, hora: string, pessoa: number) {
  let s = mapa.get(hora);
  if (!s) mapa.set(hora, (s = new Set()));
  if (s.has(pessoa)) obs.colisoes.push(`pessoa ${pessoa} na hora ${hora}`);
  s.add(pessoa);
}

/** A viagem vai para um prédio de escola (de carro, pelo destino; a pé, pela via de acesso). */
function vaiParaEscola(v: Viagem, obs: Observado, game: Game): boolean {
  const acessos = obs.escolas.map((b) => game.sim.buildings.access[b]!);
  if (v.destino >= 0) return obs.escolas.includes(v.destino);
  return v.che !== undefined && acessos.includes(v.che);
}

/** A viagem sai de um prédio de escola e chega na casa da pessoa. */
function voltaDaEscola(v: Viagem, obs: Observado, game: Game, pessoa: number): boolean {
  const acessos = obs.escolas.map((b) => game.sim.buildings.access[b]!);
  const saiDaEscola =
    (v.destino >= 0 && acessos.includes(game.sim.buildings.access[v.destino]!)) ||
    (v.sai !== undefined && acessos.includes(v.sai));
  if (!saiDaEscola) return false;
  if (v.destino >= 0) return v.destino === game.city.homeBuilding(pessoa);
  return v.che !== undefined && v.che === game.city.homeAccess(pessoa);
}

/** A pessoa está viva e matriculada em alguma escola. */
function matriculado(game: Game, pessoa: number): boolean {
  const pop = game.city.pop;
  return pop.status[pessoa] === 1 /* PSTATUS.alive */ && pop.school[pessoa]! >= 0;
}

const { game, obs } = rodar();

describe("issue #36: viagem de escola (ida e volta)", () => {
  it("os alunos matriculados saem de casa de manhã e chegam na escola", () => {
    expect(
      obs.escolas.length,
      "a cidade de teste precisa ter uma escola funcionando (o cenário bairro-basico põe uma em (61,141))",
    ).toBeGreaterThan(0);
    const morning = obs.viagens.filter(
      (v) =>
        v.minuto >= MANHA[0] &&
        v.minuto <= MANHA[1] &&
        matriculado(game, v.pessoa) &&
        vaiParaEscola(v, obs, game),
    );
    expect(
      morning.length,
      "nenhum aluno matriculado apareceu indo para a escola entre 6h e 9h. " +
        `Reproduzir: npm run sim -- report --scenario=bairro-basico --seed=${SEMENTE} --days=${DIAS}`,
    ).toBeGreaterThan(0);
  });

  it("os alunos voltam para casa depois da aula e não ficam na escola à tarde", () => {
    const voltas = obs.viagens.filter(
      (v) =>
        v.minuto >= VOLTA[0] &&
        v.minuto <= VOLTA[1] &&
        matriculado(game, v.pessoa) &&
        voltaDaEscola(v, obs, game, v.pessoa),
    );
    expect(
      voltas.length,
      "nenhum aluno matriculado voltou para casa depois das 12h. " +
        `Reproduzir: npm run sim -- report --scenario=bairro-basico --seed=${SEMENTE} --days=${DIAS}`,
    ).toBeGreaterThan(0);
    const tardeDaEscola = obs.viagens.filter(
      (v) => v.minuto >= TARDE && matriculado(game, v.pessoa) && vaiParaEscola(v, obs, game),
    );
    expect(
      tardeDaEscola.length,
      `${tardeDaEscola.length} aluno(s) ainda iam para a escola depois das 13h: a volta não saiu da escola`,
    ).toEqual(0);
  });

  it("o trabalho continua funcionando como hoje", () => {
    expect(
      obs.chegaramNoTrabalho,
      "ninguém com emprego chegou ao trabalho (tripState 2): a viagem do trabalho parou de funcionar",
    ).toBeGreaterThan(0);
  });

  it("o pico de viagens por tick sobe em relação a hoje", () => {
    expect(
      obs.picoTrips,
      `o pico de tripsStarted ficou em ${obs.picoTrips}; na main (antes da task) o cenário bairro-basico ` +
        `com a semente ${SEMENTE} dá ${PICO_TRIPS_ANTES}. As viagens da escola têm que contar no contador.`,
    ).toBeGreaterThan(PICO_TRIPS_ANTES);
  });

  it("ninguém fica preso em viagem", () => {
    expect(
      obs.presos.length,
      `${obs.presos.length} pessoa(s) ficaram com tripState 1 ou 3 por mais de um dia de jogo ` +
        `(primeira: ${obs.presos[0] ?? "—"}). Reproduzir: npm run sim -- report ` +
        `--scenario=bairro-basico --seed=${SEMENTE} --days=${DIAS}`,
    ).toEqual(0);
  });

  it("quem trabalha e estuda não tem as duas viagens no mesmo minuto", () => {
    expect(
      obs.colisoes,
      `mesma pessoa saindo para dois lugares no mesmo minuto: ${obs.colisoes.slice(0, 5).join(", ")}`,
    ).toEqual([]);
  });

  it("ninguém surge do nada (regras que nunca podem quebrar)", () => {
    expect(checkInvariants(game.city)).toEqual([]);
  });
});
