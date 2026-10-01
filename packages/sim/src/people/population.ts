/**
 * O "cartório": todas as pessoas que já moraram na cidade, em arrays numéricos.
 * Ids nunca são reaproveitados. Quem morre ou vai embora continua no registro (com o status).
 */
import { growTo } from "../core/growable";

export const PSTATUS = { alive: 1, dead: 2, left: 3 } as const;
export const SEX = { female: 0, male: 1 } as const;
/** Papel atual da pessoa na cidade. */
export const ROLE = {
  child: 0,
  student: 1,
  worker: 2,
  unemployed: 3,
  inactive: 4,
  retired: 5,
} as const;
export const ROLE_LABEL = [
  "criança",
  "estudante",
  "trabalhando",
  "desempregado(a)",
  "fora da força de trabalho",
  "aposentado(a)",
];
/** Escolaridade (mesmos grupos da PNAD). */
export const EDU_LABEL = [
  "sem instrução",
  "fundamental incompleto",
  "fundamental completo",
  "médio completo",
  "superior completo",
];
/** Emprego fora da cidade (numa cidade vizinha, pela estrada). */
export const OUTSIDE_JOB = -2;

export const TRAITS = ["marriageWish", "childWish", "ambition", "studiousness", "attachment"] as const;
export type Trait = (typeof TRAITS)[number];
export const TRAIT_LABEL: Record<Trait, string> = {
  marriageWish: "vontade de casar",
  childWish: "vontade de ter filhos",
  ambition: "ambição",
  studiousness: "gosto por estudar",
  attachment: "apego à cidade",
};

export class Population {
  count = 0;
  aliveCount = 0;
  status = new Uint8Array(0);
  sex = new Uint8Array(0);
  birthTick = new Int32Array(0);
  /** Tick do dia do aniversário (quando a atualização anual acontece). */
  slot = new Uint16Array(0);
  firstName = new Uint16Array(0);
  surnameA = new Uint16Array(0);
  surnameB = new Uint16Array(0);
  household = new Int32Array(0);
  nextInHousehold = new Int32Array(0);
  partner = new Int32Array(0);
  mother = new Int32Array(0);
  father = new Int32Array(0);
  job = new Int32Array(0);
  school = new Int32Array(0);
  clinic = new Int32Array(0);
  hospital = new Int32Array(0);
  eduYears = new Uint8Array(0);
  eduLevel = new Uint8Array(0);
  wantsUniversity = new Uint8Array(0);
  role = new Uint8Array(0);
  /** 0 = ainda não decidiu, 1 = quer trabalhar, 2 = não quer. */
  laborWilling = new Uint8Array(0);
  /** Renda mensal (R$). */
  income = new Float32Array(0);
  unemployedSinceTick = new Int32Array(0);
  /** Até este tick a pessoa ainda está procurando (não aceita emprego antes). */
  searchUntilTick = new Int32Array(0);
  /** Tempo de ida ao trabalho (minutos). */
  commuteMinutes = new Uint16Array(0);
  /** Hora de entrada no trabalho (minuto do dia). */
  workStartMinute = new Uint16Array(0);
  /** Duração do expediente de hoje (minutos). */
  workMinutes = new Uint16Array(0);
  /** 0 = em casa, 1 = indo ao destino, 2 = no destino, 3 = voltando (`tripPurpose` diz o destino). */
  tripState = new Uint8Array(0);
  /** Destino da viagem atual (TRIP.* do trânsito; 0 = em casa). Quem escreve é o trânsito. */
  tripPurpose = new Uint8Array(0);
  /** Idade no primeiro casamento (0 = nunca casou). */
  firstMarriageAge = new Uint8Array(0);
  lastEvent = new Int32Array(0);
  /** Versão do mercado na última tentativa (evita tentar de novo sem nada ter mudado). */
  triedJob = new Int32Array(0);
  triedSchool = new Int32Array(0);
  triedClinic = new Int32Array(0);
  traits: Record<Trait, Uint8Array> = {
    marriageWish: new Uint8Array(0),
    childWish: new Uint8Array(0),
    ambition: new Uint8Array(0),
    studiousness: new Uint8Array(0),
    attachment: new Uint8Array(0),
  };

  constructor() {
    this.ensure(1024);
  }

  isAlive(id: number): boolean {
    return id >= 0 && this.status[id] === PSTATUS.alive;
  }

  /** Traço entre 0 e 1. */
  trait(id: number, t: Trait): number {
    return this.traits[t][id]! / 255;
  }

  /** Cria uma pessoa viva com valores padrão. Quem chama preenche o resto. */
  create(): number {
    const id = this.count++;
    this.ensure(this.count);
    this.status[id] = PSTATUS.alive;
    this.household[id] = -1;
    this.nextInHousehold[id] = -1;
    this.partner[id] = -1;
    this.mother[id] = -1;
    this.father[id] = -1;
    this.job[id] = -1;
    this.school[id] = -1;
    this.clinic[id] = -1;
    this.hospital[id] = -1;
    this.lastEvent[id] = -1;
    this.unemployedSinceTick[id] = -1;
    this.triedJob[id] = -1;
    this.triedSchool[id] = -1;
    this.triedClinic[id] = -1;
    this.tripPurpose[id] = 0;
    this.aliveCount++;
    return id;
  }

  private ensure(n: number) {
    if (this.status.length >= n) return;
    const len = Math.max(n, this.status.length * 2, 1024);
    this.status = growTo(this.status, len);
    this.sex = growTo(this.sex, len);
    this.birthTick = growTo(this.birthTick, len);
    this.slot = growTo(this.slot, len);
    this.firstName = growTo(this.firstName, len);
    this.surnameA = growTo(this.surnameA, len);
    this.surnameB = growTo(this.surnameB, len);
    this.household = growTo(this.household, len);
    this.nextInHousehold = growTo(this.nextInHousehold, len);
    this.partner = growTo(this.partner, len);
    this.mother = growTo(this.mother, len);
    this.father = growTo(this.father, len);
    this.job = growTo(this.job, len);
    this.school = growTo(this.school, len);
    this.clinic = growTo(this.clinic, len);
    this.hospital = growTo(this.hospital, len);
    this.eduYears = growTo(this.eduYears, len);
    this.eduLevel = growTo(this.eduLevel, len);
    this.wantsUniversity = growTo(this.wantsUniversity, len);
    this.role = growTo(this.role, len);
    this.laborWilling = growTo(this.laborWilling, len);
    this.income = growTo(this.income, len);
    this.unemployedSinceTick = growTo(this.unemployedSinceTick, len);
    this.searchUntilTick = growTo(this.searchUntilTick, len);
    this.commuteMinutes = growTo(this.commuteMinutes, len);
    this.workStartMinute = growTo(this.workStartMinute, len);
    this.workMinutes = growTo(this.workMinutes, len);
    this.tripState = growTo(this.tripState, len);
    this.tripPurpose = growTo(this.tripPurpose, len);
    this.firstMarriageAge = growTo(this.firstMarriageAge, len);
    this.lastEvent = growTo(this.lastEvent, len);
    this.triedJob = growTo(this.triedJob, len);
    this.triedSchool = growTo(this.triedSchool, len);
    this.triedClinic = growTo(this.triedClinic, len);
    for (const t of Object.keys(this.traits) as Trait[]) this.traits[t] = growTo(this.traits[t], len);
  }
}
