/**
 * Economia da prefeitura. Receita e despesa entram hora a hora (1 dia do jogo = 1 ano).
 * - Receita: R$ por morador por ano varia com o porte da cidade
 *   (tabela revenuePerResidentByPopulation em config/economy.yaml).
 * - Despesas: escolas (custo por aluno, Fundeb), UBS (custo anual), manutenção das vias.
 */
import type { City } from "../city";
import { makeTableLookup } from "../config/load";
import type { System } from "../sim";

export class EconomySystem implements System {
  readonly name = "economy";
  private readonly revenuePerResident: (pop: number) => number;

  constructor(
    private city: City,
    private onYearEnd: () => void,
  ) {
    this.revenuePerResident = makeTableLookup(city.sim.config.economy.revenuePerResidentByPopulation);
  }

  tick() {
    const city = this.city;
    const { sim } = city;
    const clock = sim.clock;
    if (clock.tickOfDay === 0 && clock.tick > 0) this.onYearEnd();
    const ticksPerHour = Math.max(1, Math.round(60 / sim.config.time.minutesPerTick));
    if (clock.tick % ticksPerHour !== 0) return;
    const hoursPerYear = 24;
    const t = sim.treasury;
    t.earn(
      (city.pop.aliveCount * this.revenuePerResident(city.pop.aliveCount)) / hoursPerYear,
      "impostos_e_repasses",
    );
    const b = sim.buildings;
    let schools = 0;
    let clinics = 0;
    let utilities = 0;
    for (let id = 0; id < b.count; id++) {
      if (!b.isActive(id)) continue;
      const type = b.typeOf(id);
      if (type.service === "school")
        schools += b.students[id]! * type.upkeepPerStudentPerYear + type.upkeepPerYear;
      else if (type.service === "health") clinics += type.upkeepPerYear;
      else if (type.service === "water" || type.service === "power") utilities += type.upkeepPerYear;
    }
    t.charge(schools / hoursPerYear, "educacao");
    t.charge(clinics / hoursPerYear, "saude");
    t.charge(utilities / hoursPerYear, "agua_e_luz");
    t.charge(this.roadMaintenancePerYear() / hoursPerYear, "manutencao_vias");
  }

  private roadMaintenancePerYear(): number {
    const { world, config } = this.city.sim;
    let street = 0;
    let avenue = 0;
    for (let i = 0; i < world.size; i++) {
      const r = world.roads[i];
      if (r === 1) street++;
      else if (r === 2) avenue++;
    }
    const share = config.roads.maintenanceShareOfCostPerYear;
    return (street * config.roads.street.costPerTile + avenue * config.roads.avenue.costPerTile) * share;
  }
}
