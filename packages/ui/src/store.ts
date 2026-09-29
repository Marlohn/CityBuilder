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

export function useUi(store: Store): UiState {
  return useSyncExternalStore(store.subscribe, store.get);
}
