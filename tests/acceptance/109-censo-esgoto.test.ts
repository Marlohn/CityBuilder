/**
 * Censo do esgoto na visão da cidade (issue #109).
 *
 * A #109 só promete a ponta do censo: `withoutSewage` no censo, `samples.sewer` e
 * `unmet.sewer` no contrato/visão. Ela NÃO promete a ETE no catálogo (isso é da #107)
 * nem o `hasSewage` no motor (isso é da #108).
 *
 * Por isso tudo que lê `sewer` vai por cast nominal (`as unknown as {...}`, sem `as any`),
 * igual ao teste 108: compila na main e falha em execução até a #109 existir de verdade.
 *
 * Decisão do `it` da ETE (para ninguém "simplificar" depois): ele monta a malha com poço e
 * subestação, afirma `unmet.sewer > 0` ANTES da ETE (essa asserção já quebra na main pelo
 * motivo certo: `sewer` é `undefined` sem a #109) e só então coloca a ETE com `placeService`.
 * Se o comando da ETE falhar (na main a ETE ainda não está no catálogo: "serviço
 * desconhecido: ete", que só chega com a #107/#108), o `it` afirma `ok` com o motivo lido
 * de `drainResults()` e volta com `return` explícito — ou seja, ele NÃO passa silenciosamente
 * na main, e PASSA quando #107+#108+#109 estiverem mergeadas e a ETE zerar o `unmet.sewer`.
 *
 * Correção do desenho do `it` da ETE (ciclo r2, o PR #199 do Dev mostrou a premissa errada):
 * a malha de `montaMalhaDaEte` não tinha saída para a borda do mapa, então com
 * `growth.requiresOutsideConnection` a construtora não crescia, a população ficava 0 e
 * `unmet.sewer` era 0 antes da ETE por falta de gente, não por falta de esgoto. Agora a
 * malha tem uma rua de apoio até a borda leste e o `residential_low` fica do lado oeste
 * (deixando livre o canto onde a ETE é colocada). Nenhuma `expect` foi afrouxada.
 */
import { type Game, reportText, statsView } from "@city/sim";
import { describe, expect, it } from "vitest";
import { createTestGame } from "../helpers";

interface MalhaEte {
  /** Canto da ETE (3x3) que encosta no rio. */
  x: number;
  y: number;
  /** Rua vertical da malha. */
  X: number;
  /** Rua de serviço (poço e subestação), na outra ponta da malha. */
  Y: number;
}

/**
 * Lê `unmet.sewer` por cast nominal: compila na main (onde o campo ainda não existe) e
 * devolve `undefined` em execução até a #109 criar o campo de verdade. Sem `as any`.
 */
function sewerNaoAtendido(game: Game): number {
  const unmet = statsView(game).unmet as unknown as { sewer: number };
  return unmet.sewer;
}

function stepDays(game: Game, days: number): void {
  game.sim.step(days * game.sim.clock.ticksPerDay);
}

/** Rua + zonas iguais às do teste 108 (rua que chega na borda, casas de um lado). */
function ruaPrincipal(s: Game["sim"]): void {
  s.enqueue({ type: "buildRoad", kind: "street", x0: 30, y0: 24, x1: 30, y1: 64 });
  s.enqueue({ type: "zone", zone: "residential_low", x0: 31, y0: 24, x1: 32, y1: 63 });
  s.enqueue({ type: "zone", zone: "commercial", x0: 28, y0: 24, x1: 29, y1: 63 });
}

/**
 * Ponto seco para a ETE: um retângulo 3x3 seco com água a até 3 quadradinhos de distância,
 * mais as ruas da malha e o lugar do poço e da subestação, tudo seco. Varre o mapa na ordem
 * dos índices, então o ponto é determinístico para a semente. Igual ao teste 108.
 */
function achaPontoDaEte(game: Game): MalhaEte | null {
  const w = game.sim.world;
  const seca = (tx: number, ty: number): boolean => w.inBounds(tx, ty) && !w.water[w.idx(tx, ty)];
  const agua = (tx: number, ty: number): boolean => w.inBounds(tx, ty) && !!w.water[w.idx(tx, ty)];
  for (let i = 0; i < w.size; i++) {
    const x = w.xOf(i);
    const y = w.yOf(i);
    const X = x - 4; // rua vertical da malha
    const Y = y - 14; // rua de serviço, na outra ponta
    if (X < 8 || X + 8 > w.width || Y - 2 < 0 || Y + 16 >= w.height) continue;
    let ok = true;
    for (let ty = y + 1; ok && ty <= y + 3; ty++)
      for (let tx = x - 3; ok && tx <= x - 1; tx++) ok = seca(tx, ty); // ETE 3x3
    if (!ok) continue;
    let perto = false;
    for (let ty = y - 2; !perto && ty <= y + 6; ty++)
      for (let tx = x - 6; !perto && tx <= x + 2; tx++) perto = agua(tx, ty);
    if (!perto) continue;
    for (let ty = Y; ok && ty <= y + 14; ty++) ok = seca(X, ty); // rua vertical
    for (let tx = X; ok && tx <= X + 6; tx++) ok = seca(tx, Y); // rua de serviço
    for (let ty = Y + 1; ok && ty <= Y + 2; ty++) ok = ok && seca(X + 1, ty) && seca(X + 3, ty); // poço e subestação
    if (ok) return { x, y, X, Y };
  }
  return null;
}

