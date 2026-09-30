# Operação dos agentes (o loop 24h)

> Para a próxima sessão ou LLM que for cuidar do loop. Estado de **30/09/2026**. Tudo aqui foi conferido na máquina.
> Se algo divergir, **a máquina vence**: meça de novo antes de agir e corrija este arquivo.
> O `hermes/README.md` ensina a instalar os perfis do zero. Este arquivo descreve **o que está rodando** e por quê.

## Em uma frase

O GitHub é o quadro oficial (issues, etiquetas, PRs, CI). Um script sem LLM (o **sincronizador**) transforma etiqueta
em cartão no **kanban do Hermes**. O despachante do Hermes entrega cada cartão ao perfil certo, e os perfis fazem o
trabalho com modelos grátis.

```
GitHub (issues/etiquetas/PRs/CI) --lê a cada 2 min--> sincronizador (sem LLM)
                                                           | cria cartões (idempotente)
                                                           v
                              kanban do Hermes (kanban.db) --despachante no gateway--> perfil do papel
                                                                                          |
                                                             space-bunny-free (coordena) + OpenCode/muse (escreve código)
                                                                                          |
                                                              commits, PRs, comentários e etiquetas de volta no GitHub
```

## Onde roda

- Container **`hermes-citybuilder`**, app do CasaOS no mini PC da casa, **separado** do Hermes da casa (não misturar).
  Compose em `/var/lib/casaos/apps/hermes-citybuilder/docker-compose.yml` (arquivo do root; edite via container auxiliar).
- Imagem **fixa** `nousresearch/hermes-agent:v2026.9.24` (Hermes 0.21.5). Não use `:latest`.
- Dados: `/DATA/AppData/hermes-citybuilder` no host = `/opt/data` no container. Entra no backup diário da casa.
  Clones, caches e binários ficam de fora: voltam sozinhos.
- Sem `docker.sock` e sem Home Assistant. Teto de 3 GB de RAM, `cpu_shares` 50 (a casa tem prioridade).
- Painel na porta 9120, com senha. **Credenciais nunca vão pro repo** (este repo é público); estão com o operador.
- `docker exec` entra como root: use **`-u 10000`**, senão cria arquivo de root que o Hermes não consegue ler.

## Papéis (perfis)

| Perfil | Faz | Esforço | Ferramentas extras (além da base) | Skills |
|---|---|---|---|---|
| `designer` | 1 item de roadmap por dia, com pesquisa e fonte | medium | `web` | github, grounded-citations, blocked-page-recovery |
| `arquiteto` | **Só planeja**: quebra o próximo item da issue #2 em tarefas | medium | `web` | github, codebase-inspection |
| `revisor` | **Só revisa** PRs: CI verde sobre a main atual + regras = merge, ou pede mudanças | medium | — | github, systematic-debugging, codebase-inspection |
| `qa` | Teste de aceitação que falha antes do código; caça bug quando está sem fila | low | — | github, opencode, test-driven-development, systematic-debugging |
| `dev` | Faz o teste passar (o código sai do OpenCode/muse); conserta a main vermelha | low | — | github, opencode, test-driven-development, systematic-debugging, node-inspect-debugger |

- **Base de ferramentas de todos:** `file, terminal, skills, todo, memory, session_search`, configurada em
  `platform_toolsets.cli` de cada perfil. É daí que o despachante tira o `--toolsets` do trabalhador; as ferramentas do
  kanban entram à parte. **Fora de propósito:** `browser` (Chromium pesado), `clarify` (não há humano pra responder),
  `computer_use`, `cronjob` (agente criando agendamento), `delegation` (sub-agentes; o paralelismo é o kanban),
  `image_gen`, `tts`, `vision`, `code_execution` e `connections`.
- **Skills enxutas:** o índice de skills vai no prompt de sistema de TODA chamada (~3k tokens com as 58 genéricas).
  Cada perfil tem o marcador `.no-bundled-skills` (`hermes skills opt-out --remove`), então o `update` não repõe.
  As do papel foram copiadas de `/opt/hermes/skills/`. Skill que o agente cria sozinho (`skill_manage`) é permitida.
