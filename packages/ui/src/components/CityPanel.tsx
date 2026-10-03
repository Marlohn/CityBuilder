import type { StatsView } from "@city/contract";
import { int, money } from "../format";

const UNMET_LABELS: Record<keyof StatsView["unmet"], string> = {
  school: "Crianças sem vaga na escola",
  university: "Jovens querendo faculdade (não há)",
  health: "Pessoas sem UBS por perto",
  hospital: "Pessoas sem hospital por perto",
  housing: "Queriam uma casa e não acharam",
  job: "Procurando emprego",
  transit: "Recusaram emprego (longe e sem carro)",
  parking: "Sem vaga para estacionar",
  water: "Morando sem água",
  power: "Morando sem luz",
  sewer: "Morando sem esgoto",
};

function Bar({ label, value, color }: { label: string; value: number; color: string }) {
  const w = Math.max(0, Math.min(100, value));
  return (
    <div className="demand">
      <span className="dlabel">{label}</span>
      <div className="dbar">
        <div style={{ width: `${w}%`, background: color }} />
      </div>
    </div>
  );
}

export function CityPanel({ s }: { s: StatsView }) {
  return (
    <div className="panel-body">
      <p className="note">
        <b>Avenida de acesso (borda oeste):</b> a faixa dourada que entra pelo oeste é a ligação da cidade com
        o resto do país. Toda rua nova precisa se ligar a ela; via solta não aparece aviso, mas também não sai
        nada construído ao lado até a ligação existir.
      </p>
      <h3>Demanda</h3>
      <Bar label="Residencial" value={s.demand.residential} color="#5fb36e" />
      <Bar label="Comercial" value={s.demand.commercial} color="#6f9fe0" />
      <Bar label="Industrial" value={s.demand.industrial} color="#e0c064" />
      <h3>Pessoas</h3>
      <table className="kv">
        <tbody>
          <tr>
            <td>Moradores</td>
            <td>{int(s.population)}</td>
          </tr>
          <tr>
            <td>Famílias</td>
            <td>{int(s.households)}</td>
          </tr>
          <tr>
            <td>Trabalhando</td>
            <td>{int(s.employed)}</td>
          </tr>
          <tr>
            <td>Desempregados</td>
            <td>{int(s.unemployed)}</td>
          </tr>
          <tr>
            <td>Estudantes</td>
            <td>{int(s.students)}</td>
          </tr>
          <tr>
            <td>Aposentados</td>
            <td>{int(s.retired)}</td>
          </tr>
          <tr>
            <td>Nascimentos / mortes no ano</td>
            <td>
              {int(s.birthsThisYear)} / {int(s.deathsThisYear)}
            </td>
          </tr>
          <tr>
            <td>Chegaram / foram embora no ano</td>
            <td>
              {int(s.arrivalsThisYear)} / {int(s.departuresThisYear)}
            </td>
          </tr>
          <tr>
            <td>Casas vagas / vagas de emprego</td>
            <td>
              {int(s.vacantHomes)} / {int(s.vacantJobs)}
            </td>
          </tr>
          <tr>
            <td>Carros / em movimento</td>
            <td>
              {int(s.cars)} / {int(s.vehiclesMoving)}
            </td>
          </tr>
          <tr>
            <td>Pessoas andando a pé</td>
            <td>{int(s.peopleWalking)}</td>
          </tr>
        </tbody>
      </table>
      <h3>Desejos não atendidos (este ano)</h3>
      <table className="kv">
        <tbody>
          {(Object.keys(UNMET_LABELS) as (keyof StatsView["unmet"])[]).map((k) => (
            <tr key={k} className={s.unmet[k] > 0 ? "warn" : ""}>
              <td>{UNMET_LABELS[k]}</td>
              <td>{int(s.unmet[k])}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h3>Prefeitura</h3>
      <table className="kv">
        <tbody>
          <tr>
            <td>Saldo</td>
            <td>{money(s.money)}</td>
          </tr>
          <tr>
            <td>Receita (último ano)</td>
            <td>{money(s.lastYearRevenue)}</td>
          </tr>
          <tr>
            <td>Despesa (último ano)</td>
            <td>{money(s.lastYearExpenses)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
