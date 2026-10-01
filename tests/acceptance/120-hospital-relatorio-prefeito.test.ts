/**
 * Issue #120 — censo, relatório e prefeito: desejo não atendido "hospital" e construção automática.
 *
 * A main já tem a issue #119 (motor do hospital: `pop.hospital`, `withoutHospital` no censo,
 * `samples.hospital`). O que falta hoje na main (conferido no código em 01/10/2026):
 * - `packages/sim/src/view/stats.ts`: `unmet` NÃO tem a chave `hospital` (hoje só tem `health`
 *   = pessoas sem UBS, de `withoutClinic`), e não expõe contagem de leitos totais e ocupados.
 * - `packages/sim/src/view/report.ts`: a linha de "Desejos não atendidos" NÃO fala de
 *   "sem hospital" nem de leitos (só "sem UBS").
 * - `packages/bots/src/mayor.ts`: `placeServiceNearDemand(service: "escola" | "ubs")` só sabe
 *   colocar "escola" e "ubs", disparando com `census.childrenWithoutSchool > 150` /
 *   `census.withoutClinic > 500`; nunca constrói "hospital". A referência
 *   `data/reference/cidade-real.yaml` tem o item `hospital` com `minPopulation: 8000`
 *   (`inGame: ""`) e o prédio `hospital` com `patients: 90` já existe em `data/buildings.yaml`.
 *
 * Por que cada `it` existe (um por critério da issue):
 * 1. Censo e stats: `unmet.hospital` tem que ser exatamente o `withoutHospital` do censo
 *    (prova que o stat é o desejo real, não um número solto), `unmet.health` continua sendo
 *    o `withoutClinic` (a chave antiga não pode ter sido reaproveitada) e os leitos totais
 *    e ocupados aparecem no stats.
 * 2. Relatório: o texto mostra "sem hospital" com o mesmo número do stat/censo, mostra os
 *    leitos (total e ocupados) e continua mostrando "sem UBS" (não pode ter sumido).
 * 3. Prefeito: em cidade grande (> 8.000 hab) o bot constrói pelo menos 1 hospital ao
 *    alcance de quem está sem leito, sem quebrar invariantes.
 *
 * Cidade do teste: `createTestGame({ seed: "hospital-relatorio-prefeito", scenario: "estresse",
 * days: 40, bot: true })` (cidade grande; o cenário estresse já põe `economy: sandbox`, então
 * o prefeito tem dinheiro). Observado em 01/10/2026: população 20.800 no dia 40, ou seja,
 * bem acima dos 8.000 do `minPopulation` do hospital. Reproduzir com:
 * `npm run sim -- report --scenario=estresse --bot --seed=hospital-relatorio-prefeito --days=40`.
 *
 * Semente fixa, sem relógio, sem `Math.random`, sem medir tempo em ms. As cidades ficam num
 * `Map` memoizado para não rodar a mesma simulação cara do cenário estresse duas vezes.
 */
import { loadConfigAndData, loadScenario, runGame } from "@city/cli";
import { BSTATE, checkInvariants, currentCensus, type Game, reportText, statsView } from "@city/sim";
import { describe, expect, it } from "vitest";
import { createTestGame } from "../helpers";

/** Semente fixa do arquivo (nada de relógio nem `Math.random`). */
const SEED = "hospital-relatorio-prefeito";
/** Dias da cidade grande (o prefeito precisa de tempo para passar de 8.000 hab). */
const DAYS = 40;

/** Cidades já rodadas (não roda a mesma cidade duas vezes). */
const jogos = new Map<string, Game>();

/** Cidade grande do teste: bot ligado, cenário estresse, dinheiro sandbox (vem do cenário). */
function cidadeGrande(): Game {
  const pronta = jogos.get("grande");
  if (pronta) return pronta;
  const game = createTestGame({ seed: SEED, scenario: "estresse", days: DAYS, bot: true });
  jogos.set("grande", game);
  return game;
}

/**
 * Segunda cidade COM hospital colocado por comando, para conferir a contagem de leitos quando
 * a cidade grande ainda não tem nenhum hospital (total 0). Usa o cenário bairro-basico com os
 * mesmos pontos com via dos testes 118/119 (quatro hospitais em x=76, 84, 92 e 100, y=141,
 * encostados na via de y=140) e 30 dias (a obra do hospital leva 30 meses = 2,5 dias, então
 * aos 30 dias os hospitais já estão ativos). A comparação aqui é justificada: ela só roda
 * como reserva quando a cidade grande não tem hospital, e só prova a contagem de leitos
 * (total >= 1 e ocupados <= total), nunca população nem prefeito.
 */