- Reaplicar tudo isso: `hermes/harness/aplicar_perfis.py` (idempotente, faz backup).
- Os perfis vêm das distribuições em `hermes/<papel>/`, instaladas com `--name <papel>` (sem prefixo `cb-`).
  Cada perfil tem clone próprio, e por isso roda **1 cartão por vez**.
- **Node 22 nos agentes** (`/opt/data/.local/node22`, primeiro no PATH): é a versão do CI. A imagem traz Node 26.
- **O OpenCode só enxerga a pasta do projeto:** rodando sozinho, ele recusa ler arquivo fora dela (auto-reject).
  Tudo que o agente precisa ler vai dentro do clone.
- **Modelos:** o coordenador é `space-bunny-free` pelo OpenCode Zen, com a chave `public`. Quem escreve código é
  `opencode run` com `muse-spark-1.3-contributor-free`. Config em `/opt/data/opencode/opencode.json`.
- Cada perfil tem HOME próprio (`/opt/data/profiles/<p>/home`) e PATH mínimo no terminal. O `.profile`/`.bashrc` de cada
  HOME carrega `/opt/data/opencode/profile.sh`, que põe `gh`/`opencode` no PATH, `OPENCODE_CONFIG`, `GH_TOKEN` e locale
  UTF-8. **Perfil novo precisa dessa linha**, senão o agente reinstala o opencode sozinho.

## O sincronizador (`hermes/harness/sincronizar_github.py`)

Roda como cron `--no-agent` do perfil default, a cada 2 min. A cópia **em produção** é
`/opt/data/scripts/sincronizar_github.py`. Este repo guarda o fonte. Deploy = copiar + testar (veja **Operar**).

| Gatilho (lido no GitHub) | Cartão |
|---|---|
| PR aberto com `em-revisão` | `revisor`, 1 por commit; revisão de commit velho que nem começou é arquivada |
| PR `dev/*` aberto **sem** `em-revisão` | `dev` ajusta o que a revisão pediu (até 3 rodadas) |
| issue `pronto-pra-dev` | `dev` (até 3 rodadas) |
| issue `pronto-pra-teste` | `qa` (até 3 rodadas) |
| menos de 3 tarefas abertas | `arquiteto` planeja (a chave muda com o estado, então não replaneja o nada) |
| 1× por dia | `designer`; e `qa` caça bug, só se estiver sem fila |
| cartão bloqueado | o **jev** classifica o motivo (`triagem.jsonl`); tarefa grande demais perde a etiqueta e vira cartão "quebrar a tarefa" pro arquiteto; o resto é fechado na hora pra liberar a próxima rodada |
| CI da `main` vermelho | cartão do `dev` com **prioridade 40** (a maior), 1 por commit da main |
| PR rascunho `qa/N` com a tarefa N fechada | fechado com comentário |
| PR `fix/main-*` sem `em-revisão` | volta pro `dev` ajustar, como os `dev/*` |

**Regras embutidas, cada uma nasceu de uma falha real (a data está no comentário do código):**

- A tarefa espera as linhas `Depende de #N` (com número) fecharem.
- **Não libera 2 devs no mesmo arquivo:** compara a lista numerada ``1. `caminho` `` que o Arquiteto escreve na tarefa.
- Tarefa de item com etiqueta `bug` ganha prioridade.
- Issue com PR aberto que a fecha (`Closes/Fecha #N`) não ganha cartão de dev novo.
- **PR de tarefa que mexe em `.github/` é reprovado:** mudança de CI vai em PR próprio (`fix/ci-*`), revisado com rigor.
- O corpo de todo cartão ensina:
  - começar com o clone limpo;
  - texto de issue/PR sempre por `--body-file`;
  - conferir que não há caractere CJK antes de postar;
  - `Closes #N` em inglês;
  - rodar `npm run test:slow -- tests/slow/performance.test.ts` quando mexer em `packages/sim`.

