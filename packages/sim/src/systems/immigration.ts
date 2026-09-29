/**
 * Chegada de moradores de fora. Eles vêm pela estrada, só quando existe casa vaga ligada à saída
 * da cidade, e só se algum adulto da família conseguir emprego (aqui ou na cidade vizinha).
 * Aposentados podem vir sem emprego.
 */
import type { City } from "../city";
import {
  eduLevelFromYears,
  enroll,
  hire,
  joinHousehold,
  moveHouseholdTo,
  newPerson,
  refreshRole,
  yearsForLevel,
} from "../people/actions";
import { EV } from "../people/events";
import { OUTSIDE_JOB, ROLE, SEX } from "../people/population";
import type { System } from "../sim";
import { commuteMinutesTo, findJobFor } from "./matching";

export class ImmigrationSystem implements System {
  readonly name = "immigration";
  private arrivalsToday = 0;
  private lastDay = -1;
  private typeCum: Float64Array;

  constructor(private city: City) {
    const types = city.config.population.immigration.householdTypes;
    this.typeCum = new Float64Array(types.length);
    let s = 0;
    types.forEach((t, i) => {
      s += t.weight;
      this.typeCum[i] = s;
    });
  }

  tick() {
    const city = this.city;
    const { sim, markets } = city;
    const cfg = sim.config.population.immigration;
    if (!cfg.enabled) return;
    if (sim.clock.day !== this.lastDay) {
      this.lastDay = sim.clock.day;
      this.arrivalsToday = 0;
    }
    if (markets.housing.open.size === 0 || this.arrivalsToday >= cfg.maxHouseholdsPerDay) return;
    if (cfg.requiresOutsideConnection && !sim.network.hasOutsideConnection()) return;
    // Taxa de chegada proporcional às casas vagas.
    const vacant = markets.housing.vacancies();
    const expected = vacant / (cfg.vacancyFillDays * sim.clock.ticksPerDay);
    const rng = city.rng.migration;
    let attempts = Math.floor(expected) + (rng.chance(expected - Math.floor(expected)) ? 1 : 0);
    attempts = Math.min(attempts, 20);
    for (let k = 0; k < attempts; k++) this.tryArrival();
  }

