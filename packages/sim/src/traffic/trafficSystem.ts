/**
 * Trânsito e rotina diária.
 * - De manhã cada trabalhador sai de casa (horário de entrada sorteado por pessoa, config traffic.routine).
 * - Se a família tem carro e ele está em casa, vai de carro: pede rota, sai no tick seguinte, estaciona no destino.
 * - Sem carro disponível: vai a pé (se perto) ou por outro meio (ônibus/aplicativo, abstrato) e isso conta
 *   como desejo não atendido de transporte.
 * - Fim do expediente: volta para casa pelo mesmo caminho.
 * - Quem está matriculado na escola sai de manhã no horário do turno (config traffic.routine) e volta
 *   depois de `schoolDurationMinutes` de aula. A volta é sempre para casa, do trabalho ou da escola.
 * - Congestionamento: função BPR (1964) com o volume do dia anterior em cada quadradinho, por hora.
 */
import type { City } from "../city";
import { hashString } from "../core/rng";
import { fire } from "../people/actions";
import { EV, UNMET } from "../people/events";
import { OUTSIDE_JOB, PSTATUS } from "../people/population";
import { tileCostDs } from "../routing/pathfinder";
import { type Route, RouteService } from "../routing/routeService";
import type { System } from "../sim";
import { Vehicles, VSTATE } from "./vehicles";

/** Motivo da viagem (vai em `PendingTrip.purpose` e em `pop.tripPurpose`). */
export const TRIP = { none: 0, work: 1, school: 2 } as const;

interface PendingTrip {
  person: number;
  vehicle: number;
  from: number;
  to: number;
  /** Prédio de destino (-2 = saída da cidade para emprego fora). */
  dest: number;
  /** Motivo da viagem (TRIP.work | TRIP.school). */
  purpose: number;
  /** true = ida (sai de casa), false = volta (volta para casa). */
  toDest: boolean;
}

/** Viagem agendada num tick (saída ou volta): quem vai e por quê. */
interface ScheduledTrip {
  p: number;
  purpose: number;
}

/** Chegada agendada: o sinal diz a direção (p = ida, -1-p = volta) e o motivo vai junto. */
interface ScheduledArrival {
  code: number;
  purpose: number;
}

const MODELS = 4;

/** Viagem que acabou de começar (só para a tela desenhar; a simulação não lê isto). */
export interface TripStart {
  kind: "car" | "walk";
  /** Carro (kind "car") ou pessoa (kind "walk"). */
  id: number;
  model: number;
  /** Rota de carro (quadradinhos). */
  tiles?: Int32Array;
  /** Início e fim a pé (quadradinhos de via). */
  from?: number;
  to?: number;
}

export class TrafficSystem implements System {
  readonly name = "traffic";
  readonly vehicles = new Vehicles();
  readonly routes: RouteService;
  private departures: ScheduledTrip[][];
  private returns: ScheduledTrip[][];
  private arrivals: ScheduledArrival[][];
  private vehicleArrivals: number[][];
  /** Viagens pedidas neste tick (junto com o pedido de rota, na mesma ordem). */
  private newTrips: PendingTrip[] = [];
  /** Viagens do tick anterior, já com rota resolvida (mesma ordem de `resolved`). */
  private pendingTrips: PendingTrip[] = [];
  private resolved: (Route | null)[] = [];
  private volumes: Uint16Array;
  private prevVolumes: Uint16Array;
  private capacity: Float32Array;
  private capacityVersion = -1;
  private lastDay = -1;
  /** Viagens começadas (para a tela). `tripSeq` conta todas desde o começo do jogo. */
  readonly tripLog: TripStart[] = [];
  tripSeq = 0;

