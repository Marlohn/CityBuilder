/**
 * Atualização anual de cada pessoa, no tick do aniversário dela (espalha o trabalho ao longo do dia).
 * Ordem: morte -> estudo -> trabalho/aposentadoria -> família -> internação -> dinheiro da família.
 * A alta hospitalar roda a cada tick sobre os internados (`city.hospitalized`).
 */
import type { City } from "../city";
import type { Demography } from "../metrics/demography";
import {
  die,
  eduLevelFromYears,
  fire,
  householdLeavesCity,
  refreshRole,
  unenroll,
  unregisterHospital,
} from "../people/actions";
import { EV, UNMET } from "../people/events";
import { OUTSIDE_JOB, PSTATUS, ROLE, SEX } from "../people/population";
import type { System } from "../sim";
import { divorce, giveBirth, maybeLeaveParents, tryMarry } from "./family";

export class LifecycleSystem implements System {
  readonly name = "lifecycle";

  constructor(
    private city: City,
    private demo: Demography,
  ) {}

  tick() {
    const city = this.city;
    this.discharge();
    const list = city.slots[city.sim.clock.tickOfDay]!;
    if (list.length === 0) return;
    let write = 0;
    // A lista pode crescer durante o laço (bebês nascem no mesmo tick): só processa quem já estava.
    const n = list.length;
    for (let i = 0; i < n; i++) {
      const p = list[i]!;
      if (city.pop.status[p] !== PSTATUS.alive) continue;
      // Quem nasceu neste tick faz o primeiro aniversário daqui a um ano.
      if (city.pop.birthTick[p] !== city.tick) {
        city.sim.perf.count("personsUpdated");
        this.yearly(p);
      }
      if (city.pop.status[p] === PSTATUS.alive) list[write++] = p;
    }
    // Mantém quem entrou na lista durante o laço e remove mortos/quem saiu.
    for (let i = n; i < list.length; i++) list[write++] = list[i]!;
    list.length = write;
  }

  private yearly(p: number) {
    const city = this.city;
    const { pop, config } = city;
    const age = city.age(p);
    const sex = pop.sex[p]!;
    const rng = city.rng.life;

    // 1. Morte (tábua calibrada com o IBGE; sem UBS o risco aumenta).
    // No aniversário de `age` anos a pessoa acabou de viver o ano entre `age - 1` e `age`:
    // vale o risco dessa idade (assim o bebê passa pelo risco do primeiro ano de vida).
    const lived = Math.max(0, age - 1);
    const table = sex === SEX.male ? city.sim.data.mortality.qxMale : city.sim.data.mortality.qxFemale;
    let q = table[Math.min(lived, table.length - 1)] ?? 1;
    if (pop.clinic[p]! < 0) q *= config.health.uncoveredMortalityMultiplier;
    // Quem tem leito de hospital (segundo nível) morre menos.
    if (pop.hospital[p]! >= 0) q *= 1 - config.health.hospitalMortalityReduction;
    if (rng.chance(q)) {
      // O denominador da mortalidade infantil só conta nascidos na cidade: o primeiro
      // evento diz se a pessoa nasceu aqui (EV.born) ou chegou de fora (EV.arrived).
      const first = city.events.of(p)[0];
      const bornInCity = first !== undefined && city.events.type[first] === EV.born;
      this.demo.death(sex, lived, bornInCity);
      die(city, p);
      return;
    }
    this.demo.exposed(sex, lived);

    // 2. Estudo.
    const edu = config.education;
    if (age >= edu.schoolStartAge && age <= edu.schoolEndAge) {
      if (pop.school[p]! >= 0) {
        pop.eduYears[p]!++;
        pop.eduLevel[p] = eduLevelFromYears(city, pop.eduYears[p]!);
      } else {
        city.seekSchool.add(p);
        city.log(EV.unmet, p, UNMET.school);
      }
    } else if (age > edu.schoolEndAge && pop.school[p]! >= 0) {
      city.log(EV.graduated, p, pop.eduLevel[p]!);
      unenroll(city, p, false);
    }
    if (age < edu.schoolStartAge || age > edu.schoolEndAge) city.seekSchool.delete(p);
    const he = edu.higherEducation;
    if (age === he.ageRange[0] && pop.eduLevel[p]! >= 3 && !pop.wantsUniversity[p]) {
      if (rng.chance(he.desireChance * 2 * pop.trait(p, "studiousness"))) {
        pop.wantsUniversity[p] = 1;
        // Ainda não existe faculdade no jogo: vira desejo não atendido (sinal para o roadmap).
        city.log(EV.unmet, p, UNMET.university);
      }
    }
    if (age > he.ageRange[1]) pop.wantsUniversity[p] = 0;

    // 3. Trabalho e aposentadoria.
    const labor = config.lifecycle.labor;
    if (age >= labor.minAge && pop.laborWilling[p] === 0 && pop.school[p]! < 0) {
      pop.laborWilling[p] = rng.chance(labor.participation) ? 1 : 2;
    }
    const retireAge =
      sex === SEX.male ? config.lifecycle.retirement.ageMale : config.lifecycle.retirement.ageFemale;
    if (age >= retireAge && pop.role[p] !== ROLE.retired) {
      if (pop.job[p] !== -1) fire(city, p, "aposentadoria");
      pop.role[p] = ROLE.retired;
      pop.income[p] = config.economy.income.minimumWage;
      city.seekJob.delete(p);
      city.log(EV.retired, p);
    } else {
      // Rotatividade: parte dos trabalhadores perde ou deixa o emprego a cada ano (CAGED).
      if (pop.job[p]! >= 0 && rng.chance(labor.annualSeparation)) fire(city, p, "saiu do emprego");
      refreshRole(city, p);
    }
    if (pop.role[p] === ROLE.unemployed) city.log(EV.unmet, p, UNMET.job);

    // Desemprego longo + pouco apego à cidade: a família pode ir embora.
    const em = config.lifecycle.emigration;
    const since = pop.unemployedSinceTick[p]!;
    if (since >= 0 && city.tick - since >= em.unemployedYearsBeforeConsidering * city.sim.clock.ticksPerDay) {
      const h = pop.household[p]!;
      const someoneWorks = h >= 0 && city.hh.members(h).some((m) => pop.job[m] !== -1);
      if (!someoneWorks && rng.chance(em.annualChance * (1 - pop.trait(p, "attachment")))) {
        householdLeavesCity(city, h, 3);
        return;
      }
    }

    // 4. Família.
    const mc = config.lifecycle.marriage;
    if (pop.partner[p] === -1 && age >= mc.minAge) {
      city.singles.add(p);
      const hazard = city.marriageHazard(age) * 2 * pop.trait(p, "marriageWish");
      if (rng.chance(hazard)) tryMarry(city, this.demo, p);
    } else city.singles.delete(p);
    const partner = pop.partner[p]!;
    if (partner >= 0 && p < partner && rng.chance(config.lifecycle.divorce.annualHazard))
      divorce(city, this.demo, p);
    if (sex === SEX.female) {
      const f = city.sim.data.fertility;
      const idx = age - f.minAge;
      if (idx >= 0 && idx < f.rates.length) {
        const wish = 1 + config.lifecycle.childWishWeight * (2 * pop.trait(p, "childWish") - 1);
        if (rng.chance(f.rates[idx]! * wish)) giveBirth(city, this.demo, p);
      }
    }
    maybeLeaveParents(city, p);
    this.homelessCouple(p);

    // 5. Internação: um episódio novo (quem já tem leito não pede outro). A chance é a taxa
    // diária equivalente à anual da config (hospitalAdmissionRatePerYear, 8% = meio do
    // intervalo de 7-9% da Portaria GM/MS 1.101/2002). O sorteio usa o fluxo `hospital`,
    // separado do `life`: internação e alta são novas e não podem mudar o sorteio da morte,
    // do estudo e do trabalho de quem já estava na cidade.
    if (
      pop.hospital[p]! < 0 &&
      pop.clinic[p]! < 0 &&
      city.rng.hospital.chance(config.health.hospitalAdmissionRatePerYear / 365)
    )
      city.seekHospital.add(p);

    // 6. Dinheiro da família (uma vez por ano, pela primeira pessoa da lista da família).
    const h = pop.household[p]!;
    if (h >= 0 && city.hh.head[h] === p) this.householdYear(h);
  }

