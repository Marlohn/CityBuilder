/**
 * Ações de vida: cada uma mantém tudo consistente (prédios, mercados, família) e registra no cartório.
 * Regra: nada surge ou some do nada. Toda mudança tem um evento com o motivo.
 */
import type { City } from "../city";
import { EV } from "./events";
import { OUTSIDE_JOB, PSTATUS, ROLE, SEX, TRAITS } from "./population";

export interface NewPersonInput {
  sex: number;
  birthTick: number;
  first: number;
  surnameA: number;
  surnameB: number;
  mother?: number;
  father?: number;
  eduYears?: number;
}

export function newPerson(city: City, input: NewPersonInput): number {
  const { pop } = city;
  const p = pop.create();
  pop.sex[p] = input.sex;
  pop.birthTick[p] = input.birthTick;
  pop.slot[p] =
    ((input.birthTick % city.sim.clock.ticksPerDay) + city.sim.clock.ticksPerDay) %
    city.sim.clock.ticksPerDay;
  pop.firstName[p] = input.first;
  pop.surnameA[p] = input.surnameA;
  pop.surnameB[p] = input.surnameB;
  pop.mother[p] = input.mother ?? -1;
  pop.father[p] = input.father ?? -1;
  pop.eduYears[p] = input.eduYears ?? 0;
  pop.eduLevel[p] = eduLevelFromYears(city, pop.eduYears[p]!);
  for (const t of TRAITS) pop.traits[t][p] = city.rng.traits.int(256);
  city.schedule(p);
  city.seekClinic.add(p);
  refreshRole(city, p);
  return p;
}

/** Anos de estudo -> nível (grupos da PNAD). */
export function eduLevelFromYears(city: City, years: number): number {
  const e = city.config.education;
  if (years >= e.yearsMedio + 4) return 4;
  if (years >= e.yearsMedio) return 3;
  if (years >= e.yearsFundamental) return 2;
  if (years >= 1) return 1;
  return 0;
}

/** Anos de estudo típicos de cada nível (para quem chega de fora). */
export function yearsForLevel(city: City, level: number): number {
  const e = city.config.education;
  return (
    [0, Math.floor(e.yearsFundamental / 2), e.yearsFundamental, e.yearsMedio, e.yearsMedio + 4][level] ?? 0
  );
}

export function refreshRole(city: City, p: number) {
  const { pop } = city;
  const age = city.age(p);
  let role: number;
  if (pop.role[p] === ROLE.retired && pop.job[p] === -1) role = ROLE.retired;
  else if (pop.school[p]! >= 0) role = ROLE.student;
  else if (pop.job[p] !== -1) role = ROLE.worker;
  else if (age < city.config.lifecycle.labor.minAge) role = ROLE.child;
  else if (pop.laborWilling[p] === 1) role = ROLE.unemployed;
  else role = ROLE.inactive;
  if (role === ROLE.unemployed && pop.unemployedSinceTick[p]! < 0) {
    pop.unemployedSinceTick[p] = city.tick;
    // Procurar emprego leva tempo (distribuição em config/lifecycle.yaml).
    pop.searchUntilTick[p] = city.tick + Math.round(city.sampleSearchYears() * city.sim.clock.ticksPerDay);
  }
  if (role !== ROLE.unemployed) pop.unemployedSinceTick[p] = -1;
  pop.role[p] = role;
  // Desempregados e quem trabalha fora (prefere emprego perto) ficam na fila de procura.
  if (role === ROLE.unemployed || pop.job[p] === OUTSIDE_JOB) city.seekJob.add(p);
  else city.seekJob.delete(p);
}

// ---------- Casa ----------

/** A família se muda para uma moradia própria no prédio `building`. */
export function moveHouseholdTo(city: City, h: number, building: number, logMove = true) {
  const { hh, sim, markets } = city;
  const old = hh.home[h]!;
  if (old === building && !hh.sharing[h]) return;
  if (old >= 0) leaveHome(city, h);
  hh.home[h] = building;
  hh.wantsHome[h] = 0;
  hh.sharing[h] = 0;
  city.seekHome.delete(h);
  sim.buildings.households[building]!++;
  sim.buildings.residents[building]! += hh.size[h]!;
  markets.housing.update(building);
  if (logMove) for (const m of hh.members(h)) city.log(EV.movedHome, m, building);
}