  constructor(private city: City) {
    const sim = city.sim;
    const cfg = sim.config;
    const tm = sim.world.tileMeters;
    this.routes = new RouteService(
      sim.world,
      { tileCost: [0, tileCostDs(tm, cfg.roads.street.speedKmh), tileCostDs(tm, cfg.roads.avenue.speedKmh)] },
      sim.perf,
      cfg.performance.routeCacheMax,
    );
    const tpd = sim.clock.ticksPerDay;
    this.departures = Array.from({ length: tpd }, () => []);
    this.returns = Array.from({ length: tpd }, () => []);
    this.arrivals = Array.from({ length: tpd }, () => []);
    this.vehicleArrivals = Array.from({ length: tpd }, () => []);
    this.volumes = new Uint16Array(sim.world.size * 24);
    this.prevVolumes = new Uint16Array(sim.world.size * 24);
    this.capacity = new Float32Array(sim.world.size);
    city.onCarBought = (h) => this.buyCar(h);
    city.onCarGone = (v) => this.removeCar(v);
    city.onCarMoved = (v, h) => {
      this.vehicles.owner[v] = h;
    };
    city.onHouseholdMoved = (h, home) => this.householdMoved(h, home);
    city.onJobEnding = (p, job) => this.jobEnding(p, job);
    city.onPersonGone = (p) => this.personGone(p);
  }

  /** Família mudou de casa: o carro estacionado vai junto (levado por alguém da família). */
  private householdMoved(h: number, home: number) {
    const v = this.city.hh.car[h]!;
    if (v < 0 || this.vehicles.state[v] !== VSTATE.parked || this.vehicles.driver[v] !== -1) return;
    this.unpark(v);
    this.park(v, home);
  }

  /** Perdeu o emprego no meio do expediente: volta para casa agora (de carro, se veio de carro). */
  private jobEnding(p: number, job: number) {
    const city = this.city;
    const { pop } = city;
    if (pop.tripState[p] !== 2 || pop.tripPurpose[p] !== TRIP.work) return;
    const car = city.hh.car[pop.household[p]!] ?? -1;
    const veh = this.vehicles;
    const homeAccess = city.homeAccess(p);
    const from = job === OUTSIDE_JOB ? city.sim.network.exitFor(homeAccess) : city.sim.buildings.access[job]!;
    if (
      car >= 0 &&
      veh.driver[car] === p &&
      veh.state[car] !== VSTATE.moving &&
      homeAccess >= 0 &&
      from >= 0
    ) {
      this.newTrips.push({
        person: p,
        vehicle: car,
        from,
        to: homeAccess,
        dest: city.homeBuilding(p),
        purpose: TRIP.work,
        toDest: false,
      });
      this.routes.request(from, homeAccess);
      pop.tripState[p] = 3;
    } else pop.tripState[p] = 0;
  }

  /** Motorista morreu ou foi embora: a família busca o carro (ou ele vai junto com a família). */
  private personGone(p: number) {
    const city = this.city;
    const h = city.pop.household[p]!;
    const car = h >= 0 ? city.hh.car[h]! : -1;
    const veh = this.vehicles;
    if (car < 0 || veh.driver[car] !== p) return;
    veh.driver[car] = -1;
    if (veh.state[car] === VSTATE.moving) return; // termina a viagem e estaciona no destino
    const home = city.hh.home[h]!;
    this.unpark(car);
    if (home >= 0) this.park(car, home);
  }

  tick() {
    const city = this.city;
    const clock = city.sim.clock;
    if (clock.day !== this.lastDay) {
      this.lastDay = clock.day;
      this.startDay();
    }
    // 1. Rotas pedidas no tick anterior: carros saem agora (na ordem dos pedidos).
    this.applyResolved();
    const tod = clock.tickOfDay;
    // 2. Chegadas (primeiro os carros estacionam, depois as pessoas).
    const varr = this.vehicleArrivals[tod]!;
    for (let i = 0; i < varr.length; i++) this.vehicleArrive(varr[i]!);
    varr.length = 0;
    const arr = this.arrivals[tod]!;
    for (let i = 0; i < arr.length; i++) this.arrive(arr[i]!.code, arr[i]!.purpose);
    arr.length = 0;
    // 3. Saídas para o trabalho/escola e voltas para casa.
    const dep = this.departures[tod]!;
    for (let i = 0; i < dep.length; i++) this.leave(dep[i]!.p, dep[i]!.purpose, true);
    dep.length = 0;
    const ret = this.returns[tod]!;
    for (let i = 0; i < ret.length; i++) this.leave(ret[i]!.p, ret[i]!.purpose, false);
    ret.length = 0;
    // 4. Resolve as rotas pedidas neste tick (aplicadas no próximo, na mesma ordem).
    this.resolved = this.routes.resolvePending();
    this.pendingTrips = this.newTrips;
    this.newTrips = [];
    city.sim.perf.count("vehiclesMoving", 0);
  }

