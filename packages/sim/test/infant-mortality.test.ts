/** Mortalidade infantil (issue #72): só conta quem nasceu na cidade. */
import { describe, expect, it } from "vitest";
import { createGame } from "../src/game";
import { newPerson } from "../src/people/actions";
import { EV } from "../src/people/events";
import { SEX } from "../src/people/population";
import { loadDefaults } from "./helpers";

function newGame() {
  const { config, data } = loadDefaults({ world: { width: 64, height: 64 } });
  return createGame({ config, data, seed: "mortalidade-infantil" });
}

/** Repete a regra do lifecycle: nascido na cidade = primeiro evento é EV.born. */
function bornInCityOf(game: ReturnType<typeof newGame>, p: number): boolean {
  const first = game.city.events.of(p)[0];
  return first !== undefined && game.city.events.type[first] === EV.born;
}

describe("mortalidade infantil", () => {
  it("recém-nascido (EV.born) que morre com idade 0 sobe infantDeaths", () => {
    const game = newGame();
    const p = newPerson(game.city, {
      sex: SEX.female,
      birthTick: game.city.tick,
      first: 0,
      surnameA: 0,
      surnameB: 0,
    });
    game.city.log(EV.born, p);
    game.demo.death(SEX.female, 0, bornInCityOf(game, p));
    expect(game.demo.current.infantDeaths).toBe(1);
  });

  it("bebê imigrante (EV.arrived) que morre com idade 0 NÃO sobe infantDeaths", () => {
    const game = newGame();
    const p = newPerson(game.city, {
      sex: SEX.male,
      birthTick: game.city.tick,
      first: 0,
      surnameA: 0,
      surnameB: 0,
    });
    game.city.log(EV.arrived, p);
    game.demo.death(SEX.male, 0, bornInCityOf(game, p));
    expect(game.demo.current.infantDeaths).toBe(0);
    // Sem evento nenhum também não conta (trata como não nascida na cidade).
    const q = newPerson(game.city, {
      sex: SEX.male,
      birthTick: game.city.tick,
      first: 0,
      surnameA: 0,
      surnameB: 0,
    });
    game.city.pop.lastEvent[q] = -1;
    game.demo.death(SEX.male, 0, bornInCityOf(game, q));
    expect(game.demo.current.infantDeaths).toBe(0);
  });
});
