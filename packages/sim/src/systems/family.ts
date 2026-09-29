/**
 * Família: casamento, divórcio, nascimento e saída da casa dos pais.
 * Cada decisão combina personalidade + situação + sorte (docs/PLANO.md 5.4).
 */
import type { City } from "../city";
import type { Demography } from "../metrics/demography";
import { joinHousehold, newPerson, startOwnHousehold } from "../people/actions";
import { EV } from "../people/events";
import { SEX } from "../people/population";

/** Solteiros adultos (para sortear pares). */
export function isRelative(city: City, a: number, b: number): boolean {
  const { pop } = city;
  const ma = pop.mother[a]!;
  const fa = pop.father[a]!;
  const mb = pop.mother[b]!;
  const fb = pop.father[b]!;
  if ((ma >= 0 && ma === mb) || (fa >= 0 && fa === fb)) return true; // irmãos
  if (ma === b || fa === b || mb === a || fb === a) return true; // pai/mãe e filho(a)
  return false;
}

export function tryMarry(city: City, demo: Demography, p: number): boolean {
  const { pop } = city;
  const cfg = city.config.lifecycle.marriage;
  const rng = city.rng.family;
  const ageP = city.age(p);
  const sameSex = rng.chance(cfg.sameSexShare);
  let best = -1;
  let bestGap = Number.POSITIVE_INFINITY;
  const singles = city.singles;
  const tries = Math.min(cfg.candidatesPerSearch, singles.size);
  for (let k = 0; k < tries; k++) {
    const c = singles.random(rng);
    if (c === p || !pop.isAlive(c) || pop.partner[c] !== -1) continue;
    if ((pop.sex[c] === pop.sex[p]) !== sameSex) continue;
    const gap = Math.abs(city.age(c) - ageP);
    if (gap > cfg.maxAgeGap || city.age(c) < cfg.minAge) continue;
    if (isRelative(city, p, c)) continue;
    // O outro também precisa querer casar.
    if (!rng.chance(0.3 + 0.7 * pop.trait(c, "marriageWish"))) continue;
    if (gap < bestGap) {
      best = c;
      bestGap = gap;
    }
  }
  if (best < 0) return false;
  marry(city, demo, p, best);
  return true;
}

function livesWithParents(city: City, p: number): boolean {
  const { pop, hh } = city;
  const h = pop.household[p]!;
  if (h < 0) return false;
  for (const m of hh.members(h)) if (m === pop.mother[p] || m === pop.father[p]) return true;
  return false;
}

export function marry(city: City, demo: Demography, a: number, b: number) {
  const { pop } = city;
  pop.partner[a] = b;
  pop.partner[b] = a;
  for (const [x, y] of [
    [a, b],
    [b, a],
  ] as const) {
    if (pop.firstMarriageAge[x] === 0) {
      pop.firstMarriageAge[x] = Math.min(255, city.age(x));
      demo.firstMarriage(pop.sex[x]!, city.age(x));
    }
    city.log(EV.married, x, y);
    city.singles.delete(x);
  }
  // Onde o casal vai morar: na casa de quem já mora por conta própria; senão, família nova (e procura casa).
  if (!livesWithParents(city, a) && city.homeBuilding(a) >= 0) joinHousehold(city, b, pop.household[a]!);
  else if (!livesWithParents(city, b) && city.homeBuilding(b) >= 0) joinHousehold(city, a, pop.household[b]!);
  else startOwnHousehold(city, [a, b]);
  city.year.marriages++;
}

export function divorce(city: City, demo: Demography, a: number) {
  const { pop, hh } = city;
  const b = pop.partner[a]!;
  if (b < 0) return;
  pop.partner[a] = -1;
  pop.partner[b] = -1;
  city.log(EV.divorced, a, b);
  city.log(EV.divorced, b, a);
  demo.divorce();
  city.year.divorces++;
  // Quem sai: quem não é o primeiro da lista da família (a "pessoa de referência" fica).
  const h = pop.household[a]!;
  const leaver = h >= 0 && hh.head[h] === a ? b : a;
  // Volta para a casa dos pais se eles moram na cidade; senão monta família nova e procura casa.
  for (const parent of [pop.mother[leaver]!, pop.father[leaver]!]) {
    if (parent >= 0 && pop.isAlive(parent)) {
      const ph = pop.household[parent]!;
      if (ph >= 0 && hh.home[ph]! >= 0) {
        joinHousehold(city, leaver, ph);
        return;
      }
    }
  }
  startOwnHousehold(city, [leaver]);
}

export function giveBirth(city: City, demo: Demography, mother: number) {
  const { pop, sim } = city;
  const rng = city.rng.family;
  const ratio = city.config.population.sexRatioAtBirth;
  const male = rng.chance(ratio / (1 + ratio));
  const father =
    pop.partner[mother]! >= 0 && pop.sex[pop.partner[mother]!] === SEX.male ? pop.partner[mother]! : -1;
  const child = newPerson(city, {
    sex: male ? SEX.male : SEX.female,
    birthTick: sim.clock.tick,
    first: city.names.first(rng, male),
    // Sobrenome da mãe e depois o do pai (costume brasileiro).
    surnameA: pop.surnameB[mother]!,
    surnameB: father >= 0 ? pop.surnameB[father]! : pop.surnameA[mother]!,
    mother,
    father,
  });
  const h = pop.household[mother]!;
  if (h >= 0) joinHousehold(city, child, h);
  city.log(EV.born, child, mother, father);
  city.log(EV.childBorn, mother, child);
  if (father >= 0) city.log(EV.childBorn, father, child);
  demo.birth(city.age(mother));
  city.year.births++;
}

/** Adulto que trabalha e mora com os pais pode querer sair de casa. */
export function maybeLeaveParents(city: City, p: number) {
  const { pop } = city;
  const cfg = city.config.lifecycle.leaveParentsHome;
  if (pop.partner[p] !== -1 || city.age(p) < cfg.minAge || pop.job[p] === -1) return;
  if (!livesWithParents(city, p)) return;
  const wish = 0.5 + pop.trait(p, "ambition") * 0.5;
  if (!city.rng.family.chance(cfg.annualChance * 2 * wish)) return;
  startOwnHousehold(city, [p]);
}
