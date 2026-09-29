import type { StatsView } from "@city/contract";

export function RealismPanel({ s }: { s: StatsView }) {
  return (
    <div className="panel-body">
      <p className="note">
        Compara a cidade com dados reais do Brasil. Número fora da faixa vira um alerta para o roadmap.
      </p>
      {s.realism.length === 0 ? <p>Ainda sem dados (a cidade precisa crescer um pouco).</p> : null}
      <table className="kv realism">
        <tbody>
          {s.realism.map((r) => (
            <tr
              key={r.id}
              className={r.status === "ok" ? "" : r.status === "insufficient-data" ? "muted" : "warn"}
            >
              <td title={r.source}>{r.label}</td>
              <td>
                {r.value === null
                  ? "—"
                  : r.value.toFixed(r.unit === "%" || r.value >= 10 ? 1 : 2).replace(".", ",")}{" "}
                {r.unit}
                <div className="range">
                  faixa real: {r.min}–{r.max}
                </div>
              </td>
              <td className="status">
                {r.status === "ok" ? "✔" : r.status === "low" ? "▼" : r.status === "high" ? "▲" : "…"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function PerfPanel({ s }: { s: StatsView }) {
  const systems = Object.entries(s.perf.systems).sort((a, b) => b[1] - a[1]);
  return (
    <div className="panel-body">
      <p className="note">
        Tempo que cada parte da simulação gasta por tick (média). Ajuda a achar o que está pesando.
      </p>
      <table className="kv">
        <tbody>
          <tr>
            <td>Total por tick</td>
            <td>{s.perf.msPerTick.toFixed(2)} ms</td>
          </tr>
          {systems.map(([k, v]) => (
            <tr key={k}>
              <td>{k}</td>
              <td>{v.toFixed(3)} ms</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h4>Pico de trabalho num tick</h4>
      <table className="kv">
        <tbody>
          {Object.entries(s.perf.counters).map(([k, v]) => (
            <tr key={k}>
              <td>{k}</td>
              <td>{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function HelpPanel() {
  return (
    <div className="panel-body help">
      <h3>Como jogar</h3>
      <ul>
        <li>
          <b>Vias:</b> escolha Rua ou Avenida e arraste no mapa (sempre em linha reta).
        </li>
        <li>
          <b>Zonas:</b> arraste um retângulo encostado nas vias. Casas e prédios aparecem quando há demanda.
          Só dá para construir em lote com frente para a rua: quarteirões de 4 a 6 quadradinhos aproveitam
          melhor o espaço.
        </li>
        <li>
          <b>Serviços:</b> escola e UBS precisam encostar numa via. Crianças precisam de escola a até 2 km.
        </li>
        <li>
          <b>Clique</b> num prédio para ver quem mora, trabalha ou estuda ali. Clique numa pessoa para ver a
          história dela.
        </li>
      </ul>
      <h3>Câmera</h3>
      <ul>
        <li>W A S D ou setas: mover · botão direito arrastando: mover</li>
        <li>Roda do mouse: zoom · Q / E: girar 90°</li>
      </ul>
      <h3>Tempo</h3>
      <p>Cada dia do jogo representa um ano de vida. Na velocidade 1x, um dia dura 2 minutos.</p>
    </div>
  );
}