function cidadeComHospital(): Game {
  const pronta = jogos.get("com-hospital");
  if (pronta) return pronta;
  const scenario = loadScenario("bairro-basico");
  const { config, data } = loadConfigAndData({
    ...scenario.overrides,
    economy: { mode: "sandbox" },
  });
  const game = runGame({
    config,
    data,
    seed: "hospital-relatorio-prefeito-com-hospital",
    days: 30,
    scenario,
    commands: [
      { type: "placeService", service: "hospital", x: 76, y: 141 },
      { type: "placeService", service: "hospital", x: 84, y: 141 },
      { type: "placeService", service: "hospital", x: 92, y: 141 },
      { type: "placeService", service: "hospital", x: 100, y: 141 },
    ],
  });
  jogos.set("com-hospital", game);
  return game;
}

/** Prédios de um tipo do catálogo que não foram demolidos (valem como "existe"). */
function prediosDoTipo(game: Game, id: string): number[] {
  const b = game.sim.buildings;
  const out: number[] = [];
  for (let i = 0; i < b.count; i++) {
    if (b.typeOf(i).id !== id || b.state[i] === BSTATE.demolished) continue;
    out.push(i);
  }
  return out;
}

/** Número em português do relatório ("1.287" = 1287). */
function parsePt(s: string): number {
  return Number(s.replace(/\./g, ""));
}

/**
 * Extrai (total, ocupados) de leitos do objeto do stats.
 *
 * Os caminhos candidatos abaixo são tentativa porque o contrato (`packages/contract/src/view.ts`)
 * ainda não define o nome do campo de leitos: o teste aceita o par em qualquer um desses
 * lugares (nível de cima e dentro de `unmet`/`utilities`), como objeto `{ total, occupied }`
 * (ou sinônimos como `{ capacity, used }` / `{ leitos, ocupados }`) ou como par `[total,
 * ocupados]`. Número sozinho NÃO vale: `unmet.hospital` (quando existir) é a contagem de
 * pessoas sem hospital, não a contagem de leitos, então valores numéricos puros são ignorados
 * aqui de propósito.
 */
function extraiLeitos(stats: unknown): { total: number; occupied: number; path: string } | null {
  const caminhos = [
    "hospitalBeds",
    "healthBeds",
    "beds",
    "leitos",
    "hospital",
    "unmet.hospitalBeds",
    "unmet.healthBeds",
    "unmet.beds",
    "unmet.leitos",
    "utilities.hospitalBeds",
    "utilities.healthBeds",
    "utilities.beds",
    "utilities.leitos",
    "utilities.hospital",
  ];
  const totais = ["total", "capacity", "leitos", "totalBeds"];
  const ocupados = ["occupied", "used", "ocupados", "occupiedBeds", "pacientes", "patients"];
  const pega = (obj: unknown, caminho: string): unknown => {
    let atual: unknown = obj;
    for (const parte of caminho.split(".")) {
      if (atual === null || typeof atual !== "object") return undefined;
      atual = (atual as Record<string, unknown>)[parte];
    }
    return atual;
  };
  for (const caminho of caminhos) {
    // Pula `unmet.hospital` numérico: é o desejo não atendido, não os leitos.
    if (caminho === "unmet.hospital") continue;
    const valor = pega(stats, caminho);
    if (Array.isArray(valor) && valor.length >= 2 && valor.every((v) => typeof v === "number")) {
      return { total: valor[0] as number, occupied: valor[1] as number, path: caminho };
    }
    if (valor !== null && typeof valor === "object" && !Array.isArray(valor)) {
      const rec = valor as Record<string, unknown>;
      const chaveTotal = totais.find((k) => typeof rec[k] === "number");
      const chaveOcup = ocupados.find((k) => typeof rec[k] === "number");
      if (chaveTotal !== undefined && chaveOcup !== undefined) {
        return { total: rec[chaveTotal] as number, occupied: rec[chaveOcup] as number, path: caminho };
      }
    }
  }
  return null;
}

/** Lista os caminhos candidatos tentados por `extraiLeitos` (para a mensagem de erro). */
function caminhosTentados(): string {
  return [
    "hospitalBeds",
    "healthBeds",
    "beds",
    "leitos",
    "hospital",
    "unmet.hospitalBeds",
    "unmet.healthBeds",
    "unmet.beds",
    "unmet.leitos",
    "utilities.hospitalBeds",
    "utilities.healthBeds",
    "utilities.beds",
    "utilities.leitos",
    "utilities.hospital",
  ].join(", ");
}