/** The ETE mesh: vertical road, zones on both sides and service road on the other end. */
function montaMalhaDaEte(s: Game["sim"], m: MalhaEte): void {
  s.enqueue({ type: "buildRoad", kind: "street", x0: m.X, y0: m.Y, x1: m.X, y1: m.y + 14 });
  s.enqueue({ type: "zone", zone: "residential_low", x0: m.X - 2, y0: m.Y + 1, x1: m.X - 1, y1: m.y + 13 });
  s.enqueue({ type: "zone", zone: "commercial", x0: m.X + 1, y0: m.Y + 1, x1: m.X + 2, y1: m.y + 13 });
  s.enqueue({ type: "buildRoad", kind: "street", x0: m.X, y0: m.Y, x1: m.X + 6, y1: m.Y });
  s.enqueue({ type: "placeService", service: "poco", x: m.X + 1, y: m.Y + 1 });
  s.enqueue({ type: "placeService", service: "subestacao", x: m.X + 3, y: m.Y + 1 });
  // Support road to the east map edge: without an outside connection nothing grows
  // (growth.requiresOutsideConnection), so the city has no people and unmet.sewer is 0.
  s.enqueue({
    type: "buildRoad",
    kind: "street",
    x0: m.X,
    y0: m.y + 14,
    x1: s.world.width - 1,
    y1: m.y + 14,
  });
}

describe("censo do esgoto (issue #109)", () => {
  it("statsView traz unmet.sewer com valor numérico", () => {
    const game = createTestGame({ seed: "avaliacao-livre", days: 30, bot: false });
    const unmet = statsView(game).unmet;
    expect("sewer" in unmet, "statsView tem que trazer unmet.sewer (o censo do esgoto da #109)").toBe(true);
    const sewer = (unmet as unknown as { sewer: unknown }).sewer;
    expect(typeof sewer, "unmet.sewer tem que ser um número, não undefined nem ausente").toBe("number");
  });

  it("sem ETE e com esgoto regional apertado, parte da população fica sem esgoto", () => {
    const game = createTestGame({
      seed: "censo-esgoto-109-sem-ete",
      overrides: {
        world: { width: 128, height: 128, water: { enabled: false } },
        economy: { mode: "sandbox" },
        utilities: {
          regionalWater: 60,
          regionalPower: 60,
          regionalSewage: 15,
          sewageShareOfConsumption: 0.8,
        },
      },
    });
    ruaPrincipal(game.sim);
    stepDays(game, 5);
    const s = statsView(game);
    expect(s.population, "sanidade: tem que ter gente morando na cidade").toBeGreaterThan(0);
    const sewer = sewerNaoAtendido(game);
    expect(
      sewer,
      "com o esgoto regional apertado e sem ETE, alguém tem que estar sem esgoto",
    ).toBeGreaterThan(0);
    expect(
      sewer,
      "quem está sem esgoto mora na cidade: unmet.sewer não pode passar da população",
    ).toBeLessThanOrEqual(s.population);
    expect(
      s.unmet.water + s.unmet.power + sewer,
      "água + luz + esgoto sem atender não podem somar mais gente do que mora na cidade",
    ).toBeLessThanOrEqual(s.population);
  });

  it("colocando uma ETE, unmet.sewer zera no recompute seguinte", () => {
    const game = createTestGame({
      seed: "censo-esgoto-109-ete",
      overrides: {
        world: { width: 128, height: 128 },
        economy: { mode: "sandbox" },
        utilities: {
          regionalWater: 60,
          regionalPower: 60,
          regionalSewage: 15,
          sewageShareOfConsumption: 0.8,
        },
      },
    });
    const malha = achaPontoDaEte(game);
    expect(malha, "a semente tem que ter um ponto seco com água perto para a ETE").not.toBeNull();
    if (!malha) return;
    montaMalhaDaEte(game.sim, malha);
    game.sim.step(1);
    for (const r of game.sim.drainResults()) expect(r.ok, r.reason).toBe(true);
    stepDays(game, 5);
    expect(
      sewerNaoAtendido(game),
      "antes da ETE e com o esgoto regional apertado, alguém tem que estar sem esgoto",
    ).toBeGreaterThan(0);

    game.sim.enqueue({ type: "placeService", service: "ete", x: malha.x - 3, y: malha.y + 1 });
    game.sim.step(1);
    const resultados = game.sim.drainResults();
    const eteOk = resultados.every((r) => r.ok);
    if (!eteOk) {
      // A ETE ainda não está no catálogo na main (chega com a #107/#108): sem ela não há
      // como zerar o esgoto, então o teste para aqui — mas NÃO passa silenciosamente, porque
      // a asserção abaixo quebra na main pelo comando recusado.
      expect(
        eteOk,
        `a ETE tem que entrar em obra: ${resultados.map((r) => r.reason).join("; ")} (a #107/#108 precisam estar mergeadas para a ETE existir)`,
      ).toBe(true);
      return;
    }
    stepDays(game, 26); // a obra da ETE dura 24 meses = 24 dias de jogo, mais o recompute seguinte
    expect(sewerNaoAtendido(game), "com a ETE pronta na malha, ninguém mais pode estar sem esgoto").toBe(0);
  });

  it("o relatório em texto não vaza undefined", () => {
    const game = createTestGame({ seed: "avaliacao-livre", days: 30, bot: false });
    const texto = reportText(game);
    expect(
      texto.includes("undefined"),
      "o relatório tem que mostrar o esgoto com número, nunca a palavra undefined",
    ).toBe(false);
  });
});
