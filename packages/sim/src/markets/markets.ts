/**
 * Mercados: onde tem casa vaga, vaga de emprego, vaga na escola e na UBS.
 * Cada mercado guarda só os prédios com vaga, então procurar é rápido mesmo em cidades grandes.
 */
import { IndexedSet } from "../core/indexedSet";
import type { Rng } from "../core/rng";
import type { Buildings } from "../world/buildings";
import type { RoadNetwork } from "../world/roadNetwork";
import type { World } from "../world/world";

type Capacity = (b: number) => number;
type Used = (b: number) => number;

export interface Candidate {
  building: number;
  meters: number;
}

/** Um mercado genérico de vagas por prédio. */
export class VacancyMarket {
  readonly open = new IndexedSet();
  /** Aumenta quando aparece uma vaga nova (quem estava procurando tenta de novo). */
  version = 0;

  constructor(
    private buildings: Buildings,
    private network: RoadNetwork,
    private world: World,
    private capacity: Capacity,
    private used: Used,
  ) {}

  /** Recalcula se o prédio tem vaga. Chame depois de mudar a ocupação ou o estado. */
  /** Prédio pode receber gente (tem água e luz). Trocado pelo sistema de água e luz. */
  served: (b: number) => boolean = () => true;

  update(b: number) {
    const has = this.buildings.isActive(b) && this.served(b) && this.used(b) < this.capacity(b);
    if (has && !this.open.has(b)) {
      this.open.add(b);
      this.version++;
    } else if (!has) this.open.delete(b);
  }

  vacancies(): number {
    let n = 0;
    for (let i = 0; i < this.open.size; i++) {
      const b = this.open.at(i);
      n += this.capacity(b) - this.used(b);
    }
    return n;
  }

  /**
   * Sorteia até `samples` prédios com vaga e devolve o mais perto que atende às condições.
   * `fromTile` = via de acesso de onde a pessoa sai. `maxMeters` = distância máxima (Manhattan).
   */
  findNear(
    rng: Rng,
    fromTile: number,
    samples: number,
    maxMeters = Number.POSITIVE_INFINITY,
  ): Candidate | null {
    if (this.open.size === 0) return null;
    this.network.refresh();
    const comp = fromTile >= 0 ? this.network.component[fromTile]! : -1;
    let best: Candidate | null = null;
    const tries = Math.min(samples, this.open.size);
    for (let k = 0; k < tries; k++) {
      const b = this.open.size <= samples ? this.open.at(k) : this.open.random(rng);
      const access = this.buildings.access[b]!;
      if (comp >= 0 && this.network.component[access] !== comp) continue;
      const meters = fromTile >= 0 ? this.world.manhattanMeters(fromTile, access) : 0;
      if (meters > maxMeters) continue;
      if (!best || meters < best.meters || (meters === best.meters && b < best.building))
        best = { building: b, meters };
    }
    return best;
  }
}

export class Markets {
  readonly housing: VacancyMarket;
  readonly jobs: VacancyMarket;
  readonly schools: VacancyMarket;
  readonly clinics: VacancyMarket;

  constructor(buildings: Buildings, network: RoadNetwork, world: World) {
    const b = buildings;
    this.housing = new VacancyMarket(
      b,
      network,
      world,
      (id) => b.homesCapacity(id),
      (id) => b.households[id]!,
    );
    this.jobs = new VacancyMarket(
      b,
      network,
      world,
      (id) => b.jobsCapacity(id),
      (id) => b.jobsFilled[id]!,
    );
    this.schools = new VacancyMarket(
      b,
      network,
      world,
      (id) => b.studentsCapacity(id),
      (id) => b.students[id]!,
    );
    this.clinics = new VacancyMarket(
      b,
      network,
      world,
      (id) => b.patientsCapacity(id),
      (id) => b.patients[id]!,
    );
  }

  /** Liga a regra "só recebe gente se tiver água e luz" em todos os mercados. */
  setServed(fn: (b: number) => boolean) {
    for (const m of [this.housing, this.jobs, this.schools, this.clinics]) m.served = fn;
  }

  updateAll(b: number) {
    this.housing.update(b);
    this.jobs.update(b);
    this.schools.update(b);
    this.clinics.update(b);
  }
}
