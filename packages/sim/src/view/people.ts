/**
 * Pessoas para a tela e para a CLI: ficha completa, história e lista pesquisável.
 */
import type { LifeEventView, PersonListItem, PersonView } from "@city/contract";
import type { City } from "../city";
import { EV, UNMET } from "../people/events";
import { EDU_LABEL, OUTSIDE_JOB, PSTATUS, ROLE_LABEL, SEX, TRAIT_LABEL, TRAITS } from "../people/population";

export function personName(city: City, p: number): string {
  const { pop } = city;
  return city.names.fullName(pop.sex[p] === SEX.male, pop.firstName[p]!, pop.surnameA[p]!, pop.surnameB[p]!);
}

function statusLabel(city: City, p: number): string {
  const s = city.pop.status[p];
  const female = city.pop.sex[p] === SEX.female;
  if (s === PSTATUS.dead) return female ? "falecida" : "falecido";
  if (s === PSTATUS.left) return "mudou-se da cidade";
  if (city.pop.job[p] === OUTSIDE_JOB) return "trabalhando em outra cidade";
  return ROLE_LABEL[city.pop.role[p]!] ?? "?";
}

function buildingName(city: City, b: number): string {
  if (b === OUTSIDE_JOB) return "outra cidade";
  if (b < 0) return "?";
  return `${city.sim.buildings.typeOf(b).label} #${b}`;
}

const UNMET_TEXT: Record<number, string> = {
  [UNMET.school]: "precisava de escola e não havia vaga perto de casa",
  [UNMET.university]: "queria fazer faculdade, mas não existe faculdade na cidade",
  [UNMET.health]: "não tinha UBS por perto",
  [UNMET.housing]: "não encontrou casa na cidade",
  [UNMET.job]: "procurou emprego e não encontrou",
  [UNMET.transit]: "recusou um emprego longe por não ter como ir",
  [UNMET.parking]: "não achou vaga para estacionar",
  [UNMET.errand]:
    "queria resolver uma volta de compras ou lazer, mas não tinha loja perto de casa nem como ir a pé",
};

export function eventText(city: City, e: number): string {
  const ev = city.events;
  const a = ev.a[e]!;
  const b = ev.b[e]!;
  switch (ev.type[e]) {
    case EV.arrived:
      return `chegou à cidade e foi morar em ${buildingName(city, a)}`;
    case EV.born:
      return `nasceu (mãe: ${personName(city, a)}${b >= 0 ? `, pai: ${personName(city, b)}` : ""})`;
    case EV.died:
      return `faleceu aos ${a} anos`;
    case EV.movedHome:
      return `mudou-se para ${buildingName(city, a)}`;
    case EV.married:
      return `casou com ${personName(city, a)}`;
    case EV.divorced:
      return `divorciou-se de ${personName(city, a)}`;
    case EV.jobStart:
      return `começou a trabalhar em ${buildingName(city, a)}`;
    case EV.jobEnd:
      return `saiu do emprego em ${buildingName(city, a)}`;
    case EV.schoolStart:
      return `entrou na escola (${buildingName(city, a)})`;
    case EV.schoolEnd:
      return "saiu da escola";
    case EV.graduated:
      return `terminou os estudos (${EDU_LABEL[a] ?? "?"})`;
    case EV.retired:
      return "aposentou-se";
    case EV.leftCity:
      return a === 1
        ? "foi morar em outra cidade (não achou casa)"
        : a === 2
          ? "foi morar com parentes em outra cidade"
          : a === 3
            ? "foi embora procurar emprego em outra cidade"
            : "foi morar em outra cidade";
    case EV.boughtCar:
      return "a família comprou um carro";
    case EV.childBorn:
      return `teve um(a) filho(a): ${personName(city, a)}`;
    case EV.widowed:
      return `ficou viúvo(a) de ${personName(city, a)}`;
    case EV.unmet:
      return UNMET_TEXT[a] ?? "teve um desejo não atendido";
    case EV.lostHome:
      return `perdeu a casa (${buildingName(city, a)} foi demolido)`;
    case EV.movedToRelatives:
      return `foi morar com parentes em ${buildingName(city, a)}`;
    default:
      return "evento";
  }
}

export function personView(city: City, p: number): PersonView | null {
  const { pop, events, sim } = city;
  if (p < 0 || p >= pop.count) return null;
  const history: LifeEventView[] = events.of(p).map((e) => {
    const t = events.tick[e]!;
    const day = Math.floor(t / sim.clock.ticksPerDay);
    return {
      day,
      year: sim.config.time.startYear + day,
      type: String(events.type[e]),
      text: eventText(city, e),
    };
  });
  const traits: Record<string, number> = {};
  for (const t of TRAITS) traits[TRAIT_LABEL[t]] = Math.round(pop.trait(p, t) * 100) / 100;
  const deathEvent =
    pop.status[p] === PSTATUS.dead ? history.find((h) => h.type === String(EV.died)) : undefined;
  const age = deathEvent
    ? (events.a[events.of(p).find((e) => events.type[e] === EV.died)!] ?? 0)
    : city.age(p);
  return {
    id: p,
    name: personName(city, p),
    sex: pop.sex[p] === SEX.male ? "M" : "F",
    age,
    alive: pop.status[p] === PSTATUS.alive,
    status: statusLabel(city, p),
    householdId: pop.household[p]!,
    homeBuilding: city.homeBuilding(p),
    job: pop.job[p]!,
    school: pop.school[p]!,
    education: EDU_LABEL[pop.eduLevel[p]!] ?? "?",
    partnerId: pop.partner[p]!,
    motherId: pop.mother[p]!,
    fatherId: pop.father[p]!,
    traits,
    history,
  };
}

/** Lista paginada. Filtro por nome ou número; ou só as pessoas ligadas a um prédio. */
export function peopleList(
  city: City,
  filter: string,
  offset: number,
  limit: number,
  buildingId?: number,
): { total: number; items: PersonListItem[] } {
  const { pop } = city;
  const f = filter.trim().toLowerCase();
  const asNumber = /^\d+$/.test(f) ? Number(f) : -1;
  const items: PersonListItem[] = [];
  let total = 0;
  for (let p = 0; p < pop.count; p++) {
    if (pop.status[p] !== PSTATUS.alive) continue;
    if (buildingId !== undefined) {
      const linked =
        city.homeBuilding(p) === buildingId ||
        pop.job[p] === buildingId ||
        pop.school[p] === buildingId ||
        pop.clinic[p] === buildingId;
      if (!linked) continue;
    }
    if (f && asNumber !== p && !personName(city, p).toLowerCase().includes(f)) continue;
    if (total >= offset && items.length < limit) {
      items.push({
        id: p,
        name: personName(city, p),
        age: city.age(p),
        sex: pop.sex[p] === SEX.male ? "M" : "F",
        status: statusLabel(city, p),
      });
    }
    total++;
  }
  return { total, items };
}