  /**
   * Alta hospitalar: cada internado tem por tick a fração diária da chance de alta
   * (`1 / hospitalAvgLengthOfStayDays`, em dias). Só percorre os internados
   * (`city.hospitalized`), nunca a população inteira. Morte e saída da cidade já
   * soltam o leito (`detach` chama `unregisterHospital`), então o índice se limpa sozinho.
   */
  private discharge() {
    const city = this.city;
    const chance = Math.min(
      1,
      1 / city.config.health.hospitalAvgLengthOfStayDays / city.sim.clock.ticksPerDay,
    );
    for (let i = 0; i < city.hospitalized.size; i++) {
      const p = city.hospitalized.at(i);
      city.sim.perf.count("personsUpdated");
      if (city.rng.hospital.chance(chance)) {
        unregisterHospital(city, p);
        // Alta é cura, não perda de atendimento: o curado não volta para a fila
        // da UBS (ela anda por versão do mercado de UBS e o ex-internado ficaria
        // preso nela; ele pede outro episódio pelo `seekHospital` no aniversário).
        city.seekClinic.delete(p);
      }
    }
  }

  /** Família esperando casa há mais de um ano pode desistir e ir para outra cidade. */
  private homelessCouple(p: number) {
    const city = this.city;
    const h = city.pop.household[p]!;
    if (h < 0 || !city.hh.wantsHome[h] || city.hh.head[h] !== p) return;
    if (city.rng.life.chance(city.config.lifecycle.emigration.homelessCoupleAnnualChance)) {
      for (const m of city.hh.members(h)) city.log(EV.unmet, m, UNMET.housing);
      householdLeavesCity(city, h, 1);
    }
  }

  private householdYear(h: number) {
    const city = this.city;
    const { pop, hh, config } = city;
    let income = 0;
    for (const m of hh.members(h)) income += pop.income[m]!;
    hh.savings[h]! += income * 12 * (1 - config.economy.costOfLivingShare);
    // Carro: P = chance de uma família com essa renda ter carro (tabela calibrada para ~48%, PNAD 2023).
    // Compra com chance P x giro e vende com chance (1 - P) x giro: no equilíbrio, P das famílias têm carro.
    const pOwn = city.carOwnership(income);
    const turnover = config.traffic.cars.yearlyTurnover;
    if (hh.cars[h] === 0 && city.rng.market.chance(pOwn * turnover)) {
      hh.cars[h] = 1;
      city.onCarBought?.(h);
      city.log(EV.boughtCar, hh.head[h]!);
    } else if (hh.cars[h]! > 0 && city.rng.market.chance((1 - pOwn) * turnover)) {
      if (hh.car[h]! >= 0) city.onCarGone?.(hh.car[h]!);
      hh.cars[h] = 0;
      hh.car[h] = -1;
    }
    void OUTSIDE_JOB;
  }
}
