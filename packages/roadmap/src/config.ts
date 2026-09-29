/** Config do motor (roadmap/config.yaml) e tabela de referência (data/reference/cidade-real.yaml). */
import { parse as parseYaml } from "yaml";
import { z } from "zod";

const CategorySchema = z.enum([
  "feature",
  "construcao",
  "correcao",
  "realismo",
  "balanceamento",
  "performance",
  "saude-tecnica",
]);

export const RoadmapConfigSchema = z.object({
  evaluation: z.object({
    botSeeds: z.array(z.string()).min(1),
    botDays: z.number().positive(),
    scenario: z.string(),
    scenarioDays: z.number().positive(),
  }),
  targetPopulation: z.number().positive(),
  thresholds: z.object({
    unmetShare: z.number().min(0),
    migrantsTurnedAwayShare: z.number().min(0),
    perfShareOfRealTime: z.number().positive(),
  }),
  confidence: z.object({
    dataAndSource: z.number().min(0).max(1),
    sourceOnly: z.number().min(0).max(1),
    opinion: z.number().min(0).max(1),
  }),
  defaultEffort: z.number().positive(),
  ownerBoost: z.number().min(0),
  nowSize: z.number().int().positive(),
  mix: z.object({ features: z.number().min(0), fixes: z.number().min(0), tech: z.number().min(0) }),
  nextSize: z.number().int().min(0),
});
export type RoadmapConfig = z.infer<typeof RoadmapConfigSchema>;

export const ReferenceItemSchema = z.object({
  id: z.string(),
  label: z.string(),
  category: CategorySchema,
  minPopulation: z.number().min(0),
  /** Tipo de serviço do catálogo que atende a isso ("" = não existe no jogo). */
  inGame: z.string(),
  reach: z.enum(["population", "children0to3", "youth18to24", "households"]),
  impact: z.number().positive(),
  source: z.string().min(1),
  url: z.string().url(),
});
export type ReferenceItem = z.infer<typeof ReferenceItemSchema>;

export function parseRoadmapConfig(text: string): RoadmapConfig {
  const obj = parseYaml(text) as { roadmap?: unknown };
  return RoadmapConfigSchema.parse(obj.roadmap);
}

export function parseReference(text: string): ReferenceItem[] {
  const obj = parseYaml(text) as { items?: unknown };
  return z.array(ReferenceItemSchema).parse(obj.items);
}
