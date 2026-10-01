/**
 * Estado da cidade que a tela pode ler.
 * Nada aqui permite mudar a cidade: é só leitura.
 */

export const CONTRACT_VERSION = 1;

export interface MapView {
  width: number;
  height: number;
  tileMeters: number;
  /** 0 = sem via, 1 = rua, 2 = avenida. Índice = y * width + x. */
  roads: Uint8Array;
  /** Índice em ZONE_KINDS. */
  zones: Uint8Array;
  /** 1 = vegetação nativa. */
  trees: Uint8Array;
  /** 1 = água (rio ou lago). */
  water: Uint8Array;
  version: number;
}

export const BUILDING_STATE = { constructing: 0, active: 1, abandoned: 2 } as const;

export interface BuildingView {
  id: number;
  /** Id do tipo no catálogo (data/buildings.yaml). */
  type: string;
  x: number;
  y: number;
  w: number;
  h: number;
  state: number;
  /** 0..3, lado da via de acesso (0 = norte, 1 = leste, 2 = sul, 3 = oeste). */
  facing: number;
  /** Variação visual estável (para escolher modelo). */
  variant: number;
  residents: number;
  households: number;
  homesCapacity: number;
  jobs: number;
  jobsCapacity: number;
  students: number;
  studentsCapacity: number;
  patients: number;
  patientsCapacity: number;
}

export interface UnmetDesireCounts {
  school: number;
  university: number;
  health: number;
  /** Pessoas sem leito de hospital. */
  hospital: number;
  housing: number;
  job: number;
  transit: number;
  parking: number;
  /** Pessoas morando em prédio sem água / sem luz. */
  water: number;
  power: number;
  /** Pessoas morando em prédio sem coleta de esgoto (a ETE é a que trata). */
  sewer: number;
}

export interface RealismItem {
  id: string;
  label: string;
  value: number | null;
  min: number;
  max: number;
  unit: string;
  status: "ok" | "low" | "high" | "insufficient-data";
  source: string;
}

/** Resumo de um ano fechado para o gráfico do saldo (só leitura para a tela). */
export interface YearSummary {
  year: number;
  revenue: number;
  expenses: number;
  /** Receita menos o custeio (educação, saúde, água/luz e manutenção). */
  netOperating: number;
  /** Obras do ano (investimento, uma vez). */
  investment: number;
  /** Dinheiro em caixa no fim do ano. */
  moneyEnd: number;
}

/** Finanças por categoria do último ano fechado, com o histórico anual. */
export interface FinanceCategorySummary {
  revenueByCategory: Record<string, number>;
  expensesByCategory: Record<string, number>;
  /** revenue - operating cost (custodia) */
  netOperating: number;
  /** obras do ano (investimento, uma vez) */
  investment: number;
  yearlyHistory: YearSummary[];
}

export interface StatsView {
  tick: number;
  /** Dia do jogo (= ano de vida). */
  day: number;
  year: number;
  minuteOfDay: number;
  population: number;
  households: number;
  employed: number;
  unemployed: number;
  students: number;
  retired: number;
  children: number;
  money: number;
  lastYearRevenue: number;
  lastYearExpenses: number;
  birthsThisYear: number;
  deathsThisYear: number;
  arrivalsThisYear: number;
  departuresThisYear: number;
  vacantHomes: number;
  vacantJobs: number;
  demand: { residential: number; commercial: number; industrial: number };
  unmet: UnmetDesireCounts;
  /** Leitos de internação (hospital), não vaga de atenção básica da UBS. */
  hospitalBeds: { total: number; occupied: number };
  /** Água e luz em pessoas equivalentes (mesma unidade de demandOf): quanto a cidade usa e quanto tem. */
  utilities: {
    enabled: boolean;
    water: { capacity: number | null; used: number };
    power: { capacity: number | null; used: number };
  };
  vehiclesMoving: number;
  /** Pessoas andando a pé agora (na tela). */
  peopleWalking: number;
  cars: number;
  /** Obras barradas por falta de água/luz no último tick do growth (só informação). */
  construction: { blockedByWater: number; blockedByPower: number };
  realism: RealismItem[];
  /** Finanças por categoria do último ano fechado, com o histórico anual. */
  finance: FinanceCategorySummary;
  perf: PerfView;
}

export interface PerfView {
  /** Média de ms por tick nos últimos ticks (só informação). */
  msPerTick: number;
  ticksPerSecond: number;
  /** Tempo por sistema (ms, média). */
  systems: Record<string, number>;
  /** Contadores de trabalho (determinísticos). */
  counters: Record<string, number>;
  /** true quando a simulação não está conseguindo acompanhar a velocidade pedida. */
  behind: boolean;
}

export interface PersonView {
  id: number;
  name: string;
  sex: "F" | "M";
  age: number;
  alive: boolean;
  status: string;
  householdId: number;
  homeBuilding: number;
  job: number;
  school: number;
  education: string;
  partnerId: number;
  motherId: number;
  fatherId: number;
  traits: Record<string, number>;
  history: LifeEventView[];
}

export interface LifeEventView {
  year: number;
  day: number;
  type: string;
  text: string;
}

export interface PersonListItem {
  id: number;
  name: string;
  age: number;
  sex: "F" | "M";
  status: string;
}

/**
 * Carros e pessoas visíveis: [x, y, ângulo, tipo] por objeto, em coordenadas de quadradinho.
 * Tipo 0..99 = modelo de carro; 100 ou mais = pessoa a pé.
 */
export interface VehiclesView {
  data: Float32Array;
  count: number;
}
