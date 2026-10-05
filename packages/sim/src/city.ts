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
import type { Vehicles } from "./traffic/vehicles";

/** Contadores do ano atual (zerados a cada dia do jogo, que = 1 ano). */
// 1 dia do jogo = 1 ano de vida: `game.ts` vira `city.year` em `city.lastYear` no fim do ano,
// então o relatório lê `city.lastYear` como "ontem".
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
  /** Viagens de ontem por motivo (ida e volta contam; volta de recado é `none` e não conta). */
  tripsWork: number;
  tripsSchool: number;
  tripsShopping: number;
  tripsHealth: number;
  tripsLeisure: number;
  /** Viagens de ontem feitas a pé (parte das de cima). */
  tripsWalk: number;
  /** Receita do ano corrente por categoria (zerada na virada do ano). */
  revenueByCategory: Record<string, number>;
  /** Despesa do ano corrente por categoria (zerada na virada do ano). */
  expensesByCategory: Record<string, number>;
}

/** Resumo financeiro de um ano fechado (guardado em `City.yearlyHistory`). */
export interface YearSummary {
  year: number;
  revenue: number;
  expenses: number;
  balance: number;
  revenueByCategory: Record<string, number>;
  expensesByCategory: Record<string, number>;
  /** Verdadeiro quando a receita cobriu a despesa (a cidade se pagou). */
  selfFinanced: boolean;
  /** Dinheiro em caixa logo após fechar o ano (para o gráfico do saldo). */
  moneyEnd: number;
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
    tripsWork: 0,
    tripsSchool: 0,
    tripsShopping: 0,
    tripsHealth: 0,
    tripsLeisure: 0,
    tripsWalk: 0,
    revenueByCategory: {},
    expensesByCategory: {},
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
    /** Fluxo dedicado a episódios e altas hospitalares, sem perturbar os demais sorteios de vida. */
    hospital: Rng;
  };
  year: YearCounters = emptyYear();
  lastYear: YearCounters = emptyYear();
  /** Um resumo por ano fechado, do mais antigo ao mais recente. */
  yearlyHistory: YearSummary[] = [];
  /** Pessoas por tick-do-dia do aniversário (atualização anual espalhada ao longo do dia). */
  readonly slots: number[][];
  readonly carOwnership: (monthlyIncome: number) => number;
  readonly marriageHazard: (age: number) => number;
  private searchValues: number[];
  private searchCum: number[];
  /** Veículos da cidade (preenchido pelo trânsito; usado pelas verificações). */
  traffic: { vehicles: Vehicles } | null = null;
  /** Água e luz (ligado em game.ts; ver systems/utilities.ts). */
  utilities: {
    demandOf(homes: number, jobs: number): number;
    canSupply(access: number, demand: number, reserve?: boolean): boolean;
    spareAt(access: number, kind: "water" | "power"): number;
  } | null = null;
  /** Quantas pessoas trabalham fora da cidade agora. */
  outsideWorkers = 0;
  /** Filas de quem está procurando algo (processadas aos poucos pelo sistema de "matching"). */
  readonly seekJob = new IndexedSet();
  readonly seekSchool = new IndexedSet();
  readonly seekClinic = new IndexedSet();
  /** Quem pediu internação e espera um leito livre (fila separada da UBS). */
  readonly seekHospital = new IndexedSet();
  /** Quem está internado agora (índice para a alta não varrer a população inteira). */
  readonly hospitalized = new IndexedSet();
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
      hospital: r.stream("hospital"),
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

  /** Conta uma viagem que realmente começou (motivos do `TRIP` em traffic/trafficSystem.ts, sem importar para não fechar ciclo: none=0, work=1, school=2, shopping=3, health=4, leisure=5; `none`, a volta do recado, não conta). */
  countTrip(purpose: number, walk: boolean) {
    if (purpose === 1) this.year.tripsWork++;
    else if (purpose === 2) this.year.tripsSchool++;
    else if (purpose === 3) this.year.tripsShopping++;
    else if (purpose === 4) this.year.tripsHealth++;
    else if (purpose === 5) this.year.tripsLeisure++;
    else return;
    if (walk) this.year.tripsWalk++;
  }

  /** Coloca a pessoa na lista de atualização anual (no tick do dia do aniversário). */
  schedule(p: number) {
    this.slots[this.pop.slot[p]!]!.push(p);
  }
}
