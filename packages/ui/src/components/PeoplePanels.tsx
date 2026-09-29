import type { BuildingView, PersonListItem, PersonView } from "@city/contract";
import { useEffect, useState } from "react";
import type { GameClient } from "../client";
import { int } from "../format";
import type { Store } from "../store";

const PAGE = 50;

export function PeopleList({
  client,
  store,
  buildingId,
  refreshKey,
}: {
  client: GameClient;
  store: Store;
  buildingId?: number;
  refreshKey: number;
}) {
  const [filter, setFilter] = useState("");
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState<{ total: number; items: PersonListItem[] }>({ total: 0, items: [] });
  // Atualiza a lista quando o ano muda (refreshKey) ou quando o filtro muda.
  useEffect(() => {
    let alive = true;
    void refreshKey;
    client.people(filter, offset, PAGE, buildingId).then((d) => alive && setData(d));
    return () => {
      alive = false;
    };
  }, [client, filter, offset, buildingId, refreshKey]);
  return (
    <div className="people">
      {buildingId === undefined ? (
        <input
          placeholder="Buscar por nome ou número..."
          value={filter}
          onChange={(e) => {
            setFilter(e.target.value);
            setOffset(0);
          }}
        />
      ) : null}
      <div className="people-count">{int(data.total)} pessoas</div>
      <ul>
        {data.items.map((p) => (
          <li key={p.id}>
            <button type="button" onClick={() => store.set({ selectedPerson: p.id })}>
              <span className="pname">
                {p.sex === "F" ? "♀" : "♂"} {p.name}
              </span>
              <span className="pmeta">
                {p.age} anos · {p.status}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {data.total > PAGE ? (
        <div className="pager">
          <button type="button" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>
            ‹
          </button>
          <span>
            {offset + 1}–{Math.min(offset + PAGE, data.total)}
          </span>
          <button
            type="button"
            disabled={offset + PAGE >= data.total}
            onClick={() => setOffset(offset + PAGE)}
          >
            ›
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function PersonPanel({
  client,
  store,
  id,
  refreshKey,
}: {
  client: GameClient;
  store: Store;
  id: number;
  refreshKey: number;
}) {
  const [p, setP] = useState<PersonView | null>(null);
  useEffect(() => {
    let alive = true;
    void refreshKey;
    client.person(id).then((v) => alive && setP(v));
    return () => {
      alive = false;
    };
  }, [client, id, refreshKey]);
  if (!p) return <div className="panel-body">Carregando...</div>;
  const link = (pid: number, label: string) =>
    pid >= 0 ? (
      <button type="button" className="link" onClick={() => store.set({ selectedPerson: pid })}>
        {label} #{pid}
      </button>
    ) : null;
  return (
    <div className="panel-body person">
      <button type="button" className="back" onClick={() => store.set({ selectedPerson: null })}>
        ← voltar
      </button>
      <h3>
        {p.sex === "F" ? "♀" : "♂"} {p.name}
      </h3>
      <div className="pmeta">
        #{p.id} · {p.age} anos · {p.alive ? p.status : p.status} · {p.education}
      </div>
      <div className="family">
        {link(p.partnerId, "Cônjuge")} {link(p.motherId, "Mãe")} {link(p.fatherId, "Pai")}
      </div>
      <h4>Personalidade</h4>
      <div className="traits">
        {Object.entries(p.traits).map(([k, v]) => (
          <div key={k} className="trait">
            <span>{k}</span>
            <div className="dbar">
              <div style={{ width: `${Math.round(v * 100)}%` }} />
            </div>
          </div>
        ))}
      </div>
      <h4>História</h4>
      <ol className="history">
        {p.history.map((e, i) => (
          <li key={`${e.day}-${i}`}>
            <span className="hyear">{e.year}</span> {e.text}
          </li>
        ))}
      </ol>
    </div>
  );
}

export function BuildingPanel({
  b,
  client,
  store,
  refreshKey,
}: {
  b: BuildingView;
  client: GameClient;
  store: Store;
  refreshKey: number;
}) {
  const state = ["Em obra", "Funcionando", "Abandonado", "Demolido"][b.state] ?? "?";
  return (
    <div className="panel-body">
      <button type="button" className="back" onClick={() => store.set({ selectedBuilding: null })}>
        ← fechar
      </button>
      <h3>{b.type}</h3>
      <div className="pmeta">
        #{b.id} · {state} · ({b.x}, {b.y})
      </div>
      <table className="kv">
        <tbody>
          {b.homesCapacity > 0 ? (
            <tr>
              <td>Moradias ocupadas</td>
              <td>
                {b.households} / {b.homesCapacity} ({b.residents} moradores)
              </td>
            </tr>
          ) : null}
          {b.jobsCapacity > 0 ? (
            <tr>
              <td>Empregos ocupados</td>
              <td>
                {b.jobs} / {b.jobsCapacity}
              </td>
            </tr>
          ) : null}
          {b.studentsCapacity > 0 ? (
            <tr>
              <td>Alunos</td>
              <td>
                {b.students} / {b.studentsCapacity}
              </td>
            </tr>
          ) : null}
          {b.patientsCapacity > 0 ? (
            <tr>
              <td>Pessoas atendidas</td>
              <td>
                {b.patients} / {b.patientsCapacity}
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
      <h4>Pessoas ligadas a este prédio</h4>
      <PeopleList client={client} store={store} buildingId={b.id} refreshKey={refreshKey} />
    </div>
  );
}
