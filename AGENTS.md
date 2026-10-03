# Regras para agentes de IA

Leia isto antes de qualquer tarefa. Vale para todos os papéis (Designer, Arquiteto, Revisor, QA, Dev).
Seu papel específico está em `agents/<papel>.md`.

Nas sessões diretas do ciclo de produto, o papel segue `hermes/FACTORY.md` e a missão.
Observação e avaliação da partida usam direção, imagens e controles públicos; não precisam
ler receitas de implementação nem instruções dos perfis antigos antes de jogar.

**Guia completo do código** (onde fica cada coisa, receitas para as mudanças comuns, armadilhas): `docs/GUIA-DO-CODIGO.md`.
Cada pacote tem um `AGENTS.md` com as regras dele (ex.: `packages/sim/AGENTS.md`).

## O projeto em 5 linhas

- City builder isométrico no navegador. Plano completo: `docs/PLANO.md`. Visão: `docs/VISAO.md`.
- Código em **inglês**, documentação e mensagens para o jogador em **português**.
- `packages/sim` é o motor (sem tela). `packages/render`, `packages/ui` e `packages/web` são a tela. Eles só conversam por `packages/contract`. Os outros pacotes: `cli` (jogo sem tela), `bots` (prefeito automático), `roadmap` (motor de roadmap), `director` (IA opcional).
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
8. **Tarefa pequena:** no fluxo anterior, no máximo ~3 arquivos por mudança. Missões do ciclo de produto limitam o comportamento e a dificuldade; veja `hermes/FACTORY.md`.
9. **Documentação junto com o código.** Mudou comando, pasta, regra ou jeito de fazer algo? Atualize a doc no mesmo PR (tabela no fim de `docs/GUIA-DO-CODIGO.md`).
10. **Não presuma: confira.** Antes de afirmar algo sobre o código, leia o arquivo ou rode o comando.

## Comandos

| Comando | Para quê |
|---|---|
| `npm run check` | Fora do Hermes e no CI roda tudo. No Hermes (`CITYBUILDER_LOCAL_CHECK=1`), roda tipos, estilo e camadas e informa `CHECK LOCAL OK`; não significa suíte completa verde. |
| `npm run check -- --local` | Validação rápida antes do PR. Rode também o teste afetado; o CI completo é obrigatório antes do merge. |
| `npm run check -- --full` | Suíte completa, para CI ou diagnóstico excepcional; não repetir em cada papel. |
| `npm run format` | Corrige estilo automaticamente. |
| `npm test -- <arquivo>` | Roda só um teste. |
| `npm run sim -- report --seed=X --days=N` | Simula sem tela e mostra o relatório da cidade. |
| `npm run sim -- person <id> --seed=X --days=N` | História completa de uma pessoa. |
| `npm run sim -- replay <arquivo>` | Repete um bug a partir do arquivo de replay. |
| `npm run sim -- report --bot --days=N` | Cidade construída pelo prefeito automático. |
| `npm run sim -- director --recorded=<arquivo>` | Testa a IA diretora com respostas gravadas. |
| `npm run test:slow` | Testes lentos (coorte do IBGE, cidade de 50 mil). |
| `npm run test:e2e` | Testes no navegador (Playwright). |
| `npm run roadmap:signals` | Gera os sinais automáticos para o roadmap. |
| `npm run roadmap:build` | Recalcula a ordem do roadmap e gera `ROADMAP.md` (`--issues=arquivo.json` para rodar sem a API). |
| `npm run roadmap:check` | Confere a métrica de sucesso dos itens com a etiqueta `entregue`. |
| `npm run dev` | Abre o jogo no navegador. Agentes de produto também experimentam a interface; o relatório sem tela complementa essa observação. |
| `npm run factory:browser -- act '<ações JSON>' baseline` | Ações públicas e evidência da partida no ciclo de produto (navegador iniciado pelo worker). |

## Fluxo de trabalho (GitHub)

**Missões do ciclo de produto aprovado em 03/10:** siga `hermes/FACTORY.md`. O executor direto implementa um comportamento completo; critérios prévios, CI e avaliação independente continuam obrigatórios. Os passos abaixo continuam para os cartões antigos.

