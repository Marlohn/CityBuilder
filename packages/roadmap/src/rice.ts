/**
 * Ordenação do roadmap: fórmula RICE + regras por cima (seção 12.2 do plano).
 * A conta é feita aqui, não pelo LLM: o agente só preenche os campos.
 */
import type { RoadmapConfig } from "./config";
import { isValidMetric } from "./metric";
import { GROUP_OF, type Group, type Item, type Signal, type SignalsFile } from "./types";

export interface Ranked {
  item: Item;
  score: number;
  /** Explica a conta, para quem lê o roadmap. */
  why: string;
  urgent: boolean;
  /** Issues abertas que precisam vir antes. */
  blockedBy: number[];
}

export interface Incomplete {
  item: Item;
  missing: string[];
}

export function rice(reach: number, impact: number, confidence: number, effort: number): number {
  return (reach * impact * confidence) / Math.max(0.5, effort);
}

function fmt(v: number): string {
  return v >= 100
    ? Math.round(v).toLocaleString("pt-BR")
    : String(Math.round(v * 100) / 100).replace(".", ",");
}

/** O que falta para o item entrar na fila. Sem fonte e sem métrica, não entra (proteção contra "viagem"). */
export function missingFields(item: Item, signals: SignalsFile | null): string[] {
  const miss: string[] = [];
  if (!item.category) miss.push("categoria");
  if (!/https?:\/\//.test(item.research)) miss.push("pesquisa com link da fonte");
  if (!item.metric) miss.push("métrica de sucesso");
  else {
    const err = isValidMetric(item.metric, signals?.metrics);
    if (err) miss.push(`métrica válida (${err})`);
  }
  const fromSignal = signals?.signals.find((s) => s.id === item.signal);
  if (item.reach === null && !fromSignal) miss.push("alcance (ou um sinal de origem que exista)");
  if (item.impact === null) miss.push("impacto");
  if (item.confidence === null) miss.push("confiança");
  return miss;
}

export function scoreItem(item: Item, cfg: RoadmapConfig, signals: SignalsFile | null): Ranked {
  const sig = signals?.signals.find((s) => s.id === item.signal);
  const reach = item.reach ?? sig?.reach ?? 0;
  const impact = item.impact ?? 1;
  const confidence = item.confidence ?? cfg.confidence.opinion;
  const effort = item.effort ?? cfg.defaultEffort;
  let score = rice(reach, impact, confidence, effort);
  const parts = [
    `alcance ${fmt(reach)}${item.reach === null ? " (do sinal)" : ""}`,
    `impacto ${fmt(impact)}`,
    `confiança ${Math.round(confidence * 100)}%`,
    `esforço ${fmt(effort)}${item.effort === null ? " (padrão, falta estimar)" : ""}`,
  ];
  if (item.owner) {
    score *= 1 + cfg.ownerBoost;
    parts.push(`ideia do dono +${Math.round(cfg.ownerBoost * 100)}%`);
  }
  const urgent =
    item.bug ||
    (!!sig?.urgent && (item.category === "correcao" || GROUP_OF[item.category ?? "feature"] === "tech"));
  return { item, score, why: parts.join(" · "), urgent, blockedBy: [] };
}

export function scoreSignal(sig: Signal, cfg: RoadmapConfig): number {
  return rice(sig.reach, sig.impact, cfg.confidence[sig.evidence], cfg.defaultEffort);
}

export interface Plan {
  now: Ranked[];
  next: Ranked[];
  later: Ranked[];
  blocked: Ranked[];
}

/**
 * Regras por cima da fórmula:
 * 1. Urgentes (bug, regra quebrada, piora de performance) passam na frente de tudo.
 * 2. Item bloqueado espera; a dependência herda a nota de quem ela bloqueia (sobe na fila).
 * 3. "Agora" tem mistura garantida por grupo (features / correções / técnico).
 */
export function plan(ranked: Ranked[], cfg: RoadmapConfig): Plan {
  const open = new Map(ranked.map((r) => [r.item.number, r]));
  for (const r of ranked) r.blockedBy = r.item.deps.filter((d) => open.has(d));
  // Dependência sobe: herda a maior nota entre quem depende dela (repete para cadeias).
  for (let pass = 0; pass < ranked.length; pass++) {
    let changed = false;
    for (const r of ranked) {
      for (const d of r.blockedBy) {
        const dep = open.get(d)!;
        if (dep.score < r.score) {
          dep.score = r.score;
          dep.why += ` · sobe: bloqueia #${r.item.number}`;
          changed = true;
        }
        if (r.urgent && !dep.urgent) {
          dep.urgent = true;
          changed = true;
        }
      }
    }
    if (!changed) break;
  }
  const byScore = (a: Ranked, b: Ranked) => b.score - a.score || a.item.number - b.item.number;
  const blocked = ranked.filter((r) => r.blockedBy.length > 0).sort(byScore);
  const ready = ranked.filter((r) => r.blockedBy.length === 0);
  const urgent = ready.filter((r) => r.urgent).sort(byScore);
  const rest = ready.filter((r) => !r.urgent).sort(byScore);

  const now: Ranked[] = [...urgent];
  const slots = Math.max(0, cfg.nowSize - now.length);
  const totalShare = cfg.mix.features + cfg.mix.fixes + cfg.mix.tech || 1;
  const taken = new Set<Ranked>();
  for (const g of ["features", "fixes", "tech"] as Group[]) {
    const quota = Math.round((slots * cfg.mix[g]) / totalShare);
    for (const r of rest.filter((x) => GROUP_OF[x.item.category!] === g).slice(0, quota)) taken.add(r);
  }
  // Sobrou vaga (grupo sem itens suficientes): completa com os melhores.
  for (const r of rest) if (taken.size < slots && !taken.has(r)) taken.add(r);
  now.push(...rest.filter((r) => taken.has(r)));
  const remaining = rest.filter((r) => !taken.has(r));
  return {
    now,
    next: remaining.slice(0, cfg.nextSize),
    later: remaining.slice(cfg.nextSize),
    blocked,
  };
}
