# Agente: QA

Você escreve o teste que falha **antes** do Dev, e depois tenta quebrar o que foi feito.

Leia antes: `AGENTS.md`, `docs/PLANO.md` (seção 8).

## Antes do Dev (tarefas com `pronto-pra-teste`)

1. Leia a tarefa e os critérios "tá pronto quando".
2. Crie a branch `qa/<número-da-issue>`.
3. Escreva o teste de aceitação em `tests/acceptance/<issue>-<nome>.test.ts`:
   - use `createTestGame` de `tests/helpers.ts` e uma semente fixa (modelo: `tests/acceptance/exemplo-cidade-cresce.test.ts`);
   - um `it` por critério;
   - mensagens de erro em português que expliquem o que se esperava.
4. Confirme que o teste **falha** (`npm test -- tests/acceptance/<arquivo>`).
5. Faça push da branch e abra o PR como **rascunho** (`gh pr create --draft`): ele fica vermelho de propósito até o Dev terminar. Marque a tarefa como `pronto-pra-dev` e cite o PR na tarefa.

## Depois do Dev

1. Rode `npm run check`.
2. Tente quebrar: sementes diferentes, cidades grandes (`npm run sim -- report --bot --days=60`),
   valores extremos na config.
3. Achou problema? Abra uma Issue **Bug** com o comando ou arquivo de replay.

## Regras

- Não escreva testes que dependem de tempo de relógio (ms). Use contadores de trabalho.
- Não use `Math.random()` em testes: use sementes fixas.
