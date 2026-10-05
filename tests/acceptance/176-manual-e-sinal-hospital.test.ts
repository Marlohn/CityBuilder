/**
 * Teste de aceitação da issue #176 (papel QA).
 *
 * O hospital já funciona no jogo (leitos contam em `unmet.hospital`, issues
 * #173 e #174), mas o motor de roadmap ainda anuncia "falta no jogo:
 * Hospital" e o manual não lista o hospital para o jogador. A tarefa pede:
 * documentar o hospital em `docs/MANUAL.md` (seção Serviços, com fonte),
 * marcar `inGame: hospital` no item `hospital` de
 * `data/reference/cidade-real.yaml` e acrescentar a entrada do desejo
 * `hospital` (com `ref: "hospital"`, sem `build:`) em `DESIRES`
 * (`packages/roadmap/src/signals.ts`).
 *
 * Atenção (achado do QA): em `data/buildings.yaml` o hospital tem
 * `service: health`, o mesmo da UBS. Então `inGame: hospital` na tabela de
 * referência sozinho NÃO basta: `exists()` (signals.ts) compara com o conjunto
 * de `service` montado por `collect.ts`, e "hospital" nunca aparece nele. Para
 * o critério 1 valer, `inGame` precisa casar com o que o jogo oferece (id do
 * prédio ou outro tipo de serviço), não só trocar a string.
 *
 * Este teste deve falhar na `main` porque a referência ainda tem
 * `inGame: ""` (o sinal `comparacao:hospital` aparece mesmo com hospital),
 * `DESIRES` não tem a entrada `hospital` (o sinal `desejo:hospital` não
 * existe) e a seção Serviços do manual só lista Escola e UBS.
 *
 * Cenário: cidade com hospital de verdade (semente fixa, sem relógio, sem
 * `Math.random`). A UBS do cenário é demolida (`bulldoze` em x 73-74,
 * y 141-142, como no teste 173) com `health.maxDistanceMeters: 200`. Para o
 * sinal de desejo, a fila `seekHospital` é controlada explicitamente: depois da
 * #241 `withoutHospital` mede essa fila real, não toda a população sem leito.
 * Cada variante de cidade é simulada uma única vez (`Map` memoizado no arquivo).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadConfigAndData, ROOT } from "@city/cli";
import type { Command } from "@city/contract";
import { parseReference, parseRoadmapConfig, type RoadmapConfig, signalsFromRun } from "@city/roadmap";
import { currentCensus, type Game, reportText, statsView } from "@city/sim";
import { describe, expect, it } from "vitest";
import { createTestGame } from "../helpers";

/** Semente fixa única do arquivo (nada de relógio nem `Math.random`). */
const SEED = "sinal-hospital-roadmap";
/** Dias de jogo (o hospital leva 30 meses de obra = 2,5 dias, então 40 basta). */
const DAYS = 40;

/** Demole a UBS do cenário (x de 73 a 74, y de 141 a 142, como no teste 173). */
const BULLDOZE_UBS: Command = { type: "bulldoze", x0: 73, y0: 141, x1: 74, y1: 142 };

/** Quatro hospitais lado a lado (mesmos do teste 173, para ter leito de sobra). */
const HOSPITAL_COMMANDS: Command[] = [
  { type: "placeService", service: "hospital", x: 76, y: 141 },
  { type: "placeService", service: "hospital", x: 84, y: 141 },
  { type: "placeService", service: "hospital", x: 92, y: 141 },
  { type: "placeService", service: "hospital", x: 100, y: 141 },
];

/** Config do motor de roadmap (a mesma do `npm run roadmap:build`). */
const cfg: RoadmapConfig = parseRoadmapConfig(readFileSync(join(ROOT, "roadmap", "config.yaml"), "utf8"));

/** Tabela de referência das cidades reais (a mesma do `npm run roadmap:build`). */
const reference = parseReference(readFileSync(join(ROOT, "data", "reference", "cidade-real.yaml"), "utf8"));