  /** Começo do dia: agenda a saída de todos (trabalho e escola) e vira a página do volume de tráfego. */
  private startDay() {
    const city = this.city;
    const { pop, sim } = city;
    const tmp = this.prevVolumes;
    this.prevVolumes = this.volumes;
    this.volumes = tmp;
    this.volumes.fill(0);
    const r = sim.config.traffic.routine;
    const tpd = sim.clock.ticksPerDay;
    const mpt = sim.config.time.minutesPerTick;
    const spread = Math.max(1, r.schoolStartSpreadMinutes);
    for (let p = 0; p < pop.count; p++) {
      if (pop.status[p] !== PSTATUS.alive) continue;
      if (pop.job[p] !== -1) {
        if (pop.workMinutes[p] === 0) {
          // Jornada estável por pessoa (sorteada a partir do id e da semente, uma vez só).
          const h = hashString(`${sim.seed}:workdur:${p}`)[0];
          const u = (h >>> 0) / 4294967296;
          let weekly = r.workHoursWeekly.mean + (u - 0.5) * 2 * r.workHoursWeekly.spread;
          if (weekly > r.maxHoursWeekly) weekly = r.maxHoursWeekly;
          if (weekly < 0) weekly = 0;
          let minutes = Math.round((weekly * 60) / r.workdaysPerWeek);
          // Weekly cap also covers the round-trip commute measured by the shift clock,
          // so the shift itself stays below the daily share of maxHoursWeekly.
          // 5 is a commute floor in minutes (trip, not shift).
          const cap = Math.max(
            r.minMinutes,
            (r.maxHoursWeekly * 60) / r.workdaysPerWeek - 2 * Math.max(5, pop.commuteMinutes[p]!),
          );
          if (minutes > cap) minutes = cap;
          if (minutes < r.minMinutes) minutes = r.minMinutes;
          pop.workMinutes[p] = minutes;
        }
        if (pop.workStartMinute[p] === 0) {
          // Entrada estável por pessoa, com a hora pesando pela curva tripsByHour.
          pop.workStartMinute[p] = this.pickWorkStartMinute(
            r.workStartMinute[0],
            r.workStartMinute[1],
            `${sim.seed}:workstart:${p}`,
          );
        }
        const leaveMin = pop.workStartMinute[p]! - Math.max(5, pop.commuteMinutes[p]!) - 5;
        const t = Math.floor(Math.max(0, leaveMin) / mpt) % tpd;
        pop.tripState[p] = 0;
        pop.tripPurpose[p] = TRIP.none;
        this.departures[t]!.push({ p, purpose: TRIP.work });
      }
      // Ida à escola no início do turno (a volta sai depois da aula, em `arrive`).
      if (pop.school[p]! >= 0) {
        pop.tripState[p] = 0;
        pop.tripPurpose[p] = TRIP.none;
        // Ida escalonada por pessoa para não estourar o orçamento de busca de rotas.
        const h = hashString(`${sim.seed}:school:${p}`)[0];
        const t = (Math.floor(r.schoolStartMinute / mpt) + (h % spread)) % tpd;
        this.departures[t]!.push({ p, purpose: TRIP.school });
      }
    }
  }

  /**
   * Pesos acumulados por hora do dia (curva tripsByHour do config), montados uma vez (lazy).
   * Cada entrada guarda a hora e o acumulado até ela (ordem crescente).
   * O cache nunca é invalidado de propósito, porque a config é imutável depois de carregada e a curva tripsByHour não muda durante a partida.
   */
  private hourWeights: { hour: number; cum: number }[] | null = null;

