# Operação dos agentes (o loop 24h)

> Para a próxima sessão ou LLM que for cuidar do loop. Estado de **30/09/2026**. Tudo aqui foi conferido na máquina.
> Se algo divergir, **a máquina vence**: meça de novo antes de agir e corrija este arquivo.
> O `hermes/README.md` ensina a instalar os perfis do zero. Este arquivo descreve **o que está rodando** e por quê.

## Em uma frase

### 01/10 — pedido de decisão do Dev antes de repetir diagnóstico

Um ajuste de PR bloqueado com tipo estruturado `needs_input`, no SHA ainda atual, vai ao Arquiteto existente
antes de o zelador fechar o cartão. O motivo e o cartão de origem seguem na escalada; isso não valida a
alegação do Dev sobre o teste. Uma decisão aberta segura novos ajustes Dev do mesmo PR. Após a decisão
terminar, valem novamente os gates de QA/CI e os limites anteriores; não há tentativa extra ou orçamento
reiniciado. Bloqueio sem tipo, de outro papel, de SHA antigo ou sem PR aberto mantém o tratamento anterior.
Se criar a escalada falhar, o cartão bloqueado permanece para nova tentativa do sincronizador. Sem mudar
o core do Hermes: `kanban show --json` já fornece o tipo no evento, embora `kanban list` não o exponha.

Reversão: repor o sincronizador do backup anterior; não reiniciar workers ou modificar cartões existentes.

### 01/10 — OpenCode devolve falhas do provedor ao agente

No Dev #111, o Muse recusou a chamada com `Rate limit exceeded` em 20:36:06Z e 20:51:12Z.
O CLI permaneceu aberto, com zero tokens e sem alterações; o coordenador repetiu esperas longas.
O erro estava no log interno e não na saída entregue ao Hermes. Heartbeat recente não provava progresso.

`hermes/harness/opencode_guard.py` é instalado como `opencode` em
`/opt/data/opencode/guard/bin`, antes do binário real `/opt/data/.local/bin/opencode` no PATH.
Só envolve `run`: liga `--print-logs --log-level ERROR`, conserva a saída e devolve exit 75 ao detectar
um erro estruturado da chamada principal do provedor. Erro de título e texto de teste não acionam esse corte.
O processo e seus filhos são encerrados num grupo próprio; não encerra o worker Hermes ou outros agentes.
Limite absoluto: uma hora por chamada (exit 124). Não altera arquivos.

### 01/10 — reserva automática nas duas camadas

O fallback do coordenador Hermes não alcança o OpenCode chamado no terminal. São clientes separados.
Na verificação após #206, Dev/QA tinham `fallback_providers` ausente; o CLI dependia de orientação no SOUL
para relançar outra chamada. Essa troca passa a ser automática, no mecanismo já instalado:

| Camada | Padrão | Reserva |
|---|---|---|
| Hermes Dev/QA | Zen `space-bunny-free` | Kilo `nvidia/nemotron-3-ultra-550b-a55b:free` |
| Hermes Designer/Arquiteto/Revisor | Kilo Nemotron Ultra grátis | Zen `space-bunny-free` |
| OpenCode CLI | Zen `muse-spark-1.3-contributor-free` | Kilo Nemotron Ultra grátis → Zen `space-bunny-free` |
| OpenCode com Space Bunny escolhido explicitamente | Zen `space-bunny-free` | Kilo Nemotron Ultra grátis |
| OpenCode com Kilo escolhido explicitamente | Kilo Nemotron Ultra grátis | Zen `space-bunny-free` |

O Hermes usa sua lista nativa `fallback_providers`; os modelos principais continuam iguais. O guard tenta
uma lista fixa após erro estruturado do provedor, encerra o grupo anterior e retoma o mesmo
`session.id` com `--session`. Mantém o pedido/flags e instrui continuar do estado atual sem repetir ações.
Timeout, erro de teste, falha desconhecida, sessão não confirmada e modelo fora das rotas não provocam troca.
O catálogo local deve confirmar custo zero da reserva. Partindo de Muse são no máximo três chamadas;
partindo de Kilo ou Space Bunny são duas. Se todas falharem, exit 75; o agente registra e para.
Não há recursão, retorno ao primeiro modelo ou relançamento manual. O limite de uma hora inclui toda a sequência.

