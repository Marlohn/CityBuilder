// @vitest-environment jsdom
/**
 * Teste de aceitação da missão "Estrada de acesso visível e aviso de rua desconectada".
 *
 * Um `it` por critério (AC1..AC4). Hoje os quatro falham:
 *  - AC1: nada diz onde fica a avenida de acesso do oeste (só a aba Ajuda) e a câmera começa no
 *    meio do mapa, longe dela;
 *  - AC2: terminar uma via solta devolve `reason` vazio, então nenhum aviso aparece;
 *  - AC3: (depende do sim, que já funciona) a via ligada faz a cidade crescer;
 *  - AC4: o aviso de via desconectada não existe; o de serviço sem encostar em via existe e vem
 *    pelo mesmo canal (CommandResult.reason -> aviso da tela).
 *
 * Cenário: mapa 128 x 128 (avenida de acesso na linha y = 64, x de 0 a 47) com semente fixa.
 * A rua "solta" fica em y = 60 (longe da avenida) e é ligada depois por uma via de 3 quadradinhos.
 */
import { loadConfigAndData } from "@city/cli";
import type { CommandResult } from "@city/contract";
import { createGame, mapView, statsView } from "@city/sim";
import { App, type GameClient, Store } from "@city/ui";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { accessRoadHighlight } from "../../packages/render/src/accessRoad";
import { startTarget } from "../../packages/render/src/camera";
import { toolDefs } from "../../packages/web/src/tools";

// @city/cli lê config/data do disco via files.ts (import.meta.url), o que não funciona no
// jsdom. O mock lê os mesmos arquivos com a mesma regra, sem mudar o que o teste importa.
vi.mock("@city/cli", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const sim = await import("@city/sim");
  const bots = await import("@city/bots");
  const run = await import("../../packages/cli/src/run");
  const root = process.cwd();
  function readDir(dir: string, exts: string[]): Record<string, string> {
    const out: Record<string, string> = {};
    for (const f of fs.readdirSync(path.join(root, dir))) {
      if (exts.some((e) => f.endsWith(e))) out[f] = fs.readFileSync(path.join(root, dir, f), "utf8");
    }
    return out;
  }
  function loadConfigAndData(overrides?: unknown) {
    const config = sim.parseGameConfig(readDir("config", [".yaml"]), overrides);
    const data = sim.parseGameData(readDir("data", [".yaml", ".json"]), config);
    return { config, data };
  }
  function loadScenario(name: string) {
    return bots.parseScenario(fs.readFileSync(path.join(root, "scenarios", `${name}.yaml`), "utf8"));
  }
  return { loadConfigAndData, loadScenario, runGame: run.runGame, createRun: run.createRun };
});

const PEQUENO = { world: { width: 128, height: 128 } };
const LINHA = 64; // linha do meio do mapa 128: onde a avenida de acesso entra pelo oeste.
const AVENIDA_X1 = 47; // config/world.yaml: startingRoad.length = 48, começando em x = 0.

const { config, data } = loadConfigAndData();
const pequeno = loadConfigAndData(PEQUENO);

/** Cidade nova, com a avenida de acesso já posta (nada construído). */
function cidade(seed: string, cfg = pequeno.config) {
  return createGame({ config: cfg, data, seed });
}

/** Aplica um comando no próximo tick e devolve o resultado que a tela receberia. */
function aplicar(game: ReturnType<typeof cidade>, c: Parameters<typeof game.sim.enqueue>[0]) {
  game.sim.enqueue(c);
  game.sim.step();
  const [resultado] = game.sim.drainResults();
  return resultado as CommandResult;
}

/** Casas que se apoiam na via da linha `y` (o acesso delas é a via encostada). */
function casasNaLinha(game: ReturnType<typeof cidade>, y: number) {
  let n = 0;
  for (let b = 0; b < game.sim.buildings.count; b++) {
    if (game.sim.buildings.state[b] !== 1) continue;
    if (game.sim.world.yOf(game.sim.buildings.access[b]!) === y) n++;
  }
  return n;
}

