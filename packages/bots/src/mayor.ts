/**
 * Prefeito automático: constrói uma cidade sozinho a partir de uma semente, usando os mesmos
 * comandos de um jogador. Serve para gerar cidades de teste (inclusive de estresse) sem esforço.
 *
 * Estratégia (simples e realista):
 * - Cresce a partir da estrada de acesso, bairro por bairro.
 * - Quarteirões com 2 lotes de profundidade (como os brasileiros): todo lote tem frente para a rua.
 * - Zoneia mais quando a demanda está alta e acabam os lotes livres.
 * - Coloca escola e UBS quando aparecem crianças sem escola ou pessoas sem UBS (os mesmos sinais do jogo).
 */
import { type Command, ROAD_ID, type ZoneKind } from "@city/contract";
import { BSTATE, currentCensus, type Game, Rng } from "@city/sim";

export interface MayorOptions {
  /** A cada quantos dias do jogo o prefeito age. */
  everyDays: number;
  /** Tamanho do bairro (quadradinhos). */
  district: number;
  /** Fração da área residencial zoneada para prédios (o resto é casa). */
  highDensityShare: number;
  /** Constrói poço/subestação quando sobra menos que isto (pessoas) de água ou luz na cidade. */
  utilityReserve: number;
}

export const DEFAULT_MAYOR: MayorOptions = {
  everyDays: 0.25,
  district: 30,
  highDensityShare: 0.35,
  utilityReserve: 3000,
};

interface District {
  x0: number;
  y0: number;
  kind: "mixed" | "industrial";
  /** -1 = bairro acima da avenida principal (cresce para cima), 1 = abaixo (cresce para baixo). */
  side: -1 | 1;
  /** Quantas faixas de quarteirões já foram abertas (cresce a partir da avenida). */
  steps: number;
  /** Sorteio feito ao abrir o bairro (define onde vão os prédios residenciais). */
  r: number;
}

/** Ruas horizontais abertas por etapa (3 faixas de quarteirão com 2 lotes de fundo). */
const ROWS_PER_STEP = 3;

export class AutoMayor {
  private rng: Rng;
  private districts: District[] = [];
  private nextActionTick = 0;
  private col = 0;
  private row = 0;
  /** Quantos prédios existiam na última ação (para perceber quando a construção empaca). */
  private lastBuildingCount = -1;
  private stalledActions = 0;

  constructor(
    private game: Game,
    seed: string,
    private opts: MayorOptions = DEFAULT_MAYOR,
  ) {
    this.rng = new Rng(`${seed}/mayor`);
  }

  /** Chame uma vez por tick (antes de sim.step). */
  update() {
    const sim = this.game.sim;
    if (sim.clock.tick < this.nextActionTick) return;
    this.nextActionTick = sim.clock.tick + Math.round(this.opts.everyDays * sim.clock.ticksPerDay);
    const census = currentCensus(this.game);
    const d = this.game.growth.demand;
    const free = this.freeLots();
    // Demanda alta mas nenhuma obra nova desde a última ação: os lotes livres não servem (formato).
    const count = sim.buildings.count;
    this.stalledActions = count === this.lastBuildingCount ? this.stalledActions + 1 : 0;
    this.lastBuildingCount = count;
    const stalled = this.stalledActions >= 2;
    // Serviços primeiro (como um prefeito de verdade): escola quando ~150 crianças estão sem vaga,
    // UBS quando ~500 pessoas estão sem UBS. Sem dinheiro para o serviço, guarda dinheiro (não abre bairro).
    let saving = false;
    // Água e luz antes de tudo: sem sobra, a construtora para (poço é o jeito mais barato; 40% das
    // cidades brasileiras vivem só de água subterrânea, Atlas Águas/ANA).
    const hub = this.hubAccess();
    if (hub >= 0) {
      for (const [kind, service] of [
        ["water", "poco"],
        ["power", "subestacao"],
      ] as const) {
        if (this.game.utilities.spareAt(hub, kind) >= this.opts.utilityReserve) continue;
        if (this.underConstruction(service)) continue;
        const [px, py] = this.cityCenter();
        saving = !this.placeNear(service, px, py) || saving;
      }
    }
    if (census.childrenWithoutSchool > 150)
      saving = !this.placeServiceNearDemand("escola", census.samples.school ?? []) || saving;
    if (census.withoutClinic > 500)
      saving = !this.placeServiceNearDemand("ubs", census.samples.health ?? []) || saving;
    if (saving && this.districts.length > 0) return;
    // Abre bairro do tipo que está faltando: indústria separada (como manda o zoneamento) ou misto.
    if (this.districts.length === 0) this.buildDistrict("mixed");
    else if (d.industrialJobs > 10 && (free.industrial < 8 || stalled)) {
      this.buildDistrict("industrial");
      this.stalledActions = 0;
    } else if (
      (d.homes > 5 && (free.residential < 30 || stalled)) ||
      (d.commercialJobs > 10 && (free.commercial < 10 || stalled))
    ) {
      this.buildDistrict("mixed");
      this.stalledActions = 0;
    }
  }

