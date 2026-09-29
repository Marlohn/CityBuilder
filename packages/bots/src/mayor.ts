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
import { currentCensus, type Game, Rng } from "@city/sim";

export interface MayorOptions {
  /** A cada quantos dias do jogo o prefeito age. */
  everyDays: number;
  /** Tamanho do bairro (quadradinhos). */
  district: number;
  /** Fração da área residencial zoneada para prédios (o resto é casa). */
  highDensityShare: number;
}

export const DEFAULT_MAYOR: MayorOptions = { everyDays: 0.25, district: 30, highDensityShare: 0.35 };

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
  private schools: [number, number][] = [];
  /** Quantos prédios existiam na última ação (para perceber quando a construção empaca). */
  private lastBuildingCount = -1;
  private stalledActions = 0;
  private clinics: [number, number][] = [];

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
    // Serviços: uma escola a cada ~500 crianças sem vaga, uma UBS a cada ~1.500 pessoas sem UBS.
    if (census.childrenWithoutSchool > 150)
      this.placeServiceNearDemand("escola", census.samples.school ?? []);
    if (census.withoutClinic > 500) this.placeServiceNearDemand("ubs", census.samples.health ?? []);
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
      if (y0 >= 1 && y0 + D < w.height - 1 && this.row < 6) return { x0, y0, side };
      this.row = 0;
      this.col++;
    }
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

  /** Coloca o serviço perto de onde está a demanda (amostras de casas sem atendimento). */
  private placeServiceNearDemand(service: "escola" | "ubs", samples: number[]) {
    if (samples.length === 0) return;
    const sim = this.game.sim;
    const w = sim.world;
    const t = sim.buildings.catalog.find((b) => b.id === service);
    if (!t) return;
    const placed = service === "escola" ? this.schools : this.clinics;
    const pick = samples[this.rng.int(samples.length)]!;
    const px = w.xOf(pick);
    const py = w.yOf(pick);
    // Não coloca dois iguais muito perto (menos de 1 km).
    if (placed.some(([x, y]) => Math.abs(x - px) + Math.abs(y - py) < 60)) return;
    // Procura um lugar vazio encostado numa via, em espiral a partir do ponto.
    for (let r = 1; r < 25; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
          const x = px + dx;
          const y = py + dy;
          if (this.fits(x, y, t.w, t.h) && sim.network.findAccess(x, y, t.w, t.h)[0] >= 0) {
            this.send({ type: "placeService", service, x, y });
            placed.push([x, y]);
            return;
          }
        }
      }
    }
  }

  private fits(x: number, y: number, w: number, h: number): boolean {
    const world = this.game.sim.world;
    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) {
        if (!world.inBounds(x + dx, y + dy)) return false;
        const i = world.idx(x + dx, y + dy);
        if (world.roads[i] !== 0 || world.buildingAt[i]! >= 0) return false;
      }
    }
    return true;
  }
}