describe("missão: estrada de acesso visível e aviso de via desconectada", () => {
  it("AC1: a partida mostra onde fica a avenida de acesso do oeste (mapa destacado, câmera e painel)", () => {
    const game = cidade("acesso-visivel");
    const map = mapView(game.sim.world, game.sim.accessRoad);
    expect(
      map.accessRoad,
      "a visão do mapa não diz onde está a avenida de acesso: o jogo precisa publicar o retângulo " +
        "dela (MapView.accessRoad) para a tela poder destacar a estrada de acesso",
    ).toBeTruthy();
    const rect = map.accessRoad!;
    expect(rect.x0, "a avenida de acesso tem que sair da borda oeste (x = 0)").toBe(0);
    expect(rect.y0, "a avenida de acesso tem que estar na linha do meio do mapa").toBe(LINHA);
    expect(rect.x1, "a avenida de acesso tem o comprimento da config (48 quadradinhos)").toBe(AVENIDA_X1);

    // O chão pinta o destaque onde a avenida passa (e a faixa ao lado, que fica visível).
    const mask = accessRoadHighlight(map.accessRoad, map.width, map.height);
    const em = (x: number, y: number) => mask[y * map.width + x];
    expect(em(0, LINHA), "o primeiro quadradinho da avenida de acesso tem que estar destacado").toBeGreaterThan(0);
    expect(em(20, LINHA), "a avenida de acesso tem que estar destacada no meio dela").toBeGreaterThan(0);
    expect(
      em(20, LINHA - 1),
      "a faixa ao lado da avenida de acesso também tem que estar destacada (o modelo 3D da via " +
        "cobre o quadradinho, então o aviso precisa aparecer na faixa vizinha)",
    ).toBeGreaterThan(0);
    expect(em(20, LINHA + 1), "a faixa ao sul da avenida também tem que estar destacada").toBeGreaterThan(0);
    expect(em(90, 20), "uma via qualquer não pode entrar no destaque").toBe(0);

    // A câmera começa olhando a avenida de acesso, não o meio vazio do mapa.
    const alvo = startTarget(map.accessRoad, map.width, map.height);
    expect(alvo.z, "a câmera começa na linha da avenida de acesso").toBe(LINHA);
    expect(
      Math.abs(alvo.x - AVENIDA_X1),
      `a câmera começa na ponta leste da avenida de acesso (x perto de ${AVENIDA_X1}), veio ${alvo.x}`,
    ).toBeLessThanOrEqual(16);
    expect(
      startTarget(undefined, map.width, map.height),
      "sem avenida de acesso a câmera continua no meio do mapa",
    ).toEqual({ x: map.width / 2, z: map.height / 2 });
  });

  it("AC2: terminar uma via que não se liga à avenida de acesso devolve aviso ao jogador", () => {
    const game = cidade("via-solta");
    const r = aplicar(game, { type: "buildRoad", kind: "street", x0: 44, y0: 60, x1: 64, y1: 60 });
    expect(r.ok, `a via solta tem que ser construída mesmo assim (motivo: ${r.reason ?? "-"})`).toBe(true);
    expect(
      r.reason,
      "terminar uma via que não se liga à avenida de acesso precisa voltar com um aviso no mesmo " +
        "campo (reason) que o aviso de serviço sem encostar em via usa",
    ).toBeTruthy();
    expect(
      r.reason,
      `o aviso "${r.reason}" precisa dizer que a via está desconectada`,
    ).toMatch(/desconectada/i);
    expect(
      r.reason,
      `o aviso "${r.reason}" precisa dizer que nada será construído enquanto ela estiver desconectada`,
    ).toMatch(/nada ser[aá] constru[ií]do/i);
    expect(
      r.reason,
      `o aviso "${r.reason}" precisa dizer o que fazer (ligar na avenida de acesso)`,
    ).toMatch(/avenida de acesso/i);
  });

  it("AC3: depois de ligar a via na avenida o aviso some e a zona ao lado ganha casas e moradores", () => {
    const game = cidade("via-ligada");
    aplicar(game, { type: "buildRoad", kind: "street", x0: 44, y0: 60, x1: 64, y1: 60 });
    aplicar(game, { type: "zone", zone: "residential_low", x0: 45, y0: 58, x1: 64, y1: 59 });
    game.sim.step(8 * game.sim.clock.ticksPerDay);
    expect(
      casasNaLinha(game, 60),
      "enquanto a via estiver solta nenhuma construtora pode começar ali (é a regra que trava a partida)",
    ).toBe(0);
    expect(statsView(game).population, "cidade parada: sem ligação com fora ninguém chega").toBe(0);

    // Liga a via na avenida de acesso com uma via de 3 quadradinhos.
    const ligacao = aplicar(game, { type: "buildRoad", kind: "street", x0: 44, y0: 61, x1: 44, y1: 64 });
    expect(ligacao.ok, `a via de ligação tem que ser construída (motivo: ${ligacao.reason ?? "-"})`).toBe(true);
    expect(
      ligacao.reason ?? "",
      `a via que se liga na avenida de acesso não pode levar o aviso de desconectada ("${ligacao.reason}")`,
    ).not.toMatch(/desconectada/i);

    game.sim.step(10 * game.sim.clock.ticksPerDay);
    expect(
      casasNaLinha(game, 60),
      "com a via ligada na avenida de acesso a zona ao lado tem que receber casas",
    ).toBeGreaterThan(0);
    expect(
      statsView(game).population,
      "com a via ligada a população tem que subir no painel (compare com o zero de antes)",
    ).toBeGreaterThan(0);
  });

  it("AC4: os dois avisos (via desconectada e serviço sem via) chegam pelo mesmo canal", async () => {
    const game = cidade("mesmo-canal");
    const via = aplicar(game, { type: "buildRoad", kind: "street", x0: 44, y0: 60, x1: 64, y1: 60 });
    // Subestação longe de qualquer via (mesma situação do aviso que já existe no jogo).
    const servico = aplicar(game, { type: "placeService", service: "substation", x: 100, y: 100 });
    expect(via.reason, "o aviso de via desconectada não veio").toBeTruthy();
    expect(
      servico.reason,
      "o aviso de serviço sem encostar em via precisa continuar existindo (é o formato da casa)",
    ).toMatch(/precisa encostar numa via/i);

    // Os dois são lidos pela tela no mesmo lugar: o aviso que nasce de CommandResult.reason.
    const store = new Store();
    store.set({ stats: statsView(game), ready: true, panelOpen: true });
    await act(async () => {
      store.pushResults([via, servico]);
    });
    const textos = store.get().toasts.map((t) => t.text);
    expect(
      textos.some((t) => t === via.reason),
      `o aviso de via desconectada não apareceu como aviso na tela (avisos: ${textos.join(" | ")})`,
    ).toBe(true);
    expect(
      textos.some((t) => t === servico.reason),
      `o aviso de serviço sem via não apareceu como aviso na tela (avisos: ${textos.join(" | ")})`,
    ).toBe(true);

    // E o painel da Cidade explica a regra da estrada de acesso sem precisar abrir a Ajuda.
    const tools = toolDefs(config, data.buildings);
    const client: GameClient = {
      command: () => {},
      setSpeed: () => {},
      person: async () => null,
      people: async () => ({ total: 0, items: [] }),
      save: async () => "{}",
      load: () => {},
      bugReport: async () => "{}",
    };
    const host = document.createElement("div");
    document.body.appendChild(host);
    let root!: Root;
    await act(async () => {
      root = createRoot(host);
      root.render(createElement(App, { store, client, tools, typeLabels: {} }));
    });
    const painel = (host.textContent ?? "").toLowerCase();
    expect(
      painel,
      "a aba Cidade (que abre junto com a partida) precisa dizer onde fica a avenida de acesso, " +
        "sem o jogador ter que abrir a Ajuda",
    ).toMatch(/acesso/);
    expect(painel, "a dica da aba Cidade precisa apontar o oeste do mapa").toMatch(/oeste/);
    await act(async () => {
      root.unmount();
    });
    host.remove();
  });
});