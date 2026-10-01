/**
 * Monta um jogo completo: a simulação com todos os sistemas ligados na ordem certa.
 * CLI, navegador e testes usam esta função, então todos rodam exatamente o mesmo jogo.
 */
import type { RealismItem } from "@city/contract";
import { ROAD_ID } from "@city/contract";
import { City, emptyYear } from "./city";
import { Demography } from "./metrics/demography";
import { computeRealism } from "./metrics/realism";
import { takeCensus } from "./people/census";
import { type SimOptions, Simulation, type System } from "./sim";
import { EconomySystem } from "./systems/economy";
import { GrowthSystem } from "./systems/growth";
import { ImmigrationSystem } from "./systems/immigration";
import { LifecycleSystem } from "./systems/lifecycle";
import { MatchingSystem } from "./systems/matching";
import { RemovalSystem } from "./systems/removal";
import { UtilitiesSystem } from "./systems/utilities";
import { TrafficSystem } from "./traffic/trafficSystem";

export interface Game {
  sim: Simulation;
  city: City;
  demo: Demography;
  growth: GrowthSystem;
  traffic: TrafficSystem;
  utilities: UtilitiesSystem;
  /** Placar de realismo do último ano fechado. */
  realism: RealismItem[];
}

/** Liga os mercados quando um prédio fica pronto. */
class ReadySystem implements System {
  readonly name = "ready";
  constructor(private city: City) {}
  tick() {}
  onBuildingReady(id: number) {
    this.city.markets.updateAll(id);
  }
}

export function createGame(opts: SimOptions): Game {
  const sim = new Simulation(opts);
  const city = new City(sim);
  const demo = new Demography(opts.config.realism.windowYears);
  const growth = new GrowthSystem(city);
  const traffic = new TrafficSystem(city);
  city.traffic = traffic;
  const utilities = new UtilitiesSystem(city);
  city.utilities = utilities;
  city.markets.setServed(utilities.served);
  const game: Game = { sim, city, demo, growth, traffic, utilities, realism: [] };
  placeStartingRoad(sim);
  const onYearEnd = () => {
    const summary = sim.treasury.closeYear();
    // Ano fechado: o calendário já virou, então o ano guardado é o anterior.
    const year = sim.clock.year - 1;
    // Guarda o breakdown financeiro junto dos contadores demográficos do ano.
    city.year.revenueByCategory = { ...summary.revenueByCategory };
    city.year.expensesByCategory = { ...summary.expensesByCategory };
    city.lastYear = city.year;
    city.year = emptyYear();
    city.yearlyHistory.push({ year, ...summary });
    demo.closeYear();
    game.realism = computeRealism(city, demo, takeCensus(city));
  };
  sim.addSystem(new ReadySystem(city));
  sim.addSystem(new RemovalSystem(city));
  sim.addSystem(new EconomySystem(city, onYearEnd));
  // Água e luz antes do crescimento e da imigração (eles consultam quem tem água e luz).
  sim.addSystem(utilities);
  sim.addSystem(growth);
  sim.addSystem(new ImmigrationSystem(city));
  sim.addSystem(new LifecycleSystem(city, demo));
  sim.addSystem(new MatchingSystem(city));
  sim.addSystem(traffic);
  return game;
}

/** Estrada de acesso que já existe no começo (sai da borda oeste, na linha do meio). */
function placeStartingRoad(sim: Simulation) {
  const sr = sim.config.world.startingRoad;
  if (!sr.enabled) return;
  const w = sim.world;
  const y = Math.floor(w.height / 2);
  for (let x = 0; x < Math.min(sr.length, w.width); x++) {
    const i = w.idx(x, y);
    w.roads[i] = ROAD_ID[sr.kind];
    w.trees[i] = 0;
  }
  w.roadVersion++;
  w.zoneVersion++;
  w.mapVersion++;
}
