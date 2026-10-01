import type { StatsView } from "@city/contract";
import { money } from "../format";

/** "impostos_e_repasses" -> "Impostos e repasses". */
function categoryLabel(id: string): string {
  return id.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
}

/** Obra (investimento, uma vez) ou custeio (todo ano). O id da categoria diz o que e. */
function isInvestment(id: string): boolean {
  return id.startsWith("obras_");
}

export function FinancePanel({ s }: { s: StatsView }) {
  const finance = s.finance;
  const ids = [
    ...new Set([...Object.keys(finance.revenueByCategory), ...Object.keys(finance.expensesByCategory)]),
  ];
  const operating = finance.netOperating >= 0;
  const row = (id: string) => (
    <tr key={id}>
      <td>{categoryLabel(id)}</td>
      <td>{money(finance.revenueByCategory[id] ?? finance.expensesByCategory[id] ?? 0)}</td>
    </tr>
  );
  return (
    <div className="panel-body">
      <h3>Finanças</h3>
      <h4>Custeio (todo ano)</h4>
      <table className="kv">
        <tbody>{ids.filter((id) => !isInvestment(id)).map(row)}</tbody>
      </table>
      <h4>Obras / investimento (uma vez)</h4>
      <table className="kv">
        <tbody>
          {ids.filter(isInvestment).map(row)}
          <tr>
            <td>Investimento no ano</td>
            <td>{money(finance.investment)}</td>
          </tr>
        </tbody>
      </table>
      <h4>Resultado</h4>
      <table className="kv">
        <tbody>
          <tr>
            <td>A cidade se paga?</td>
            <td style={{ color: operating ? "var(--accent)" : "var(--bad)" }}>
              {money(finance.netOperating)}
            </td>
          </tr>
        </tbody>
      </table>
      <h4>Histórico do saldo</h4>
      <table className="kv">
        <tbody>
          {finance.yearlyHistory.map((entry) => (
            <tr key={entry.year}>
              <td>Ano {entry.year}</td>
              <td>{money(entry.moneyEnd)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
