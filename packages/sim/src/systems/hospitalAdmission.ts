/**
 * Admite quem está na fila de internação: a cada tick puxa da `seekHospital` (orçamento
 * fixo, cursor circular como o `MatchingSystem`) e registra em leito livre de hospital
 * dentro de `config.health.hospitalMaxDistanceMeters`. Sem vaga ou longe demais, o
 * pedido continua na fila. Nada surge do nada: a admissão chama `registerHospital`.
 */
import type { City } from "../city";
import type { IndexedSet } from "../core/indexedSet";
import { registerHospital } from "../people/actions";
import { PSTATUS } from "../people/population";
import type { System } from "../sim";

export class HospitalAdmissionSystem implements System {
  readonly name = "hospitalAdmission";
  private cursor = 0;

  constructor(private city: City) {}

  tick() {
    const budget = this.city.config.performance.budgets.personsUpdatedPerTick;
    const n = Math.max(4, Math.floor(budget / 8));
    this.take(this.city.seekHospital, n, (p) => this.admit(p));
  }

  /** Percorre a fila de forma circular, no máximo `n` itens por tick. */
  private take(set: IndexedSet, n: number, fn: (id: number) => void) {
    if (set.size === 0) return;
    const count = Math.min(n, set.size);
    for (let k = 0; k < count; k++) {
      if (this.cursor >= set.size) this.cursor = 0;
      const id = set.at(this.cursor);
      const sizeBefore = set.size;
      this.city.sim.perf.count("personsUpdated");
      fn(id);
      // Se o item saiu da fila, o próximo ocupou a mesma posição: não avança o cursor.
      if (set.size === sizeBefore && set.has(id)) this.cursor++;
    }
  }

  private admit(p: number) {
    const city = this.city;
    const { pop } = city;
    if (pop.status[p] !== PSTATUS.alive || pop.hospital[p]! >= 0) {
      city.seekHospital.delete(p);
      return;
    }
    const access = city.homeAccess(p);
    if (access < 0) return;
    const maxM = city.config.health.hospitalMaxDistanceMeters;
    const cand = city.markets.hospitals.findNear(city.rng.hospital, access, 8, maxM);
    if (cand) registerHospital(city, p, cand.building);
  }
}
