/**
 * Cofre da prefeitura. No modo "sandbox" o dinheiro é infinito.
 */

export class Treasury {
  /** Receita e despesa do ano (dia do jogo) atual, por categoria. */
  revenue: Record<string, number> = {};
  expenses: Record<string, number> = {};
  lastYearRevenue = 0;
  lastYearExpenses = 0;

  constructor(
    public money: number,
    readonly mode: "budget" | "sandbox",
  ) {}

  canAfford(amount: number): boolean {
    return this.mode === "sandbox" || this.money >= amount;
  }

  /** Gasto obrigatório (manutenção): acontece mesmo sem dinheiro (fica no vermelho). */
  charge(amount: number, category: string) {
    if (amount <= 0) return;
    this.expenses[category] = (this.expenses[category] ?? 0) + amount;
    if (this.mode === "budget") this.money -= amount;
  }

  /** Gasto opcional (obra): só se tiver dinheiro. */
  trySpend(amount: number, category: string): boolean {
    if (!this.canAfford(amount)) return false;
    this.charge(amount, category);
    return true;
  }

  earn(amount: number, category: string) {
    if (amount <= 0) return;
    this.revenue[category] = (this.revenue[category] ?? 0) + amount;
    if (this.mode === "budget") this.money += amount;
  }

  closeYear() {
    this.lastYearRevenue = sum(this.revenue);
    this.lastYearExpenses = sum(this.expenses);
    this.revenue = {};
    this.expenses = {};
  }
}

function sum(r: Record<string, number>): number {
  let s = 0;
  for (const v of Object.values(r)) s += v;
  return s;
}