  private hourTable(): { hour: number; cum: number }[] {
    if (this.hourWeights) return this.hourWeights;
    const raw = this.city.config.traffic.routine.tripsByHour;
    const hours = Object.keys(raw)
      .map(Number)
      .filter((h) => Number.isFinite(h))
      .sort((a, b) => a - b);
    const table: { hour: number; cum: number }[] = [];
    let cum = 0;
    for (const hour of hours) {
      const w = raw[String(hour)] ?? 0;
      if (w <= 0) continue;
      cum += w;
      table.push({ hour, cum });
    }
    this.hourWeights = table;
    return table;
  }

  /**
   * Sorteia o minuto de entrada dentro da janela [min, max]: primeiro a hora, com peso
   * da curva tripsByHour (só horas com peso > 0), depois o minuto dentro da hora.
   * Estável por pessoa (semente + id): só usa o hash, sem sorteio global.
   */
  private pickWorkStartMinute(min: number, max: number, seed: string): number {
    const table = this.hourTable();
    const loHour = Math.floor(min / 60);
    const hiHour = Math.floor(max / 60);
    const h = hashString(seed);
    let total = 0;
    let prev = 0;
    const inWindow: { hour: number; w: number }[] = [];
    for (const e of table) {
      const w = e.cum - prev;
      prev = e.cum;
      if (e.hour < loHour || e.hour > hiHour || w <= 0) continue;
      inWindow.push({ hour: e.hour, w });
      total += w;
    }
    let hour: number;
    if (inWindow.length === 0 || total <= 0) {
      // Sem peso na janela: minuto uniforme na janela (como era antes da curva).
      return min + ((h[0]! >>> 0) % (max - min + 1));
    }
    const x = ((h[0]! >>> 0) / 4294967296) * total;
    hour = inWindow[inWindow.length - 1]!.hour;
    let acc = 0;
    for (const e of inWindow) {
      acc += e.w;
      if (x < acc) {
        hour = e.hour;
        break;
      }
    }
    // Minuto dentro da hora, limitado à janela.
    const loMin = Math.max(0, min - hour * 60);
    const hiMin = Math.min(59, max - hour * 60);
    const span = hiMin - loMin + 1;
    if (span <= 0) return Math.max(min, Math.min(max, hour * 60));
    return hour * 60 + loMin + ((h[1]! >>> 0) % span);
  }

  private buyCar(h: number) {
    const city = this.city;
    const home = city.hh.home[h]!;
    const model = city.rng.market.int(MODELS);
    const v = this.vehicles.create(h, model, home);
    city.hh.car[h] = v;
    if (home >= 0) this.park(v, home);
  }

  private removeCar(v: number) {
    const veh = this.vehicles;
    if (veh.state[v] === VSTATE.gone) return;
    this.unpark(v);
    veh.moving.delete(v);
    veh.state[v] = VSTATE.gone;
    veh.routes[v] = null;
    veh.routeCum[v] = null;
  }

  private parkingCapacity(b: number): number {
    const bs = this.city.sim.buildings;
    const cars = this.city.config.traffic.cars;
    return Math.ceil(bs.homesCapacity(b) * cars.parkingPerHome + bs.jobsCapacity(b) * cars.parkingPerJob);
  }

  private park(v: number, b: number) {
    const veh = this.vehicles;
    const bs = this.city.sim.buildings;
    veh.state[v] = VSTATE.parked;
    veh.routes[v] = null;
    veh.routeCum[v] = null;
    if (b >= 0 && bs.parked[b]! < this.parkingCapacity(b)) {
      veh.parkedAt[v] = b;
      veh.streetTile[v] = -1;
      bs.parked[b]!++;
    } else {
      // Sem vaga no prédio: estaciona na rua em frente (e conta como desejo não atendido).
      veh.parkedAt[v] = -1;
      veh.streetTile[v] = b >= 0 ? bs.access[b]! : -1;
      this.city.year.parkingMisses++;
    }
  }

  private unpark(v: number) {
    const veh = this.vehicles;
    const b = veh.parkedAt[v]!;
    if (veh.state[v] === VSTATE.parked && b >= 0) this.city.sim.buildings.parked[b]!--;
    veh.parkedAt[v] = -1;
    veh.streetTile[v] = -1;
  }

