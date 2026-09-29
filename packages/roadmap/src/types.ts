/** Tipos do motor de roadmap. Veja docs/PLANO.md seção 12.2. */

export type Category =
  | "feature"
  | "construcao"
  | "correcao"
  | "realismo"
  | "balanceamento"
  | "performance"
  | "saude-tecnica";

/** Grupos usados na mistura garantida de cada ciclo. */
export type Group = "features" | "fixes" | "tech";

export const GROUP_OF: Record<Category, Group> = {
  feature: "features",
  construcao: "features",
  correcao: "fixes",
  realismo: "fixes",
  balanceamento: "fixes",
  performance: "tech",
  "saude-tecnica": "tech",
};

/** De onde veio o sinal (as fontes 1 a 5 da seção 12.2). */
export type SignalSource = "desejo" | "comparacao" | "realismo" | "bot" | "saude-tecnica" | "pendente";

/** Uma coisa que o jogo mediu e que pode virar item do roadmap. */
export interface Signal {
  /** Estável entre execuções (ex.: "desejo:university"). É o que o item cita no campo "Sinal de origem". */
  id: string;
  source: SignalSource;
  category: Category;
  title: string;
  /** Explicação com os números medidos. */
  detail: string;
  /** Pessoas afetadas (média entre as cidades de teste). */
  reach: number;
  /** 3 = vida ou morte, 2 = alto, 1 = médio, 0,5 = baixo, 0,25 = estética. */
  impact: number;
  /** Dado do jogo + fonte real, só fonte, ou só opinião. */
  evidence: "dataAndSource" | "sourceOnly" | "opinion";
  /** Bug, regra quebrada, piora de performance: passa na frente de tudo. */
  urgent: boolean;
  /** Em quantas cidades de teste apareceu (de quantas). */
  seen: number;
  runs: number;
  research?: { source: string; url?: string };
  /** Métrica de sucesso sugerida (mesmo formato do campo do item). */
  metric?: string;
  /** Proposta sugerida para o Designer. */
  proposal?: string;
}

/** Resultado de `npm run roadmap:signals`. */
export interface SignalsFile {
  generatedAt: string;
  runs: { name: string; seed: string; days: number; population: number }[];
  /** Média das métricas entre as cidades de teste (é contra isso que a métrica de sucesso é conferida). */
  metrics: Record<string, number>;
  signals: Signal[];
}

/** Issue do GitHub no formato mínimo que o motor usa. */
export interface IssueInput {
  number: number;
  title: string;
  body: string;
  labels: string[];
  state: "open" | "closed";
  url?: string;
}

/** Item do roadmap lido de uma issue (formulário "Item do roadmap"). */
export interface Item {
  number: number;
  title: string;
  url?: string;
  labels: string[];
  category: Category | null;
  problem: string;
  research: string;
  proposal: string;
  metric: string;
  reach: number | null;
  impact: number | null;
  /** 1, 0,8 ou 0,5. */
  confidence: number | null;
  effort: number | null;
  deps: number[];
  signal: string;
  /** Veio de uma ideia do dono (etiqueta "do-dono"). */
  owner: boolean;
  /** Etiqueta "bug": passa na frente. */
  bug: boolean;
  /** Etiqueta "entregue": o motor confere a métrica. */
  delivered: boolean;
}
