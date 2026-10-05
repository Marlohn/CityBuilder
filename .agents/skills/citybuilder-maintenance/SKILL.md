---
name: citybuilder-maintenance
description: Fluxo enxuto para manutenção e desenvolvimento do Marlohn/CityBuilder.
---

# Manutenção do CityBuilder

Use o GitHub como fonte atual do projeto. Leia o `AGENTS.md` da raiz e o `AGENTS.md` do pacote afetado antes de alterar código.

## Como trabalhar

1. Leia a issue/PR e o código/histórico necessários para entender o alvo.
2. Faça a menor mudança coerente, sem limite artificial de arquivos e sem dividir trabalho em papéis ou branches de QA/Dev.
3. Código e teste pertencem à mesma mudança. Para bugs/comportamento, prefira um teste de regressão; não crie testes cerimoniais para mudanças que não se beneficiam deles.
4. Rode testes afetados durante a implementação e `npm run check` antes do PR. Use `test:slow` para mudanças de simulação/dados/performance e `test:e2e` para render/UI/web quando pertinente.
5. Confira o diff e os checks do HEAD exato antes de mergear.

## Segurança

- Preserve determinismo, camadas, contratos e compatibilidade de save/replay.
- Regras e números do mundo real precisam de fonte; mudanças puramente técnicas não.
- Não apague branch, POC, experimento, teste ou dado sem evidência de que não contém trabalho útil. Preserve especialmente branches `poc/*` e `poc-*`.
- Prefira corrigir diretamente problemas claros em PRs, mantendo o escopo.

## Issues, PRs e limpeza

- Uma issue pode ser implementada diretamente em uma branch/PR; não existe fluxo obrigatório de Designer, Arquiteto, QA e Dev.
- Ao triar, use evidência do código atual: válida, duplicada, resolvida ou obsoleta.
- Ao limpar branches, confira PRs, commits exclusivos e referências. Branch com PR aberta ou conteúdo não incorporado fica.
- Ao concluir, informe mudança, validação e qualquer risco restante, com links de issue/PR/commit quando existirem.

Atualize esta skill somente quando surgir uma regra operacional estável e realmente útil. Não a transforme em diário nem replique documentação já existente.
