import { loadConfigAndData, runGame } from "@city/cli";
import { statsView } from "@city/sim";

const { config, data } = loadConfigAndData();
const g = runGame({ config, data, seed: "vitrine", days: 12, bot: true });
const tpd = g.sim.clock.ticksPerDay;
const rows: string[] = [];
for (let t = 0; t < tpd; t++) {
  g.sim.step(1);
  const m = g.city.sim.clock.minuteOfDay;
  if (t % Math.round(tpd / 24) === 0)
    rows.push(`${String(Math.floor(m / 60)).padStart(2, "0")}h moving=${g.traffic.vehicles.moving.size}`);
}
console.log("pop", statsView(g).population, "ticksPerDay", tpd, "min/tick", config.time.minutesPerTick);
console.log(rows.join(" | "));