O CLI exige `KILO_API_KEY`; o Hermes exige `KILOCODE_API_KEY`. O aplicador usa a mesma credencial já existente,
sem gravar valores no repo; backups de `.env`/config antes da mudança. O ambiente do terminal lê a chave local
e exporta só para o processo, sem imprimir. Os logs identificam `HERMES_OPENCODE_FALLBACK` com origem,
destino e sessão, e `FALLBACK_RESULT` com saída. Não adiciona serviço, plugin, fila ou dependência do Codex.
Uma chamada curta pelo Kilo nativo do CLI respondeu em 4,83s; retomar sessão anteriormente recusada respondeu
em 5,42s. A rota direta do Hermes foi conferida no código instalado (`route_classified_error` e
`_init_fallback_chain`); recuperação real do coordenador nas próximas sessões ainda precisa ser observada.
Falha de provedor é infraestrutura, não prova de defeito do jogo. Sem espera com loops, reinstalação ou modelo pago.
O catálogo local registra custo zero para esse reserva; uma chamada curta sem ferramentas respondeu em 4,21s.
Com o guard, a recusa real do Muse devolveu exit 75 em 3,24s. Isso verifica acesso/erro, não qualidade de código ou
ganho de entrega. Não foram repetidas tarefas do jogo. Não há recuperação ilimitada se todos os modelos falharem.
Uma verificação conjunta encontrou Kilo sobrecarregado (503) após a recusa do Muse. Seu log usa
`error.error.code=503`, sem `AI_APICallError`; esse formato também precisa devolver controle ao guard.
Depois da correção, uma chamada curta recebeu recusa do Muse e respondeu OK pelo Kilo automaticamente,
na mesma sessão, em 11,27s totais. A terceira etapa foi verificada no harness, não usada nessa chamada real.

