/**
 * "Censo" da cidade: conta pessoas por situação. Recalculado no máximo uma vez por tick
 * (uma passada por todo o registro, sem criar objetos).
 */
import type { City } from "../city";
import { OUTSIDE_JOB, PSTATUS, ROLE } from "./population";

export interface Census {
  tick: number;
  population: number;
  households: number;
  byRole: number[];
  employedLocal: number;
  employedOutside: number;
  /** Crianças de 6 a 17 anos sem escola. */
  childrenWithoutSchool: number;
  children6to17: number;
  /** Pessoas sem UBS (cadastradas em nenhuma). */
  withoutClinic: number;
  /** Pessoas sem leito de hospital (cadastradas em nenhum). */
  withoutHospital: number;
  /** Jovens 18-24 que querem faculdade e não têm onde estudar. */
  wantUniversity: number;
  youth18to24: number;
  /** Famílias esperando casa própria (casal morando com os pais, etc.). */
  householdsWaitingHome: number;
  /** Pessoas morando em prédio sem água / sem luz. */
  withoutWater: number;
  withoutPower: number;
  /** Pessoas morando em prédio sem coleta de esgoto. */
  withoutSewage: number;
  householdsWithCar: number;
  pop14plus: number;
  pop60plus: number;
  adults20plus: number;
  commuteUnder30: number;
  commuteKnown: number;
  /** Locais (quadradinho da casa) de amostra para cada desejo não atendido (usado pelo roadmap). */
  samples: Record<string, number[]>;
}

const SAMPLE_MAX = 200;

export function takeCensus(city: City): Census {
  const { pop, hh } = city;
  const byRole = [0, 0, 0, 0, 0, 0];
  const c: Census = {
    tick: city.tick,
    population: 0,
    households: hh.aliveCount,
    byRole,
    employedLocal: 0,
    employedOutside: 0,
    childrenWithoutSchool: 0,
    children6to17: 0,
    withoutClinic: 0,
    withoutHospital: 0,
    wantUniversity: 0,
    youth18to24: 0,
    householdsWaitingHome: 0,
    withoutWater: 0,
    withoutPower: 0,
    withoutSewage: 0,
    householdsWithCar: 0,
    pop14plus: 0,
    pop60plus: 0,
    adults20plus: 0,
    commuteUnder30: 0,
    commuteKnown: 0,
    samples: {
      school: [],
      health: [],
      hospital: [],
      university: [],
      housing: [],
      job: [],
      water: [],
      power: [],
      sewer: [],
    },
  };
  const edu = city.config.education;
  const sample = (kind: string, p: number) => {
    const arr = c.samples[kind]!;
    if (arr.length < SAMPLE_MAX) {
      const home = city.homeBuilding(p);
      if (home >= 0) arr.push(city.sim.buildings.access[home]!);
    }
  };
  const clinicsExist = city.markets.clinics.open.size > 0 || hasAnyClinic(city);
  const utilitiesOn = city.sim.config.utilities.enabled;
  const bs = city.sim.buildings;
  for (let p = 0; p < pop.count; p++) {
    if (pop.status[p] !== PSTATUS.alive) continue;
    c.population++;
    const role = pop.role[p]!;
    byRole[role]!++;
    const age = city.age(p);
    if (pop.job[p] === OUTSIDE_JOB) c.employedOutside++;
    else if (pop.job[p]! >= 0) c.employedLocal++;
    if (age >= 14) c.pop14plus++;
    if (age >= 60) c.pop60plus++;
    if (age >= 20) c.adults20plus++;
    if (age >= edu.schoolStartAge && age <= edu.schoolEndAge) {
      c.children6to17++;
      if (pop.school[p]! < 0) {
        c.childrenWithoutSchool++;
        sample("school", p);
      }
    }
    if (age >= 18 && age <= 24) {
      c.youth18to24++;
      if (pop.wantsUniversity[p]) {
        c.wantUniversity++;
        sample("university", p);
      }
    }
    if (pop.clinic[p]! < 0) {
      c.withoutClinic++;
      if (clinicsExist || c.samples.health!.length < 50) sample("health", p);
    }
    if (pop.hospital[p]! < 0) {
      c.withoutHospital++;
      sample("hospital", p);
    }
    if (utilitiesOn) {
      const home = city.homeBuilding(p);
      if (home >= 0) {
        if (!bs.hasWater[home]) {
          c.withoutWater++;
          sample("water", p);
        }
        if (!bs.hasPower[home]) {
          c.withoutPower++;
          sample("power", p);
        }
        if (!bs.hasSewage[home]) {
          c.withoutSewage++;
          sample("sewer", p);
        }
      }
    }
    if (role === ROLE.unemployed) sample("job", p);
    if (role === ROLE.worker && pop.commuteMinutes[p]! > 0) {
      c.commuteKnown++;
      if (pop.commuteMinutes[p]! <= 30) c.commuteUnder30++;
    }
  }
  for (let h = 0; h < hh.count; h++) {
    if (!hh.alive[h]) continue;
    if (hh.wantsHome[h]) {
      c.householdsWaitingHome++;
      const head = hh.head[h]!;
      if (head >= 0) sample("housing", head);
    }
    if (hh.cars[h]! > 0) c.householdsWithCar++;
  }
  return c;
}

function hasAnyClinic(city: City): boolean {
  const b = city.sim.buildings;
  for (let i = 0; i < b.count; i++) if (b.isActive(i) && b.patientsCapacity(i) > 0) return true;
  return false;
}
