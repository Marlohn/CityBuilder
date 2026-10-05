/** Monta o ROADMAP.md a partir das issues e dos sinais. Função pura: mesma entrada = mesmo texto. */
import type { RoadmapConfig } from "./config";
import { isRoadmapItem, parseItem } from "./items";
import { checkMetric, type MetricCheck } from "./metric";
import { type Incomplete, missingFields, type Plan, plan, type Ranked, scoreItem, scoreSignal } from "./rice";
import type { IssueInput, Item, Signal, SignalsFile } from "./types";

export interface Delivery {
  item: Item;
  check: MetricCheck | null;
  error?: string;
}

export interface Roadmap {
  plan: Plan;
  incomplete: Incomplete[];
  ideas: IssueInput[];
  /** Sinais que nenhum item aberto cita: serve como fila de candidatos para priorização. */
  unlinked: { signal: Signal; score: number }[];
  deliveries: Delivery[];
}

export function computeRoadmap(
  issues: IssueInput[],
  signals: SignalsFile | null,
  cfg: RoadmapConfig,
  testExists?: (path: string) => boolean,
): Roadmap {
  const open = issues.filter((i) => i.state === "open");
  const openNumbers = new Set(open.map((i) => i.number));
  const items = issues.filter(isRoadmapItem).map(parseItem);
  const deliveries: Delivery[] = items
    .filter((i) => openNumbers.has(i.number) && i.delivered && i.metric)
    .map((item) => {
      if (!signals) return { item, check: null, error: "sem sinais medidos" };
      try {
        return { item, check: checkMetric(item.metric, signals.metrics, testExists) };
      } catch (e) {
        return { item, check: null, error: (e as Error).message };
      }
    });
  const active = items.filter((i) => openNumbers.has(i.number) && !i.delivered);
  const incomplete: Incomplete[] = [];
  const ranked: Ranked[] = [];
  for (const item of active) {
    const missing = missingFields(item, signals);
    if (missing.length > 0) incomplete.push({ item, missing });
    else ranked.push(scoreItem(item, cfg, signals));
  }
  const cited = new Set(active.map((i) => i.signal).filter(Boolean));
  const unlinked = (signals?.signals ?? [])
    .filter((s) => !cited.has(s.id))
    .map((signal) => ({ signal, score: scoreSignal(signal, cfg) }))
    .sort((a, b) => Number(b.signal.urgent) - Number(a.signal.urgent) || b.score - a.score);
  const ideas = open.filter((i) => i.labels.includes("ideia") && !isRoadmapItem(i));
  return { plan: plan(ranked, cfg, openNumbers), incomplete, ideas, unlinked, deliveries };
}

function n(v: number): string {
  return Math.round(v).toLocaleString("pt-BR");
}

function link(item: Item): string {
  return item.url ? `[#${item.number}](${item.url})` : `#${item.number}`;
}

function rankedTable(list: Ranked[], withBlock = false): string[] {
  if (list.length === 0) return ["_Nada aqui._", ""];
  const out = [
    `| # | Item | Categoria | Nota | Por quê${withBlock ? " | Esperando" : ""} |`,
    `|---|---|---|---|---${withBlock ? "|---" : ""}|`,
  ];
  for (const r of list) {
    const flag = r.urgent ? "🚨 " : "";
    const block = withBlock ? ` | ${r.blockedBy.map((d) => `#${d}`).join(", ")}` : "";
    out.push(
      `| ${link(r.item)} | ${flag}${r.item.title.replace(/\|/g, "/")} | ${r.item.category} | ${n(r.score)} | ${r.why}${block} |`,
    );
  }
  out.push("");
  return out;
}

