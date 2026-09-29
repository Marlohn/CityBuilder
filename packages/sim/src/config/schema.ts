/**
 * Schema da configuração do jogo. Todo número de regra vem daqui (config/*.yaml).
 * Se um valor for inválido, parseGameConfig lança um erro dizendo qual campo e por quê.
 */
import { z } from "zod";

const pos = z.number().positive();
const nonneg = z.number().min(0);
const prob = z.number().min(0).max(1);
const intPos = z.number().int().positive();
const range = z.tuple([z.number(), z.number()]).refine(([a, b]) => a <= b, "o mínimo deve ser <= máximo");
/** Tabela "chave numérica -> valor" (ex: idade -> chance), usada com interpolação linear. */
const numericTable = z
  .record(z.string(), z.number())
  .refine((t) => Object.keys(t).length > 0 && Object.keys(t).every((k) => Number.isFinite(Number(k))), {
    message: "tabela precisa de chaves numéricas",
  });

const RoadKindConfig = z.object({
  label: z.string(),
  speedKmh: pos,
  lanes: intPos,
  costPerTile: nonneg,
  capacityPerLanePerHour: pos,
});

const HouseholdType = z.object({
  id: z.string(),
  weight: nonneg,
  adults: z.number().int().min(1).max(2),
  adultAge: range,
  children: range,
});

const RealismItem = z.object({
  id: z.string(),
  /** População mínima para este indicador fazer sentido. */
  minPopulation: z.number().int().min(0).optional(),
  label: z.string(),
  unit: z.string(),
  min: z.number(),
  max: z.number(),
  source: z.string(),
});

export const GameConfigSchema = z.object({
  world: z.object({
    width: z.number().int().min(16).max(1024),
    height: z.number().int().min(16).max(1024),
    tileMeters: pos,
    treeCoverage: prob,
    startingRoad: z
      .object({ enabled: z.boolean(), kind: z.enum(["street", "avenue"]), length: intPos })
      .default({ enabled: false, kind: "avenue", length: 1 }),
  }),
  time: z.object({
    minutesPerTick: z.number().int().min(1).max(60),
    realSecondsPerDayAt1x: pos,
    speeds: z.array(pos).min(1),
    startYear: z.number().int(),
    startHour: z.number().min(0).max(23).default(0),
  }),
  roads: z.object({
    street: RoadKindConfig,
    avenue: RoadKindConfig,
    maintenanceShareOfCostPerYear: prob,
  }),
  population: z.object({
    sexRatioAtBirth: pos,
    immigration: z.object({
      enabled: z.boolean(),
      requiresOutsideConnection: z.boolean().default(true),
      vacancyFillDays: pos,
      maxHouseholdsPerDay: intPos,
      householdTypes: z.array(HouseholdType).min(1),
      educationDistribution: z.array(nonneg).length(5),
    }),
    outsideJobs: z
      .object({
        enabled: z.boolean(),
        share: prob,
        minWorkers: z.number().int().min(0),
        extraCommuteMinutes: nonneg,
      })
      .default({ enabled: false, share: 0, minWorkers: 0, extraCommuteMinutes: 0 }),
  }),
  lifecycle: z.object({
    mortalityTable: z.string(),
    fertilityTable: z.string(),
    childWishWeight: nonneg,
    marriage: z.object({
      minAge: intPos,
      hazardByAge: numericTable,
      sameSexShare: prob,
      maxAgeGap: intPos,
      candidatesPerSearch: intPos,
    }),
    divorce: z.object({ annualHazard: prob }),
    retirement: z.object({ ageMale: intPos, ageFemale: intPos }),
    leaveParentsHome: z.object({ minAge: intPos, annualChance: prob }),
    emigration: z.object({
      unemployedYearsBeforeConsidering: nonneg,
      annualChance: prob,
      homelessCoupleAnnualChance: prob,
    }),
    labor: z.object({
      minAge: intPos,
      participation: prob,
      candidatesPerSearch: intPos,
      annualSeparation: prob.default(0),
      /** Duração da procura (anos) -> peso. */
      searchYears: numericTable.default({ "0": 1 }),
    }),
  }),
  education: z.object({
    schoolStartAge: intPos,
    schoolEndAge: intPos,
    yearsFundamental: intPos,
    yearsMedio: intPos,
    maxDistanceMeters: pos,
    higherEducation: z.object({ desireChance: prob, ageRange: range }),
  }),
  health: z.object({
    maxDistanceMeters: pos,
    uncoveredMortalityMultiplier: pos,
  }),
  economy: z.object({
    mode: z.enum(["budget", "sandbox"]),
    startingMoney: z.number(),
    revenuePerResidentPerYear: nonneg,
    income: z.object({
      monthlyByEducation: z.array(pos).length(5),
      spread: z.number().min(0).max(1),
      minimumWage: pos,
    }),
    costOfLivingShare: prob,
  }),
  traffic: z.object({
    cars: z.object({
      ownershipByHouseholdIncome: numericTable,
      yearlyTurnover: prob.default(0.3),
      parkingPerHome: nonneg,
      parkingPerJob: nonneg,
    }),
    walking: z.object({ maxWorkMeters: pos, speedKmh: pos }),
    bpr: z.object({ alpha: nonneg, beta: z.number().int().min(1).max(8) }),
    routine: z.object({
      workStartMinute: range,
      workDurationMinutes: intPos,
      schoolStartMinute: nonneg,
      schoolDurationMinutes: intPos,
    }),
  }),
  growth: z.object({
    initialResidentialDemand: nonneg,
    jobShareCommercial: prob,
    jobShareIndustrial: prob,
    maxConstructionStartsPerDay: intPos,
    targetVacancy: prob,
  }),
  realism: z.object({
    minPopulation: intPos,
    minSamples: z
      .object({ births: intPos, deaths: intPos, marriages: intPos, divorces: intPos })
      .default({ births: 300, deaths: 150, marriages: 40, divorces: 20 }),
    windowYears: intPos,
    items: z.array(RealismItem),
  }),
  performance: z.object({
    routeCacheMax: intPos,
    budgets: z.object({ nodesExpandedPerTick: intPos, personsUpdatedPerTick: intPos }),
    timingWindow: intPos,
  }),
  logging: z.object({
    default: z.enum(["error", "warn", "info", "debug"]),
    systems: z.record(z.string(), z.enum(["error", "warn", "info", "debug"])),
    ringSize: intPos,
  }),
});

