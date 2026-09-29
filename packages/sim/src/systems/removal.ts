/**
 * Prédio demolido ou sem acesso por via: quem morava, trabalhava, estudava ou era atendido ali
 * precisa de outro lugar. Nada some do nada: cada pessoa ganha um evento com o motivo.
 * Os prédios removidos no tick são tratados juntos, numa passada só pelo registro.
 */
import type { City } from "../city";
import { fire, leaveHome, unenroll, unregisterClinic } from "../people/actions";
import { EV } from "../people/events";
import { PSTATUS } from "../people/population";
import type { System } from "../sim";
import { BSTATE } from "../world/buildings";

export class RemovalSystem implements System {
  readonly name = "removal";
  private pending = new Set<number>();
  private checkAccess = false;

  constructor(private city: City) {}

  onBuildingRemoved(id: number) {
    this.pending.add(id);
  }

  onRoadsRemoved() {
    this.checkAccess = true;
  }

  /** Serviço mudou de lugar: quem ficou longe demais (mesmo limite de quando se matriculou) procura outro. */
  onBuildingMoved(id: number) {
    const city = this.city;
    const { pop, sim } = city;
    const access = sim.buildings.access[id]!;
    const maxSchool = sim.config.education.maxDistanceMeters;
    const maxClinic = sim.config.health.maxDistanceMeters;
    for (let p = 0; p < pop.count; p++) {
      if (pop.status[p] !== PSTATUS.alive) continue;
      const atSchool = pop.school[p] === id;
      const atClinic = pop.clinic[p] === id;
      if (!atSchool && !atClinic) continue;
      const home = city.homeAccess(p);
      const far = (max: number) => home < 0 || sim.world.manhattanMeters(home, access) > max;
      if (atSchool && far(maxSchool)) unenroll(city, p);
      if (atClinic && far(maxClinic)) unregisterClinic(city, p);
    }
    city.markets.updateAll(id);
  }

  tick() {
    if (this.checkAccess) {
      this.checkAccess = false;
      this.recheckAccess();
    }
    if (this.pending.size === 0) return;
    const gone = this.pending;
    this.pending = new Set();
    const { pop, hh, markets } = this.city;
    for (let h = 0; h < hh.count; h++) {
      if (hh.alive[h] && gone.has(hh.home[h]!)) {
        for (const m of hh.members(h)) this.city.log(EV.lostHome, m, hh.home[h]!);
        leaveHome(this.city, h);
        hh.wantsHome[h] = 1;
        this.city.seekHome.add(h);
      }
    }
    for (let p = 0; p < pop.count; p++) {
      if (pop.status[p] !== PSTATUS.alive) continue;
      if (gone.has(pop.job[p]!)) fire(this.city, p, "prédio fechou");
      if (gone.has(pop.school[p]!)) unenroll(this.city, p);
      if (gone.has(pop.clinic[p]!)) unregisterClinic(this.city, p);
    }
    for (const b of gone) markets.updateAll(b);
  }

  /** Prédios que perderam a via de acesso: acham outra ou são abandonados. */
  private recheckAccess() {
    const { sim } = this.city;
    const b = sim.buildings;
    for (let id = 0; id < b.count; id++) {
      if (b.state[id] === BSTATE.demolished || b.state[id] === BSTATE.abandoned) continue;
      if (sim.world.roads[b.access[id]!] !== 0) continue;
      const [access, facing] = sim.network.findAccess(b.x[id]!, b.y[id]!, b.w[id]!, b.h[id]!);
      if (access >= 0) {
        b.access[id] = access;
        b.facing[id] = facing;
      } else {
        b.setState(id, BSTATE.abandoned);
        sim.log.info("removal", "abandoned", { entity: `building:${id}`, reason: "perdeu o acesso por via" });
        this.pending.add(id);
      }
    }
  }
}
