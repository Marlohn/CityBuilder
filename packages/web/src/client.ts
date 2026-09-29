/** Fala com o motor (Worker). Implementa o GameClient usado pela interface. */
import type { Command, FromWorker, PersonListItem, PersonView, ToWorker, ViewRect } from "@city/contract";
import type { GameClient } from "@city/ui";

type FrameMsg = Extract<FromWorker, { type: "frame" }>;

export class WorkerClient implements GameClient {
  private worker: Worker;
  private nextId = 1;
  private pending = new Map<number, (msg: FromWorker) => void>();
  onFrame: ((f: FrameMsg) => void) | null = null;
  onReady: (() => void) | null = null;
  onError: ((message: string) => void) | null = null;

  constructor() {
    this.worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
    this.worker.onmessage = (ev: MessageEvent<FromWorker>) => {
      const m = ev.data;
      if (m.type === "frame") this.onFrame?.(m);
      else if (m.type === "ready") this.onReady?.();
      else if (m.type === "error") this.onError?.(m.message);
      else if ("requestId" in m) {
        const cb = this.pending.get(m.requestId);
        this.pending.delete(m.requestId);
        cb?.(m);
      }
    };
  }

  send(msg: ToWorker) {
    this.worker.postMessage(msg);
  }

  private request<T>(build: (requestId: number) => ToWorker, pick: (m: FromWorker) => T): Promise<T> {
    const requestId = this.nextId++;
    return new Promise((resolve) => {
      this.pending.set(requestId, (m) => resolve(pick(m)));
      this.send(build(requestId));
    });
  }

  command(c: Command) {
    this.send({ type: "command", command: c });
  }

  setSpeed(speed: number) {
    this.send({ type: "speed", speed });
  }

  setView(rect: ViewRect) {
    this.send({ type: "view", rect });
  }

  person(id: number): Promise<PersonView | null> {
    return this.request(
      (requestId) => ({ type: "queryPerson", id, requestId }),
      (m) => (m.type === "person" ? m.person : null),
    );
  }

  people(filter: string, offset: number, limit: number, buildingId?: number) {
    return this.request<{ total: number; items: PersonListItem[] }>(
      (requestId) => ({
        type: "queryPeople",
        filter,
        offset,
        limit,
        requestId,
        ...(buildingId !== undefined ? { buildingId } : {}),
      }),
      (m) => (m.type === "people" ? { total: m.total, items: m.items } : { total: 0, items: [] }),
    );
  }

  save(): Promise<string> {
    return this.request(
      (requestId) => ({ type: "save", requestId }),
      (m) => (m.type === "saved" ? m.save : ""),
    );
  }

  bugReport(note: string): Promise<string> {
    return this.request(
      (requestId) => ({ type: "bugReport", requestId, note }),
      (m) => (m.type === "bugReport" ? m.report : ""),
    );
  }
}