  /** Lotes zoneados e ainda vazios, por tipo. */
  private freeLots() {
    const w = this.game.sim.world;
    const out = { residential: 0, commercial: 0, industrial: 0 };
    for (let i = 0; i < w.size; i++) {
      const z = w.zones[i]!;
      if (z === 0 || w.buildingAt[i]! >= 0) continue;
      if (z <= 2) out.residential++;
      else if (z === 3) out.commercial++;
      else out.industrial++;
    }
    return out;
  }

  private send(c: Command) {
    this.game.sim.enqueue(c);
  }

  /**
   * Cresce a cidade: continua um bairro do mesmo tipo que ainda não terminou ou abre um novo.
   * Como um prefeito de verdade, abre algumas ruas por vez e só quando tem dinheiro para a etapa inteira
   * (etapa pela metade deixa ruas sem ligação com a estrada, onde ninguém consegue chegar).
   */
  private buildDistrict(kind: District["kind"]) {
    const D = this.opts.district;
    const steps = Math.ceil(D / 3 / ROWS_PER_STEP);
    let d = this.districts.find((x) => x.kind === kind && x.steps < steps);
    if (!d) {
      const slot = this.nextSlot();
      if (!slot) return;
      const fresh: District = { ...slot, kind, steps: 0, r: this.rng.float() };
      if (!this.extend(fresh)) return;
      this.districts.push(fresh);
      this.advanceSlot();
      d = fresh;
    } else if (!this.extend(d)) return;
    // Com dinheiro sobrando (ou no modo livre), continua o bairro na mesma vez, guardando reserva.
    while (d.steps < steps && this.extend(d, 3)) {}
  }

  /** Próximo lugar livre para um bairro: colunas a partir do fim da estrada, alternando acima e abaixo. */
  private nextSlot(): { x0: number; y0: number; side: -1 | 1 } | null {
    const w = this.game.sim.world;
    const D = this.opts.district;
    const midY = Math.floor(w.height / 2);
    const startX = this.game.sim.config.world.startingRoad.length;
    for (;;) {
      const x0 = startX + this.col * D;
      if (x0 + D >= w.width - 1) return null;
      const side: -1 | 1 = this.row % 2 === 0 ? -1 : 1;
      const layer = Math.floor(this.row / 2);
      const y0 = side < 0 ? midY - (layer + 1) * D : midY + 1 + layer * D;
      if (y0 >= 1 && y0 + D < w.height - 1 && this.row < 6) {
        // Bairro, avenida vertical e avenida principal não podem passar por água (ainda não há ponte).
        const blocked =
          this.waterIn(x0, y0, x0 + D, y0 + D) ||
          this.waterIn(x0, Math.min(y0, midY), x0, Math.max(y0 + D, midY)) ||
          this.waterIn(startX - 1, midY, x0 + D, midY);
        if (!blocked) return { x0, y0, side };
        this.advanceSlot();
        continue;
      }
      this.row = 0;
      this.col++;
    }
  }

  private waterIn(x0: number, y0: number, x1: number, y1: number): boolean {
    const w = this.game.sim.world;
    for (let y = Math.max(0, y0); y <= Math.min(w.height - 1, y1); y++)
      for (let x = Math.max(0, x0); x <= Math.min(w.width - 1, x1); x++)
        if (w.water[w.idx(x, y)]) return true;
    return false;
  }