  /** A pessoa sai de casa (toDest) ou volta do trabalho/escola. A volta é sempre para casa. */
  private leave(p: number, purpose: number, toDest: boolean) {
    const city = this.city;
    const { pop, hh, sim } = city;
    if (pop.status[p] !== PSTATUS.alive) return;
    // Uma viagem por pessoa por vez: a segunda saída da manhã não sai.
    if (toDest && pop.tripState[p] !== 0) return;
    if (!toDest && pop.tripState[p] !== 2) return;
    const homeAccess = city.homeAccess(p);
    if (homeAccess < 0) return;
    const isWork = purpose === TRIP.work;
    // Prédio onde a pessoa está (volta) ou para onde vai (ida); fora da cidade só o emprego.
    const away = isWork ? pop.job[p]! : pop.school[p]!;
    if (away === -1) {
      // Perdeu o destino no meio do dia: amanhece em casa.
      if (!toDest) {
        pop.tripState[p] = 0;
        pop.tripPurpose[p] = TRIP.none;
      }
      return;
    }
    const awayAccess =
      isWork && away === OUTSIDE_JOB ? sim.network.exitFor(homeAccess) : sim.buildings.access[away]!;
    if (awayAccess < 0) return;
    const from = toDest ? homeAccess : awayAccess;
    const to = toDest ? awayAccess : homeAccess;
    if (purpose === TRIP.school && toDest) {
      // A criança vai a pé: a matrícula não consome o carro da família (config/education.yaml,
      // maxDistanceMeters: 2000; PNAD Educação: a maioria dos alunos vai a pé).
      const meters = sim.world.manhattanMeters(from, to);
      const walkMax = sim.config.education.maxDistanceMeters;
      const kmh =
        meters <= walkMax ? sim.config.traffic.walking.speedKmh : sim.config.roads.avenue.speedKmh / 2;
      this.logTrip({ kind: "walk", id: p, model: p % 4, from, to });
      city.sim.perf.count("tripsStarted");
      this.scheduleArrival(p, (meters / 1000 / kmh) * 60, purpose, toDest);
      return;
    }
    const h = pop.household[p]!;
    const car = hh.car[h]!;
    const veh = this.vehicles;
    const home = city.homeBuilding(p);
    const carHere =
      car >= 0 &&
      veh.state[car] === VSTATE.parked &&
      veh.driver[car] === -1 &&
      (toDest ? veh.parkedAt[car] === home || veh.streetTile[car] === homeAccess : veh.driver[car] === -1);
    // De carro: só se o carro estiver onde a pessoa está (em casa de manhã; na volta, com o motorista).
    const drivesBack =
      !toDest &&
      car >= 0 &&
      veh.driver[car] === p &&
      veh.state[car] !== VSTATE.moving &&
      veh.state[car] !== VSTATE.gone;
    if ((toDest && carHere) || drivesBack) {
      veh.driver[car] = p;
      this.newTrips.push({ person: p, vehicle: car, from, to, dest: toDest ? away : home, purpose, toDest });
      this.routes.request(from, to);
      pop.tripState[p] = toDest ? 1 : 3;
      pop.tripPurpose[p] = purpose;
      return;
    }
    // Sem carro: a pé (se perto) ou por outro meio. Tempo estimado; sem veículo na tela.
    const meters = sim.world.manhattanMeters(from, to);
    const walkMax = isWork
      ? sim.config.traffic.walking.maxWorkMeters
      : sim.config.education.maxDistanceMeters;
    const kmh =
      meters <= walkMax ? sim.config.traffic.walking.speedKmh : sim.config.roads.avenue.speedKmh / 2;
    if (isWork && toDest && meters > walkMax) {
      city.year.transitRefusals++;
      if (city.rng.market.chance(0.05)) city.log(EV.unmet, p, UNMET.transit);
    }
    if (meters <= walkMax) this.logTrip({ kind: "walk", id: p, model: p % 4, from, to });
    const minutes =
      (meters / 1000 / kmh) * 60 +
      (isWork && away === OUTSIDE_JOB ? sim.config.population.outsideJobs.extraCommuteMinutes : 0);
    this.scheduleArrival(p, minutes, purpose, toDest);
  }

