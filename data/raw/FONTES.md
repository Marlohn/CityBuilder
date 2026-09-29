# Dados brutos

- `nomes-femininos-ibge-2010.csv`, `nomes-masculinos-ibge-2010.csv`: 500 primeiros nomes por sexo, com frequência.
  Fonte: IBGE, Censo 2010 ("Nomes no Brasil"), extraídos pelo repositório https://github.com/MedidaSP/nomes-brasileiros-ibge.
- `sobrenomes-ibge-censo-2022.csv`: 22 sobrenomes mais frequentes, com frequência. Fonte: IBGE, Censo 2022,
  divulgado na imprensa (ex.: https://aratuon.com.br/cidadania/silva-santos-ou-oliveira-ibge-revela-os-sobrenomes-mais-comuns-no-brasil/).

Para gerar `data/names.json`: `npx tsx tools/build-names.ts`.
