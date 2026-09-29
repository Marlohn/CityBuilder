/**
 * Mensagens entre a tela (thread principal) e o motor (Web Worker).
 */
import type { Command, CommandResult } from "./commands";
import type { BuildingView, MapView, PersonListItem, PersonView, StatsView, VehiclesView } from "./view";

export interface ViewRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export type ToWorker =
  | {
      type: "init";
      seed: string;
      configTexts: Record<string, string>;
      dataTexts: Record<string, string>;
      /** Valores que sobrescrevem a config (ex.: { economy: { mode: "sandbox" } }). */
      overrides?: unknown;
    }
  | { type: "load"; save: string; configTexts: Record<string, string>; dataTexts: Record<string, string> }
  | { type: "command"; command: Command }
  | { type: "speed"; speed: number }
  /** Avança N ticks de uma vez (testes e depuração). */
  | { type: "advance"; ticks: number }
  | { type: "view"; rect: ViewRect }
  | { type: "queryPerson"; id: number; requestId: number }
  | {
      type: "queryPeople";
      filter: string;
      offset: number;
      limit: number;
      buildingId?: number;
      requestId: number;
    }
  | { type: "save"; requestId: number }
  | { type: "bugReport"; requestId: number; note: string };

export type FromWorker =
  | { type: "ready" }
  | { type: "error"; message: string }
  | {
      type: "frame";
      stats: StatsView;
      /** Enviado só quando o mapa muda. */
      map?: MapView;
      /** Enviado só quando algum prédio muda. */
      buildings?: BuildingView[];
      vehicles: VehiclesView;
      commandResults: CommandResult[];
    }
  | { type: "person"; requestId: number; person: PersonView | null }
  | { type: "people"; requestId: number; total: number; items: PersonListItem[] }
  | { type: "saved"; requestId: number; save: string }
  | { type: "bugReport"; requestId: number; report: string };