  private logTrip(t: TripStart) {
    const max = this.city.config.traffic.tripLogMax;
    this.tripLog.push(t);
    this.tripSeq++;
    if (this.tripLog.length > max) this.tripLog.splice(0, this.tripLog.length - max / 2);
  }

  private scheduleArrival(p: number, minutes: number, purpose: number, toDest: boolean) {
    const clock = this.city.sim.clock;
    const ticks = clock.minutesToTicks(minutes);
    const at = (clock.tickOfDay + ticks) % clock.ticksPerDay;
    this.city.pop.tripState[p] = toDest ? 1 : 3;
    this.city.pop.tripPurpose[p] = purpose;
    if (purpose === TRIP.work && toDest)
      this.city.pop.commuteMinutes[p] = Math.min(65535, Math.round(minutes));
    this.arrivals[at]!.push({ code: toDest ? p : -1 - p, purpose });
  }

  private applyResolved() {
    const city = this.city;
    const trips = this.pendingTrips;
    const results = this.resolved;
    this.pendingTrips = [];
    this.resolved = [];
    if (trips.length !== results.length)
      throw new Error(`trânsito: ${trips.length} viagens para ${results.length} rotas`);
    for (let i = 0; i < trips.length; i++) {
      const t = trips[i]!;
      const route = results[i] ?? null;
      const { pop } = city;
      const veh = this.vehicles;
      if (!route || pop.status[t.person] !== PSTATUS.alive || veh.state[t.vehicle] === VSTATE.gone) {
        veh.driver[t.vehicle] = -1;
        if (!route && t.purpose === TRIP.work && pop.status[t.person] === PSTATUS.alive) {
          // Não existe caminho até o trabalho (via demolida): perde o emprego.
          // Sem via até a escola: só volta para casa (não perde o emprego).
          fire(city, t.person, "sem caminho até o trabalho");
        }
        pop.tripState[t.person] = 0;
        pop.tripPurpose[t.person] = TRIP.none;
        continue;
      }
      this.depart(t, route);
    }
  }

  private depart(t: PendingTrip, route: Route) {
    const city = this.city;
    const clock = city.sim.clock;
    const veh = this.vehicles;
    const v = t.vehicle;
    this.unpark(v);
    const seconds = this.travelSeconds(route, clock.minuteOfDay);
    const extra =
      t.dest === OUTSIDE_JOB && t.purpose === TRIP.work
        ? city.config.population.outsideJobs.extraCommuteMinutes
        : 0;
    const minutes = seconds / 60 + extra;
    veh.state[v] = VSTATE.moving;
    veh.routes[v] = route.tiles;
    veh.routeCum[v] = route.cum;
    veh.departTick[v] = clock.tick;
    veh.arriveTick[v] = clock.tick + Math.max(1, Math.round(seconds / 60 / city.config.time.minutesPerTick));
    veh.destBuilding[v] = t.dest;
    veh.moving.add(v);
    city.sim.perf.count("tripsStarted");
    this.logTrip({ kind: "car", id: v, model: veh.model[v]!, tiles: route.tiles });
    if (t.purpose === TRIP.work && t.toDest)
      city.pop.commuteMinutes[t.person] = Math.min(65535, Math.round(minutes));
    const drive = veh.arriveTick[v]! - clock.tick;
    this.vehicleArrivals[(clock.tickOfDay + drive) % clock.ticksPerDay]!.push(v);
    const at = (clock.tickOfDay + drive + (extra > 0 ? clock.minutesToTicks(extra) : 0)) % clock.ticksPerDay;
    this.arrivals[at]!.push({ code: t.toDest ? t.person : -1 - t.person, purpose: t.purpose });
  }

  /** Prédio demolido: carros estacionados nele vão para a rua em frente. */
  onBuildingRemoved(b: number) {
    const veh = this.vehicles;
    const bs = this.city.sim.buildings;
    for (let v = 0; v < veh.count; v++) {
      if (veh.state[v] === VSTATE.parked && veh.parkedAt[v] === b) {
        bs.parked[b]!--;
        veh.parkedAt[v] = -1;
        veh.streetTile[v] = bs.access[b]!;
      }
    }
  }

