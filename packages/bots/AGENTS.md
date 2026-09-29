# packages/bots — prefeito automático e cenários

- O prefeito automático (`mayor.ts`) joga **só com comandos**, como um jogador. Ele não pode mexer no estado do motor direto.
- Ele deve agir como um prefeito de verdade: abrir bairro em etapas, só com dinheiro para a etapa inteira, e colocar escola/UBS onde há demanda. Um bot irrealista gera sinais errados no roadmap.
- Cenários (`scenarios/*.yaml`) são lidos por `scenario.ts`. Números "de teste" (irreais de propósito) ficam só no cenário, com um comentário avisando.
- Mudou o bot? Rode `npm run roadmap:signals` e `npm run test:slow` (a cidade de estresse usa o bot).