export function leaveHome(city: City, h: number) {
  const { hh, sim, markets } = city;
  const b = hh.home[h]!;
  if (b < 0) return;
  const owner = !hh.sharing[h];
  if (owner) sim.buildings.households[b]!--;
  sim.buildings.residents[b]! -= hh.size[h]!;
  hh.home[h] = -1;
  hh.sharing[h] = 0;
  // Se alguém morava "de favor" com esta família, fica com a moradia (ex.: filho casado fica na casa dos pais).
  if (owner) {
    for (let i = 0; i < city.seekHome.size; i++) {
      const g = city.seekHome.at(i);
      if (g !== h && hh.alive[g] && hh.sharing[g] && hh.home[g] === b) {
        hh.sharing[g] = 0;
        hh.wantsHome[g] = 0;
        sim.buildings.households[b]!++;
        city.seekHome.delete(g);
        break;
      }
    }
  }
  markets.housing.update(b);
}

/**
 * Cria uma família nova com estas pessoas, morando "de favor" no mesmo prédio (casal que acabou de
 * casar, filho adulto que quer sair de casa). Ela entra na fila de procura de casa.
 */
export function startOwnHousehold(city: City, members: number[]): number {
  const { hh } = city;
  const host = city.homeBuilding(members[0]!);
  const h = hh.create();
  hh.home[h] = host;
  hh.sharing[h] = host >= 0 ? 1 : 0;
  hh.wantsHome[h] = 1;
  for (const m of members) joinHousehold(city, m, h);
  city.seekHome.add(h);
  return h;
}

/**
 * Tira a pessoa da família atual e coloca em outra (atualiza o número de moradores das casas).
 * Se na família antiga só sobrarem menores de idade, os filhos dela vão junto (criança não fica sozinha).
 */
export function joinHousehold(city: City, p: number, h: number, handleOld = true) {
  const { hh, pop, sim } = city;
  const old = pop.household[p]!;
  if (old === h) return;
  if (old >= 0) {
    hh.removeMember(old, p);
    const oldHome = hh.home[old]!;
    if (oldHome >= 0) sim.buildings.residents[oldHome]!--;
  }
  hh.addMember(h, p);
  const home = hh.home[h]!;
  if (home >= 0) sim.buildings.residents[home]!++;
  if (old >= 0 && handleOld) {
    if (hh.size[old]! > 0 && !hh.members(old).some((m) => city.age(m) >= 18)) {
      for (const child of hh.members(old)) {
        if (pop.mother[child] === p || pop.father[child] === p) joinHousehold(city, child, h, false);
      }
    }
    if (hh.size[old] === 0) dissolveEmpty(city, old, h);
    else handleOrphans(city, old);
  } else if (old >= 0 && hh.size[old] === 0) dissolveEmpty(city, old, h);
}

function dissolveEmpty(city: City, old: number, heir: number) {
  const { hh } = city;
  leaveHome(city, old);
  // O carro vai junto se a nova família não tiver; senão é vendido.
  const car = hh.car[old]!;
  if (car >= 0) {
    if (heir >= 0 && hh.car[heir]! < 0) {
      hh.car[heir] = car;
      hh.cars[heir] = 1;
      city.onCarMoved?.(car, heir);
    } else city.onCarGone?.(car);
    hh.car[old] = -1;
    hh.cars[old] = 0;
  }
  hh.dissolve(old);
  city.seekHome.delete(old);
}

// ---------- Trabalho ----------

export function hire(city: City, p: number, building: number, commuteMinutes: number) {
  const { pop, sim, markets } = city;
  if (pop.job[p] !== -1) fire(city, p, "trocou de emprego");
  pop.job[p] = building;
  if (building === OUTSIDE_JOB) city.outsideWorkers++;
  else {
    sim.buildings.jobsFilled[building]!++;
    markets.jobs.update(building);
  }
  pop.income[p] = incomeFor(city, p);
  pop.commuteMinutes[p] = Math.min(65535, Math.round(commuteMinutes));
  city.log(EV.jobStart, p, building);
  refreshRole(city, p);
}

export function fire(city: City, p: number, _reason: string) {
  const { pop, sim, markets } = city;
  const b = pop.job[p]!;
  if (b === -1) return;
  if (b === OUTSIDE_JOB) city.outsideWorkers--;
  else {
    sim.buildings.jobsFilled[b]!--;
    markets.jobs.update(b);
  }
  pop.job[p] = -1;
  pop.income[p] = 0;
  pop.commuteMinutes[p] = 0;
  city.log(EV.jobEnd, p, b);
  refreshRole(city, p);
}

/** Salário mensal: média por escolaridade (PNAD) com variação individual. */
export function incomeFor(city: City, p: number): number {
  const inc = city.config.economy.income;
  const base = inc.monthlyByEducation[city.pop.eduLevel[p]!] ?? inc.minimumWage;
  const ambition = city.pop.trait(p, "ambition");
  const v = base * (1 + inc.spread * city.rng.market.normalish(0, 1) + (ambition - 0.5) * inc.spread);
  return Math.max(inc.minimumWage, Math.round(v));
}

// ---------- Escola e UBS ----------

