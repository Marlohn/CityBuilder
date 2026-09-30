/**
 * Relatório da cidade em texto (o que os agentes leem). Curto, em português, com números.
 */
import type { Game } from "../game";
import { statsView } from "./stats";

function n(v: number): string {
  return Math.round(v)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

function money(v: number): string {
  const abs = Math.abs(v);
  const s = abs >= 1e6 ? `${(abs / 1e6).toFixed(1).replace(".", ",")} mi` : n(abs);
  return `${v < 0 ? "-" : ""}R$ ${s}`;
}

export function reportText(game: Game): string {
  const s = statsView(game);
  const { sim, city } = game;
  const lines: string[] = [];
  lines.push(`# Relatório da cidade — semente "${sim.seed}", ano ${s.year} (dia ${s.day}), tick ${s.tick}`);
  lines.push("");
  lines.push("## Pessoas");
  lines.push(`População: ${n(s.population)} em ${n(s.households)} famílias`);
  lines.push(
    `Trabalhando: ${n(s.employed)} (fora da cidade: ${n(city.outsideWorkers)}) · desempregados: ${n(s.unemployed)} · estudantes: ${n(s.students)} · aposentados: ${n(s.retired)} · crianças: ${n(s.children)}`,
  );
  lines.push(
    `Ano passado: ${n(city.lastYear.births)} nascimentos, ${n(city.lastYear.deaths)} mortes, ${n(city.lastYear.arrivals)} chegadas, ${n(city.lastYear.departures)} saídas, ${n(city.lastYear.marriages)} casamentos, ${n(city.lastYear.divorces)} divórcios`,
  );
  const ly = city.lastYear;
  lines.push(
    `Viagens de ontem: trabalho ${n(ly.tripsWork)} · escola ${n(ly.tripsSchool)} · compras ${n(ly.tripsShopping)} · saúde ${n(ly.tripsHealth)} · lazer ${n(ly.tripsLeisure)} (a pé ${n(ly.tripsWalk)})`,
  );
  const turned = Object.entries(city.lastYear.migrantsTurnedAway);
  if (turned.length > 0)
    lines.push(
      `Famílias que desistiram de vir (ano passado): ${turned.map(([k, v]) => `${k}=${v}`).join(", ")}`,
    );
  lines.push("");
  lines.push("## Mercados");
  lines.push(`Casas vagas: ${n(s.vacantHomes)} · vagas de emprego: ${n(s.vacantJobs)}`);
  const d = game.growth.demand;
  lines.push(
    `Demanda: casas ${n(d.homes)}, empregos no comércio ${n(d.commercialJobs)}, na indústria ${n(d.industrialJobs)}`,
  );
  let active = 0;
  let building = 0;
  for (let i = 0; i < sim.buildings.count; i++) {
    if (sim.buildings.state[i] === 1) active++;
    else if (sim.buildings.state[i] === 0) building++;
  }
  lines.push(`Prédios: ${n(active)} funcionando, ${n(building)} em obra`);
  lines.push("");
  lines.push("## Desejos não atendidos");
  lines.push(
    `Crianças sem escola: ${n(s.unmet.school)} · querem faculdade: ${n(s.unmet.university)} · sem UBS: ${n(s.unmet.health)} · famílias esperando casa: ${n(s.unmet.housing)} · desempregados: ${n(s.unmet.job)} · recusaram emprego por distância: ${n(s.unmet.transit)} · sem água: ${n(s.unmet.water)} · sem luz: ${n(s.unmet.power)}`,
  );
  lines.push("");
  lines.push("## Prefeitura");
  lines.push(
    `Saldo: ${money(s.money)} · receita no último ano: ${money(s.lastYearRevenue)} · despesa: ${money(s.lastYearExpenses)}`,
  );
  const adjusted = Object.entries(sim.modifiers).filter(([, v]) => v !== 1);
  if (adjusted.length > 0)
    lines.push(`Ajustes da diretora (IA) em vigor: ${adjusted.map(([k, v]) => `${k}=${v}`).join(", ")}`);
  lines.push("");
  lines.push("## Placar de realismo");
  if (s.realism.length === 0) lines.push("(ainda sem ano fechado)");
  for (const r of s.realism) {
    const mark =
      r.status === "ok" ? "OK " : r.status === "low" ? "BAIXO" : r.status === "high" ? "ALTO" : "sem dados";
    const v = r.value === null ? "—" : String(r.value).replace(".", ",");
    lines.push(`[${mark}] ${r.label}: ${v} ${r.unit} (real: ${r.min}–${r.max}; ${r.source})`);
  }
  lines.push("");
  lines.push("## Desempenho");
  lines.push(`ms por tick (média): ${s.perf.msPerTick.toFixed(3)}`);
  const sys = Object.entries(s.perf.systems)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k}=${v.toFixed(3)}`)
    .join(", ");
  lines.push(`por sistema (ms): ${sys}`);
  const peaks = Object.entries(sim.perf.peak)
    .map(([k, v]) => `${k}=${v}`)
    .join(", ");
  lines.push(`pico de trabalho num tick: ${peaks || "—"}`);
  return lines.join("\n");
}
