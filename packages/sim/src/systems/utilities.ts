/**
 * Água e luz (issue #15).
 *
 * As redes seguem as ruas: um prédio tem água se está na mesma malha de ruas (componente da rede viária)
 * de um poço, ETA ou da rede da região (que chega pela estrada de acesso) com capacidade sobrando.
 * O mesmo vale para a luz (subestação ou rede da região).
 *
 * O consumo de cada prédio é calculado pela capacidade (casas × pessoas por casa + empregos × fração),
 * não por quem mora lá agora: assim a capacidade fica reservada para o prédio inteiro e só muda quando
 * a cidade muda (prédio novo, via nova), o que deixa a conta barata.
 *
 * Sem água ou luz: ninguém se muda para o prédio, a empresa não contrata e a construtora não constrói
 * ali (ver markets e growth). Quem já mora num prédio sem água ou luz vira desejo não atendido.
 */
import type { City } from "../city";
import type { System } from "../sim";
import { BSTATE } from "../world/buildings";

type Kind = "water" | "power" | "sewage";

export class UtilitiesSystem implements System {
  readonly name = "utilities";
  private seenStructure = -1;
  private seenRoads = -1;
  /** Capacidade sobrando por componente da rede viária (depois de atender todos os prédios). */
  private spare: Record<Kind, Map<number, number>> = {
    water: new Map(),
    power: new Map(),
    sewage: new Map(),
  };

  constructor(private city: City) {}

  get enabled(): boolean {
    return this.city.sim.config.utilities.enabled;
  }

  tick() {
    if (!this.enabled) return;
    const { sim } = this.city;
    const cfg = sim.config.utilities;
    if (sim.clock.tick % cfg.everyTicks !== 0) return;
    if (sim.buildings.structureVersion === this.seenStructure && sim.world.roadVersion === this.seenRoads)
      return;
    this.recompute();
  }

  /** Consumo do prédio em pessoas equivalentes. */
  demandOf(typeHomes: number, typeJobs: number): number {
    const cfg = this.city.sim.config.utilities;
    return typeHomes * cfg.personsPerHome + typeJobs * cfg.personsPerJob;
  }

  /** O prédio tem água e luz (sempre true com o sistema desligado). */
  served = (b: number): boolean => {
    if (!this.enabled) return true;
    const bs = this.city.sim.buildings;
    // Falta de esgoto NAO tira o servico (decisao da issue #108).
    return bs.hasWater[b] === 1 && bs.hasPower[b] === 1;
  };

  /**
   * Dá para ligar um prédio novo com este consumo neste acesso? Se `reserve`, já desconta da sobra
   * (a construtora usa para não lançar mais obras do que a rede aguenta no mesmo intervalo).
   */
  canSupply(access: number, demand: number, reserve = false): boolean {
    if (!this.enabled) return true;
    if (this.seenStructure < 0) this.recompute();
    const net = this.city.sim.network;
    net.refresh();
    const comp = access >= 0 ? net.component[access]! : -1;
    if (comp < 0) return false;
    const w = this.spare.water.get(comp) ?? 0;
    const p = this.spare.power.get(comp) ?? 0;
    if (w < demand || p < demand) return false;
    const cfg = this.city.sim.config.utilities;
    const sewageDemand = demand * cfg.sewageShareOfConsumption;
    const s = this.spare.sewage.get(comp) ?? 0;
    if (this.hasEteInComponent(net, comp) && s < sewageDemand) return false;
    if (reserve) {
      this.spare.water.set(comp, w - demand);
      this.spare.power.set(comp, p - demand);
      if (this.hasEteInComponent(net, comp)) this.spare.sewage.set(comp, s - sewageDemand);
    }
    return true;
  }

  /** Tem ETE ativa nesta malha de ruas? Sem ETE a cidade usa fossa septica e o esgoto nao bloqueia. */
  private hasEteInComponent(net: { component: Int32Array }, comp: number): boolean {
    const bs = this.city.sim.buildings;
    for (let b = 0; b < bs.count; b++) {
      if (!bs.isActive(b)) continue;
      if (bs.typeOf(b).service !== "sewage") continue;
      if (net.component[bs.access[b]!] === comp) return true;
    }
    return false;
  }

  /** Capacidade sobrando na malha de ruas deste acesso (para o prefeito automático e a tela). */
  spareAt(access: number, kind: Kind): number {
    if (!this.enabled) return Number.POSITIVE_INFINITY;
    if (this.seenStructure < 0) this.recompute();
    const net = this.city.sim.network;
    net.refresh();
    const comp = access >= 0 ? net.component[access]! : -1;
    return comp < 0 ? 0 : (this.spare[kind].get(comp) ?? 0);
  }

