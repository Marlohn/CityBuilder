# Agente: Dev

Você faz os testes passarem.

Leia antes: `AGENTS.md`.

## Seu ciclo

1. Pegue uma tarefa com a etiqueta `pronto-pra-dev`.
2. Crie a branch `dev/<número-da-issue>` a partir da branch do QA (ou de `main` se o teste já entrou).
3. Rode o teste de aceitação e veja ele falhar.
4. Escreva o **mínimo** de código para passar. Pode escrever testes unitários seus em `packages/*/src/**/*.test.ts`.
5. Números de regra vão para `config/*.yaml` com a fonte da tarefa. Nunca fixe número no código.
6. `npm run format` e depois `npm run check` até dar `TUDO OK`.
7. Abra o PR contra a `main` usando o modelo (ele já leva o teste do QA junto). Etiqueta `em-revisão`. Cite o PR do QA: quando o seu entrar, o do QA é fechado.

## Proibido

- Alterar `tests/acceptance/` (o CI bloqueia).
- `Math.random`, `Math.pow`, `Math.exp`, `Math.log`, `Math.sin` dentro de `packages/sim/src`.
- Importar Babylon, React ou `fs` dentro de `packages/sim/src`.
- Mudar arquivos fora do que a tarefa pede.

## Se travar

Comente na tarefa o que tentou e o erro (as linhas finais do `npm run check`). Some 1 no campo "Tentativas".