1. Designer: `ideia`/sinal → Issue `roadmap` (formulário padrão).
2. Arquiteto: Issue `roadmap` → Issues `tarefa` pequenas, etiqueta `pronto-pra-teste`.
3. QA: escreve o teste de aceitação em `tests/acceptance/` numa branch `qa/<issue>`, abre PR como rascunho (fica vermelho de propósito). Etiqueta `pronto-pra-dev`.
4. Dev: branch `dev/<issue>` a partir da `qa/<issue>`, faz o teste passar e abre o PR contra a `main`, com `Closes #<issue>` na descrição (em inglês; "Fecha #" não fecha a issue). **Não pode mexer em `tests/acceptance/`** (o CI compara com a branch do QA e bloqueia).
5. Sincronizador atualiza branch atrasada e espera o CI sem ocupar agente. CI falhou ou há conflito? Devolve ao Dev. CI completo verde sobre a main atual? Revisor lê o diff e faz merge; o PR do QA é fechado.
6. Falhou 3 vezes? A tarefa volta para o Arquiteto quebrar em partes menores (o `hermes/harness/sincronizar_github.py` cria o cartão dele).

## Regras do loop automático (Hermes)

### Ciclo rápido (decisão de 30/09, fábrica autônoma)

- Dev: teste afetado + `npm run check -- --local`, push e encerra o cartão. Não espera GitHub, não roda a suíte completa nem `test:slow` localmente por rotina.
- QA: teste do seu arquivo + estilo. Preserve prova de falha e qualidade; prefira cenário controlado pequeno quando ele provar a regra. Simulações amplas continuam no CI.
- Revisor: não executa npm, não resolve conflito, não faz rebase/push. Leia tarefa, diff e resultados do CI. Reprove com evidência ou faça merge com `--match-head-commit <SHA revisado>`.
- Espera de CI é do sincronizador, sem `sleep` nem `--watch` de um agente. Se main/HEAD mudar durante a revisão, encerre sem merge: haverá novo cartão para o commit atualizado.
- Comando que pode demorar: `terminal(..., background=true)` uma única vez; acompanhe o mesmo `session_id` com `process` e esperas de até 60 s. Timeout do envelope NÃO prova que o processo parou: confira antes de iniciar outro.
- Não use `| tail` sem `set -o pipefail`: preserve o código de saída. Não abra benchmarks nem repita a mesma tarefa para comparar LLMs; a avaliação usa entregas novas reais.

Os papéis rodam sozinhos no Hermes (como funciona e o que fazer quando algo trava: `hermes/OPERACAO.md`). Valem para todos:

- **O dono não aprova nada** (decisão de 29/09). PR que mexe em contrato, save, schema da config ou `docs/VISAO.md` segue o
  fluxo normal: CI verde + revisão = merge. Nesses PRs o Revisor revisa com rigor dobrado e explica no PR o que mudou.
  Ignore "precisa de aprovação do dono" (`docs/PLANO.md` seção 12, `.github/CODEOWNERS`): nunca pare esperando o dono.
- **Texto de issue, PR e comentário vai por arquivo**: escreva em `/tmp/corpo.md` e use `gh ... --body-file /tmp/corpo.md`.
  Com `--body "..."` o shell come as crases e o texto sai cortado. Antes de postar, confira que não escapou caractere
  chinês/japonês (acontece com alguns modelos): `LC_ALL=C.UTF-8 grep -nP '[\x{3000}-\x{9fff}]' /tmp/corpo.md` tem que sair vazio.
- `ROADMAP.md` e `roadmap/signals.json` gerados na sua máquina **não se commitam**: o workflow do GitHub publica.
- Cada cartão do loop é UM alvo (uma issue, um PR). Nada fica guardado entre ciclos fora do GitHub: comece sempre com
  `git checkout main && git reset --hard origin/main && git pull`.

## Quando algo quebrar

- A falha de teste mostra a **semente** e o **comando** para reproduzir. Use-os.
- Bug com replay: `npm run sim -- replay bug.json` repete exatamente o problema.
- Logs: `npm run sim -- report --log=debug` mostra o que cada sistema fez e por quê.
