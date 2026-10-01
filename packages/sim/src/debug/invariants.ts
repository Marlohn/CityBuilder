/**
 * Regras que NUNCA podem quebrar. Usado nos testes com cidades aleatórias e no relatório de bug.
 * Cada violação vem com uma frase explicando o que está errado e em quem.
 */
import type { City } from "../city";
import { EV } from "../people/events";
import { OUTSIDE_JOB, PSTATUS } from "../people/population";
import { BSTATE } from "../world/buildings";

export function checkInvariants(city: City, maxReports = 20): string[] {
  const out: string[] = [];
  const add = (msg: string) => {
    if (out.length < maxReports) out.push(msg);
  };
  const { pop, hh, sim, events } = city;
  const b = sim.buildings;
  const residents = new Int32Array(b.count);
  const households = new Int32Array(b.count);
  const jobs = new Int32Array(b.count);
  const students = new Int32Array(b.count);
  const patients = new Int32Array(b.count);
  let outside = 0;
  let alive = 0;
  for (let p = 0; p < pop.count; p++) {
    const st = pop.status[p];
    if (st !== PSTATUS.alive && st !== PSTATUS.dead && st !== PSTATUS.left)
      add(`pessoa ${p}: status inválido ${st}`);
    // Ninguém surge do nada: o primeiro evento de toda pessoa é "chegou" ou "nasceu".
    const evs = events.of(p);
    const first = evs[0];
    if (first === undefined || (events.type[first] !== EV.arrived && events.type[first] !== EV.born)) {
      add(`pessoa ${p}: não tem registro de chegada nem de nascimento (surgiu do nada)`);
    }
    if (st !== PSTATUS.alive) {
      if (pop.household[p] !== -1) add(`pessoa ${p}: saiu/morreu mas ainda está numa família`);
      continue;
    }
    alive++;
    const h = pop.household[p]!;
    if (h < 0 || !hh.alive[h]) add(`pessoa ${p}: viva sem família válida`);
    const partner = pop.partner[p]!;
    if (partner >= 0 && pop.partner[partner] !== p)
      add(`pessoa ${p}: cônjuge ${partner} não aponta de volta`);
    if (partner >= 0 && !pop.isAlive(partner)) add(`pessoa ${p}: casada com quem não está vivo na cidade`);
    const j = pop.job[p]!;
    if (j === OUTSIDE_JOB) outside++;
    else if (j >= 0) {
      if (b.state[j] !== BSTATE.active) add(`pessoa ${p}: trabalha no prédio ${j} que não está funcionando`);
      jobs[j]!++;
    }
    const s = pop.school[p]!;
    if (s >= 0) students[s]!++;
    const c = pop.clinic[p]!;
    if (c >= 0) patients[c]!++;
    // UBS e hospital dividem o mesmo contador de pacientes do prédio.
    const hb = pop.hospital[p]!;
    if (hb >= 0) patients[hb]!++;
    if (h >= 0 && hh.home[h]! >= 0) residents[hh.home[h]!]!++;
    if (city.age(p) < 0) add(`pessoa ${p}: idade negativa`);
  }
  if (alive !== pop.aliveCount) add(`contador de vivos (${pop.aliveCount}) diferente do real (${alive})`);
  if (outside !== city.outsideWorkers)
    add(`contador de quem trabalha fora (${city.outsideWorkers}) diferente do real (${outside})`);
  for (let h = 0; h < hh.count; h++) {
    if (!hh.alive[h]) continue;
    const members = hh.members(h);
    if (members.length !== hh.size[h])
      add(`família ${h}: tamanho ${hh.size[h]} mas tem ${members.length} membros`);
    if (members.length === 0) add(`família ${h}: viva sem ninguém`);
    if (members.length > 0 && !members.some((m) => city.age(m) >= 18))
      add(`família ${h}: só tem menores de idade`);
    const home = hh.home[h]!;
    if (home >= 0 && !hh.sharing[h]) households[home]!++;
    if (hh.sharing[h] && home < 0) add(`família ${h}: marcada "de favor" sem casa anfitriã`);
  }
  for (let id = 0; id < b.count; id++) {
    if (b.residents[id] !== residents[id])
      add(`prédio ${id}: diz ter ${b.residents[id]} moradores, mas são ${residents[id]}`);
    if (b.households[id] !== households[id])
      add(`prédio ${id}: diz ter ${b.households[id]} famílias, mas são ${households[id]}`);
    if (b.households[id]! > b.homesCapacity(id))
      add(`prédio ${id}: mais famílias (${b.households[id]}) que moradias`);
    if (b.jobsFilled[id] !== jobs[id])
      add(`prédio ${id}: diz ter ${b.jobsFilled[id]} empregados, mas são ${jobs[id]}`);
    if (b.jobsFilled[id]! > b.jobsCapacity(id)) add(`prédio ${id}: mais empregados que vagas`);
    if (b.students[id] !== students[id])
      add(`prédio ${id}: diz ter ${b.students[id]} alunos, mas são ${students[id]}`);
    if (b.students[id]! > b.studentsCapacity(id)) add(`prédio ${id}: mais alunos que vagas`);
    if (b.patients[id] !== patients[id])
      add(`prédio ${id}: diz atender ${b.patients[id]}, mas são ${patients[id]}`);
    if (b.state[id] !== BSTATE.demolished) {
      for (let dy = 0; dy < b.h[id]!; dy++) {
        for (let dx = 0; dx < b.w[id]!; dx++) {
          const t = sim.world.idx(b.x[id]! + dx, b.y[id]! + dy);
          if (sim.world.buildingAt[t] !== id)
            add(`prédio ${id}: o mapa não marca o quadradinho (${b.x[id]! + dx}, ${b.y[id]! + dy})`);
          if (sim.world.roads[t] !== 0) add(`prédio ${id}: tem via embaixo do prédio`);
        }
      }
    }
  }
  if (!Number.isFinite(sim.treasury.money)) add("dinheiro da prefeitura não é um número");
  checkVehicles(city, add);
  return out;
}

/** Todo carro tem dono, lugar e, se estiver andando, rota. Vagas contadas batem com os carros parados. */
function checkVehicles(city: City, add: (m: string) => void) {
  const traffic = city.traffic;
  if (!traffic) return;
  const veh = traffic.vehicles;
  const b = city.sim.buildings;
  const parked = new Int32Array(b.count);
  for (let v = 0; v < veh.count; v++) {
    const st = veh.state[v];
    if (st === 3) continue;
    const owner = veh.owner[v]!;
    if (owner < 0 || !city.hh.alive[owner]) add(`carro ${v}: sem dono vivo (família ${owner})`);
    else if (city.hh.car[owner] !== v) add(`carro ${v}: a família ${owner} não aponta para ele`);
    if (st === 0) {
      if (veh.parkedAt[v]! >= 0) parked[veh.parkedAt[v]!]!++;
      else if (veh.streetTile[v]! < 0 && veh.driver[v] === -1) add(`carro ${v}: estacionado em lugar nenhum`);
    }
    if (st === 1 && !veh.routes[v]) add(`carro ${v}: andando sem rota`);
    if (st === 1 && !veh.moving.has(v)) add(`carro ${v}: andando fora da lista de movimento`);
  }
  for (let id = 0; id < b.count; id++) {
    if (b.parked[id] !== parked[id])
      add(`prédio ${id}: diz ter ${b.parked[id]} carros estacionados, mas são ${parked[id]}`);
  }
}
