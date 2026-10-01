import type { ToolDef } from "../client";
import { money } from "../format";
import type { Store, UiState } from "../store";

export function Toolbar({ ui, store, tools }: { ui: UiState; store: Store; tools: ToolDef[] }) {
  const groups = [...new Set(tools.map((t) => t.group))];
  const active = tools.find((t) => t.id === ui.tool);
  return (
    <div className="toolbar">
      {groups.map((g) => (
        <div className="tool-group" key={g}>
          <div className="group-label">{g}</div>
          <div className="group-buttons">
            {tools
              .filter((t) => t.group === g)
              .map((t) => (
                <button
                  type="button"
                  key={t.id}
                  className={ui.tool === t.id ? "active" : ""}
                  title={`${t.label}${t.cost !== undefined ? ` — Obra: ${money(t.cost)}` : ""}${t.upkeepPerYear !== undefined ? ` · Ano: ${money(t.upkeepPerYear)}` : ""}\n${t.hint}`}
                  onClick={() => store.set({ tool: ui.tool === t.id ? "inspect" : t.id })}
                >
                  <span className="icon">{t.icon}</span>
                  <span className="tlabel">{t.label}</span>
                </button>
              ))}
          </div>
        </div>
      ))}
      {active && active.id !== "inspect" ? (
        <div className="tool-hint">
          <b>{active.label}</b>
          {active.cost !== undefined ? ` · Obra: ${money(active.cost)}` : ""}
          {active.upkeepPerYear !== undefined ? ` · Ano: ${money(active.upkeepPerYear)}` : ""}
          <br />
          {active.hint}
          <br />
          <small>Esc ou botão direito para cancelar</small>
        </div>
      ) : null}
    </div>
  );
}
