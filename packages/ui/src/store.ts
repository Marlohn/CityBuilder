/** Estado da interface: um "store" mínimo com assinatura, usado com useSyncExternalStore. */

import type { BuildingView, CommandResult, StatsView } from "@city/contract";
import { useSyncExternalStore } from "react";

export interface Toast {
  id: number;
  text: string;
  ok: boolean;
}

export interface UiState {
  stats: StatsView | null;
  tool: string;
  speed: number;
  selectedBuilding: BuildingView | null;
  selectedPerson: number | null;
  panel: "city" | "people" | "realism" | "perf" | "help";
  /** Painel lateral aberto ou recolhido (a escolha fica guardada no navegador). */
  panelOpen: boolean;
  toasts: Toast[];
  ready: boolean;
  error: string | null;
}

export class Store {
  private state: UiState = {
    stats: null,
    tool: "inspect",
    speed: 1,
    selectedBuilding: null,
    selectedPerson: null,
    panel: "city",
    panelOpen: readPanelOpen(),
    toasts: [],
    ready: false,
    error: null,
  };
  private listeners = new Set<() => void>();
  private toastId = 0;

  get = (): UiState => this.state;

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  set(patch: Partial<UiState>) {
    // Selecionar um prédio ou uma pessoa abre o painel (é onde aparece a informação).
    if ((patch.selectedBuilding || patch.selectedPerson != null) && patch.panelOpen === undefined)
      patch = { ...patch, panelOpen: true };
    if (patch.panelOpen !== undefined && patch.panelOpen !== this.state.panelOpen)
      writePanelOpen(patch.panelOpen);
    this.state = { ...this.state, ...patch };
    for (const fn of this.listeners) fn();
  }

  /** Mostra o resultado de comandos recusados (e alguns avisos). */
  pushResults(results: CommandResult[]) {
    const fresh: Toast[] = [];
    for (const r of results) {
      if (!r.ok) fresh.push({ id: ++this.toastId, text: r.reason ?? "comando recusado", ok: false });
      else if (r.reason) fresh.push({ id: ++this.toastId, text: r.reason, ok: true });
    }
    if (fresh.length === 0) return;
    this.set({ toasts: [...this.state.toasts, ...fresh].slice(-4) });
    for (const t of fresh) {
      setTimeout(() => this.set({ toasts: this.state.toasts.filter((x) => x.id !== t.id) }), 4000);
    }
  }
}

const PANEL_KEY = "citybuilder.panelOpen";

function readPanelOpen(): boolean {
  try {
    return globalThis.localStorage?.getItem(PANEL_KEY) !== "0";
  } catch {
    return true;
  }
}

function writePanelOpen(open: boolean) {
  try {
    globalThis.localStorage?.setItem(PANEL_KEY, open ? "1" : "0");
  } catch {
    // Navegador sem armazenamento (modo privado): só não lembra a escolha.
  }
}

export function useUi(store: Store): UiState {
  return useSyncExternalStore(store.subscribe, store.get);
}
