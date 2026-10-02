import type { GameClient } from "../client";
import { clock, int, money, pct } from "../format";
import type { Store, UiState } from "../store";

const SPEEDS = [
  { v: 0, label: "⏸", title: "Pausar" },
  { v: 0.25, label: "🐢", title: "Devagar (1/4): bom para observar o trânsito" },
  { v: 1, label: "▶", title: "Velocidade 1x (1 dia = 2 min)" },
  { v: 2, label: "▶▶", title: "Velocidade 2x" },
  { v: 4, label: "▶▶▶", title: "Velocidade 4x" },
];

// Limites de cor do número de água/luz: número de tela.
// PENDENTE: sem fonte oficial (limite de alerta escolhido pela equipe).
const UTILITY_WARN = 0.8;
const UTILITY_BAD = 0.95;

const DEMAND_BARS = [
  {
    key: "residential",
    label: "Residencial",
    color: "#5fb36e",
    title: "Casas que a cidade quer: mais Casas = mais moradores (100% = 100 casas)",
  },
  {
    key: "commercial",
    label: "Comercial",
    color: "#6f9fe0",
    title: "Lojas e serviços que a cidade quer (100% = 100 vagas de comércio)",
  },
  {
    key: "industrial",
    label: "Industrial",
    color: "#e0c064",
    title: "Indústrias que a cidade quer (100% = 100 vagas de indústria)",
  },
] as const;

function utilityColor(fraction: number): string {
  if (fraction >= UTILITY_BAD) return "var(--bad)";
  if (fraction >= UTILITY_WARN) return "var(--warn)";
  return "var(--accent)";
}

function UtilityStat({
  name,
  used,
  capacity,
  hint,
}: {
  name: string;
  used: number;
  capacity: number | null;
  hint?: string;
}) {
  const value = `${int(used)} / ${capacity === null ? "—" : int(capacity)}`;
  const base =
    capacity === null
      ? `${name}: ${int(used)} pessoas equivalentes usando; serviço sem limite (desligado)`
      : `${name}: ${int(used)} de ${int(capacity)} pessoas equivalentes usando (${pct(capacity > 0 ? used / capacity : 0)})`;
  const title = hint ? `${base}${hint}` : base;
  const fraction = capacity && capacity > 0 ? used / capacity : 0;
  return (
    <div className="stat" title={title}>
      <span className="label">{name}</span>
      <span className="value small" style={{ color: capacity === null ? undefined : utilityColor(fraction) }}>
        {value}
      </span>
      <span className="sub">pessoas equivalentes</span>
    </div>
  );
}

export function TopBar({ ui, store, client }: { ui: UiState; store: Store; client: GameClient }) {
  const s = ui.stats;
  const blockedByWater = s !== null && s.construction.blockedByWater > 0;
  const blockedByPower = s !== null && s.construction.blockedByPower > 0;
  const showBlockedWarning = s !== null && ui.speed !== 0 && (blockedByWater || blockedByPower);
  const blockedMessage =
    blockedByWater && blockedByPower
      ? "⚠ obras paradas: falta água e luz"
      : blockedByWater
        ? "⚠ obras paradas: falta água"
        : "⚠ obras paradas: falta luz";
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
      {s ? (
        <div className="stat" title="Demanda da cidade por casas, comércio e indústrias (100% = 100 vagas)">
          <span className="label">Demanda</span>
          <div className="demandbars">
            {DEMAND_BARS.map((b) => (
              <div className="demand" key={b.key} title={b.title}>
                <span className="dlabel">{b.label}</span>
                <div className="dbar">
                  <div
                    style={{ width: `${Math.max(0, Math.min(100, s.demand[b.key]))}%`, background: b.color }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
      {s ? (
        <>
          <UtilityStat name="Água" used={s.utilities.water.used} capacity={s.utilities.water.capacity} />
          <UtilityStat
            name="Esgoto"
            used={s.utilities.sewage.used}
            capacity={s.utilities.sewage.capacity}
            hint=" (coleta de esgoto tratada na ETE)"
          />
          <UtilityStat name="Luz" used={s.utilities.power.used} capacity={s.utilities.power.capacity} />
        </>
      ) : null}
      {showBlockedWarning ? <div className="blocked">{blockedMessage}</div> : null}
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
