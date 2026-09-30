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

| Perfil | Faz | Clone | Esforço do modelo |
|---|---|---|---|
| `designer` | 1 item de roadmap por dia, com pesquisa e fonte | `/opt/data/cb/designer` | medium |
| `arquiteto` | **Só planeja**: quebra o próximo item da issue #2 em tarefas | `/opt/data/cb/arquiteto` | medium |
| `revisor` | **Só revisa** PRs: CI verde + regras = merge, ou pede mudanças | `/opt/data/cb/revisor` | medium |
| `qa` | Teste de aceitação que falha antes do código; caça bug quando está sem fila | `/opt/data/cb/qa` | low |
| `dev` | Faz o teste passar (o código em si sai do OpenCode/muse) | `/opt/data/cb/dev` | low |

- Os perfis vêm das distribuições em `hermes/<papel>/`, instaladas com `--name <papel>` (sem prefixo `cb-`).
  O `revisor` usa a distribuição do arquiteto. Cada perfil tem clone próprio, e por isso roda **1 cartão por vez**.
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
| cartão bloqueado | fechado na hora (zelador), para liberar a próxima rodada |

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

## Pendências e ideias

- Worktree por cartão (em vez de clone por perfil) para rodar 2+ devs/qa ao mesmo tempo. Hoje o limite é o desenho, não a RAM.
- O mini PC tem 1 slot de RAM vazio (DDR4 SODIMM). Só vale depois do item acima.
- Medir retrabalho e intervenções depois das mudanças de 30/09 (revisor separado, trava de arquivo, teste lento antes do PR).
