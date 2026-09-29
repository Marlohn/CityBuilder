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
import type { Command, ZoneKind } from "@city/contract";
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
}

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

  /** Abre um bairro novo encostado nos anteriores, ligado à avenida principal. */
  private buildDistrict(kind: District["kind"]) {
    const w = this.game.sim.world;
    const D = this.opts.district;
    const midY = Math.floor(w.height / 2);
    // Bairros em colunas a partir do fim da estrada de acesso, alternando acima e abaixo da avenida.
    const startX = this.game.sim.config.world.startingRoad.length;
    const x0 = startX + this.col * D;
    const side = this.row % 2 === 0 ? -1 : 1;
    const layer = Math.floor(this.row / 2);
    const y0 = side < 0 ? midY - (layer + 1) * D : midY + 1 + layer * D;
    if (x0 + D >= w.width - 1 || y0 < 1 || y0 + D >= w.height - 1) {
      this.row = 0;
      this.col++;
      if (startX + this.col * D + D >= w.width - 1) return;
      this.buildDistrict(kind);
      return;
    }
    this.districts.push({ x0, y0, kind });
    // Avenida principal até o fim deste bairro.
    this.send({ type: "buildRoad", kind: "avenue", x0: startX - 1, y0: midY, x1: x0 + D, y1: midY });
    // Avenida vertical ligando o bairro à principal.
    this.send({
      type: "buildRoad",
      kind: "avenue",
      x0,
      y0: Math.min(y0, midY),
      x1: x0,
      y1: Math.max(y0 + D, midY),
    });
    // Ruas: horizontais a cada 3 (quarteirão com 2 lotes de fundo), verticais a cada 12.
    for (let y = y0; y <= y0 + D; y += 3)
      this.send({ type: "buildRoad", kind: "street", x0, y0: y, x1: x0 + D, y1: y });
    for (let x = x0; x <= x0 + D; x += 12)
      this.send({ type: "buildRoad", kind: "street", x0: x, y0, x1: x, y1: y0 + D });
    this.send({ type: "buildRoad", kind: "street", x0: x0 + D, y0, x1: x0 + D, y1: y0 + D });
    // Zonas.
    if (kind === "industrial") this.zone("industrial", x0 + 1, y0 + 1, x0 + D - 1, y0 + D - 1);
    else {
      const third = Math.floor(D / 3);
      const r = this.rng.float();
      // Faixa comercial perto da avenida; o resto residencial (parte em prédios).
      const nearAve = side < 0 ? [y0 + D - third, y0 + D - 1] : [y0 + 1, y0 + third];
      const far = side < 0 ? [y0 + 1, y0 + D - third - 1] : [y0 + third + 1, y0 + D - 1];
      this.zone("commercial", x0 + 1, nearAve[0]!, x0 + D - 1, nearAve[1]!);
      const split = x0 + Math.floor(D / 2);
      const hd = this.opts.highDensityShare;
      // Metade oeste: prédios com chance hd; metade leste: prédios só se hd for alto.
      this.zone(r < hd ? "residential_high" : "residential_low", x0 + 1, far[0]!, split, far[1]!);
      this.zone(
        r < hd - 0.5 ? "residential_high" : "residential_low",
        split + 1,
        far[0]!,
        x0 + D - 1,
        far[1]!,
      );
    }
    this.row++;
    if (this.row >= 6) {
      this.row = 0;
      this.col++;
    }
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
