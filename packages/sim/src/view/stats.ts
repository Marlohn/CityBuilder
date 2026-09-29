/**
 * Números gerais da cidade para a tela e para o relatório.
 */
import type { StatsView } from "@city/contract";
import type { Game } from "../game";

export function statsView(game: Game, behind = false): StatsView {
  const { sim } = game;
  const perfAvg = sim.perf.averages();
  const msPerTick = Object.values(perfAvg).reduce((s, v) => s + v, 0);
  return {
    tick: sim.clock.tick,
    day: sim.clock.day,
    year: sim.clock.year,
    minuteOfDay: sim.clock.minuteOfDay,
    population: 0,
    households: 0,
    employed: 0,
    unemployed: 0,
    students: 0,
    retired: 0,
    children: 0,
    money: sim.treasury.money,
    lastYearRevenue: sim.treasury.lastYearRevenue,
    lastYearExpenses: sim.treasury.lastYearExpenses,
    birthsThisYear: 0,
    deathsThisYear: 0,
    arrivalsThisYear: 0,
    departuresThisYear: 0,
    vacantHomes: 0,
    vacantJobs: 0,
    demand: { residential: 0, commercial: 0, industrial: 0 },
    unmet: { school: 0, university: 0, health: 0, housing: 0, job: 0, transit: 0, parking: 0 },
    vehiclesMoving: 0,
    cars: 0,
    realism: [],
    perf: {
      msPerTick,
      ticksPerSecond: msPerTick > 0 ? 1000 / msPerTick : 0,
      systems: perfAvg,
      counters: { ...sim.perf.peak },
      behind,
    },
  };
}
