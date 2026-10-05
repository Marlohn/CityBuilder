/**
 * Lê as issues do GitHub. Issues criadas pelo formulário "Item do roadmap" viram itens;
 * issues com a etiqueta "ideia" ficam na fila de triagem.
 * O GitHub grava o formulário como "### <Rótulo>\n\n<resposta>" e "_No response_" quando vazio.
 */
import type { Category, IssueInput, Item } from "./types";

const CATEGORIES: Category[] = [
  "feature",
  "construcao",
  "correcao",
  "realismo",
  "balanceamento",
  "performance",
  "saude-tecnica",
];

function normalize(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

export function formSections(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  const parts = body.split(/^###\s+/m).slice(1);
  for (const part of parts) {
    const nl = part.indexOf("\n");
    const label = normalize(nl === -1 ? part : part.slice(0, nl));
    // Linha "---" encerra o formulário (rodapé de assinatura, comentário extra etc.).
    let value = nl === -1 ? "" : (part.slice(nl + 1).split(/^-{3,}\s*$/m)[0] ?? "").trim();
    if (value === "_No response_" || value === "_Sem resposta_") value = "";
    out[label] = value;
  }
  return out;
}

/** Primeiro número do texto ("3 - vida ou morte" → 3, "4.200 pessoas" → 4200, "80 - só fonte" → 80). */
export function leadingNumber(s: string): number | null {
  const m = /-?\d[\d.]*(,\d+)?/.exec(s.trim());
  if (!m) return null;
  let t = m[0];
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(t)) t = t.replace(/\./g, "").replace(",", ".");
  else t = t.replace(",", ".");
  const v = Number(t);
  return Number.isFinite(v) ? v : null;
}

export function isRoadmapItem(issue: IssueInput): boolean {
  if (issue.labels.includes("roadmap")) return true;
  const s = formSections(issue.body);
  return "metrica de sucesso" in s && "pesquisa" in s;
}

export function parseItem(issue: IssueInput): Item {
  const s = formSections(issue.body);
  const cat = normalize(s.categoria ?? "") as Category;
  const conf = leadingNumber(s.confianca ?? "");
  const deps = [...(s.dependencias ?? "").matchAll(/#(\d+)/g)].map((m) => Number(m[1]));
  return {
    number: issue.number,
    title: issue.title,
    ...(issue.url ? { url: issue.url } : {}),
    labels: issue.labels,
    category: CATEGORIES.includes(cat) ? cat : null,
    problem: s.problema ?? "",
    research: s.pesquisa ?? "",
    proposal: s.proposta ?? "",
    metric: s["metrica de sucesso"] ?? "",
    reach: leadingNumber(s.alcance ?? ""),
    impact: leadingNumber(s.impacto ?? ""),
    confidence: conf === null ? null : conf > 1 ? conf / 100 : conf,
    effort: leadingNumber(s.esforco ?? ""),
    deps,
    signal: (s["sinal de origem"] ?? "").trim(),
    owner: issue.labels.includes("do-dono"),
    bug: issue.labels.includes("bug"),
    delivered: issue.labels.includes("entregue"),
  };
}

/** Converte a resposta da API REST do GitHub (lista de issues) no formato mínimo. Ignora pull requests. */
export function fromGithubApi(raw: unknown[]): IssueInput[] {
  const out: IssueInput[] = [];
  for (const r of raw as Record<string, unknown>[]) {
    if (r.pull_request) continue;
    out.push({
      number: Number(r.number),
      title: String(r.title ?? ""),
      body: String(r.body ?? ""),
      labels: ((r.labels as unknown[]) ?? []).map((l) =>
        typeof l === "string" ? l : String((l as { name?: string }).name ?? ""),
      ),
      state: r.state === "closed" ? "closed" : "open",
      ...(typeof r.html_url === "string" ? { url: r.html_url } : {}),
    });
  }
  return out;
}
