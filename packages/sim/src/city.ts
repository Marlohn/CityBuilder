/**
 * Estado compartilhado pelos sistemas da cidade (pessoas, famílias, mercados, estatísticas).
 */
import { makeTableLookup } from "./config/load";
import { IndexedSet } from "./core/indexedSet";
import type { Rng } from "./core/rng";
import { Markets } from "./markets/markets";
import { EventLog } from "./people/events";
import { Households } from "./people/households";
import { NamePicker } from "./people/names";
import { Population } from "./people/population";
import type { Simulation } from "./sim";

/** Contadores do ano atual (zerados a cada dia do jogo, que = 1 ano). */
export interface YearCounters {
  births: number;
  deaths: number;
  arrivals: number;
  departures: number;
  marriages: number;
  divorces: number;
  /** Famílias que queriam vir morar aqui mas desistiram (motivo -> quantidade). */
  migrantsTurnedAway: Record<string, number>;
  /** Recusas de emprego por distância sem carro. */
  transitRefusals: number;
  parkingMisses: number;
}

export function emptyYear(): YearCounters {
  return {
    births: 0,
    deaths: 0,
    arrivals: 0,
    departures: 0,
    marriages: 0,
    divorces: 0,
    migrantsTurnedAway: {},
    transitRefusals: 0,
    parkingMisses: 0,
  };
}

export class City {
  readonly pop = new Population();
  readonly hh: Households;
  readonly events: EventLog;
  readonly markets: Markets;
  readonly names: NamePicker;
  readonly rng: {
    life: Rng;
    family: Rng;
    market: Rng;
    migration: Rng;
    growth: Rng;
    traits: Rng;
  };
  year: YearCounters = emptyYear();
  lastYear: YearCounters = emptyYear();
  /** Pessoas por tick-do-dia do aniversário (atualização anual espalhada ao longo do dia). */
  readonly slots: number[][];
  readonly carOwnership: (monthlyIncome: number) => number;
  readonly marriageHazard: (age: number) => number;
  private searchValues: number[];
  private searchCum: number[];
  /** Sistema de trânsito (preenchido pelo jogo; usado pelas verificações). */
  traffic: import("./traffic/trafficSystem").TrafficSystem | null = null;
  /** Quantas pessoas trabalham fora da cidade agora. */
  outsideWorkers = 0;
  /** Filas de quem está procurando algo (processadas aos poucos pelo sistema de "matching"). */
  readonly seekJob = new IndexedSet();
  readonly seekSchool = new IndexedSet();
  readonly seekClinic = new IndexedSet();
  /** Famílias procurando casa. */
  readonly seekHome = new IndexedSet();
  /** Adultos solteiros (para sortear pares). */
  readonly singles = new IndexedSet();
  /** Chamado quando uma família deixa de existir e o carro dela some junto (vendido/levado). */
  onCarGone: ((car: number) => void) | null = null;
  /** Chamado quando uma família compra um carro (o trânsito cria o veículo). */
  onCarBought: ((household: number) => void) | null = null;
  /** A família mudou de casa (o carro vai junto). */
  onHouseholdMoved: ((household: number, home: number) => void) | null = null;
  /** A pessoa está deixando o emprego (antes de apagar o vínculo). */
  onJobEnding: ((person: number, job: number) => void) | null = null;
  /** A pessoa morreu ou foi embora. */
  onPersonGone: ((person: number) => void) | null = null;
  /** Chamado quando o carro passa para outra família (ex.: casamento). */
  onCarMoved: ((car: number, household: number) => void) | null = null;

  constructor(readonly sim: Simulation) {
    this.hh = new Households(this.pop);
    this.events = new EventLog(this.pop);
    this.markets = new Markets(sim.buildings, sim.network, sim.world);
    this.names = new NamePicker(sim.data.names);
    const r = sim.rng;
    this.rng = {
      life: r.stream("life"),
      family: r.stream("family"),
      market: r.stream("market"),
      migration: r.stream("migration"),
      growth: r.stream("growth"),
      traits: r.stream("traits"),
    };
    this.slots = Array.from({ length: sim.clock.ticksPerDay }, () => []);
    this.carOwnership = makeTableLookup(sim.config.traffic.cars.ownershipByHouseholdIncome);
    this.marriageHazard = makeTableLookup(sim.config.lifecycle.marriage.hazardByAge);
    const sy = Object.entries(sim.config.lifecycle.labor.searchYears).sort(
      (a, b) => Number(a[0]) - Number(b[0]),
    );
    this.searchValues = sy.map(([k]) => Number(k));
    let acc = 0;
    this.searchCum = sy.map(([, w]) => (acc += w));
  }

  get config() {
    return this.sim.config;
  }
  get tick() {
    return this.sim.clock.tick;
  }

  /** Sorteia quanto tempo (anos) uma procura de emprego vai durar. */
  sampleSearchYears(): number {
    return this.searchValues[this.rng.market.pickCumulative(this.searchCum)] ?? 0;
  }

  age(p: number): number {
    return this.sim.clock.ageOf(this.pop.birthTick[p]!);
  }

  /** Via de acesso da casa da pessoa (-1 = sem casa). */
  homeAccess(p: number): number {
    const h = this.pop.household[p]!;
    const home = h >= 0 ? this.hh.home[h]! : -1;
    return home >= 0 ? this.sim.buildings.access[home]! : -1;
  }

  homeBuilding(p: number): number {
    const h = this.pop.household[p]!;
    return h >= 0 ? this.hh.home[h]! : -1;
  }

  log(type: number, p: number, a = -1, b = -1) {
    this.events.add(this.tick, type, p, a, b);
  }

  /** Coloca a pessoa na lista de atualização anual (no tick do dia do aniversário). */
  schedule(p: number) {
    this.slots[this.pop.slot[p]!]!.push(p);
  }
}
