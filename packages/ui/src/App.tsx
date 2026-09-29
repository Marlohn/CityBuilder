import type { GameClient, ToolDef } from "./client";
import { CityPanel } from "./components/CityPanel";
import { HelpPanel, PerfPanel, RealismPanel } from "./components/InfoPanels";
import { BuildingPanel, PeopleList, PersonPanel } from "./components/PeoplePanels";
import { Toolbar } from "./components/Toolbar";
import { TopBar } from "./components/TopBar";
import { type Store, type UiState, useUi } from "./store";

const TABS: { id: UiState["panel"]; label: string }[] = [
  { id: "city", label: "Cidade" },
  { id: "people", label: "Pessoas" },
  { id: "realism", label: "Realismo" },
  { id: "perf", label: "Desempenho" },
  { id: "help", label: "Ajuda" },
];

export interface AppProps {
  store: Store;
  client: GameClient;
  tools: ToolDef[];
  typeLabels: Record<string, string>;
}

export function App({ store, client, tools, typeLabels }: AppProps) {
  const ui = useUi(store);
  const s = ui.stats;
  const refreshKey = s ? s.day : 0;
  return (
    <div className="app">
      <TopBar ui={ui} store={store} client={client} />
      <Toolbar ui={ui} store={store} tools={tools} />
      {!ui.panelOpen ? (
        <button
          type="button"
          className="side-tab"
          title="Abrir o painel (tecla I)"
          onClick={() => store.set({ panelOpen: true })}
        >
          ◀ Painel
        </button>
      ) : null}
      <div className={`side ${ui.panelOpen ? "" : "closed"}`}>
        <button
          type="button"
          className="side-close"
          title="Recolher o painel (tecla I)"
          onClick={() => store.set({ panelOpen: false })}
        >
          ▶
        </button>
        {ui.selectedPerson !== null ? (
          <PersonPanel client={client} store={store} id={ui.selectedPerson} refreshKey={refreshKey} />
        ) : ui.selectedBuilding ? (
          <BuildingPanel
            b={{
              ...ui.selectedBuilding,
              type: typeLabels[ui.selectedBuilding.type] ?? ui.selectedBuilding.type,
            }}
            client={client}
            store={store}
            refreshKey={refreshKey}
          />
        ) : (
          <>
            <div className="tabs">
              {TABS.map((t) => (
                <button
                  type="button"
                  key={t.id}
                  className={ui.panel === t.id ? "active" : ""}
                  onClick={() => store.set({ panel: t.id })}
                >
                  {t.label}
                </button>
              ))}
            </div>
            {s && ui.panel === "city" ? <CityPanel s={s} /> : null}
            {ui.panel === "people" ? (
              <div className="panel-body">
                <PeopleList client={client} store={store} refreshKey={refreshKey} />
              </div>
            ) : null}
            {s && ui.panel === "realism" ? <RealismPanel s={s} /> : null}
            {s && ui.panel === "perf" ? <PerfPanel s={s} /> : null}
            {ui.panel === "help" ? <HelpPanel /> : null}
          </>
        )}
        <div className="side-footer">
          <button
            type="button"
            onClick={async () => {
              const note = prompt("O que aconteceu? (opcional)") ?? "";
              const report = await client.bugReport(note);
              download(`bug-${Date.now()}.json`, report);
            }}
          >
            🐞 Reportar problema
          </button>
          <button
            type="button"
            onClick={async () => {
              const save = await client.save();
              download(`cidade-${Date.now()}.json`, save);
            }}
          >
            💾 Salvar
          </button>
          <label className="file-button">
            📂 Abrir
            <input
              type="file"
              accept="application/json"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (f) client.load(await f.text());
                e.target.value = "";
              }}
            />
          </label>
        </div>
      </div>
      <div className="toasts">
        {ui.toasts.map((t) => (
          <div key={t.id} className={`toast ${t.ok ? "ok" : "bad"}`}>
            {t.text}
          </div>
        ))}
      </div>
      {!ui.ready ? <div className="loading">{ui.error ?? "Carregando a cidade..."}</div> : null}
    </div>
  );
}

function download(name: string, text: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
