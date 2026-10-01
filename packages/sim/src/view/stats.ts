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

/** Custeio do ano: gasto que a cidade repete todo ano (chave ausente conta como 0). */
function operatingCost(expensesByCategory: Record<string, number>): number {
  return (
    (expensesByCategory["educacao"] ?? 0) +
    (expensesByCategory["saude"] ?? 0) +
    (expensesByCategory["agua_e_luz"] ?? 0) +
    (expensesByCategory["manutencao_vias"] ?? 0)
  );
}

/** Investimento do ano: só a obra, que acontece uma vez (chave ausente conta como 0). */
function investmentCost(expensesByCategory: Record<string, number>): number {
  return (expensesByCategory["obras_vias"] ?? 0) + (expensesByCategory["obras_servicos"] ?? 0);
}

/** Soma dos valores de um breakdown por categoria. */
function sumCategories(breakdown: Record<string, number>): number {
  let total = 0;
  for (const v of Object.values(breakdown)) total += v;
  return total;
}

export function statsView(game: Game, behind = false): StatsView {
  const { sim, city } = game;
  const c = currentCensus(game);
  const perfAvg = sim.perf.averages();
  const msPerTick = Object.values(perfAvg).reduce((s, v) => s + v, 0);
  const d = game.growth.demand;
  // Totais de água e luz em pessoas equivalentes (inteiros, como a população).
  const u = game.utilities.totals();
  // Finanças por categoria do último ano fechado (cópias, para a tela não mexer no motor).
  const revenueByCategory = { ...city.lastYear.revenueByCategory };
  const expensesByCategory = { ...city.lastYear.expensesByCategory };
  const operating = operatingCost(expensesByCategory);
  const investment = investmentCost(expensesByCategory);
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
      water: c.withoutWater,
      power: c.withoutPower,
    },
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
    finance: {
      revenueByCategory,
      expensesByCategory,
      netOperating: sumCategories(revenueByCategory) - operating,
      investment,
      yearlyHistory: city.yearlyHistory.map((h) => ({
        year: h.year,
        revenue: h.revenue,
        expenses: h.expenses,
        netOperating: h.revenue - operatingCost(h.expensesByCategory),
        investment: investmentCost(h.expensesByCategory),
        moneyEnd: h.moneyEnd,
      })),
    },
    perf: {
      msPerTick,
      ticksPerSecond: msPerTick > 0 ? 1000 / msPerTick : 0,
      systems: perfAvg,
      counters: { ...sim.perf.peak },
      behind,
    },
  };
}
