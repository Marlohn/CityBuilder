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
  // Totais de água e luz em pessoas equivalentes (inteiros, como a população).
  const u = game.utilities.totals();
  // Leitos de hospital: soma em uma passada dos prédios ativos com vaga de paciente.
  let bedsTotal = 0;
  let bedsOccupied = 0;
  for (let i = 0; i < city.sim.buildings.count; i++) {
    if (!city.sim.buildings.isActive(i)) continue;
    const cap = city.sim.buildings.patientsCapacity(i);
    if (cap <= 0) continue;
    bedsTotal += cap;
    bedsOccupied += city.sim.buildings.patients[i]!;
  }
  if (bedsOccupied > bedsTotal) bedsOccupied = bedsTotal;
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
      hospital: c.withoutHospital,
      housing: c.householdsWaitingHome,
      job: c.byRole[ROLE.unemployed]!,
      transit: city.year.transitRefusals,
      parking: city.year.parkingMisses,
      water: c.withoutWater,
      power: c.withoutPower,
    },
    hospitalBeds: { total: bedsTotal, occupied: bedsOccupied },
    utilities: {
      enabled: game.utilities.enabled,
      water: {
        capacity: u.water.capacity === null ? null : Math.round(u.water.capacity),
        used: Math.round(u.water.used),
      },
      power: {
        capacity: u.power.capacity === null ? null : Math.round(u.power.capacity),
        used: Math.round(u.power.used),
      },
    },
    vehiclesMoving: game.traffic.vehicles.moving.size,
    peopleWalking: 0,
    cars: c.householdsWithCar,
    construction: {
      blockedByWater: game.growth.blockedByWater,
      blockedByPower: game.growth.blockedByPower,
    },
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