  private advanceSlot() {
    this.row++;
    if (this.row >= 6) {
      this.row = 0;
      this.col++;
    }
  }

  /** Abre a próxima etapa do bairro. Devolve false se não tinha dinheiro (nada é feito). */
  private extend(d: District, reserve = 1): boolean {
    const w = this.game.sim.world;
    const D = this.opts.district;
    const midY = Math.floor(w.height / 2);
    const startX = this.game.sim.config.world.startingRoad.length;
    const { x0, y0, side } = d;
    // Faixa de linhas desta etapa, contando a partir do lado da avenida principal.
    const depth0 = d.steps * ROWS_PER_STEP * 3;
    const depth1 = Math.min(D, depth0 + ROWS_PER_STEP * 3);
    const near = side < 0 ? y0 + D : y0;
    const ya = side < 0 ? near - depth1 : near + depth0;
    const yb = side < 0 ? near - depth0 : near + depth1;
    type Road = Extract<Command, { type: "buildRoad" }>;
    const roads: Road[] = [];
    // Avenida principal até o fim deste bairro e avenida vertical até o fim da etapa.
    roads.push({ type: "buildRoad", kind: "avenue", x0: startX - 1, y0: midY, x1: x0 + D, y1: midY });
    roads.push({
      type: "buildRoad",
      kind: "avenue",
      x0,
      y0: Math.min(ya, midY),
      x1: x0,
      y1: Math.max(yb, midY),
    });
    // Ruas: horizontais a cada 3 (quarteirão com 2 lotes de fundo), verticais a cada 12 e na borda.
    for (let y = y0; y <= y0 + D; y += 3)
      if (y >= ya && y <= yb) roads.push({ type: "buildRoad", kind: "street", x0, y0: y, x1: x0 + D, y1: y });
    for (let x = x0 + 12; x < x0 + D; x += 12)
      roads.push({ type: "buildRoad", kind: "street", x0: x, y0: ya, x1: x, y1: yb });
    roads.push({ type: "buildRoad", kind: "street", x0: x0 + D, y0: ya, x1: x0 + D, y1: yb });
    if (!this.game.sim.treasury.canAfford(this.roadsCost(roads) * reserve)) return false;
    for (const r of roads) this.send(r);
    // Zonas desta etapa.
    const za = Math.max(ya + 1, y0 + 1);
    const zb = Math.min(yb - 1, y0 + D - 1);
    if (d.kind === "industrial") this.zone("industrial", x0 + 1, za, x0 + D - 1, zb);
    else {
      // Faixa comercial perto da avenida (um terço do bairro); o resto residencial (parte em prédios).
      const third = Math.floor(D / 3);
      const [ca, cb] = side < 0 ? [y0 + D - third, y0 + D - 1] : [y0 + 1, y0 + third];
      const split = x0 + Math.floor(D / 2);
      const hd = this.opts.highDensityShare;
      // Metade oeste: prédios com chance hd; metade leste: prédios só se hd for alto.
      const west: ZoneKind = d.r < hd ? "residential_high" : "residential_low";
      const east: ZoneKind = d.r < hd - 0.5 ? "residential_high" : "residential_low";
      for (let y = za; y <= zb; y++) {
        if (y >= ca && y <= cb) this.zone("commercial", x0 + 1, y, x0 + D - 1, y);
        else {
          this.zone(west, x0 + 1, y, split, y);
          this.zone(east, split + 1, y, x0 + D - 1, y);
        }
      }
    }
    d.steps++;
    return true;
  }