  /**
   * Totais da cidade em pessoas equivalentes (para o StatsView).
   * `used` soma o consumo de todos os prédios que não são poço/ETA/subestação
   * (demolidos e abandonados ficam de fora); `capacity` é `used` mais as sobras.
   * O esgoto soma só prédios sem serviço (nem a ETE entra) vezes a fração da config.
   */
  totals(): {
    water: { capacity: number | null; used: number };
    power: { capacity: number | null; used: number };
    sewage: { capacity: number | null; used: number };
  } {
    const bs = this.city.sim.buildings;
    const cfg = this.city.sim.config.utilities;
    let used = 0;
    let usedNoService = 0;
    for (let b = 0; b < bs.count; b++) {
      const st = bs.state[b];
      if (st === BSTATE.demolished || st === BSTATE.abandoned) continue;
      const t = bs.typeOf(b);
      if (t.service === "water" || t.service === "power") continue;
      const demand = this.demandOf(t.homes, t.jobs);
      used += demand;
      if (t.service === undefined) usedNoService += demand;
    }
    const sewageUsed = usedNoService * cfg.sewageShareOfConsumption;
    if (!this.enabled)
      return {
        water: { capacity: null, used },
        power: { capacity: null, used },
        sewage: { capacity: null, used: sewageUsed },
      };
    if (this.seenStructure < 0) this.recompute();
    let spareWater = 0;
    for (const v of this.spare.water.values()) spareWater += v;
    let sparePower = 0;
    for (const v of this.spare.power.values()) sparePower += v;
    let spareSewage = 0;
    for (const v of this.spare.sewage.values()) spareSewage += v;
    return {
      water: { capacity: used + spareWater, used },
      power: { capacity: used + sparePower, used },
      sewage: { capacity: sewageUsed + spareSewage, used: sewageUsed },
    };
  }

  recompute() {
    const city = this.city;
    const { sim, markets } = city;
    const cfg = sim.config.utilities;
    const bs = sim.buildings;
    const net = sim.network;
    net.refresh();
    this.seenStructure = bs.structureVersion;
    this.seenRoads = sim.world.roadVersion;
    const cap: Record<Kind, Map<number, number>> = {
      water: new Map(),
      power: new Map(),
      sewage: new Map(),
    };
    const add = (kind: Kind, comp: number, v: number) => {
      if (comp >= 0) cap[kind].set(comp, (cap[kind].get(comp) ?? 0) + v);
    };
    // Rede da região: chega pela estrada de acesso (componentes ligados à borda do mapa).
    for (const comp of net.componentsWithExit()) {
      add("water", comp, cfg.regionalWater);
      add("power", comp, cfg.regionalPower);
      add("sewage", comp, cfg.regionalSewage);
    }
    for (let b = 0; b < bs.count; b++) {
      if (!bs.isActive(b)) continue;
      const t = bs.typeOf(b);
      if (t.service === "water" || t.service === "power" || t.service === "sewage")
        add(t.service, net.component[bs.access[b]!]!, t.serves);
    }
    // Atende os prédios na ordem de criação (determinístico): quem chegou primeiro tem prioridade.
    for (let b = 0; b < bs.count; b++) {
      const st = bs.state[b];
      if (st === BSTATE.demolished || st === BSTATE.abandoned) continue;
      const t = bs.typeOf(b);
      const demand = this.demandOf(t.homes, t.jobs);
      const comp = net.component[bs.access[b]!] ?? -1;
      const sewageDemand = demand * cfg.sewageShareOfConsumption;
      const give = (kind: Kind): number => {
        if (t.service === kind || demand === 0) return 1;
        const need = kind === "sewage" ? sewageDemand : demand;
        const c = comp >= 0 ? (cap[kind].get(comp) ?? 0) : 0;
        if (c < need) return 0;
        cap[kind].set(comp, c - need);
        return 1;
      };
      const w = give("water");
      const p = give("power");
      const g = give("sewage");
      if (bs.hasWater[b] !== w || bs.hasPower[b] !== p || bs.hasSewage[b] !== g) {
        bs.hasWater[b] = w;
        bs.hasPower[b] = p;
        bs.hasSewage[b] = g;
        markets.updateAll(b);
      }
    }
    this.spare = cap;
  }
}