/** Serviços que o jogo oferece (montado como o `collect.ts` faz). */
const services: Set<string> = (() => {
  const { data } = loadConfigAndData();
  const out = new Set<string>();
  for (const b of data.buildings) if (b.service) out.add(b.service);
  return out;
})();

/** Tira acento e põe em minúscula, para achar "Hospital" em qualquer grafia. */
function semAcento(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

/** Cidade com hospital já rodada (não roda a mesma cidade duas vezes). */
const jogos = new Map<string, Game>();

function cidadeComHospital(chave = "com-hospital"): Game {
  const pronto = jogos.get(chave);
  if (pronto) return pronto;
  const game = createTestGame({
    seed: SEED,
    scenario: "bairro-basico",
    days: DAYS,
    overrides: { economy: { mode: "sandbox" }, health: { maxDistanceMeters: 200 } },
    commands: [BULLDOZE_UBS, ...HOSPITAL_COMMANDS],
  });
  jogos.set(chave, game);
  return game;
}

/**
 * Cenário controlado da #241: mantém hospital ativo, mas força demanda hospitalar
 * suficiente para o sinal do roadmap. A fila é montada antes da primeira leitura
 * do censo deste Game, evitando o cache por tick de currentCensus.
 */
function cidadeComDemandaHospital(): { game: Game; population: number; waiting: number } {
  const game = cidadeComHospital("com-demanda-hospital");
  const city = game.city;

  for (const p of city.seekHospital.toArray()) city.seekHospital.delete(p);

  let population = 0;
  for (let p = 0; p < city.pop.count; p++) if (city.pop.status[p] === 1) population++;

  const target = Math.max(2, Math.ceil(population * cfg.thresholds.unmetShare));
  expect(
    target,
    `o limiar do roadmap (${target}) precisa ser menor que a população (${population})`,
  ).toBeLessThan(population);

  for (let p = 0; p < city.pop.count && city.seekHospital.size < target; p++) {
    if (city.pop.status[p] !== 1) continue;
    if (city.pop.hospital[p]! >= 0) continue;
    if (city.homeAccess(p) < 0) continue;
    city.seekHospital.add(p);
  }

  expect(
    city.seekHospital.size,
    `o cenário precisa de ${target} pessoas vivas, com casa e sem leito para montar a fila real`,
  ).toBe(target);

  return { game, population, waiting: city.seekHospital.size };
}

describe("issue #176: manual e sinal de roadmap do hospital", () => {
  it("não gera mais sinal de falta no jogo para hospital numa cidade que tem hospital", () => {
    const game = cidadeComHospital();
    const sinais = signalsFromRun(game, cfg, reference, services);
    const porId = sinais.filter((s) => s.id === "comparacao:hospital");
    expect(
      porId,
      `o sinal \`comparacao:hospital\` ("Falta no jogo: Hospital") apareceu mesmo com 4 ` +
        `hospitais na cidade: data/reference/cidade-real.yaml precisa de \`inGame: hospital\` ` +
        `no item \`hospital\` para o prédio que já existe no jogo`,
    ).toHaveLength(0);
    // O título de "falta no jogo" é o que o roadmap mostra ao jogador; um sinal de desejo
    // pode (e deve) citar o hospital no texto. Então o filtro é pelo título de falta.
    const peloTitulo = sinais.filter(
      (s) => semAcento(s.title).includes("falta no jogo") && semAcento(s.title).includes("hospital"),
    );
    expect(
      peloTitulo.map((s) => s.id),
      `algum sinal ainda anuncia "falta no jogo" de hospital (${peloTitulo
        .map((s) => `"${s.title}"`)
        .join(", ")}): data/reference/cidade-real.yaml precisa de \`inGame: hospital\` no ` +
        `item \`hospital\` para o prédio que já existe no jogo`,
    ).toHaveLength(0);
  });

  it("o sinal desejo:hospital usa a fila real numa cidade que já tem hospital", () => {
    const { game, population, waiting } = cidadeComDemandaHospital();
    const census = currentCensus(game);
    const semLeito = statsView(game).unmet.hospital;

    // Regressão da #241: a fonte é a fila de internação, não toda pessoa sem leito.
    expect(census.population).toBe(population);
    expect(
      census.withoutHospital,
      `withoutHospital deveria ser a fila seekHospital (${waiting}), mas veio ${census.withoutHospital}`,
    ).toBe(waiting);
    expect(semLeito).toBe(waiting);
    expect(semLeito).toBeLessThan(population);
    const noRelatorio = new Intl.NumberFormat("pt-BR").format(waiting);
    expect(reportText(game)).toContain(`sem hospital: ${noRelatorio}`);

    expect(
      semLeito,
      `há só ${semLeito} pessoas na fila de internação numa cidade de ${population}: abaixo de ` +
        `population * thresholds.unmetShare (${population} * ${cfg.thresholds.unmetShare}) ` +
        `o sinal é ignorado, então o cenário não prova nada`,
    ).toBeGreaterThanOrEqual(population * cfg.thresholds.unmetShare);

    const sinais = signalsFromRun(game, cfg, reference, services);
    const sinal = sinais.find((s) => s.id === "desejo:hospital");
    expect(
      sinal,
      `o sinal \`desejo:hospital\` não apareceu mesmo com ${semLeito} pessoas na fila de internação: ` +
        `packages/roadmap/src/signals.ts precisa medir o desejo \`hospital\``,
    ).toBeDefined();
    if (!sinal) return;
    expect(
      sinal.category,
      `o sinal \`desejo:hospital\` veio com categoria "${sinal.category}": o serviço já ` +
        `existe no jogo, então a categoria tem que ser "balanceamento"`,
    ).toBe("balanceamento");
    expect(
      semAcento(sinal.title).includes("falta no jogo"),
      `o sinal \`desejo:hospital\` veio com título de falta ("${sinal.title}"): o serviço ` +
        `já existe no jogo, o título tem que ser de desejo não atendido`,
    ).toBe(false);
    expect(
      sinal.impact,
      `o sinal \`desejo:hospital\` veio com impacto ${sinal.impact}: o item \`hospital\` da ` +
        `tabela de referência tem impacto 3`,
    ).toBe(3);
  });

  it("a seção Serviços do manual lista o hospital com fonte", () => {
    const manual = readFileSync(join(ROOT, "docs", "MANUAL.md"), "utf8");
    const inicio = manual.indexOf("## Serviços");
    expect(
      inicio,
      `docs/MANUAL.md não tem a seção "## Serviços": sem ela o jogador não acha o hospital`,
    ).toBeGreaterThanOrEqual(0);
    const resto = manual.slice(inicio);
    const fimRelativo = resto.slice("## Serviços".length).search(/\n## /);
    const secao = fimRelativo < 0 ? resto : resto.slice(0, "## Serviços".length + fimRelativo);
    const linhas = secao.split("\n").filter((l) => l.startsWith("-"));
    const linha = linhas.find((l) => semAcento(l).includes("ospital"));
    expect(
      linha,
      `a seção Serviços de docs/MANUAL.md não tem nenhuma linha de bullet falando do ` +
        `hospital (só ${linhas.length} bullets): o manual tem que listar o hospital para o jogador`,
    ).toBeDefined();
    if (!linha) return;
    expect(
      semAcento(linha).includes("leito"),
      `a linha do hospital no manual ("${linha.trim()}") não fala de "leito": o manual ` +
        `tem que explicar os leitos de internação (o número novo no relatório e no painel)`,
    ).toBe(true);
    expect(
      /https?:\/\//.test(linha) || /https?:\/\//.test(secao),
      `a linha do hospital no manual ("${linha.trim()}") não traz fonte: a seção tem que ` +
        `trazer um link http(s) com a fonte do número (como as outras regras do jogo)`,
    ).toBe(true);
  });
});
