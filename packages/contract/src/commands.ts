/**
 * Comandos: a única forma de mudar a cidade.
 * A tela (ou um bot, ou um replay) manda comandos; o motor decide se aceita.
 */
import { z } from "zod";

export const ZONE_KINDS = [
  "none",
  "residential_low",
  "residential_high",
  "commercial",
  "industrial",
] as const;
export type ZoneKind = (typeof ZONE_KINDS)[number];
/** Número da zona guardado no mapa (índice em ZONE_KINDS). */
export const ZONE_ID: Record<ZoneKind, number> = {
  none: 0,
  residential_low: 1,
  residential_high: 2,
  commercial: 3,
  industrial: 4,
};

export const ROAD_KINDS = ["street", "avenue"] as const;
export type RoadKind = (typeof ROAD_KINDS)[number];
/** Número da via guardado no mapa (0 = sem via). */
export const ROAD_ID: Record<RoadKind, number> = { street: 1, avenue: 2 };

const coord = z.number().int().min(0).max(4095);

export const CommandSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("buildRoad"),
    kind: z.enum(ROAD_KINDS),
    x0: coord,
    y0: coord,
    x1: coord,
    y1: coord,
  }),
  z.object({
    type: z.literal("zone"),
    zone: z.enum(ZONE_KINDS),
    x0: coord,
    y0: coord,
    x1: coord,
    y1: coord,
  }),
  z.object({ type: z.literal("bulldoze"), x0: coord, y0: coord, x1: coord, y1: coord }),
  z.object({ type: z.literal("placeService"), service: z.string().min(1), x: coord, y: coord }),
]);

export type Command = z.infer<typeof CommandSchema>;

/** Comando com o tick em que foi aplicado (usado no replay). */
export interface TimedCommand {
  tick: number;
  command: Command;
}

export interface CommandResult {
  tick: number;
  command: Command;
  ok: boolean;
  /** Motivo em português quando recusado (ex: "dinheiro insuficiente"). */
  reason?: string;
  cost?: number;
}

export function parseCommand(input: unknown): Command {
  return CommandSchema.parse(input);
}
