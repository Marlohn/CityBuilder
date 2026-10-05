/**
 * Sinais: o que o jogo mediu e pode virar item do roadmap (fontes 1 a 5 da seção 12.2 do plano).
 * Tudo aqui é função pura sobre um jogo já rodado, para ser testável sem rodar cidades grandes.
 */
import { checkInvariants, type Game, statsView } from "@city/sim";
import type { ReferenceItem, RoadmapConfig } from "./config";
import type { Category, Signal } from "./types";

type RunSignal = Omit<Signal, "seen" | "runs">;

/** Números da cidade num formato plano. É contra isso que a métrica de sucesso dos itens é conferida. */
export function metricsOf(game: Game): Record<string, number> {
  const s = statsView(game);
  const { city, sim } = game;
  const m: Record<string, number> = {
    population: s.population,
    households: s.households,
    money: s.money,
    employed: s.employed,
    unemployed: s.unemployed,
    vacantHomes: s.vacantHomes,
    vacantJobs: s.vacantJobs,
    buildings: sim.buildings.count,
    cars: s.cars,
    "lastYear.births": city.lastYear.births,
    "lastYear.deaths": city.lastYear.deaths,
    "lastYear.arrivals": city.lastYear.arrivals,
    "lastYear.departures": city.lastYear.departures,
    "lastYear.migrantsTurnedAway": Object.values(city.lastYear.migrantsTurnedAway).reduce((a, b) => a + b, 0),
    "perf.msPerTick": s.perf.msPerTick,
    invariantViolations: checkInvariants(city, 1000).length,
  };
  for (const [k, v] of Object.entries(s.unmet)) m[`unmet.${k}`] = v;
  for (const r of s.realism) if (r.value !== null) m[`realism.${r.id}`] = r.value;
  for (const [k, v] of Object.entries(sim.perf.peak)) m[`perf.peak.${k}`] = v;
  return m;
}

/** Pessoas vivas com idade entre lo e hi (inclusive). */
export function countAges(game: Game, lo: number, hi: number): number {
  const { pop } = game.city;
  const clock = game.sim.clock;
  let n = 0;
  for (let id = 0; id < pop.count; id++) {
    if (!pop.isAlive(id)) continue;
    const a = clock.ageOf(pop.birthTick[id]!);
    if (a >= lo && a <= hi) n++;
  }
  return n;
}

function reachOf(game: Game, kind: ReferenceItem["reach"]): number {
  const s = statsView(game);
  if (kind === "children0to3") return countAges(game, 0, 3);
  if (kind === "youth18to24") return countAges(game, 18, 24);
  if (kind === "households") return s.households;
  return s.population;
}