  private tryArrival() {
    const city = this.city;
    const { sim, markets, pop, hh } = city;
    const cfg = sim.config.population.immigration;
    const rng = city.rng.migration;
    const home = markets.housing.findNear(rng, -1, 6);
    if (!home) return;
    const access = sim.buildings.access[home.building]!;
    if (cfg.requiresOutsideConnection && sim.network.exitFor(access) < 0) {
      this.turnedAway("sem_ligacao_com_a_estrada");
      return;
    }
    const type = cfg.householdTypes[rng.pickCumulative(this.typeCum)]!;
    const nAdults = type.adults;
    const nKids = type.children[0] + rng.int(type.children[1] - type.children[0] + 1);
    const tpd = sim.clock.ticksPerDay;
    // Idade dos adultos (em anos) e das crianças; a mãe precisa ter pelo menos 16 anos a mais que o filho.
    const adultAges = Array.from({ length: nAdults }, () => rng.range(type.adultAge[0], type.adultAge[1]));
    const youngestAdult = Math.min(...adultAges);
    const kidAges = Array.from({ length: nKids }, () =>
      rng.range(0, Math.max(0, Math.min(14, youngestAdult - 16))),
    );
    const sameSex = nAdults === 2 && rng.chance(sim.config.lifecycle.marriage.sameSexShare);
    const firstSex = rng.chance(0.5) ? SEX.female : SEX.male;
    const sexes = nAdults === 1 ? [firstSex] : sameSex ? [firstSex, firstSex] : [SEX.female, SEX.male];

    // Primeiro confere se algum adulto em idade de trabalhar arruma emprego (antes de criar as pessoas).
    const retirees = type.adultAge[0] >= 58;
    if (!retirees) {
      const tryJob = findJobFor(city, access, false);
      if (!tryJob) {
        this.turnedAway("sem_emprego");
        return;
      }
    }

    const h = hh.create();
    const adults: number[] = [];
    const surnames = [city.names.surname(rng), city.names.surname(rng)];
    for (let i = 0; i < nAdults; i++) {
      const age = adultAges[i]!;
      const level = rng.pickCumulative(cumulative(cfg.educationDistribution));
      const p = newPerson(city, {
        sex: sexes[i]!,
        birthTick: sim.clock.tick - age * tpd - rng.int(tpd),
        first: city.names.first(rng, sexes[i] === SEX.male),
        surnameA: city.names.surname(rng),
        surnameB: surnames[i]!,
        eduYears: yearsForLevel(city, level),
      });
      pop.eduLevel[p] = level;
      pop.laborWilling[p] = rng.chance(sim.config.lifecycle.labor.participation) ? 1 : 2;
      if (
        age >=
        (sexes[i] === SEX.male
          ? sim.config.lifecycle.retirement.ageMale
          : sim.config.lifecycle.retirement.ageFemale)
      ) {
        pop.role[p] = ROLE.retired;
        pop.income[p] = sim.config.economy.income.minimumWage;
      }
      joinHousehold(city, p, h);
      adults.push(p);
    }
    if (adults.length === 2) {
      pop.partner[adults[0]!] = adults[1]!;
      pop.partner[adults[1]!] = adults[0]!;
    }
    const mother = adults.find((a) => pop.sex[a] === SEX.female) ?? -1;
    const father = adults.find((a) => pop.sex[a] === SEX.male && a !== mother) ?? -1;
    for (const age of kidAges) {
      const male = rng.chance(
        sim.config.population.sexRatioAtBirth / (1 + sim.config.population.sexRatioAtBirth),
      );
      const k = newPerson(city, {
        sex: male ? SEX.male : SEX.female,
        birthTick: sim.clock.tick - age * tpd - rng.int(tpd),
        first: city.names.first(rng, male),
        // Costume brasileiro: sobrenome da mãe e depois o do pai.
        surnameA: mother >= 0 ? pop.surnameB[mother]! : surnames[0]!,
        surnameB: father >= 0 ? pop.surnameB[father]! : surnames[1]!,
        mother,
        father,
        eduYears: Math.max(0, Math.min(age - sim.config.education.schoolStartAge, 12)),
      });
      pop.eduLevel[k] = eduLevelFromYears(city, pop.eduYears[k]!);
      joinHousehold(city, k, h);
    }
    // Primeiro registro de quem chega é sempre "chegou à cidade" (ninguém surge do nada).
    for (const m of hh.members(h)) city.log(EV.arrived, m, home.building);
    moveHouseholdTo(city, h, home.building, false);
    for (const m of hh.members(h)) refreshRole(city, m);
    // Empregos para os adultos que querem trabalhar.
    for (const a of adults) {
      if (pop.role[a] !== ROLE.unemployed) continue;
      const job = findJobFor(city, access, hh.cars[h]! > 0);
      if (job)
        hire(
          city,
          a,
          job.building,
          job.building === OUTSIDE_JOB ? job.minutes : commuteMinutesTo(city, access, job),
        );
    }
    // Crianças em idade escolar tentam vaga na escola (se não tiver, entram na fila de procura).
    for (const m of hh.members(h)) {
      const age = city.age(m);
      if (age >= sim.config.education.schoolStartAge && age <= sim.config.education.schoolEndAge) {
        const s = markets.schools.findNear(rng, access, 6, sim.config.education.maxDistanceMeters);
        if (s) enroll(city, m, s.building);
      }
    }
    city.year.arrivals += hh.size[h]!;
    this.arrivalsToday++;
  }

  private turnedAway(reason: string) {
    const t = this.city.year.migrantsTurnedAway;
    t[reason] = (t[reason] ?? 0) + 1;
  }
}

function cumulative(weights: number[]): number[] {
  let s = 0;
  return weights.map((w) => (s += w));
}
