import type { GameClient } from "../client";
import { clock, int, money } from "../format";
import type { Store, UiState } from "../store";

const SPEEDS = [
  { v: 0, label: "⏸", title: "Pausar" },
  { v: 1, label: "▶", title: "Velocidade 1x (1 dia = 2 min)" },
  { v: 2, label: "▶▶", title: "Velocidade 2x" },
  { v: 4, label: "▶▶▶", title: "Velocidade 4x" },
];

export function TopBar({ ui, store, client }: { ui: UiState; store: Store; client: GameClient }) {
  const s = ui.stats;
  return (
    <div className="topbar">
      <div className="brand">CityBuilder</div>
      <div className="stat" title="Cada dia do jogo representa um ano de vida">
        <span className="label">Ano</span>
        <span className="value">{s ? s.year : "—"}</span>
        <span className="sub">{s ? clock(s.minuteOfDay) : ""}</span>
      </div>
      <div className="stat">
        <span className="label">População</span>
        <span className="value">{s ? int(s.population) : "—"}</span>
      </div>
      <div className={`stat ${s && s.money < 0 ? "negative" : ""}`} title="Saldo da prefeitura">
        <span className="label">Prefeitura</span>
        <span className="value">{s ? money(s.money) : "—"}</span>
      </div>
      <div className="stat" title="Receita e despesa do último ano">
        <span className="label">Último ano</span>
        <span className="value small">
          {s ? `+${money(s.lastYearRevenue)} / -${money(s.lastYearExpenses)}` : "—"}
        </span>
      </div>
      <div className="speeds">
        {SPEEDS.map((sp) => (
          <button
            type="button"
            key={sp.v}
            title={sp.title}
            className={ui.speed === sp.v ? "active" : ""}
            onClick={() => {
              client.setSpeed(sp.v);
              store.set({ speed: sp.v });
            }}
          >
            {sp.label}
          </button>
        ))}
      </div>
      {s?.perf.behind ? (
        <div className="behind" title="A simulação não está conseguindo acompanhar a velocidade escolhida">
          simulação atrasada
        </div>
      ) : null}
    </div>
  );
}