  private vehicleArrive(v: number) {
    const veh = this.vehicles;
    if (veh.state[v] !== VSTATE.moving) return;
    veh.moving.delete(v);
    const dest = veh.destBuilding[v]!;
    if (dest >= 0 && this.city.sim.buildings.state[dest] === 3) {
      // O destino foi demolido durante a viagem: estaciona na rua.
      veh.state[v] = VSTATE.parked;
      veh.routes[v] = null;
      veh.routeCum[v] = null;
      veh.parkedAt[v] = -1;
      veh.streetTile[v] = this.city.sim.buildings.access[dest]!;
      return;
    }
    if (dest === OUTSIDE_JOB) {
      veh.state[v] = VSTATE.outside;
      veh.routes[v] = null;
      veh.routeCum[v] = null;
    } else this.park(v, dest);
  }

  /** Tempo de viagem (segundos) com congestionamento (BPR) usando o volume de ontem nesta hora. */
  private travelSeconds(route: Route, minuteOfDay: number): number {
    const cfg = this.city.config;
    this.refreshCapacity();
    const hour = Math.floor(minuteOfDay / 60) % 24;
    const alpha = cfg.traffic.bpr.alpha;
    const beta = cfg.traffic.bpr.beta;
    const tiles = route.tiles;
    const cum = route.cum;
    let total = 0;
    for (let i = 1; i < tiles.length; i++) {
      const tile = tiles[i]!;
      const t0 = cum[i]! - cum[i - 1]!;
      const k = tile * 24 + hour;
      const x = this.prevVolumes[k]! / this.capacity[tile]!;
      let xb = 1;
      for (let b = 0; b < beta; b++) xb *= x;
      total += t0 * (1 + alpha * xb);
      if (this.volumes[k]! < 65535) this.volumes[k]!++;
    }
    return total / 10;
  }

  private refreshCapacity() {
    const world = this.city.sim.world;
    if (this.capacityVersion === world.roadVersion) return;
    this.capacityVersion = world.roadVersion;
    const r = this.city.config.roads;
    for (let i = 0; i < world.size; i++) {
      const kind = world.roads[i];
      this.capacity[i] =
        kind === 1
          ? r.street.lanes * r.street.capacityPerLanePerHour
          : kind === 2
            ? r.avenue.lanes * r.avenue.capacityPerLanePerHour
            : 1;
    }
  }

  private arrive(code: number, purpose: number) {
    const city = this.city;
    const toDest = code >= 0;
    const p = toDest ? code : -1 - code;
    const { pop, hh } = city;
    if (pop.status[p] !== PSTATUS.alive) return;
    const car = hh.car[pop.household[p]!] ?? -1;
    const veh = this.vehicles;
    if (!toDest && car >= 0 && veh.driver[car] === p) veh.driver[car] = -1;
    const isWork = purpose === TRIP.work;
    if (toDest && ((isWork && pop.job[p] === -1) || (!isWork && pop.school[p]! === -1))) {
      // Perdeu o destino no caminho: volta para casa.
      pop.tripState[p] = 0;
      pop.tripPurpose[p] = TRIP.none;
      return;
    }
    if (toDest) {
      pop.tripState[p] = 2;
      // Volta no fim do expediente (duração própria da pessoa) ou da aula.
      const clock = city.sim.clock;
      const r = city.config.traffic.routine;
      const duration = isWork
        ? pop.workMinutes[p]! > 0
          ? pop.workMinutes[p]!
          : (r.workHoursWeekly.mean * 60) / r.workdaysPerWeek
        : r.schoolDurationMinutes;
      const dur = clock.minutesToTicks(duration);
      this.returns[(clock.tickOfDay + dur) % clock.ticksPerDay]!.push({ p, purpose });
    } else {
      pop.tripState[p] = 0;
      pop.tripPurpose[p] = TRIP.none;
    }
  }

