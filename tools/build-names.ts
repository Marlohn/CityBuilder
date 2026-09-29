/**
 * Gera data/names.json a partir de data/raw (IBGE). Uso: npx tsx tools/build-names.ts
 * Os nomes do IBGE vêm em maiúsculas e sem acento; aqui viram "Título" e ganham acento
 * nos casos comuns (lista abaixo).
 */
import { readFileSync, writeFileSync } from "node:fs";

const ACCENTS: Record<string, string> = {
  JOSE: "José",
  JOAO: "João",
  ANTONIO: "Antônio",
  ANTONIA: "Antônia",
  MARCIA: "Márcia",
  FABIO: "Fábio",
  FABIANA: "Fabiana",
  MARCIO: "Márcio",
  SERGIO: "Sérgio",
  MONICA: "Mônica",
  PATRICIA: "Patrícia",
  CLAUDIA: "Cláudia",
  CLAUDIO: "Cláudio",
  LUCIA: "Lúcia",
  LUCIO: "Lúcio",
  VITORIA: "Vitória",
  LAIS: "Laís",
  ANDRE: "André",
  CESAR: "César",
  VINICIUS: "Vinícius",
  MATEUS: "Mateus",
  CAUA: "Cauã",
  CAUE: "Cauê",
  RAIMUNDO: "Raimundo",
  SEBASTIAO: "Sebastião",
  ANDREIA: "Andréia",
  ROSANGELA: "Rosângela",
  ANGELA: "Ângela",
  ANGELICA: "Angélica",
  JESSICA: "Jéssica",
  VERONICA: "Verônica",
  DEBORA: "Débora",
  BARBARA: "Bárbara",
  TANIA: "Tânia",
  VANIA: "Vânia",
  SONIA: "Sônia",
  GLORIA: "Glória",
  NATALIA: "Natália",
  LETICIA: "Letícia",
  CECILIA: "Cecília",
  EMILIA: "Emília",
  JULIA: "Júlia",
  LIVIA: "Lívia",
  ELAINE: "Elaine",
  REGINA: "Regina",
  EDNA: "Edna",
  HELENA: "Helena",
  IRACEMA: "Iracema",
  ROGERIO: "Rogério",
  ROMULO: "Rômulo",
  OTAVIO: "Otávio",
  FLAVIO: "Flávio",
  FLAVIA: "Flávia",
  SILVIO: "Sílvio",
  SILVIA: "Sílvia",
  VALERIA: "Valéria",
  MARILIA: "Marília",
  EMERSON: "Emerson",
  EVERTON: "Everton",
  JONATAS: "Jônatas",
  ISAIAS: "Isaías",
  MOISES: "Moisés",
  ELIAS: "Elias",
  NICOLAS: "Nícolas",
  NATANAEL: "Natanael",
  HERCULES: "Hércules",
  ALVARO: "Álvaro",
  AURELIO: "Aurélio",
  ROSALIA: "Rosália",
  ANALIA: "Anália",
  LUCIANA: "Luciana",
  GABRIELA: "Gabriela",
  ERICA: "Érica",
  ERICO: "Érico",
  GISELIA: "Gisélia",
  SIRLEI: "Sirlei",
  SUELI: "Sueli",
  IRENE: "Irene",
  IVONE: "Ivone",
  SIMONE: "Simone",
  ZELIA: "Zélia",
  NUBIA: "Núbia",
  ROSA: "Rosa",
  SOFIA: "Sofia",
  ESTER: "Ester",
  RAQUEL: "Raquel",
};

function titleCase(upper: string): string {
  const fixed = ACCENTS[upper];
  if (fixed) return fixed;
  return upper.charAt(0) + upper.slice(1).toLowerCase();
}

function readNames(file: string): [string, number][] {
  const lines = readFileSync(file, "utf8").trim().split("\n").slice(1);
  return lines.map((line) => {
    const cols = line.split(",").map((c) => c.replace(/"/g, ""));
    return [titleCase(cols[0]!), Number(cols[2])] as [string, number];
  });
}

const female = readNames("data/raw/nomes-femininos-ibge-2010.csv");
const male = readNames("data/raw/nomes-masculinos-ibge-2010.csv");
const surnames = readFileSync("data/raw/sobrenomes-ibge-censo-2022.csv", "utf8")
  .trim()
  .split("\n")
  .slice(1)
  .map((l) => {
    const [n, f] = l.split(",");
    return [n!, Number(f)] as [string, number];
  });

const out = {
  source:
    "IBGE Censo 2010 (500 prenomes mais frequentes por sexo) e IBGE Censo 2022 (22 sobrenomes mais frequentes). Gerado por tools/build-names.ts a partir de data/raw.",
  female,
  male,
  surnames,
};
writeFileSync("data/names.json", `${JSON.stringify(out)}\n`);
console.log(`nomes: ${female.length} F, ${male.length} M, ${surnames.length} sobrenomes`);