  /** Custo das vias que ainda não existem (mesma conta do comando buildRoad). */
  private roadsCost(roads: Extract<Command, { type: "buildRoad" }>[]): number {
    const sim = this.game.sim;
    const w = sim.world;
    const seen = new Set<number>();
    let cost = 0;
    for (const r of roads) {
      const id = ROAD_ID[r.kind];
      for (let y = Math.min(r.y0, r.y1); y <= Math.max(r.y0, r.y1); y++) {
        for (let x = Math.min(r.x0, r.x1); x <= Math.max(r.x0, r.x1); x++) {
          if (!w.inBounds(x, y)) continue;
          const i = w.idx(x, y);
          if (w.roads[i] === id || seen.has(i * 2 + id)) continue;
          seen.add(i * 2 + id);
          cost += sim.config.roads[r.kind].costPerTile;
        }
      }
    }
    return cost;
  }

  private zone(zone: ZoneKind, x0: number, y0: number, x1: number, y1: number) {
    this.send({ type: "zone", zone, x0, y0, x1, y1 });
  }

  /**
   * Coloca o serviço perto de onde está a demanda (amostras de casas sem atendimento).
   * Devolve false só quando falta dinheiro (aí o prefeito guarda dinheiro em vez de abrir bairro).
   */
  private placeServiceNearDemand(service: "escola" | "ubs", samples: number[]): boolean {
    if (samples.length === 0) return true;
    const sim = this.game.sim;
    const w = sim.world;
    const pick = samples[this.rng.int(samples.length)]!;
    const px = w.xOf(pick);
    const py = w.yOf(pick);
    // Já tem um igual (pronto ou em obra) a menos de ~1 km: espera ele ficar pronto.
    const b = sim.buildings;
    for (let id = 0; id < b.count; id++) {
      if (b.state[id]! > BSTATE.active || b.typeOf(id).id !== service) continue;
      if (Math.abs(b.x[id]! - px) + Math.abs(b.y[id]! - py) < 60) return true;
    }
    return this.placeNear(service, px, py);
  }

  /**
   * Coloca o serviço no lugar vazio mais perto do ponto, encostado numa via (busca em espiral).
   * Devolve false só quando falta dinheiro.
   */
  private placeNear(service: string, px: number, py: number): boolean {
    const sim = this.game.sim;
    const t = sim.buildings.catalog.find((b) => b.id === service);
    if (!t) return true;
    if (!sim.treasury.canAfford(t.cost ?? 0)) return false;
    for (let r = 1; r < 40; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
          const x = px + dx;
          const y = py + dy;
          if (this.fits(x, y, t.w, t.h) && sim.network.findAccess(x, y, t.w, t.h)[0] >= 0) {
            this.send({ type: "placeService", service, x, y });
            return true;
          }
        }
      }
    }
    return true;
  }

  /** Algum prédio deste tipo ainda em obra (espera ficar pronto antes de pedir outro). */
  private underConstruction(service: string): boolean {
    const b = this.game.sim.buildings;
    for (let id = 0; id < b.count; id++)
      if (b.state[id] === BSTATE.constructing && b.typeOf(id).id === service) return true;
    return false;
  }

  /** Via da avenida principal no começo da cidade (a malha onde está quase tudo). */
  private hubAccess(): number {
    const w = this.game.sim.world;
    const x = this.game.sim.config.world.startingRoad.length - 1;
    const y = Math.floor(w.height / 2);
    if (!w.inBounds(x, y)) return -1;
    const i = w.idx(x, y);
    return w.roads[i] ? i : -1;
  }

  /** Meio da parte construída (para os serviços da cidade inteira ficarem perto de todo mundo). */
  private cityCenter(): [number, number] {
    const w = this.game.sim.world;
    const midY = Math.floor(w.height / 2);
    if (this.districts.length === 0) return [this.game.sim.config.world.startingRoad.length + 4, midY - 3];
    let sx = 0;
    let sy = 0;
    for (const d of this.districts) {
      sx += d.x0 + this.opts.district / 2;
      sy += d.y0 + this.opts.district / 2;
    }
    return [Math.round(sx / this.districts.length), Math.round(sy / this.districts.length)];
  }

  private fits(x: number, y: number, w: number, h: number): boolean {
    const world = this.game.sim.world;
    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) {
        if (!world.inBounds(x + dx, y + dy)) return false;
        const i = world.idx(x + dx, y + dy);
        if (world.roads[i] !== 0 || world.buildingAt[i]! >= 0 || world.water[i]) return false;
      }
    }
    return true;
  }
}
