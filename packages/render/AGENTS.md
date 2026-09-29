# packages/render — tela

- Só fala com o motor pelo `@city/contract`. Nunca importe `@city/sim` (o CI bloqueia).
- Não guarde regra de jogo aqui: se precisa de um número de regra, ele vem pronto numa visão do contrato.
- Texto para o jogador em português. Código em inglês.
- Testar: `npm run dev` (humanos) e `npm run test:e2e` (Playwright). Performance: desenhe em lote (thin instances) e só atualize o que mudou (versões do mapa).