Validação: `python3 hermes/harness/testar_opencode_guard.py`, também dentro do check existente do CI.
Os cenários reproduzem o CLI vivo após recusa, stderr fragmentado, título, saída de teste, código de erro normal,
timeout e filhos resistentes a SIGTERM. Também provam troca em ambos os sentidos, sessão preservada, limite de
três chamadas, erro 503 nativo do Kilo, ausência de chave e rejeição de custo não zero. Sem rede, LLM ou clone de agente. Todos os checks anteriores permanecem.
Fonte das flags: [CLI oficial](https://opencode.ai/docs/cli/#run); erro observado na versão instalada 1.18.33.

Deploy após CI completo verde e merge: atualizar apenas Dev/QA no clone de distribuição, copiar o guard para
a pasta acima e acrescentar ao final de `/opt/data/opencode/profile.sh`
`PATH="/opt/data/opencode/guard/bin:$PATH"; export PATH`. O aplicador de perfis instala isso e a reserva nativa,
com backups. Novos workers leem a configuração; sessões já ativas podem conservar a configuração anterior.
Não substituir o executável real nem reiniciar gateway/worker. Chamadas já iniciadas não recebem o guard.
Reversão: reverter o PR, repor guard/profile.sh e configs/.env dos backups `bak-20261001-reserva`, atualizar SOULs.
Não reiniciar worker ativo; binário e sessões originais ficam preservados.

### Atualização de 30/09 à noite: ciclo rápido autônomo

O dono autorizou mudar a fábrica e medir com tarefas novas reais, sem repetir tarefas em comparações de LLM.
As regras abaixo substituem instruções antigas de rodar check completo em cada perfil ou esperar CI no Revisor.

- **Dev/QA no mini PC:** teste afetado + tipos/estilo/camadas. `aplicar_perfis.py` exporta `CITYBUILDER_LOCAL_CHECK=1`
  no ambiente comum do terminal; `npm run check` passa a informar `CHECK LOCAL OK`, nunca `TUDO OK` da suíte inteira.
  `--local` também ativa isso explicitamente. `--full` é diagnóstico excepcional. No CI o modo local é ignorado.
- **GitHub CI:** continua rodando todas as verificações, simulações lentas e Playwright. Nenhuma cobertura removida.
  A trava de aceitação compara conteúdo QA/Dev diretamente (dois commits, sem merge-base): o rebase do #129
  produzia falso positivo mesmo com teste idêntico. Arquivo alterado de verdade segue reprovado.
- **Sincronizador:** antes de criar revisão, verifica checks completos do HEAD e ancestralidade da main. Branch atrasada
  recebe update com SHA esperado e espera fora do kanban; conflito/CI vermelho voltam ao Dev com comentário. Check ausente,
  parcial ou mergeabilidade desconhecida não liberam revisão. Não há LLM dormindo à espera do GitHub.
- **Cartão concluído não é entrega:** PR ainda aberto é reavaliado mesmo se já teve revisão do mesmo commit.
  Retomadas têm chaves próprias, sem dois cartões abertos para o mesmo PR. Depois de três retomadas de revisão ou
  três ajustes do Dev, o Arquiteto recebe o PR para decidir a causa e encaminhar QA ou tarefas menores.
  Escalada tem no máximo um cartão aberto por PR, mesmo que o SHA mude. O Arquiteto não espera CI nem revisa:
  corrige o encaminhamento e encerra. CI de infraestrutura já corrigido na main: recoloca `em-revisão` para o script
  atualizar a branch e aguardar os checks fora do kanban.
  Após três ajustes, causa no código comprovada permite **uma** tentativa adicional por PR: Arquiteto registra
  o diagnóstico, põe `pronto-pra-dev` no PR e conclui o cartão do SHA atual. O script consome a etiqueta.
  Falhou essa tentativa? Arquiteto cria tarefas menores e fecha o PR antigo. Comentário sem encaminhamento
  recebe retomada limitada do Arquiteto; nunca reinicia as três tentativas normais.
  O cartão de escalada inclui a chave `dev-diagnostico-pr-N` e seu estado real no kanban. Se já existe, informa
  explicitamente que a reserva foi utilizada e não instrui reautorizar. Novo commit do QA não repõe o orçamento.
  A mudança deixa o estado disponível ao LLM; a trava de uma tentativa por PR continua igual.
- **Revisor:** lê diff/testes e evidências, sem npm/rebase/push. Merge com `--match-head-commit` no SHA lido. Se main mudou,
  encerra o cartão sem merge: o sincronizador atualiza a branch e despacha a revisão do novo commit.
- **Timeout do Hermes:** fonte verificada na imagem fixa, `agent/tool_executor.py` e `agent/deadline.py`.
  O envelope `timeouts.tools.sequential_call` caía no padrão de 420 s, antes de alguns comandos terminarem;
  `concurrent_batch` também usa esse padrão. Ambos passam a 900 s; comandos longos devem iniciar em background e ser
  acompanhados pelo mesmo `session_id`, com esperas de até 60 s. Timeout não significa processo encerrado.
- **Capacidade:** continuam duas vagas globais e uma por perfil. São limites configurados; o máximo seguro do fluxo novo ainda não foi validado. Uma vaga por perfil também protege seu clone compartilhado. Modelos gratuitos atuais mantidos nesta primeira mudança.
  A supervisão do Codex é temporária; nenhuma regra de produção depende do Codex nem de uma aprovação humana.
- **Validação:** checks rápidos do harness antes do deploy e CI do PR de infraestrutura; eficácia medida nas entregas
  novas (QA → Dev → CI → revisão → Pages), sem bake-off. Resultados e intervenções em `hermes/avaliacao/DIARIO.md`.
- **Deploy:** fonte no clone de distribuição, nunca reset no clone de um agente ativo. Atualize perfis com `hermes profile
  update`, execute `aplicar_perfis.py` e copie o sincronizador após validação. A configuração dos próximos workers vem
  dos perfis; o gateway não precisa reiniciar para mudar SOUL/timeouts. Não mude concorrência nesta rodada.
- **Reversão:** reverta o PR, reponha o sincronizador guardado em `.bak-ciclo-rapido`, atualize os perfis e remova a linha
  `CITYBUILDER_LOCAL_CHECK` do ambiente comum. Config anterior está nos backups dos perfis.

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
| `dev` | Faz o teste passar (o código sai do OpenCode/muse); conserta a main vermelha | low | `web` | github, opencode, test-driven-development, systematic-debugging, node-inspect-debugger |

- **Modelo principal por papel (30/09):**
  - **designer, arquiteto e revisor:** `nvidia/nemotron-3-ultra-550b-a55b:free` pelo **Kilo** (provedor nativo
    `kilocode`, chave `KILOCODE_API_KEY` no `.env` do perfil, fonte `/opt/data/.kilo_key`), com fallback pro
    `space-bunny-free` do Zen.
  - **qa e dev:** `space-bunny-free` pelo Zen.
  - **Por que essa divisão:** a conta Kilo tem **~200 req/h**. Medido: arquiteto ~105/h (com revisões antigas), revisor
    ~29/h, designer 1 ciclo/dia; qa ~77/h e dev ~64/h não cabem junto.
  - **Sem vigia de consumo** (havia um; removido em 30/09): o Kilo não informa uso (nem cabeçalho, nem endpoint) e a
    contagem era estimativa. Se o Kilo recusar, o Hermes cai sozinho no reserva (provado com um modelo quebrado). O
    `metricas.py` mostra `chamadas_por_modelo`: papel do Kilo com chamadas no Zen **depois** da troca = o Kilo recusou.
  - **Medido em 30/09, depois da troca:** todas as sessões rodaram 100% no Kilo, sem fallback. O ciclo do designer foi
    de 36–60 chamadas em 31–36 min (Zen) para 19 chamadas em 7 min; as duas revisões do #65, 24 chamadas em 8 min e 12 em
    11 min. Tarefas diferentes: é indício, não prova.
  - **Modelos grátis do Kilo** que responderam em 30/09: nemotron-3-ultra (1,3 s), cohere/north-mini-code (1,2 s),
    ling-3.0-flash, dots-3-note, step-3.7-flash, laguna-s-2.1, space-bunny-alpha (23 s) e o roteador `kilo-auto/free`.
    Fora do ar: nemotron-3-super, qwen3.8-27b, inkling-small (limite diário próprio).
- **Base de ferramentas de todos:** `file, terminal, skills, todo, memory, session_search`, configurada em
  `platform_toolsets.cli` de cada perfil. É daí que o despachante tira o `--toolsets` do trabalhador; as ferramentas do
  kanban entram à parte. **Fora de propósito:** `browser` (Chromium pesado), `clarify` (não há humano pra responder),
  `computer_use`, `cronjob` (agente criando agendamento), `delegation` (sub-agentes; o paralelismo é o kanban),
  `image_gen`, `tts`, `vision`, `code_execution` e `connections`.
- **Skills enxutas:** o índice de skills vai no prompt de sistema de TODA chamada (~3k tokens com as 58 genéricas).
  Cada perfil tem o marcador `.no-bundled-skills` (`hermes skills opt-out --remove`), então o `update` não repõe.
  As do papel foram copiadas de `/opt/hermes/skills/`. Skill que o agente cria sozinho (`skill_manage`) é permitida.
- **Onde mora o quê.** O **comportamento** de cada papel (`SOUL.md`) mora no repo, em `hermes/<papel>/`, e chega ao perfil
  com `hermes profile update <papel> -y`: sobrescreve o SOUL e **preserva** config, `.env` e memória. A origem registrada
  de cada perfil (`source:` em `/opt/data/profiles/<papel>/distribution.yaml`) é o **clone de distribuição**
  `/opt/data/distribuicao/hermes/<papel>`, um clone só pra isso. **Nunca aponte pro clone de trabalho de um agente
  (`/opt/data/cb/<papel>`) e nunca dê `reset`/`checkout` nele:** em 30/09 um deploy meu tirou o clone do dev de `dev/40` no meio
  de um cartão (perdeu ~3 min de edição não commitada), e antes disso a origem do revisor apontava pro arquiteto e o `update`
  colou o SOUL errado nele. O que é **local do servidor** (ferramentas, skills, modelo, chave do Kilo) é aplicado por
  `hermes/harness/aplicar_perfis.py` (idempotente, faz backup do config).
- **Mudar o comportamento de um papel:** edite `hermes/<papel>/SOUL.md` (ou o `AGENTS.md`, que todos leem) num PR. Depois do
  merge: `git -C /opt/data/distribuicao pull` e `hermes profile update <papel> -y`. Confira com
  `diff /opt/data/profiles/<papel>/SOUL.md /opt/data/distribuicao/hermes/<papel>/SOUL.md` (tem que sair vazio; o `saude.py` faz isso).
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
| PR aberto com `em-revisão` | `revisor`: no máximo **1 aberto por PR**, e 1 por commit (commit novo com a revisão ainda na fila: a aberta olha o PR como está) |
| PR `dev/*` ou `fix/main-*` aberto **sem** `em-revisão` | `dev` ajusta o que a revisão pediu (até 3 por PR) |
| issue `pronto-pra-dev` | `dev` (até 3 rodadas; espera `Depende de #N`; **um dev por arquivo**) |
| issue `pronto-pra-teste` | `qa` (até 3 rodadas). **Prioridade +15 se o dev já tem PR aberto pra essa tarefa**: terminar antes de começar (o QA é um só, e o #79 esperava atrás de 3 tarefas novas) |
| **3 rodadas gastas sem entrega** | `arquiteto` "quebrar a tarefa" (docs/PLANO.md 12) + comentário na issue |
| menos de 3 tarefas **prontas para começar** (sem `Depende de #N` aberta) | `arquiteto` planeja (a chave muda com o estado, então não replaneja o nada). Tarefa que espera outra **não** conta: em 30/09 três tarefas do mesmo item enchiam a fila e seguravam os bugs urgentes independentes (#26, #27, #25) |
| 1× por dia | `designer`; e `qa` caça bug, só se estiver sem fila |
| cartão bloqueado | **zelador**: fecha na hora, com o motivo do bloqueio no resumo (arquiva se o Hermes recusar), pra liberar a próxima rodada |
| CI da `main` vermelho | `dev`, **prioridade 40** (a maior), um conserto aberto por vez, até 3 rodadas por commit; o cartão manda conferir se a `main` já está verde |
| PR rascunho `qa/N` com a tarefa N fechada | fechado, com comentário no PR |
| PR `dev/N` reprovado com a issue N de volta em `pronto-pra-teste` (teste do QA errado) | **sem** ajuste do dev **e sem revisão nova** (o dev recolocava `em-revisão` e o revisor só repetia a devolução: #49 e #40, ~15 min cada): ele não pode mexer em `tests/acceptance/`. O revisor devolve a tarefa ao QA (regra no SOUL), o QA corrige no mesmo `qa/N` e volta pra `pronto-pra-dev`; aí o dev traz o teste com `git merge origin/qa/N`. Achado no PR #76 (30/09): não havia caminho pra isso |
| issue `pronto-pra-dev`/`pronto-pra-teste` **sem** a etiqueta `tarefa` (um item do roadmap) | **nunca** vira cartão. Em 30/09 o arquiteto pôs a etiqueta no item #21 e nasceu cartão de QA pro item inteiro |
| PR `dev/N` mesclado (últimas 48 h) e a tarefa N ainda aberta | issue fechada, com comentário: o GitHub nem sempre fecha (o #68 dizia `Closes #39` e `closingIssuesReferences` veio vazio; sem isso a #39 ganharia outra rodada de dev) |

O arquivo tem ~340 linhas e **só faz isso**. Cada função com efeito tem gabarito em `testar_sinc.py`, e `mutantes.py`
prova que o teste fica vermelho quando o defeito volta.

**Rastro de tudo (regra do dono, 30/09: nada de solução que não dá pra rastrear depois).** O rastro fica **no próprio alvo**;
não existe registro paralelo:
- cartão criado: `created_by=sincronizador` e a chave na frente do título (`hermes kanban list`);
- cartão bloqueado que o zelador fecha: o motivo do bloqueio no resumo (`hermes kanban show <id>`);
- PR do QA fechado e tarefa mandada quebrar: comentário no PR/issue;
- o resto: a saída de cada execução do cron que fez algo fica em `/opt/data/cron/output/<job>/`.

Havia um diário no GitHub (issue #61 e `acoes.jsonl`). Foi **removido em 30/09**: repetia o que o Hermes e o GitHub já guardam
e era mais uma peça pra manter num loop que tem que rodar sem supervisor. Os arquivos da noite 29–30/09 seguem em
`/opt/data/avaliacao/` só como dado histórico. **Automação nova:** pergunte "se isso agir às 3h, como descobrem amanhã o que
aconteceu e por quê?". A resposta tem que ser "está no alvo".

**Regras do sincronizador, cada uma nasceu de uma falha real (a data está no comentário do código):**
- A tarefa espera as linhas `Depende de #N` (com número) fecharem.
- **Um dev por arquivo:** compara a lista numerada ``1. `caminho` `` que o Arquiteto escreve na tarefa.
- Tarefa de item com etiqueta `bug` ganha prioridade.
- Issue com PR **do dev** aberto que a fecha (`Closes/Fecha #N`) ou branch exata `dev/N` não ganha cartão novo. A branch
  preserva o vínculo mesmo se o agente apagar `Closes` ao atualizar a descrição, como no PR #180 (01/10).
  O rascunho do QA também diz
  `Closes #N` e **não conta**: em 30/09 ele escondeu a #49 (e a #39, que divide arquivo com ela) por ~9 h.
- **Chave arquivada continua contando como cartão existente:** verificado que o Hermes cria OUTRO cartão se a chave for
  reusada depois de arquivada; sem isso o cartão nascia de novo a cada 2 min.
- O texto de cada cartão é curto de propósito (alvo, clone limpo, `kanban_complete`/`kanban_block`). As regras dos papéis
  moram nos `SOUL.md` e no `AGENTS.md`: texto por `--body-file`, sem caractere CJK, `Closes #N` em inglês, teste lento antes
  do PR de `packages/sim`, nada de `.github/` no PR de tarefa (o revisor reprova).

### Freio de memória (`hermes/harness/freio_memoria.py`, cron `freio-memoria`, a cada 2 min)

- Encerra (SIGKILL) os terminais de chat do painel quando os processos do container passam de 85% do teto.
- **Por quê:** o painel guarda cada terminal de chat por 30 min depois de o navegador fechar, com teto **fixo** de 16 no código
  (`PtySessionRegistry(ttl=30*60, max_sessions=16)` em `hermes_cli/web_server_chat.py`, sem opção de config). São ~250 MB
  cada, então 16 passam dos 3 GB. Em 30/09 eram 11 terminais + 2 agentes e o mini PC travou.
- Casa pelo **argv exato** (`python -m tui_gateway.entry` e `node .../ui-tui/dist/entry.js`). Casar por texto solto matou um
  processo inocente no teste (um `sh -c` que só citava o nome).
- **Disparou 2 vezes na noite de 29–30/09 sem ter terminal pra matar** (2.713 e 2.620 de 3.072 MB): a pressão era dos
  agentes + comparação de modelos. Ele só registra; a resposta a isso é `max_in_progress`, não o freio.
- **Quando apagar:** se o Hermes passar a permitir configurar o teto/TTL desses terminais. Configure lá e remova o arquivo e o cron.

### Sem supervisor: o que acontece sozinho e o que fica sem dono

| Falha | O que acontece sozinho | O que fica sem dono |
|---|---|---|
| Agente trava, estoura passos ou bloqueia | zelador fecha com o motivo; nova rodada (até 3); depois o arquiteto quebra a tarefa | — |
| `main` vermelha | cartão do dev, prioridade 40, até 3 por commit. Provado em 29–30/09: vermelha às 23:15, consertada e mesclada (PR #65) em ~1 h 20, **sem supervisor** | 3 tentativas sem conserto: a `main` fica vermelha e nada mais anda |
| Revisão termina **sem decidir** (nem merge, nem reprova) | nada: o PR fica parado com `em-revisão` e sem cartão | Ainda não ocorreu. Detecte: PR com `em-revisão` e nenhum cartão aberto em `hermes kanban list` |
| Memória alta | o freio só age se houver terminal de chat do painel | agentes demais: baixe `kanban.max_in_progress` |
| Kilo recusa (limite ~200/h) | o Hermes cai no `space-bunny` do Zen | ninguém avisa: olhe `chamadas_por_modelo` nas métricas |
| Modelo grátis sai do ar (o muse do OpenCode, por exemplo) | dev/qa falham, gastam as 3 rodadas e o arquiteto é chamado (inútil) | trocar o modelo em `/opt/data/opencode/opencode.json` e `--model`. Refaça `bakeoff.sh` pra escolher |
| Token do GitHub vence ou é revogado | tudo pára com 401 | renovar o token nos `.env` dos perfis. Em 30/09 a API **não** mandou cabeçalho de validade, o que indica token sem expiração |
| Disco | nada limpa sozinho (`/opt/data/profiles` ≈ 2,5 GB e crescendo; 150 GB livres em 30/09) | olhar de vez em quando |

## Decisões do dono (não reabrir)

- **O dono não faz nenhum passo manual e não aprova nada.** Contrato, save, schema e VISAO seguem CI verde + revisão = merge
  (o CODEOWNERS está sem efeito na prática; a regra está no `AGENTS.md`). A `main` **tem** proteção (ruleset): exige
  os quatro jobs do CI (`npm run check`, `testes de aceitação protegidos`,
  `testes lentos (coorte IBGE e cidade de 50 mil)` e `teste de tela (Playwright)`), com branch atualizada antes
  do merge (`strict_required_status_checks_policy=true`), sem bypass e sem review humano obrigatório.
- **PR do supervisor (docs e harness) não passa pelo revisor:** CI verde e merge do supervisor. Deliberado: o revisor gastou
  47 min num PR só de documentação.
- **Nada espera sem motivo:** gatilho é evento, não relógio. Todo intervalo precisa de motivo escrito ao lado.
- **Nunca afirme "não dá" ou "não tem permissão" sem testar aquela operação.** O token dos agentes tem Contents, Issues,
  PRs e Workflows de escrita. Em 01/10 o dono adicionou Administration: write para corrigir o ruleset da fábrica.

### Proteção nativa da main (conferida em 01/10)

Ruleset `main`, ID `24212946`, ativo em `~DEFAULT_BRANCH`; GitHub Actions é a origem dos checks (`integration_id=15368`).
Foram preservadas as regras de exclusão e de force-push. Não criar uma segunda proteção por cima: atualize o ruleset
existente, preservando condições e bypass vazio. Confira com `gh api repos/Marlohn/CityBuilder/rules/branches/main`
ou `gh api repos/Marlohn/CityBuilder/rulesets/24212946`. A API clássica `branches/main/protection` pode devolver 404
mesmo quando há um ruleset ativo; 404 nessa rota não prova ausência de proteção.

Antes, o ruleset exigia só check geral e aceitação, sem atualização da branch. No #154, o Revisor citou main `5f2eaf8`
apesar de ela já estar em `e23d219`: todos os checks consultados estavam verdes, mas a main atual não foi considerada.
A trava nativa agora recusa merge desatualizado, independentemente do prompt. A espera continua no sincronizador.
Estado anterior guardado em `/opt/data/avaliacao/ruleset-main-antes-20261001.json`; mudanças no ruleset exigem
Administration: write. A primeira tentativa deu 403, sem alteração; após ajuste do token pelo dono, PUT e GET
confirmaram a configuração às 09:28:53 de Brasília (12:28:53Z). Registro de aplicação no PR #160.

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
| Mini PC travado (load 30, 77% de espera de disco), mas nenhum processo morto | O container encostou no teto (processos 2,9 de 3 GB): o kernel descarta o código da memória e relê do disco sem parar. A causa foi 11 processos de **chat do painel** (~250 MB cada, ignoram SIGTERM) + comparação de modelos + 2 agentes | Freio de memória (`freio_memoria.py`, cron próprio); decida pela pressão (`memory.pressure`) e por `anon`, não por "OOM kill = 0" |
| Cartão de revisão bloqueado pra sempre e zelador em laço | O contrato de PR (`--completion-contract <url>`) só fecha o cartão com o PR verde; revisão que reprova nunca fecharia | Revisão sempre `local-only`; zelador arquiva o que se recusa a fechar |
| Tarefa pronta e nenhum agente pega (loop parado ~9 h) | O rascunho do QA (`qa/N`, "Closes #N") era contado como PR do dev | `com_pr` ignora `qa/*`; cenário e mutante no teste. **O teste com dado falso passava**: só a fumaça com o GitHub real mostrou |
| Cartão arquivado é recriado a cada 2 min | A chave de idempotência não vale depois de arquivar: o Hermes cria outro cartão | `chaves()` conta arquivado como existente |
| `hermes profile update` colou o SOUL errado | A origem registrada do revisor era a pasta do arquiteto | Conferir o `source:` de cada perfil (ver **Papéis**) |
| Freio matou processo inocente | Casava texto solto na linha de comando | Casa pelo argv exato; o teste tem processos que só citam o nome |
| PR mostra arquivos inteiros reescritos | Editar no Windows grava CRLF | Normalizar pra LF antes do commit (`git diff --cached --check`) |
| 3–15% das chamadas voltam `BLOCKED: Command flagged as dangerous` | Trabalhadores rodam com `-q` (sem humano) e `approvals.single_query_mode` é `deny`: o `git reset --hard` do começo de todo cartão, `python -c`/heredoc e avisos do scanner (Tirith) caem aí | Medido em 30/09 (QA de 15,8% para 6,7% depois de tirar o `execute_code`). Liberar é decisão do dono: afrouxa uma trava. Ver **Pendências** |
| Script "compila" mas quebra | `py_compile` não pega nome inexistente | `pyflakes` + **executar** um ciclo em modo simulação antes de publicar |

## Operar

```bash
# dentro do container (docker exec -it -u 10000 -e HOME=/opt/data hermes-citybuilder bash)
H=/opt/hermes/.venv/bin/hermes
$H kanban list                     # quadro
$H kanban show <id>                # resumo, eventos e diagnóstico de um cartão
$H kanban log <id>                 # o que o agente fez
$H cron list                       # sincronizador: every 2m, last run ok?
$H config get kanban.max_in_progress   # agentes simultâneos (hoje 2; por perfil 1). Com 3, a máquina engasgou (30/09 13:00)
cd /opt/data/avaliacao && python3 metricas.py --json metricas-$(date -u +%Y%m%dT%H%MZ).json
```

**Saúde em um comando:** `python3 /opt/data/scripts/saude.py` (só leitura; sai com 1 se algo falhar). Confere os 5 perfis (SOUL
igual ao do repo, origem registrada), os 2 crons, produção == repo, token do GitHub, proteção da `main`, Kilo, memória, disco e
o invariante do loop (nada aberto com tarefa pronta; PR em revisão sem cartão). Rode no começo de toda sessão de supervisão.
Ele tem teste de mutação feito à mão: reprova com o loop ocioso, com SOUL diferente e com origem errada.

**Deploy do sincronizador e do freio:**
1. Mude os arquivos em `hermes/harness/` num PR (CI verde, merge). Confira `git diff --cached --check`: sem CRLF.
2. Com o clone atualizado no container, rode e espere `TESTE OK` em cada um:
   - `python3 hermes/harness/testar_sinc.py hermes/harness/sincronizar_github.py`: cenários com dado falso **e** uma fumaça
     com o GitHub e o kanban reais, só leitura. **Leia o que a fumaça diria que criaria e pergunte se faz sentido**
     (foi ela que achou a #49 escondida);
   - `python3 hermes/harness/mutantes.py`: reintroduz defeitos, e todos têm que ser **PEGOS**;
   - `python3 hermes/harness/testar_freio.py hermes/harness/freio_memoria.py`.
3. **Só se tudo passar**, copie pra `/opt/data/scripts/` encadeando com `&&` e guardando o anterior (`.bak-<data>`); confira
   `md5sum` produção == repo.
4. Crons (`hermes cron list`): `sincronizar-github` e `freio-memoria`, ambos `every 2m`, `--no-agent --deliver local`. Criar:
   `hermes cron create "every 2m" --name freio-memoria --script freio_memoria.py --no-agent --deliver local`.
5. Função nova com efeito colateral: escreva o cenário **e o mutante** antes.

**Subir ou descer agentes simultâneos:** revalide com o fluxo em uso. Em 01/10, o host informou Intel N150,
4 CPUs e ~8 GB de RAM; o cgroup do container confirmou teto de 3 GiB. A configuração confirmou
`kanban.max_in_progress=2` e `max_in_progress_per_profile=1`. Isso confirma o limite escolhido, não a capacidade máxima.
As medições de 30/09 são históricas: os testes locais e o fluxo mudaram. Elas não provam que três workers
sejam inviáveis hoje. Observe pico de `anon`, memória disponível do host, pressão e variação dos eventos
do cgroup durante entregas reais; `memory.peak` e eventos acumulados isolados não datam uma falha.
Uma coleta passiva com dois workers também não valida três. Antes de alterar a configuração, confira no
despachante instalado como a alteração é carregada e preserve os workers ativos. Mais de um Dev no mesmo
clone continua inseguro mesmo que sobre RAM: precisa de workspace isolado.

## Avaliação do experimento

A pergunta do dono: este modelo de loop serve pros outros projetos dele? Números em `hermes/harness/metricas.py`
(kanban + state.db + GitHub) e diário em `hermes/avaliacao/DIARIO.md`. **A métrica que decide é intervenções do supervisor
por dia**: o loop só vale se ela tender a zero. Atualize o diário a cada rodada, com número ou link do lado.

## Jev (decisão estruturada, grátis)

`POST https://opencode.ai/zen/v1/systemone` com `{"model":"jev-1.13-free","state":"<texto>","questions":{...}}`.
Os tipos de pergunta são `noul` (sim/não com probabilidade), `choice` (múltipla escolha com probabilidades) e `score`
(nota numa escala). Não gera texto. Custo zero, ~1 s. O Cloudflare barra o User-Agent padrão do Python: use um próprio.

**Em produção hoje: só o `metricas.py`** (motivo das reprovações, offline). A triagem do zelador foi **removida em 30/09**: só
tinha rodado sobre um bug meu (12 registros, 2 cartões, sempre "acesso") e nunca num caso real. O "3 rodadas → arquiteto
quebra" que ela fazia agora é regra sem LLM. Plugins oficiais do Hermes com jev (`jev-approvals`, `jev-skill-router`,
`jev-memory-selector`, `jev-cron-gate`): ainda não avaliados.

## Pendências e ideias

### Decisão do dono: `approvals.single_query_mode` (a única que não é minha)

Medido em 30/09 nas sessões dos agentes: **3–9% das chamadas** (antes da revisão de ferramentas, 7–16%) voltam
`BLOCKED: Command flagged as dangerous`. Motivos: `git reset --hard` (32 sessões: é o primeiro comando de todo cartão),
`python -c`/`node -e`/heredoc, avisos do scanner Tirith. Custo: uma chamada perdida por sessão, mais o agente tentando
contornar. O botão nativo é `approvals.single_query_mode: approve` nos `config.yaml` dos perfis, com `approvals.deny`
(lista de comandos que **nunca** passam, mesmo assim: `git push --force*`, `rm -rf /opt/data*`...). **Afrouxa uma trava de
segurança**; o container é isolado (sem docker.sock, sem HA, token só deste repo), mas por isso é decisão do dono e não do
supervisor. Sem ela, o loop funciona: só perde ~5% das chamadas.

### Próximos usos do jev (anotado em 30/09, pedido do dono: aplicar depois)

Regra para todos: **gabarito antes de ligar** (casos reais com a resposta conhecida, controle negativo incluído), registro
de cada decisão num `.jsonl` em `/opt/data/avaliacao/`, e se o jev falhar volta ao comportamento antigo.

| # | Uso | Onde entra | Estado / gabarito |
|---|---|---|---|
| 1 | **Escolher o modelo do dev pela dificuldade da tarefa** (`score` → muse, ou outro modelo se a comparação mostrar vantagem) | `criar()` dos cartões `dev-issue`, com `--model` | Depende do `bakeoff.sh` mostrar diferença real entre modelos (em andamento) |
| 2 | **Barrar item duplicado no roadmap** (`choice` entre os itens abertos + "nenhum") antes de o designer criar issue | cartão do designer | **Testado em 30/09, 21 casos** (`hermes/harness/jev_duplicata.py`): achou 6/6 duplicatas (2 reais, #59↔#60, e 4 reescritas; confiança 0,78–0,93); dos 15 controles, 12 certos, 2 sobreposições **reais** que eu não tinha visto (#31 Faculdade ↔ #64 "Jovens no ensino superior", carro some ↔ #21) e 1 erro genuíno com confiança 0,52. Limiar sugerido ≥ 0,75. **Não ligado**: falta decidir onde entra. Duplicata real existe: os agentes criaram #59 e #60 |
| 3 | **Filtrar ideia contra `docs/VISAO.md`** (`noul` "está dentro da visão?") antes de o designer gastar pesquisa | issues com etiqueta `ideia` | Não há ideia recusada no repo pra usar de gabarito |
| 4 | **Comando "perigoso" sem humano** | config de aprovações | **Medido** (ver decisão acima). O `jev-approvals` continua não avaliado; a opção nativa é `single_query_mode` + `deny` |
| 5 | Avaliar `jev-skill-router`, `jev-memory-selector` e `jev-cron-gate` | perfis | Medir tokens por chamada antes/depois; só liga se a qualidade não cair |
| 6 | Prefeito automático alternativo no jogo (`choice` entre ações) | `packages/bots`, **só como opcional**: o motor tem que continuar determinístico e sem rede | Mesma semente, partidas com e sem jev, comparar o relatório |

### Outras

- **Aviso de loop ocioso com tarefa pronta** (candidato, **não feito**): em 30/09 o loop ficou ~9 h sem nenhum cartão aberto
  com a #39 e a #49 prontas, e nada avisou (o bug era do próprio harness). Invariante barato: nenhum cartão aberto **e** issue
  `pronto-pra-dev`/`pronto-pra-teste` sem PR do dev por mais de 1 h. O rastro certo é um comentário na issue dizendo qual regra
  a segurou (dependência, arquivo em uso, PR aberto). Fica de fora por enquanto por ser mais uma peça; é a falha silenciosa
  mais provável de um loop sem supervisor.
- **Worktree por cartão** (em vez de clone por perfil) para rodar 2+ devs/qa ao mesmo tempo, e acabar com o `git reset --hard`
  no começo de todo cartão. **Verificado que o kanban suporta:** `hermes kanban create --workspace worktree --branch <nome>`. Não
  testado. Cada worktree precisa do próprio `npm ci` (com `node_modules` compartilhado os pacotes do monorepo apontam pro
  código de outro worktree e o teste engana: já aconteceu na comparação de modelos). Hoje o limite é o desenho, não a RAM.
- O mini PC tem 1 slot de RAM vazio (DDR4 SODIMM). Só vale depois do item acima.
- Medir retrabalho e intervenções depois das mudanças de 30/09 (revisor separado, trava de arquivo, teste lento antes do PR).