function fmt(v: number): string {
  return Math.round(v)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

export interface InfantMortalitySample {
  births: number;
  infantDeaths: number;
  population: number;
}

/** Taxa agregada (por mil) ou null quando a soma ainda não tem amostra suficiente. */
export function aggregateInfantMortalityValue(
  samples: InfantMortalitySample[],
  minBirths: number,
): number | null {
  let births = 0;
  let infantDeaths = 0;
  for (const s of samples) {
    births += s.births;
    infantDeaths += s.infantDeaths;
  }
  if (samples.length === 0 || births < minBirths) return null;
  return Math.round((infantDeaths / births) * 1000 * 100) / 100;
}

/** Receita real de municípios pequenos: base para conferir a economia do jogo. */
const SMALL_TOWN_REVENUE = {
  source:
    "Municípios com até 5 mil habitantes: receita externa média ~R$ 10.886 por habitante, a maior parte do FPM (Gazeta do Povo; Jornal da USP: municípios pequenos recebem mais por habitante)",
  url: "https://jornal.usp.br/radio-usp/municipios-pequenos-recebem-mais-recursos-per-capita-que-metropoles-com-maiores-desafios-urbanos/",
};

/** Desejos não atendidos (fonte 1). `ref` liga o desejo a uma linha da tabela de referência. */
const DESIRES: {
  key: string;
  what: string;
  ref?: string;
  impact: number;
  /** Proposta quando o serviço ainda não existe no jogo. */
  build?: string;
}[] = [
  { key: "school", what: "crianças de 6 a 17 anos sem vaga em escola", ref: "escola", impact: 2 },
  {
    key: "university",
    what: "jovens querendo fazer faculdade sem faculdade na cidade",
    ref: "faculdade",
    impact: 2,
    build: "Criar a faculdade (prédio, vagas, formação que muda renda e emprego).",
  },
  { key: "health", what: "pessoas sem UBS", ref: "ubs", impact: 3 },
  // O hospital já existe no jogo (prédio `hospital`, service health): é desejo de balanceamento, não serviço faltante.
  { key: "hospital", what: "pessoas sem leito de internação no hospital", ref: "hospital", impact: 3 },
  { key: "housing", what: "famílias esperando casa própria", impact: 1 },
  { key: "water", what: "pessoas morando em prédio sem água", ref: "agua", impact: 3 },
  { key: "power", what: "pessoas morando em prédio sem luz", ref: "energia", impact: 3 },
  {
    key: "transit",
    what: "recusas de emprego por distância sem carro (último ano)",
    ref: "transporte_publico",
    impact: 2,
    build: "Criar ônibus: linhas, pontos, frota com dono (a prefeitura ou empresa), passageiros reais.",
  },
  {
    key: "parking",
    what: "vezes que alguém não achou vaga para estacionar (último ano)",
    impact: 0.5,
    build: "Estacionamentos e vagas na rua, com capacidade medida.",
  },
];

export function signalsFromRun(
  game: Game,
  cfg: RoadmapConfig,
  reference: ReferenceItem[],
  services: Set<string>,
  /** População no meio da partida (para perceber cidade que parou de crescer). */
  populationMidRun?: number,
): RunSignal[] {
  const out: RunSignal[] = [];
  const s = statsView(game);
  const p = s.population;
  const exists = (r: ReferenceItem) => r.inGame !== "" && services.has(r.inGame);
  const covered = new Set<string>();

  // 1. Desejos não atendidos.
  for (const d of DESIRES) {
    const value = (s.unmet as unknown as Record<string, number>)[d.key] ?? 0;
    if (p === 0 || value < p * cfg.thresholds.unmetShare || value === 0) continue;
    const ref = d.ref ? reference.find((r) => r.id === d.ref) : undefined;
    const inGame = ref ? exists(ref) : true;
    if (ref) covered.add(ref.id);
    const category: Category = !inGame && ref ? ref.category : !inGame ? "feature" : "balanceamento";
    out.push({
      id: `desejo:${d.key}`,
      source: "desejo",
      category,
      title: inGame ? `Desejo não atendido: ${d.what}` : `Falta no jogo: ${ref?.label ?? d.what}`,
      detail: `${fmt(value)} ${d.what} numa cidade de ${fmt(p)} pessoas.${
        inGame
          ? " O jogo já tem isso: o problema é o prefeito automático (ou o jogador) não atender, ou falta informação na tela para perceber."
          : " O jogo ainda não tem como atender."
      }`,
      reach: value,
      impact: ref?.impact ?? d.impact,
      evidence: ref ? "dataAndSource" : "opinion",
      urgent: false,
      ...(ref ? { research: { source: ref.source, url: ref.url } } : {}),
      metric: `unmet.${d.key} < ${Math.max(1, Math.round(value * 0.1))}`,
      proposal: inGame
        ? "Ensinar o prefeito automático a atender e mostrar a cobertura no mapa (camada de cobertura)."
        : (d.build ?? `Criar ${ref?.label ?? d.what}.`),
    });
  }

  // 2. Comparação com cidades reais.
  for (const r of reference) {
    if (exists(r) || covered.has(r.id)) continue;
    const big = p >= r.minPopulation;
    if (!big && cfg.targetPopulation < r.minPopulation) continue;
    const measured = reachOf(game, r.reach);
    out.push({
      id: `comparacao:${r.id}`,
      source: "comparacao",
      category: r.category,
      title: `Falta no jogo: ${r.label}`,
      detail: big
        ? `${r.minPopulation <= 1 ? "Toda cidade real tem isso" : `Cidades reais com mais de ${fmt(r.minPopulation)} habitantes têm isso`}; a cidade de teste tem ${fmt(p)} e o jogo não oferece.`
        : `Cidades reais com mais de ${fmt(r.minPopulation)} habitantes têm isso. A cidade de teste tem ${fmt(p)}, mas o jogo promete ${fmt(cfg.targetPopulation)}: vai precisar (alcance = pessoas de hoje).`,
      // Alcance sempre medido na cidade de teste (nunca projetado): quem ainda não precisa conta menos.
      reach: measured,
      impact: r.impact,
      evidence: big ? "dataAndSource" : "sourceOnly",
      urgent: false,
      research: { source: r.source, url: r.url },
      proposal: `Criar ${r.label.toLowerCase()} (pesquisar como funciona e o custo real antes).`,
    });
  }

  // 3. Placar de realismo.
  for (const r of game.realism) {
    if (r.status !== "low" && r.status !== "high") continue;
    out.push({
      id: `realismo:${r.id}`,
      source: "realismo",
      category: "realismo",
      title: `Realismo: ${r.label} ${r.status === "low" ? "abaixo" : "acima"} da vida real`,
      detail: `Na cidade: ${r.value} ${r.unit}. Na vida real: ${r.min} a ${r.max}.`,
      reach: p,
      impact: r.id === "lifeExpectancy" || r.id === "infantMortality" ? 2 : 1,
      evidence: "dataAndSource",
      urgent: false,
      research: { source: r.source },
      metric: `realism.${r.id} entre ${r.min} e ${r.max}`,
      proposal: "Achar a regra que gera esse número (relatório + log) e corrigir com base na fonte.",
    });
  }

  // 4. Partida do prefeito automático.
  if (s.money < 0) {
    out.push({
      id: "bot:falencia",
      source: "bot",
      category: "balanceamento",
      title: "Prefeitura termina no vermelho",
      detail: `Saldo final R$ ${fmt(s.money)}. Receita no último ano R$ ${fmt(s.lastYearRevenue)}, despesa R$ ${fmt(s.lastYearExpenses)}.`,
      reach: p,
      impact: 1,
      evidence: "dataAndSource",
      urgent: false,
      research: SMALL_TOWN_REVENUE,
      metric: "money > 0",
      proposal: "Rever impostos e custos de manutenção com dados reais de orçamento municipal (STN/Siconfi).",
    });
  }
  const turned = Object.entries(game.city.lastYear.migrantsTurnedAway);
  const turnedTotal = turned.reduce((a, [, v]) => a + v, 0);
  const arrivals = game.city.lastYear.arrivals;
  if (turnedTotal > 0 && turnedTotal >= Math.max(1, arrivals) * cfg.thresholds.migrantsTurnedAwayShare) {
    out.push({
      id: "bot:migrantes-desistiram",
      source: "bot",
      category: "balanceamento",
      title: "Famílias desistem de vir morar na cidade",
      detail: `No último ano, ${fmt(turnedTotal)} famílias desistiram (${turned.map(([k, v]) => `${k}=${v}`).join(", ")}) e ${fmt(arrivals)} chegaram.`,
      reach: turnedTotal,
      impact: 1,
      evidence: "opinion",
      urgent: false,
      metric: `lastYear.migrantsTurnedAway < ${Math.max(1, Math.round(turnedTotal * 0.3))}`,
      proposal: "Ver o motivo mais comum e ajustar a oferta (casas/empregos) ou a regra de chegada.",
    });
  }

  const homesWanted = game.growth.demand.homes;
  if (
    populationMidRun !== undefined &&
    populationMidRun > 0 &&
    p <= populationMidRun * 1.05 &&
    homesWanted > 0
  ) {
    const t = game.sim.treasury;
    out.push({
      id: "bot:cidade-parou",
      source: "bot",
      category: "balanceamento",
      title: "A cidade para de crescer",
      detail: `População no meio da partida ${fmt(populationMidRun)}, no fim ${fmt(p)}, com demanda de ${fmt(homesWanted)} casas. Saldo R$ ${fmt(t.money)}; último ano: receita R$ ${fmt(t.lastYearRevenue)}, despesa R$ ${fmt(t.lastYearExpenses)} (${Object.entries(
        t.expenses,
      )
        .map(([k, v]) => `${k} R$ ${fmt(v)}`)
        .join(", ")} no ano atual).`,
      reach: p,
      impact: 2,
      evidence: "dataAndSource",
      urgent: false,
      research: SMALL_TOWN_REVENUE,
      metric: `population > ${Math.round(populationMidRun * 1.2)}`,
      proposal:
        "Descobrir o que trava (dinheiro, demanda, lotes) e comparar receita e despesa com dados reais de municípios do mesmo tamanho (Siconfi/FINBRA).",
    });
  }

  // 5. Saúde técnica.
  const violations = checkInvariants(game.city, 20);
  if (violations.length > 0) {
    out.push({
      id: "saude:regras-quebradas",
      source: "saude-tecnica",
      category: "correcao",
      title: "Regras que nunca podem quebrar quebraram",
      detail: violations.slice(0, 5).join(" | "),
      reach: p,
      impact: 3,
      evidence: "dataAndSource",
      urgent: true,
      metric: "invariantViolations = 0",
      proposal: "Reproduzir com o replay da semente e corrigir a causa (não o sintoma).",
    });
  }
  const msPerDay = s.perf.msPerTick * game.sim.clock.ticksPerDay;
  const budget = game.sim.config.time.realSecondsPerDayAt1x * 1000 * cfg.thresholds.perfShareOfRealTime;
  if (msPerDay > budget) {
    out.push({
      id: "saude:performance",
      source: "saude-tecnica",
      category: "performance",
      title: "Simulação pesada demais para a velocidade 1x",
      detail: `Um dia do jogo leva ${fmt(msPerDay)} ms de processamento; o limite é ${fmt(budget)} ms.`,
      reach: p,
      impact: 2,
      evidence: "dataAndSource",
      urgent: true,
      metric: `perf.msPerTick < ${(budget / game.sim.clock.ticksPerDay).toFixed(3)}`,
      proposal: "Ver o sistema mais pesado no relatório (ms por sistema) e o contador de trabalho que subiu.",
    });
  }
  return out;
}

/** Junta os sinais de várias cidades: mesmo id vira um sinal só, com alcance médio. */
export function mergeRuns(perRun: RunSignal[][]): Signal[] {
  const runs = perRun.length;
  const byId = new Map<string, Signal>();
  for (const list of perRun) {
    for (const sig of list) {
      const prev = byId.get(sig.id);
      if (!prev) {
        byId.set(sig.id, { ...sig, reach: sig.reach / runs, seen: 1, runs });
      } else {
        prev.reach += sig.reach / runs;
        prev.seen++;
        prev.urgent ||= sig.urgent;
      }
    }
  }
  // O mesmo assunto medido de dois jeitos (desejo e comparação) vira um sinal só: fica o desejo,
  // que tem o número medido das pessoas.
  for (const d of DESIRES) if (d.ref && byId.has(`desejo:${d.key}`)) byId.delete(`comparacao:${d.ref}`);
  const out = [...byId.values()];
  for (const s of out) {
    s.reach = Math.round(s.reach);
    if (s.seen < runs)
      s.detail += ` (apareceu em ${s.seen} de ${runs} cidades de teste; números de uma delas)`;
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

/** Valores da config ainda sem fonte (marcados PENDENTE). Um sinal por arquivo. */
export function pendingSignals(configTexts: Record<string, string>, population: number): Signal[] {
  const out: Signal[] = [];
  for (const [file, text] of Object.entries(configTexts).sort(([a], [b]) => a.localeCompare(b))) {
    const lines = text
      .split("\n")
      .map((l, i) => ({ l: l.trim(), n: i + 1 }))
      .filter((x) => x.l.includes("PENDENTE"));
    if (lines.length === 0) continue;
    out.push({
      id: `pendente:${file}`,
      source: "pendente",
      category: "realismo",
      title: `Valores sem fonte em config/${file} (${lines.length})`,
      detail: lines
        .slice(0, 4)
        .map((x) => `linha ${x.n}: ${x.l.replace(/^#\s*/, "")}`)
        .join(" | "),
      reach: population,
      impact: 0.5,
      evidence: "opinion",
      urgent: false,
      seen: 1,
      runs: 1,
      proposal: "Pesquisar fonte real para cada valor PENDENTE e trocar o comentário pela fonte.",
    });
  }
  return out;
}

/** Média das métricas entre as cidades de teste. */
export function averageMetrics(list: Record<string, number>[]): Record<string, number> {
  const sum: Record<string, number> = {};
  const count: Record<string, number> = {};
  for (const m of list)
    for (const [k, v] of Object.entries(m)) {
      sum[k] = (sum[k] ?? 0) + v;
      count[k] = (count[k] ?? 0) + 1;
    }
  const out: Record<string, number> = {};
  for (const k of Object.keys(sum).sort()) out[k] = Math.round((sum[k]! / count[k]!) * 1000) / 1000;
  return out;
}
