/**
 * Cenários: cidades de teste descritas em arquivo (scenarios/*.yaml).
 * Um cenário é uma lista de comandos com o dia em que acontecem. Existe um atalho "grid"
 * para desenhar uma malha de ruas sem escrever cada rua.
 */
import type { Command, RoadKind } from "@city/contract";
import { CommandSchema } from "@city/contract";
import { parse as parseYaml } from "yaml";
import { z } from "zod";

const GridSchema = z.object({
  grid: z.object({
    x0: z.number().int(),
    y0: z.number().int(),
    cols: z.number().int().positive(),
    rows: z.number().int().positive(),
    /** Distância entre ruas (em quadradinhos). */
    block: z.number().int().min(2),
    kind: z.enum(["street", "avenue"]).default("street"),
  }),
});

const StepSchema = z.object({
  day: z.number().min(0).default(0),
  do: z.union([CommandSchema, GridSchema, z.array(z.union([CommandSchema, GridSchema]))]),
});

export const ScenarioSchema = z.object({
  name: z.string(),
  description: z.string().default(""),
  seed: z.string().default("cenario"),
  days: z.number().positive().default(10),
  overrides: z.record(z.string(), z.unknown()).default({}),
  steps: z.array(StepSchema).default([]),
});

export type Scenario = z.infer<typeof ScenarioSchema>;

export interface ScheduledCommand {
  day: number;
  command: Command;
}

export function parseScenario(text: string): Scenario {
  return ScenarioSchema.parse(parseYaml(text));
}

/** Expande atalhos (grid) em comandos normais, em ordem. */
export function scenarioCommands(s: Scenario): ScheduledCommand[] {
  const out: ScheduledCommand[] = [];
  for (const step of s.steps) {
    const items = Array.isArray(step.do) ? step.do : [step.do];
    for (const item of items) {
      if ("grid" in item) for (const c of gridRoads(item.grid)) out.push({ day: step.day, command: c });
      else out.push({ day: step.day, command: item as Command });
    }
  }
  return out;
}

export function gridRoads(g: {
  x0: number;
  y0: number;
  cols: number;
  rows: number;
  block: number;
  kind: RoadKind;
}): Command[] {
  const cmds: Command[] = [];
  const x1 = g.x0 + g.cols * g.block;
  const y1 = g.y0 + g.rows * g.block;
  for (let r = 0; r <= g.rows; r++) {
    const y = g.y0 + r * g.block;
    cmds.push({ type: "buildRoad", kind: g.kind, x0: g.x0, y0: y, x1, y1: y });
  }
  for (let c = 0; c <= g.cols; c++) {
    const x = g.x0 + c * g.block;
    cmds.push({ type: "buildRoad", kind: g.kind, x0: x, y0: g.y0, x1: x, y1 });
  }
  return cmds;
}
