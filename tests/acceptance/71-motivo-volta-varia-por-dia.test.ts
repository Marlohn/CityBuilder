/**
 * Bug da issue #39 — o motivo da volta (compras, saúde ou lazer) não muda com o dia.
 *
 * A issue pede "cada pessoa sem trabalho e sem aula sorteia um motivo de volta POR DIA".
 * O sorteio usa `${seed}:errand:${p}` (sem o dia), então cada pessoa ganha um motivo só na
 * vida inteira: quem sorteou "compras" nunca vai na UBS, quem sorteou "saúde" nunca vai ao
 * comércio. Numa cidade com ninguém indo à UBS, o evento é impossível de observar.
 *
 * Teste de bug: roda a cidade de referência e exige que, entre as pessoas que fazem volta em
 * quase todo dia, a maioria varie o motivo pelo menos uma vez em 12 dias.
 */

import { describe, expect, it } from "vitest";
import { createTestGame } from "../helpers";

const SEED = "avaliacao-livre";
const DAYS_PROBED = 12;
/** Motivo novo = tripPurpose >= 3 (1 = trabalho, 2 = escola, 0 = em casa). */
const NEW_PURPOSE_MIN = 3;
/** Só entram na conta quem faz volta em pelo menos este tanto dia observado. */
const MIN_DAYS = 10;

describe("bug #71: o motivo da volta tem de variar com o dia", () => {
  it("pessoas que resolvem volta todo dia mudam de motivo pelo menos uma vez", () => {
    const game = createTestGame({
      seed: SEED,
      scenario: "bairro-basico",
      days: 40,
      bot: true,
      overrides: { economy: { mode: "sandbox" } },
    });
    const pop = game.city.pop;
    const tpd = game.sim.clock.ticksPerDay;
    const motives = new Map<number, Set<number>>();
    const days = new Map<number, Set<number>>();
    for (let d = 0; d < DAYS_PROBED; d++) {
      for (let t = 0; t < tpd; t++) {
        game.sim.step(1);
        for (let p = 0; p < pop.count; p++) {
          const purpose = pop.tripPurpose[p]!;
          if (purpose < NEW_PURPOSE_MIN) continue;
          let s = motives.get(p);
          if (!s) {
            s = new Set();
            motives.set(p, s);
            days.set(p, new Set());
          }
          s.add(purpose);
          days.get(p)!.add(d);
        }
      }
    }
    const rows = [...motives.entries()]
      .map(([p, s]) => ({ p, motives: s.size, days: days.get(p)!.size }))
      .filter((r) => r.days >= MIN_DAYS);
    const vary = rows.filter((r) => r.motives > 1).length;
    expect(
      rows.length,
      `só ${rows.length} pessoas fazem volta em pelo menos ${MIN_DAYS} dos ${DAYS_PROBED} dias: ` +
        `a cidade de referência não chegou a ter viagem de retorno para o teste medir`,
    ).toBeGreaterThan(100);
    expect(
      vary,
      `nenhuma das ${rows.length} pessoas que fazem volta em ${MIN_DAYS}+ dias muda de motivo: ` +
        `o motivo está travado na vida inteira (o sorteio não usa o dia). ` +
        `Na vida real todo mundo vai na UBS e no comércio ao longo da vida, então ` +
        `${rows.length} pessoas com um motivo fixo é o bug.`,
    ).toBeGreaterThan(0);
  });
});
