# Regras para agentes de IA

Leia isto antes de qualquer tarefa. Vale para todos os papéis (Designer, Arquiteto, QA, Dev).
Seu papel específico está em `agents/<papel>.md`.

## O projeto em 5 linhas

- City builder isométrico no navegador. Plano completo: `docs/PLANO.md`. Visão: `docs/VISAO.md`.
- Código em **inglês**, documentação e mensagens para o jogador em **português**.
- `packages/sim` é o motor (sem tela). `packages/render` e `packages/ui` são a tela. Eles só conversam por `packages/contract`.
- Todo número de regra fica em `config/*.yaml` ou `data/`, com a **fonte** ao lado. Sem fonte, marque `PENDENTE`.
- Tudo é reproduzível: mesma semente + mesmos comandos = mesmo resultado.

## Regras de ouro

1. **Pesquisa antes.** Regra de jogo, prédio ou número novo só entra com uma fonte real (link). Prefira IBGE.
2. **Faz sentido na vida real?** Pergunte: de onde veio, de quem é, para onde vai, onde fica depois. Nada surge ou some do nada.
3. **Teste primeiro.** O teste é escrito antes e precisa falhar. Depois o código faz passar.
4. **Nada fixo no código.** Número de regra vai para a config.
5. **Não quebre camadas.** O motor (`packages/sim/src`) não pode importar tela, UI, `fs`, Babylon ou React.
6. **Não use `Math.pow`, `Math.exp`, `Math.log`, `Math.sin`... no motor.** Eles podem dar resultados diferentes em cada navegador. Use tabelas prontas (geradas em `tools/`) ou só `+ - * /`.
7. **Sorteio só pelo `Rng`** do sistema (`this.rng`), nunca `Math.random()`.
8. **Tarefa pequena:** no máximo ~3 arquivos por mudança.

## Comandos

| Comando | Para quê |
|---|---|
| `npm run check` | Roda tudo. Responde `TUDO OK` ou o que quebrou. Rode sempre antes de abrir PR. |
| `npm run format` | Corrige estilo automaticamente. |
| `npm test -- <arquivo>` | Roda só um teste. |
| `npm run sim -- report --seed=X --days=N` | Simula sem tela e mostra o relatório da cidade. |
| `npm run sim -- person <id> --seed=X --days=N` | História completa de uma pessoa. |
| `npm run sim -- replay <arquivo>` | Repete um bug a partir do arquivo de replay. |
| `npm run roadmap:signals` | Gera os sinais automáticos para o roadmap. |
| `npm run roadmap:build` | Recalcula a ordem do roadmap e gera `ROADMAP.md` (`--issues=arquivo.json` para rodar sem a API). |
| `npm run roadmap:check` | Confere a métrica de sucesso dos itens com a etiqueta `entregue`. |
| `npm run dev` | Abre o jogo no navegador (só para humanos; agentes preferem o relatório em texto). |

## Fluxo de trabalho (GitHub)

1. Designer: `ideia`/sinal → Issue `roadmap` (formulário padrão).
2. Arquiteto: Issue `roadmap` → Issues `tarefa` pequenas, etiqueta `pronto-pra-teste`.
3. QA: escreve o teste de aceitação em `tests/acceptance/` numa branch `qa/<issue>`, abre PR. Etiqueta `pronto-pra-dev`.
4. Dev: branch `dev/<issue>`, faz o teste passar. **Não pode mexer em `tests/acceptance/`** (o CI bloqueia).
5. Arquiteto revisa. CI verde + aprovação = merge.
6. Falhou 3 vezes? A tarefa volta para o Arquiteto quebrar em partes menores.

## Quando algo quebrar

- A falha de teste mostra a **semente** e o **comando** para reproduzir. Use-os.
- Bug com replay: `npm run sim -- replay bug.json` repete exatamente o problema.
- Logs: `npm run sim -- report --log=debug` mostra o que cada sistema fez e por quê.
