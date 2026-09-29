/**
 * Números gerais da cidade para a tela e para o relatório.
 */
import type { StatsView } from "@city/contract";
import type { Game } from "../game";
import { type Census, takeCensus } from "../people/census";
import { ROLE } from "../people/population";

let cache: { game: Game; tick: number; census: Census } | null = null;

/** Censo do tick atual (calculado no máximo uma vez por tick). */
export function currentCensus(game: Game): Census {
  if (cache && cache.game === game && cache.tick === game.sim.clock.tick) return cache.census;
  const census = takeCensus(game.city);
  cache = { game, tick: game.sim.clock.tick, census };
  return census;
}

/** Barra de demanda 0-100 (escala logarítmica suave, sem Math.log: só para exibir). */
function bar(v: number, scale: number): number {
  return Math.round((100 * v) / (v + scale));
}

export function statsView(game: Game, behind = false): StatsView {
  const { sim, city } = game;
  const c = currentCensus(game);
  const perfAvg = sim.perf.averages();
  const msPerTick = Object.values(perfAvg).reduce((s, v) => s + v, 0);
  const d = game.growth.demand;
  return {
    tick: sim.clock.tick,
    day: sim.clock.day,
    year: sim.clock.year,
    minuteOfDay: sim.clock.minuteOfDay,
    population: c.population,
    households: c.households,
    employed: c.employedLocal + c.employedOutside,
    unemployed: c.byRole[ROLE.unemployed]!,
    students: c.byRole[ROLE.student]!,
    retired: c.byRole[ROLE.retired]!,
    children: c.byRole[ROLE.child]!,
    money: sim.treasury.money,
    lastYearRevenue: sim.treasury.lastYearRevenue,
    lastYearExpenses: sim.treasury.lastYearExpenses,
    birthsThisYear: city.year.births,
    deathsThisYear: city.year.deaths,
    arrivalsThisYear: city.year.arrivals,
    departuresThisYear: city.year.departures,
    vacantHomes: city.markets.housing.vacancies(),
    vacantJobs: city.markets.jobs.vacancies(),
    demand: {
      residential: bar(d.homes, 40),
      commercial: bar(d.commercialJobs, 100),
      industrial: bar(d.industrialJobs, 60),
    },
    unmet: {
      school: c.childrenWithoutSchool,
      university: c.wantUniversity,
      health: c.withoutClinic,
      housing: c.householdsWaitingHome,
      job: c.byRole[ROLE.unemployed]!,
      transit: city.year.transitRefusals,
      parking: city.year.parkingMisses,
    },
    vehiclesMoving: game.traffic.vehicles.moving.size,
    cars: c.householdsWithCar,
    realism: game.realism,
    perf: {
      msPerTick,
      ticksPerSecond: msPerTick > 0 ? 1000 / msPerTick : 0,
      systems: perfAvg,
      counters: { ...sim.perf.peak },
      behind,
    },
  };
}
