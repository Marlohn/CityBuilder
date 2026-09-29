# packages/roadmap — motor de roadmap

Como funciona: `docs/PLANO.md`, seções 12.2 e 14.2.

- `signals.ts`: o que o jogo mede (desejos não atendidos, comparação com cidades reais, realismo, bot, saúde técnica, PENDENTE). Alcance é sempre **medido**, nunca projetado.
- `rice.ts`: a fórmula e as regras (urgente primeiro, dependência sobe, mistura garantida). A ordem é decidida aqui, não por um LLM.
- `items.ts`: lê o formulário de issue do GitHub. Se mudar o formulário (`.github/ISSUE_TEMPLATE/roadmap-item.yml`), mude o leitor e o teste.
- `build.ts`: gera o `ROADMAP.md` (função pura, testável).
- Números de organização (tamanho do "Agora", mistura) ficam em `roadmap/config.yaml`. Tabela de referência com fontes: `data/reference/cidade-real.yaml`.