## Decisões do dono (não reabrir)

- **O dono não faz nenhum passo manual e não aprova nada.** Contrato, save, schema e VISAO seguem CI verde + revisão = merge
  (o CODEOWNERS está sem efeito na prática). A `main` fica sem proteção de branch.
- **Nada espera sem motivo:** gatilho é evento, não relógio. Todo intervalo precisa de motivo escrito ao lado.
- **Nunca afirme "não dá" ou "não tem permissão" sem testar aquela operação.** O token dos agentes tem Contents, Issues,
  PRs e Workflows de escrita, mas não tem Administration.

## Armadilhas já pagas

| Sintoma | Causa | Como está resolvido |
|---|---|---|
| `agent.reasoning_effort` não muda nada | O Hermes só manda o parâmetro a provedores que conhece e descarta pro `opencode-zen`, sem avisar | Provider `custom:zen` com `extra_body.reasoning_effort` (provado com servidor de captura) |
| muse dá `FreeTierError` | O plano grátis só atende o cliente OpenCode | Delegar código pelo `opencode run`; não burlar |
| Config nova do kanban não pega | O gateway só lê a config ao subir | `s6-svc -r /run/service/gateway-default` (os agentes sobrevivem) |
| "Pico de 3 GB" assusta | `memory.current` do cgroup inclui cache de disco | Decida por `anon` em `memory.stat`; hoje processos ≈ 1–2 GB em 3 GB |
| `grep -P` quebra com acento/CJK | O container não tem locale | `profile.sh` exporta `C.UTF-8` |
| Check "testes de aceitação protegidos" vermelho sem culpa | Comparava com o merge na `main` atual | PRs #47 e #56: compara com o commit do dev e ignora arquivo idêntico à `main` |
| Agente diz "anexado" numa issue | A API do GitHub não anexa arquivo | O reprodutor vai num branch `qa/bug-*` |
| Arquiteto seguiu prioridade errada | O `ROADMAP.md` commitado fica velho | A ordem oficial é a issue #2 (publicada pelo workflow) |
| `main` vermelha com os dois PRs verdes | Merge com CI velho: o #54 foi mesclado com o CI de antes do #46 entrar | O revisor faz `gh pr update-branch` e espera o CI de novo se a `main` andou; `main` vermelha vira cartão |
| "É a versão do Node" | Hipótese sem controle (falhava no 22 **e** no 26) | Sempre rode o controle antes de culpar o ambiente |
| Dev mexe na trava do CI dentro do PR da tarefa | A trava vigia o próprio Dev | PR de tarefa que toca `.github/` é reprovado; CI muda em `fix/ci-*` |
| Chamada ao jev dá 403 (Cloudflare 1010) | O User-Agent padrão do Python é barrado | User-Agent próprio (`citybuilder-sincronizador/1.0`) |
| Modelo "grátis" recusa (`FreeTierError`) | Só `space-bunny` e `jev` atendem fora do cliente OpenCode, mesmo com a chave da conta | Os outros só pelo `opencode run -m opencode/<id>` |
| Script "compila" mas quebra | `py_compile` não pega nome inexistente | `pyflakes` + **executar** um ciclo em modo simulação antes de publicar |

## Operar

```bash
# dentro do container (docker exec -it -u 10000 -e HOME=/opt/data hermes-citybuilder bash)
H=/opt/hermes/.venv/bin/hermes
$H kanban list                     # quadro
$H kanban show <id>                # resumo, eventos e diagnóstico de um cartão
$H kanban log <id>                 # o que o agente fez
$H cron list                       # sincronizador: every 2m, last run ok?
$H config get kanban.max_in_progress   # agentes simultâneos (hoje 3)
cd /opt/data/avaliacao && python3 metricas.py --json metricas-$(date -u +%Y%m%dT%H%MZ).json
```

**Deploy do sincronizador:**
1. Mude o arquivo em `hermes/harness/`.
2. Rode `pyflakes`.
3. Copie para `/tmp` no container e rode `main()` com `criar`/`zelar` trocados por `print` (modo simulação contra o GitHub real).
4. Só então copie para `/opt/data/scripts/`.