export type GameConfig = z.infer<typeof GameConfigSchema>;

const BuildingType = z
  .object({
    id: z.string(),
    label: z.string(),
    zone: z.enum(["residential_low", "residential_high", "commercial", "industrial"]).optional(),
    service: z.enum(["school", "health"]).optional(),
    w: intPos,
    h: intPos,
    homes: z.number().int().min(0).default(0),
    jobs: z.number().int().min(0).default(0),
    students: z.number().int().min(0).default(0),
    patients: z.number().int().min(0).default(0),
    cost: nonneg.default(0),
    upkeepPerYear: nonneg.default(0),
    upkeepPerStudentPerYear: nonneg.default(0),
    constructionMonths: pos,
    /** Andares (só visual). */
    floors: z.number().int().min(1).default(1),
    models: z.array(z.string()).min(1),
  })
  .refine((b) => (b.zone ? 1 : 0) + (b.service ? 1 : 0) === 1, "cada prédio tem uma zona OU um serviço");

export const BuildingCatalogSchema = z.object({ buildings: z.array(BuildingType).min(1) });
export type BuildingType = z.infer<typeof BuildingType>;

export const MortalityTableSchema = z.object({
  source: z.string(),
  maxAge: intPos,
  /** Probabilidade de morrer no ano, por idade (0..maxAge), para cada sexo. */
  qxFemale: z.array(prob),
  qxMale: z.array(prob),
});
export type MortalityTable = z.infer<typeof MortalityTableSchema>;

export const FertilityTableSchema = z.object({
  source: z.string(),
  minAge: intPos,
  /** Chance anual de ter um filho por idade da mulher, começando em minAge. */
  rates: z.array(prob),
});
export type FertilityTable = z.infer<typeof FertilityTableSchema>;

export const NamesSchema = z.object({
  source: z.string(),
  female: z.array(z.tuple([z.string(), z.number()])),
  male: z.array(z.tuple([z.string(), z.number()])),
  surnames: z.array(z.tuple([z.string(), z.number()])),
});
export type NamesData = z.infer<typeof NamesSchema>;
