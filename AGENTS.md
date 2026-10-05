# Regras de desenvolvimento do CityBuilder

Estas regras valem para humanos e IAs. O objetivo é preservar as garantias importantes do jogo sem transformar uma mudança simples em um processo pesado.

## Antes de mudar

- O GitHub é a fonte de verdade do estado atual. Confira a issue/PR, o código e o histórico relevantes para a tarefa.
- Leia o `AGENTS.md` do pacote que será alterado. Consulte `docs/GUIA-DO-CODIGO.md`, `docs/VISAO.md` ou `docs/PLANO.md` quando a decisão realmente depender deles.
- Não faça uma investigação ampla por ritual: leia o necessário para entender e validar a mudança.

## Princípios que não podem quebrar

- `packages/sim` é o motor puro; tela e Babylon/React não entram nele.
- Mesma semente + mesmos comandos devem produzir o mesmo resultado. No motor, sorteio só pelo `Rng`; não use `Math.random()`.
- Preserve compatibilidade de save/replay e contratos públicos. Mudanças de formato precisam de migração quando houver versão anterior em uso.
- Número ou regra que representa o mundo real fica em `config/` ou `data/` e deve ter fonte. UI, refactor, tooling e implementação puramente técnica não precisam de pesquisa externa artificial.
- Prefira a menor mudança coerente. Não há limite artificial de arquivos: uma feature pode tocar quantos arquivos forem naturalmente necessários.
- Não remova POCs, experimentos, branches, testes ou dados só porque parecem antigos. Verifique referências e histórico; POCs visuais são trabalho válido até decisão explícita de descarte.

## Fluxo simples

1. Entenda o problema e o comportamento esperado.
2. Trabalhe em uma branch descritiva. Issue é recomendada para trabalho rastreável, mas não é pré-requisito para toda mudança pequena.
3. Implemente código e testes na mesma branch e no mesmo PR. Não existe handoff obrigatório Designer → Arquiteto → QA → Dev nem branch separada de QA.
4. Para bug ou mudança de comportamento, adicione/ajuste um teste de regressão quando ele trouxer valor. Não force TDD para documentação, refactor mecânico ou mudanças que já tenham cobertura adequada.
5. Durante o trabalho, rode os testes afetados. Antes do PR, rode `npm run check`. Testes lentos e E2E são executados quando o risco da mudança justifica; o CI também os seleciona por caminho.
6. Revise o diff final, confira o CI do HEAD exato e faça merge quando a mudança estiver correta. Não crie etapas extras só para satisfazer um papel de processo.

## Comandos

| Comando | Uso |
|---|---|
| `npm run check` | Tipos, estilo, camadas e suíte Vitest normal |
| `npm test -- <arquivo>` | Teste afetado durante a implementação |
| `npm run test:slow` | Coorte/estresse; use quando mexer em simulação, dados ou performance |
| `npm run test:e2e` | Navegador; use para render, UI, web ou comportamento visual |
| `npm run format` | Corrige formatação |
| `npm run dev` | Abre o jogo localmente |
| `npm run sim -- report --bot --days=N` | Inspeciona uma cidade sem tela |
| `npm run sim -- replay <arquivo>` | Reproduz um bug a partir de replay |
| `npm run roadmap:signals` | Mede sinais do produto |
| `npm run roadmap:build` | Gera a visão atual do roadmap |

## PRs e documentação

- Se houver issue, use `Closes #N` no PR quando a mudança realmente a concluir.
- Descreva o que mudou e como foi validado. Fonte externa só é obrigatória quando a mudança introduz ou altera uma regra/número factual da simulação.
- Atualize documentação quando mudar comando, arquitetura, contrato, formato ou comportamento que o usuário/desenvolvedor precisa conhecer. Não atualize docs por obrigação quando nada documentado mudou.
- CI verde não substitui revisão do diff; revisão extensa não substitui testes relevantes.

## Limpeza

- Branch só pode ser apagada quando estiver claramente incorporada/descartada e sem PR aberta ou trabalho exclusivo.
- Experimentos `poc/*` e `poc-*` são preservados pela higiene automática.
- Em dúvida entre apagar e preservar trabalho potencialmente útil, preserve e investigue.