**Subir ou descer agentes simultâneos:** decida pelo pico de `anon` (o `vigia.sh` mede). Ajuste
`kanban.max_in_progress` e reinicie só o gateway.

## Avaliação do experimento

A pergunta do dono: este modelo de loop serve pros outros projetos dele? Números em `hermes/harness/metricas.py`
(kanban + state.db + GitHub) e diário em `hermes/avaliacao/DIARIO.md`. **A métrica que decide é intervenções do supervisor
por dia**: o loop só vale se ela tender a zero. Atualize o diário a cada rodada, com número ou link do lado.

## Jev (decisão estruturada, grátis)

`POST https://opencode.ai/zen/v1/systemone` com `{"model":"jev-1.13-free","state":"<texto>","questions":{...}}`.
Os tipos de pergunta são `noul` (sim/não com probabilidade), `choice` (múltipla escolha com probabilidades) e `score`
(nota numa escala). Não gera texto. Usos em produção: a triagem do zelador (`sincronizar_github.py`, `triar`) e o motivo
das reprovações nas métricas (`metricas.py`). Se o jev falhar, quem chama volta ao comportamento antigo. Existem plugins
oficiais do Hermes com ele (`jev-approvals`, `jev-skill-router`, `jev-memory-selector`, `jev-cron-gate`), ainda não avaliados.

## Pendências e ideias

### Próximos usos do jev (anotado em 30/09, pedido do dono: aplicar depois)

Regra para todos: **gabarito antes de ligar** (casos reais com a resposta conhecida, controle negativo incluído), registro
de cada decisão num `.jsonl` em `/opt/data/avaliacao/`, e se o jev falhar volta ao comportamento antigo.

| # | Uso | Onde entra | Gabarito antes de ligar |
|---|---|---|---|
| 1 | **Escolher o modelo do dev pela dificuldade da tarefa** (`score` fácil/média/difícil → muse, ou outro modelo se a comparação mostrar vantagem) | `criar()` dos cartões `dev-issue`, passando `--model` | Só depois da comparação `hermes/harness/bakeoff.sh` mostrar diferença real entre modelos; classificar tarefas já entregues e conferir com o tempo e as rodadas que cada uma levou |
| 2 | **Barrar item duplicado no roadmap** (`choice` entre os itens abertos + "nenhum") antes de o designer criar issue | cartão do designer ou o sincronizador comentando na issue nova | Pares conhecidos: um duplicado de verdade e um "parecido mas diferente"; tem que acertar os dois |
| 3 | **Filtrar ideia contra `docs/VISAO.md`** (`noul` "está dentro da visão?") antes de o designer gastar pesquisa | issues com etiqueta `ideia` | Ideias já recusadas e já aceitas pelo designer como gabarito |
| 4 | **Comando "perigoso" em trabalhador sem humano**: hoje é `deny` cego. Avaliar o plugin oficial `jev-approvals` (ou `approvals.mode: smart`) | config de aprovações dos perfis | Lista de comandos seguros e perigosos: nenhum perigoso pode passar |
| 5 | Avaliar os plugins `jev-skill-router`, `jev-memory-selector` e `jev-cron-gate` | perfis | Medir tokens por chamada antes/depois; só liga se a qualidade não cair |
| 6 | Prefeito automático alternativo no jogo (`choice` entre ações) | `packages/bots`, **só como opcional**: o motor tem que continuar determinístico e sem rede | Mesma semente, partidas com e sem jev, comparar o relatório |

### Outras

- Worktree por cartão (em vez de clone por perfil) para rodar 2+ devs/qa ao mesmo tempo. Hoje o limite é o desenho, não a RAM.
- O mini PC tem 1 slot de RAM vazio (DDR4 SODIMM). Só vale depois do item acima.
- Medir retrabalho e intervenções depois das mudanças de 30/09 (revisor separado, trava de arquivo, teste lento antes do PR).