export function enroll(city: City, p: number, school: number) {
  const { pop, sim, markets } = city;
  unenroll(city, p, false);
  pop.school[p] = school;
  city.seekSchool.delete(p);
  sim.buildings.students[school]!++;
  markets.schools.update(school);
  city.log(EV.schoolStart, p, school);
  refreshRole(city, p);
}

export function unenroll(city: City, p: number, log = true) {
  const { pop, sim, markets } = city;
  const s = pop.school[p]!;
  if (s < 0) return;
  sim.buildings.students[s]!--;
  markets.schools.update(s);
  pop.school[p] = -1;
  if (log) city.log(EV.schoolEnd, p, s);
  refreshRole(city, p);
}

export function registerClinic(city: City, p: number, clinic: number) {
  const { pop, sim, markets } = city;
  unregisterClinic(city, p);
  pop.clinic[p] = clinic;
  city.seekClinic.delete(p);
  sim.buildings.patients[clinic]!++;
  markets.clinics.update(clinic);
}

export function unregisterClinic(city: City, p: number) {
  const { pop, sim, markets } = city;
  const c = pop.clinic[p]!;
  if (c < 0) return;
  sim.buildings.patients[c]!--;
  markets.clinics.update(c);
  pop.clinic[p] = -1;
  if (pop.isAlive(p)) city.seekClinic.add(p);
}

// ---------- Saídas (morte e mudança para fora) ----------

/** Solta todos os vínculos da pessoa com prédios e com o cônjuge. */
function detach(city: City, p: number) {
  const { pop } = city;
  fire(city, p, "saiu");
  unenroll(city, p, false);
  unregisterClinic(city, p);
  const partner = pop.partner[p]!;
  if (partner >= 0) {
    pop.partner[partner] = -1;
    pop.partner[p] = -1;
  }
  return partner;
}

export function die(city: City, p: number) {
  const { pop } = city;
  const partner = detach(city, p);
  if (partner >= 0 && pop.isAlive(partner)) city.log(EV.widowed, partner, p);
  city.log(EV.died, p, city.age(p));
  const h = pop.household[p]!;
  removeFromCity(city, p, PSTATUS.dead);
  city.year.deaths++;
  if (h >= 0) handleOrphans(city, h);
}

export function personLeavesCity(city: City, p: number, reason: number) {
  detach(city, p);
  city.log(EV.leftCity, p, reason);
  removeFromCity(city, p, PSTATUS.left);
  city.year.departures++;
}

/** A família inteira vai embora (pela estrada). */
export function householdLeavesCity(city: City, h: number, reason: number) {
  for (const m of city.hh.members(h)) personLeavesCity(city, m, reason);
}

function removeFromCity(city: City, p: number, status: number) {
  const { pop, hh } = city;
  const h = pop.household[p]!;
  if (h >= 0) {
    hh.removeMember(h, p);
    const home = hh.home[h]!;
    if (home >= 0) city.sim.buildings.residents[home]!--;
    if (hh.size[h] === 0) {
      leaveHome(city, h);
      if (hh.car[h]! >= 0) city.onCarGone?.(hh.car[h]!);
      hh.dissolve(h);
      city.seekHome.delete(h);
    }
  }
  pop.status[p] = status;
  pop.aliveCount--;
  city.seekJob.delete(p);
  city.seekSchool.delete(p);
  city.seekClinic.delete(p);
  city.singles.delete(p);
}

/**
 * Se só sobraram menores de idade na família, eles vão morar com um parente (avós) na cidade,
 * ou com parentes fora da cidade. Criança não fica sozinha.
 */
export function handleOrphans(city: City, h: number) {
  const { hh, pop } = city;
  if (!hh.alive[h]) return;
  const members = hh.members(h);
  const adult = members.some((m) => city.age(m) >= 18);
  if (adult) return;
  for (const child of members) {
    const guardianHh = findRelativeHousehold(city, child);
    if (guardianHh >= 0 && guardianHh !== h) {
      joinHousehold(city, child, guardianHh);
      city.log(EV.movedToRelatives, child, hh.home[guardianHh]!);
    } else {
      personLeavesCity(city, child, 2);
    }
  }
  void pop;
}

/** Procura avós (pais da mãe ou do pai) vivos na cidade com casa. */
function findRelativeHousehold(city: City, child: number): number {
  const { pop, hh } = city;
  for (const parent of [pop.mother[child]!, pop.father[child]!]) {
    if (parent < 0) continue;
    for (const gp of [pop.mother[parent]!, pop.father[parent]!]) {
      if (gp >= 0 && pop.isAlive(gp)) {
        const g = pop.household[gp]!;
        if (g >= 0 && hh.home[g]! >= 0) return g;
      }
    }
  }
  return -1;
}

export function isMale(city: City, p: number): boolean {
  return city.pop.sex[p] === SEX.male;
}
