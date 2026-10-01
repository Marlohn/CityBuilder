/** O que a interface pode pedir ao jogo. Implementado pelo pacote web (via Worker). */
import type { Command, PersonListItem, PersonView } from "@city/contract";

export interface GameClient {
  command(c: Command): void;
  setSpeed(speed: number): void;
  person(id: number): Promise<PersonView | null>;
  people(
    filter: string,
    offset: number,
    limit: number,
    buildingId?: number,
  ): Promise<{ total: number; items: PersonListItem[] }>;
  save(): Promise<string>;
  /** Abre um save (refaz a cidade). */
  load(save: string): void;
  bugReport(note: string): Promise<string>;
}

export interface ToolDef {
  id: string;
  label: string;
  icon: string;
  group: "Vias" | "Zonas" | "Serviços" | "Outros";
  hint: string;
  /** Custo em reais (por quadradinho para vias). */
  cost?: number;
  /** Custo anual de manutenção em reais (quando houver). */
  upkeepPerYear?: number;
}