export function renderRoadmap(r: Roadmap, signals: SignalsFile | null, cfg: RoadmapConfig): string {
  const L: string[] = [];
  L.push("# Roadmap");
  L.push("");
  L.push(
    "> Gerado por `npm run roadmap:build`. Não edite à mão: mude as issues e rode de novo. Como funciona: docs/PLANO.md, seção 12.2.",
  );
  L.push(">");
  L.push(
    "> Nota = (alcance × impacto × confiança) ÷ esforço. 🚨 = urgente (passa na frente). Itens sem os campos mínimos ou sem métrica válida não entram.",
  );
  L.push("");
  if (signals) {
    const pops = signals.runs.map((x) => `${x.name} ${n(x.population)}`).join(", ");
    L.push(
      `Sinais medidos em ${signals.generatedAt.slice(0, 10)} em ${signals.runs.length} cidades de teste (${pops} pessoas).`,
    );
  } else {
    L.push("Sem sinais medidos: rode `npm run roadmap:signals`.");
  }
  L.push("");
  const mix = `${Math.round(cfg.mix.features * 100)}% features/construções, ${Math.round(cfg.mix.fixes * 100)}% correções/realismo, ${Math.round(cfg.mix.tech * 100)}% técnico`;
  L.push(`## Agora (até ${cfg.nowSize} itens; mistura: ${mix})`);
  L.push("");
  L.push(...rankedTable(r.plan.now));
  L.push("## Próximo");
  L.push("");
  L.push(...rankedTable(r.plan.next));
  L.push("## Depois");
  L.push("");
  L.push(...rankedTable(r.plan.later));
  L.push("## Bloqueados (esperando dependência)");
  L.push("");
  L.push(...rankedTable(r.plan.blocked, true));

  L.push("## Entregues: conferência da métrica");
  L.push("");
  if (r.deliveries.length === 0) L.push("_Nada entregue esperando conferência._");
  for (const d of r.deliveries) {
    const res = d.check
      ? d.check.ok
        ? `✅ resolveu (${d.check.id} = ${d.check.value}) — pode fechar`
        : `❌ não resolveu (${d.check.id} = ${d.check.value ?? "sem dado"}; esperado ${d.check.expected}) — volta com a etiqueta \`não-resolveu\``
      : `⚠️ não deu para conferir: ${d.error}`;
    L.push(`- ${link(d.item)} ${d.item.title}: ${res}`);
  }
  L.push("");

  L.push("## Incompletos (falta campo obrigatório)");
  L.push("");
  if (r.incomplete.length === 0) L.push("_Nenhum._");
  for (const x of r.incomplete) L.push(`- ${link(x.item)} ${x.item.title}: falta ${x.missing.join(", ")}`);
  L.push("");

  L.push("## Ideias aguardando triagem");
  L.push("");
  if (r.ideas.length === 0) L.push('_Nenhuma. Abra uma issue com o formulário "Ideia"._');
  for (const i of r.ideas) L.push(`- ${i.url ? `[#${i.number}](${i.url})` : `#${i.number}`} ${i.title}`);
  L.push("");

  const renderSignals = (items: Roadmap["unlinked"]) => {
    if (items.length === 0) {
      L.push("_Nenhum._");
      L.push("");
      return;
    }
    for (const { signal: s, score } of items) {
      L.push(`### ${s.urgent ? "🚨 " : ""}${s.title}`);
      L.push("");
      L.push(`- **Sinal:** \`${s.id}\` · categoria ${s.category} · nota provisória ${n(score)}`);
      L.push(`- **Medido:** ${s.detail}`);
      L.push(
        `- **Alcance:** ${n(s.reach)} pessoas · impacto ${String(s.impact).replace(".", ",")} · prova: ${
          s.evidence === "dataAndSource"
            ? "dado do jogo + fonte"
            : s.evidence === "sourceOnly"
              ? "só fonte"
              : "só dado do jogo, falta fonte"
        }`,
      );
      if (s.research)
        L.push(`- **Fonte:** ${s.research.source}${s.research.url ? ` (${s.research.url})` : ""}`);
      if (s.proposal) L.push(`- **Sugestão:** ${s.proposal}`);
      if (s.metric) L.push(`- **Métrica sugerida:** \`${s.metric}\``);
      L.push("");
    }
  };

  const productSignals = r.unlinked.filter(({ signal }) => signal.source !== "pendente");
  const pendingResearch = r.unlinked.filter(({ signal }) => signal.source === "pendente");

  L.push("## Sinais de produto sem item (candidatos ao roadmap)");
  L.push("");
  L.push(
    'Medidos pelo jogo e ainda não viraram issue. A nota é provisória (esforço padrão). Para criar o item, use o formulário "Item do roadmap" e cite o id no campo "Sinal de origem".',
  );
  L.push("");
  renderSignals(productSignals);

  L.push("## Pesquisa e calibração pendente");
  L.push("");
  L.push(
    "Valores de config ainda sem fonte ou decisão explícita. Continuam visíveis, mas ficam separados das escolhas de produto.",
  );
  L.push("");
  renderSignals(pendingResearch);
  return `${L.join("\n").trimEnd()}\n`;
}
