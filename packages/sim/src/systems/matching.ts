/**
 * Junta quem procura com as vagas: emprego, escola, UBS e casa.
 * Processa um pouco por tick (orçamento fixo) e só tenta de novo quando o mercado mudou.
 */
import type { City } from "../city";
import type { IndexedSet } from "../core/indexedSet";
import type { Candidate } from "../markets/markets";
import { enroll, hire, householdLeavesCity, moveHouseholdTo, registerClinic } from "../people/actions";
import { EV, UNMET } from "../people/events";
import { OUTSIDE_JOB, ROLE } from "../people/population";
import type { System } from "../sim";

/** Desvio médio das ruas em relação à linha reta (Manhattan já é em grade). PENDENTE: valor típico. */
const DETOUR = 1.1;

export interface JobOffer {
  building: number;
  meters: number;
  minutes: number;
}

/** Tempo de ida (minutos) até o emprego, de carro (via local) ou a pé. */
export function commuteMinutesTo(city: City, _fromAccess: number, job: Candidate, hasCar = true): number {
  const cfg = city.config;
  const kmh = hasCar ? cfg.roads.street.speedKmh : cfg.traffic.walking.speedKmh;
  return ((job.meters * DETOUR) / 1000 / kmh) * 60;
}

/**
 * Procura emprego para quem mora com acesso `homeAccess`.
 * Sem carro, só aceita empregos a uma distância que dá para ir a pé (config traffic.walking).
 */
export function findJobFor(
  city: City,
  homeAccess: number,
  hasCar: boolean,
  allowOutside = true,
): JobOffer | null {
  const cfg = city.config;
  const rng = city.rng.market;
  const samples = cfg.lifecycle.labor.candidatesPerSearch;
  const walkMax = cfg.traffic.walking.maxWorkMeters;
  let local = city.markets.jobs.findNear(rng, homeAccess, samples);
  if (local && !hasCar && local.meters > walkMax) {
    city.year.transitRefusals++;
    local = city.markets.jobs.findNear(rng, homeAccess, samples, walkMax);
  }
  if (local)
    return { ...local, minutes: commuteMinutesTo(city, homeAccess, local, hasCar || local.meters > walkMax) };
  if (!allowOutside) return null;
  const oj = cfg.population.outsideJobs;
  if (!oj.enabled) return null;
  const workers = Math.max(1, city.pop.aliveCount);
  const cap = Math.max(oj.minWorkers, oj.share * workers);
  if (city.outsideWorkers >= cap) return null;
  const exit = city.sim.network.exitFor(homeAccess);
  if (exit < 0) return null;
  const meters = city.sim.world.manhattanMeters(homeAccess, exit);
  const minutes = ((meters * DETOUR) / 1000 / cfg.roads.avenue.speedKmh) * 60 + oj.extraCommuteMinutes;
  return { building: OUTSIDE_JOB, meters, minutes };
}

export class MatchingSystem implements System {
  readonly name = "matching";
  private cursors = { job: 0, school: 0, clinic: 0, home: 0 };

  constructor(private city: City) {}

  tick() {
    const budget = this.city.config.performance.budgets.personsUpdatedPerTick;
    const per = Math.max(4, Math.floor(budget / 8));
    this.jobs(per);
    this.schools(per);
    this.clinics(per);
    this.homes(Math.max(2, Math.floor(per / 4)));
  }

  /** Percorre a fila de forma circular, no máximo `n` itens por tick. */
  private take(set: IndexedSet, key: keyof MatchingSystem["cursors"], n: number, fn: (id: number) => void) {
    if (set.size === 0) return;
    const count = Math.min(n, set.size);
    for (let k = 0; k < count; k++) {
      if (this.cursors[key] >= set.size) this.cursors[key] = 0;
      const id = set.at(this.cursors[key]!);
      const sizeBefore = set.size;
      fn(id);
      // Se o item saiu da fila, o próximo ocupou a mesma posição: não avança o cursor.
      if (set.size === sizeBefore && set.has(id)) this.cursors[key]++;
    }
  }

  private jobs(n: number) {
    const city = this.city;
    const { pop, markets, hh } = city;
    this.take(city.seekJob, "job", n, (p) => {
      if (city.tick < pop.searchUntilTick[p]!) return;
      if (pop.triedJob[p] === markets.jobs.version) return;
      pop.triedJob[p] = markets.jobs.version;
      const access = city.homeAccess(p);
      if (access < 0) return;
      const h = pop.household[p]!;
      const working = pop.job[p] === OUTSIDE_JOB;
      city.sim.perf.count("jobSearches");
      const offer = findJobFor(city, access, hh.cars[h]! > 0, !working);
      if (!offer) return;
      // Quem já trabalha fora só troca se o emprego novo for mais perto.
      if (working && offer.minutes >= pop.commuteMinutes[p]!) return;
      hire(city, p, offer.building, offer.minutes);
    });
  }

  private schools(n: number) {
    const city = this.city;
    const { pop, markets } = city;
    const maxM = city.config.education.maxDistanceMeters;
    this.take(city.seekSchool, "school", n, (p) => {
      if (pop.triedSchool[p] === markets.schools.version) return;
      pop.triedSchool[p] = markets.schools.version;
      const access = city.homeAccess(p);
      if (access < 0) return;
      const s = markets.schools.findNear(city.rng.market, access, 8, maxM);
      if (s) enroll(city, p, s.building);
    });
  }

  private clinics(n: number) {
    const city = this.city;
    const { pop, markets } = city;
    const maxM = city.config.health.maxDistanceMeters;
    this.take(city.seekClinic, "clinic", n, (p) => {
      if (pop.triedClinic[p] === markets.clinics.version) return;
      pop.triedClinic[p] = markets.clinics.version;
      const access = city.homeAccess(p);
      if (access < 0) return;
      const c = markets.clinics.findNear(city.rng.market, access, 8, maxM);
      if (c) registerClinic(city, p, c.building);
    });
  }

  /**
   * Famílias procurando casa: casais morando com os pais, quem saiu de casa, despejados.
   * Quem ficou sem casa nenhuma e não acha outra vai embora da cidade.
   */
  private homes(n: number) {
    const city = this.city;
    const { hh, pop, markets } = city;
    this.take(city.seekHome, "home", n, (h) => {
      if (!hh.alive[h]) {
        city.seekHome.delete(h);
        return;
      }
      const head = hh.head[h]!;
      const ref = head >= 0 && pop.job[head]! >= 0 ? (city.sim.buildings.access[pop.job[head]!] ?? -1) : -1;
      const home = markets.housing.findNear(city.rng.market, ref, 6);
      if (home) {
        moveHouseholdTo(city, h, home.building);
        return;
      }
      if (hh.home[h]! < 0 && !hh.sharing[h]) {
        // Sem casa e sem vaga: vai morar em outra cidade.
        for (const m of hh.members(h)) city.log(EV.unmet, m, UNMET.housing);
        householdLeavesCity(city, h, 1);
      }
    });
    void ROLE;
  }
}