describe("issue #120: censo, relatório e prefeito para o desejo não atendido 'hospital'", () => {
  it("censo e stats: desejo não atendido 'hospital' e leitos", { timeout: 600000 }, () => {
    const game = cidadeGrande();
    const census = currentCensus(game);
    expect(
      census.population,
      `a cidade grande do teste deveria passar de 8.000 hab (minPopulation do hospital em ` +
        `data/reference/cidade-real.yaml), mas tem ${census.population}: sem cidade grande ` +
        `o teste não prova nada`,
    ).toBeGreaterThan(8000);
    const stats = statsView(game) as unknown as { unmet: Record<string, number> };
    // a) `unmet.hospital` é exatamente o `withoutHospital` do censo da #119.
    expect(
      typeof stats.unmet.hospital,
      `o stats ainda não tem a chave unmet.hospital (packages/sim/src/view/stats.ts só tem ` +
        `health = sem UBS): sem ela a tela não sabe quanta gente está sem hospital`,
    ).toBe("number");
    if (typeof stats.unmet.hospital !== "number") return;
    expect(
      stats.unmet.hospital,
      `unmet.hospital deveria valer exatamente o withoutHospital do censo ` +
        `(${census.withoutHospital}), mas vale ${stats.unmet.hospital}: o stat não é o desejo real`,
    ).toBe(census.withoutHospital);
    // b) `unmet.health` continua sendo o sem-UBS (`withoutClinic`): a chave antiga não
    // pode ter sido reaproveitada para o hospital.
    expect(
      stats.unmet.health,
      `unmet.health deveria continuar sendo o withoutClinic do censo (${census.withoutClinic}), ` +
        `mas vale ${stats.unmet.health}: a chave antiga do sem-UBS foi reaproveitada`,
    ).toBe(census.withoutClinic);
    // c) leitos totais e ocupados expostos no stats (caminhos candidatos porque o contrato
    // ainda não define o nome do campo).
    const leitos = extraiLeitos(stats);
    expect(
      leitos,
      `o stats não expõe leitos totais e ocupados em nenhum dos caminhos candidatos ` +
        `(${caminhosTentados()}): sem a contagem de leitos a tela não sabe se falta leito`,
    ).not.toBeNull();
    if (leitos === null) return;
    expect(
      typeof leitos.total,
      `o total de leitos no stats (caminho ${leitos.path}) deveria ser um número, ` +
        `mas veio ${String(leitos.total)}`,
    ).toBe("number");
    expect(
      leitos.occupied,
      `os leitos ocupados (${leitos.occupied}, caminho ${leitos.path}) não podem passar do ` +
        `total (${leitos.total}): a conta de ocupação está errada`,
    ).toBeLessThanOrEqual(leitos.total);
    // O total tem que bater com a capacidade real dos hospitais ativos da cidade (0 se não há
    // nenhum): senão é um número solto e a tela mostra cobertura de leito errada.
    const bs = game.sim.buildings;
    let capacidade = 0;
    for (let i = 0; i < bs.count; i++) {
      if (bs.typeOf(i).id !== "hospital" || bs.state[i] !== BSTATE.active) continue;
      capacidade += bs.patientsCapacity(i);
    }
    expect(
      leitos.total,
      `o total de leitos no stats (caminho ${leitos.path}) é ${leitos.total}, mas a soma das ` +
        `capacidades dos hospitais ativos é ${capacidade}: o número exposto não bate com os ` +
        `leitos que existem na cidade`,
    ).toBeGreaterThanOrEqual(capacidade);
    if (leitos.total === 0) {
      // Sem hospital na cidade grande o total é 0: repete a conferência na cidade COM
      // hospital (reserva justificada no comentário de `cidadeComHospital`).
      const game2 = cidadeComHospital();
      const stats2 = statsView(game2) as unknown as Record<string, unknown>;
      const leitos2 = extraiLeitos(stats2);
      expect(
        leitos2,
        `nem na cidade COM hospital (bairro-basico com 4 hospitais via placeService em ` +
          `x=76, 84, 92 e 100, y=141) o stats expõe leitos em nenhum dos caminhos candidatos ` +
          `(${caminhosTentados()})`,
      ).not.toBeNull();
      if (leitos2 === null) return;
      expect(
        leitos2.total,
        `na cidade COM hospital o total de leitos (caminho ${leitos2.path}) deveria ser ` +
          `>= 1, mas veio ${leitos2.total}`,
      ).toBeGreaterThanOrEqual(1);
      // O total tem que bater com a capacidade real dos hospitais ativos, senão é um número solto.
      const bs2 = game2.sim.buildings;
      let capacidade2 = 0;
      for (let i = 0; i < bs2.count; i++) {
        if (bs2.typeOf(i).id !== "hospital" || bs2.state[i] !== BSTATE.active) continue;
        capacidade2 += bs2.patientsCapacity(i);
      }
      expect(
        capacidade2,
        `a cidade de reserva deveria ter pelo menos 1 hospital ativo (4 hospitais via placeService ` +
          `em x=76, 84, 92 e 100, y=141, no bairro-basico), mas a capacidade soma ` +
          `${capacidade2}: sem hospital ativo o total de leitos não pode ser conferido`,
      ).toBeGreaterThan(0);
      expect(
        leitos2.total,
        `o total de leitos no stats (caminho ${leitos2.path}) é ${leitos2.total}, mas a soma das ` +
          `capacidades dos hospitais ativos é ${capacidade2}: o número ` +
          `exposto não bate com os leitos que existem na cidade`,
      ).toBeGreaterThanOrEqual(capacidade2);
      expect(
        leitos2.occupied,
        `na cidade COM hospital os leitos ocupados (${leitos2.occupied}, caminho ` +
          `${leitos2.path}) não podem passar do total (${leitos2.total})`,
      ).toBeLessThanOrEqual(leitos2.total);
    }
  });

  it("relatório mostra 'sem hospital' e os leitos quando faltam leitos", { timeout: 600000 }, () => {
    const game = cidadeGrande();
    const census = currentCensus(game);
    const stats = statsView(game) as unknown as { unmet: Record<string, number> };
    const texto = reportText(game);
    // a) o relatório fala de "sem hospital" (hoje só fala de "sem UBS").
    expect(
      texto.toLowerCase().includes("sem hospital"),
      `o relatório deveria conter "sem hospital" (packages/sim/src/view/report.ts só mostra ` +
        `"sem UBS" na linha de Desejos não atendidos):\n${texto}`,
    ).toBe(true);
    // b) o número de "sem hospital" no texto é o mesmo do stat/censo (regex tolerante a
    // separador de milhar: o relatório usa ponto, ex.: "1.287").
    const achado = texto.match(/sem hospital[^0-9]*([\d.]+)/i);
    expect(
      achado !== null,
      `o relatório fala de "sem hospital" mas sem número junto (esperado algo como ` +
        `"sem hospital: 1.287"):\n${texto}`,
    ).toBe(true);
    if (achado === null) return;
    const noTexto = parsePt(achado[1]!);
    const esperado = typeof stats.unmet.hospital === "number" ? stats.unmet.hospital : census.withoutHospital;
    expect(
      noTexto,
      `o número de "sem hospital" no relatório (${achado[1]}) deveria ser o mesmo que ` +
        `unmet.hospital/withoutHospital (${esperado})`,
    ).toBe(esperado);
    // c) o texto menciona leitos com total e ocupados (dois números na mesma linha com
    // "leito") e, na cidade com hospital, o total é >= 1.
    const linhasComLeito = texto.split("\n").filter((l) => /leito/i.test(l));
    expect(
      linhasComLeito.length,
      `o relatório deveria mencionar leitos (total e ocupados) quando faltam leitos, ` +
        `mas nenhuma linha contém "leito":\n${texto}`,
    ).toBeGreaterThanOrEqual(1);
    if (linhasComLeito.length === 0) return;
    const comDoisNumeros = linhasComLeito.filter((l) => (l.match(/[\d.]+/g) ?? []).length >= 2);
    expect(
      comDoisNumeros.length,
      `a linha de leitos deveria trazer total e ocupados (dois números na mesma linha), ` +
        `mas as linhas com "leito" só têm:\n${linhasComLeito.join("\n")}`,
    ).toBeGreaterThanOrEqual(1);
    const textoComHospital = reportText(cidadeComHospital());
    const linhas2 = textoComHospital.split("\n").filter((l) => /leito/i.test(l));
    expect(
      linhas2.length,
      `na cidade COM hospital o relatório também deveria mencionar leitos, mas nenhuma ` +
        `linha contém "leito":\n${textoComHospital}`,
    ).toBeGreaterThanOrEqual(1);
    if (linhas2.length === 0) return;
    const numeros2 = (linhas2.join(" ").match(/[\d.]+/g) ?? []).map(parsePt);
    expect(
      numeros2.some((v) => v >= 1),
      `na cidade COM hospital o total de leitos no relatório deveria ser >= 1, mas os ` +
        `números nas linhas com "leito" são [${numeros2.join(", ")}]:\n${linhas2.join("\n")}`,
    ).toBe(true);
    // d) a linha de Desejos não atendidos continua mostrando "sem UBS".
    expect(
      texto.includes("sem UBS"),
      `a linha de Desejos não atendidos não pode ter perdido o "sem UBS" ao ganhar o ` +
        `"sem hospital":\n${texto}`,
    ).toBe(true);
  });

  it("prefeito automático constrói hospital em cidade grande (> 8.000 hab)", { timeout: 600000 }, () => {
    const game = cidadeGrande();
    const census = currentCensus(game);
    // a) sem mais de 8.000 hab o critério não prova nada (minPopulation do hospital).
    expect(
      census.population,
      `a cidade do prefeito deveria ter mais de 8.000 hab (minPopulation do hospital em ` +
        `data/reference/cidade-real.yaml), mas tem ${census.population}: sem cidade grande ` +
        `o teste não prova nada`,
    ).toBeGreaterThan(8000);
    // b) pelo menos 1 hospital não demolido (colocado pelo prefeito; hoje são 0 porque o
    // prefeito de packages/bots/src/mayor.ts só sabe colocar escola e ubs).
    const b = game.sim.buildings;
    let todos = 0;
    for (let i = 0; i < b.count; i++) if (b.typeOf(i).id === "hospital") todos++;
    const hospitais = prediosDoTipo(game, "hospital");
    expect(
      hospitais.length,
      todos > 0
        ? `a cidade tem ${todos} prédio(s) do tipo hospital mas todos estão demolidos ` +
            `(state demolished): demolição não conta como construir`
        : `o prefeito não construiu nenhum hospital em ${DAYS} dias numa cidade de ` +
            `${census.population} hab (packages/bots/src/mayor.ts só coloca escola e ubs)`,
    ).toBeGreaterThanOrEqual(1);
    if (hospitais.length === 0) return;
    // c) o hospital está ao alcance de quem está sem leito: para pelo menos uma pessoa viva
    // com `pop.hospital[p] < 0` que tenha casa, a distância em linha reta (manhattanMeters,
    // como nos testes 118/119) até o hospital é <= hospitalMaxDistanceMeters.
    const pop = game.city.pop as unknown as { hospital?: Int32Array };
    expect(
      pop.hospital instanceof Int32Array,
      `sem o campo pop.hospital (issue #119, packages/sim/src/people/population.ts) não dá ` +
        `para saber quem está sem leito`,
    ).toBe(true);
    if (!(pop.hospital instanceof Int32Array)) return;
    const maxDist = game.sim.config.health.hospitalMaxDistanceMeters;
    let semLeitoComCasa = 0;
    let aoAlcance = 0;
    const city = game.city;
    for (let p = 0; p < city.pop.count; p++) {
      if (city.pop.status[p] !== 1) continue; // 1 = vivo (PSTATUS.alive)
      if (pop.hospital[p]! >= 0) continue;
      const lar = city.homeBuilding(p);
      if (lar < 0) continue;
      semLeitoComCasa++;
      const de = b.access[lar]!;
      for (const h of hospitais) {
        const dist = game.sim.world.manhattanMeters(de, b.access[h]!);
        if (dist <= maxDist) {
          aoAlcance++;
          break;
        }
      }
      if (aoAlcance > 0) break;
    }
    expect(
      semLeitoComCasa,
      `a cidade de ${census.population} hab não tem ninguém vivo sem leito (pop.hospital < 0) ` +
        `com casa no dia ${DAYS}: sem gente sem leito o teste de alcance não prova nada`,
    ).toBeGreaterThan(0);
    if (semLeitoComCasa === 0) return;
    expect(
      aoAlcance,
      `nenhuma das pessoas sem leito está a até ${maxDist} m (hospitalMaxDistanceMeters) de ` +
        `um dos ${hospitais.length} hospitais do prefeito: o hospital foi construído longe ` +
        `de quem precisa`,
    ).toBeGreaterThanOrEqual(1);
    // d) nada quebra junto.
    expect(checkInvariants(game.city), `regras que nunca podem quebrar foram violadas`).toEqual([]);
  });
});