  /**
   * Posições dos carros dentro do retângulo (para a tela): os que estão andando e os estacionados
   * (na frente do prédio onde estão parados, ou na rua). Só leitura; usa Math.atan2 porque é só visual.
   */
  /**
   * Carros para a tela: estacionados e em movimento. `hidden` = carros que a tela já está desenhando
   * por conta própria (viagem visual); `movingToo` = false para não desenhar os que estão andando.
   */
  positions(
    rect: { x0: number; y0: number; x1: number; y1: number },
    subTick = 0,
    hidden?: (v: number) => boolean,
    movingToo = true,
  ): Float32Array {
    const veh = this.vehicles;
    const world = this.city.sim.world;
    const bs = this.city.sim.buildings;
    const now = this.city.sim.clock.tick + subTick;
    const out: number[] = [];
    const inRect = (x: number, y: number) => x >= rect.x0 && y >= rect.y0 && x <= rect.x1 && y <= rect.y1;
    // Estacionados.
    const slot = new Map<number, number>();
    for (let v = 0; v < veh.count && out.length < 4 * 30000; v++) {
      if (veh.state[v] !== VSTATE.parked || hidden?.(v)) continue;
      const b = veh.parkedAt[v]!;
      const access = b >= 0 ? bs.access[b]! : veh.streetTile[v]!;
      if (access < 0) continue;
      const key = b >= 0 ? b : -1 - access;
      const k = slot.get(key) ?? 0;
      slot.set(key, k + 1);
      let x: number;
      let y: number;
      let angle: number;
      if (b >= 0) {
        // Na frente do prédio, junto à calçada, um ao lado do outro.
        const f = bs.facing[b]!;
        const w = bs.w[b]!;
        const h = bs.h[b]!;
        const along = (0.3 + (k % 3) * 0.3) * (f === 0 || f === 2 ? w : h);
        const bx = bs.x[b]!;
        const by = bs.y[b]!;
        if (f === 0) [x, y, angle] = [bx + along, by + 0.12, Math.PI / 2];
        else if (f === 2) [x, y, angle] = [bx + along, by + h - 0.12, Math.PI / 2];
        else if (f === 1) [x, y, angle] = [bx + w - 0.12, by + along, 0];
        else [x, y, angle] = [bx + 0.12, by + along, 0];
      } else {
        x = world.xOf(access) + 0.2 + (k % 3) * 0.3;
        y = world.yOf(access) + 0.12;
        angle = Math.PI / 2;
      }
      if (inRect(x, y)) out.push(x, y, angle, veh.model[v]!);
    }
    for (let i = 0; movingToo && i < veh.moving.size && out.length < 4 * 20000; i++) {
      const v = veh.moving.at(i);
      const tiles = veh.routes[v];
      const cum = veh.routeCum[v];
      if (!tiles || !cum) continue;
      const span = Math.max(1, veh.arriveTick[v]! - veh.departTick[v]!);
      const f = Math.min(1, Math.max(0, (now - veh.departTick[v]!) / span));
      const target = f * cum[cum.length - 1]!;
      let lo = 0;
      let hi = cum.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (cum[mid]! <= target) lo = mid;
        else hi = mid - 1;
      }
      const a = tiles[lo]!;
      const b = tiles[Math.min(lo + 1, tiles.length - 1)]!;
      const segT = cum[Math.min(lo + 1, cum.length - 1)]! - cum[lo]!;
      const u = segT > 0 ? (target - cum[lo]!) / segT : 0;
      const ax = world.xOf(a) + 0.5;
      const ay = world.yOf(a) + 0.5;
      const bx = world.xOf(b) + 0.5;
      const by = world.yOf(b) + 0.5;
      const dx = bx - ax;
      const dy = by - ay;
      // Mão direita: desloca para a direita do sentido do movimento.
      const x = ax + dx * u - dy * 0.18;
      const y = ay + dy * u + dx * 0.18;
      if (!inRect(x, y)) continue;
      // Ângulo no plano do chão (X, Z=y) para girar o modelo.
      const angle = dx === 0 && dy === 0 ? 0 : Math.atan2(dx, dy);
      out.push(x, y, angle, veh.model[v]!);
    }
    return Float32Array.from(out);
  }
}
