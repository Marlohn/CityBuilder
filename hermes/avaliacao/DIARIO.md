# Diário da avaliação: agentes Hermes + kanban + LLM grátis (CityBuilder)

**Pergunta do dono (29/09/2026):** isso funciona pros meus outros projetos, ou é perda de tempo?
**Como medir:** números saem de `/opt/data/avaliacao/metricas.py` (kanban.db, state.db dos perfis e GitHub), com um
`metricas-<data>.json` por coleta. O qualitativo fica neste diário, uma seção por rodada. Nada aqui é impressão sem número
ou link do lado.

## O sistema avaliado

- 4 papéis (designer, arquiteto, qa, dev) = perfis do Hermes 0.21.5. O coordenador é `space-bunny-free`; quem escreve
  código é o OpenCode com `muse-spark-1.3` (ambos grátis). O quadro oficial é o GitHub e o kanban do Hermes despacha.
- O "harness" é meu: o sincronizador (script sem LLM, a cada 2 min) transforma etiqueta do GitHub em cartão, respeitando
  dependências, prioridade de bug, rodadas de revisão e o zelador.
- Máquina: mini PC da casa, 4 núcleos, 8 GB (1 slot vazio), dividido com HA, radar, Plex etc. Container com teto de 3 GB.

---

## Rodada 0: linha de base (29/09 18:30Z → 30/09 00:13Z, 5,7 h)

| Métrica | Valor |
|---|---|
| Tarefas fechadas / criadas | 3 / 7 |
| Lead time da tarefa (issue → merge), mediana | 1,9 h |
| PRs de dev mesclados | 3 (1.132 linhas) |
| Ritmo extrapolado | ~12 tarefas/dia |
| Rodadas de revisão por PR | #43: 1 · #54: 1 · #46: 3 · #52: 5 (mediana 2) |
| Cartões de ajuste / cartões de dev | 4 / 4 (**retrabalho de 100%**) |
| Tempo com 0/1/2/3 agentes rodando | 3% / 27% / 61% / 10% |
| Fila (mediana, criado → começou) | qa 22 min · revisão 17 min · dev 1 min |

**Por papel (modelo = tempo pensando; ferramentas = comandos, testes, OpenCode):**

| Papel | Sessões | Tokens entrada/saída/raciocínio | Horas modelo / ferramentas |
|---|---|---|---|
| arquiteto | 11 | 730k / 531k / 396k | 2,5 / 1,5 |
| qa | 8 | 641k / 382k / 195k | 1,75 / 1,0 |
| dev | 8 | 421k / 135k / 53k | 0,7 / 1,5 |
| designer | 2 | 226k / 145k / 128k | 0,8 / 0,3 |

### O que funcionou (com prova)

- **A qualidade do trabalho dos agentes é real, não enfeite.**
  - O arquiteto achou, **medindo**, uma perda de desempenho que o dev tinha atribuído à `main` (PR #52, 1ª revisão).
  - O qa escreve teste que falha pelo motivo certo, com linha de base medida.
  - O designer cita IBGE/INEP e escreve na issue quando não achou fonte.
- **O ciclo fecha sozinho:** tarefa → teste → código → revisão → ajuste → merge aconteceu sem mim (#37, #48) por ~2 h.
- **O dev com OpenCode/muse é rápido:** mediana de 19 min por tarefa, e o tempo vai pra ferramentas (testes), não pro modelo.

### Gargalos (com número)

1. **Revisão.** O arquiteto é o papel mais caro (2,5 h de modelo, 730k tokens de entrada) e faz duas coisas: planejar e revisar.
   A revisão espera 17 min na fila porque o perfil só roda 1 cartão por vez (clone compartilhado).
2. **Retrabalho de 100%.** Cada PR de dev precisou em média de 1 ajuste. As causas foram:
   - desempenho que só aparece no CI lento (o dev não rodou o teste lento antes do PR);
   - conflito com a `main`, porque tarefas em paralelo mexem no mesmo arquivo (`trafficSystem.ts` em #36/#37/#48);
   - falso positivo do CI (2 vezes).
3. **Fila do qa, 22 min:** 1 slot por perfil, e o qa pega todas as tarefas.
4. **Paralelismo travado por desenho, não pela RAM:** os processos chegaram a no máximo 2 GB de 3 GB, e mesmo assim só 10% do
   tempo teve 3 agentes. O limite real é **1 cartão por perfil**, por causa do clone compartilhado.

### Falhas encontradas e quem causou

| # | Falha | Origem | Travaria o loop sem supervisão? |
|---|---|---|---|
| 1 | Clone sujo entre ciclos | harness (meu) | degradaria |
| 2 | Texto cortado pelo shell (`--body`) | harness | não |
| 3 | 5 tarefas liberadas juntas, fora de ordem | harness | **sim**, conflitos em série |
| 4 | Arquiteto seguiu `ROADMAP.md` velho (pegou #4 em vez do bug #21) | repo + harness | não, só prioridade errada |
| 5 | qa escreveu "anexado" (mentira da API) e estourou o orçamento de passos | modelo | cartão travado |
| 6 | Dev ganharia cartão duplicado com PR já aberto | harness | desperdício |
| 7 | "Fecha #37" em vez de "Closes #37" | modelo | issue não fecharia |
| 8 | CI protegido: falso positivo quando a `main` anda | repo (CI) | **sim**, com a `main` protegida |
| 9 | Cartão bloqueado ficava pra sempre | harness | **sim** |
| 10 | PR reprovado não voltava pro dev | harness | **sim** |
| 11 | Esforço do modelo ignorado pelo provedor (config engolida) | Hermes | não, só lentidão |
| 12 | Caracteres chineses no texto ("a mesma拥") | modelo | não, ruído |
| 13 | CI protegido: 2º falso positivo (merge da `main` no dev) | meu conserto incompleto | **sim** |
| 14 | **Dev editou a trava do CI dentro do próprio PR** | modelo | risco de governança |

**Leitura crítica:**
- **Das 14 falhas, 8 foram do harness ou do repo e 5 do modelo.** O LLM grátis não é o elo fraco: o encanamento é.
- **5 falhas teriam parado o loop sem ninguém olhando.** O dia 1 **não** mostrou autonomia; mostrou que ela é construível.

### Custo oculto: supervisão

- Neste dia 1 houve ~20 intervenções minhas (correções de harness, de PR e de instrução), mais a montagem.
- O custo real do experimento está na supervisão, feita por um modelo pago, e não nos agentes, que são grátis.
- O projeto só compensa se esse número cair a ~0 por dia. É a métrica principal das próximas rodadas.

### Ideias pra testar (fora da caixa)

1. **Worktree por cartão** em vez de clone por perfil: permite 2+ devs e 2 revisões ao mesmo tempo. Ataca os gargalos 1, 3 e 4.
2. **Separar revisor de planejador** (perfil novo): a revisão para de esperar o planejamento.
3. **Levar os testes pra antes do PR:** o dev roda o teste lento de desempenho antes de abrir PR quando mexe em `packages/sim`.
   Ataca a maior causa de retrabalho.
4. **Serializar tarefas que tocam o mesmo arquivo:** o arquiteto já lista os arquivos; o sincronizador não libera 2 devs no
   mesmo arquivo ao mesmo tempo. Ataca os conflitos.
5. **Pente de RAM (slot vazio):** só vale depois do item 1; hoje a RAM não é o limite.

### Veredito parcial (dia 1)

**Promissor na qualidade, imaturo na autonomia.** O trabalho dos agentes é bom o bastante pra valer a pena. O gargalo é
encanamento (ordem, retrabalho, travas), e encanamento se conserta uma vez e serve pra todo projeto. Ainda **não** dá pra
dizer "funciona sem supervisão": falta passar um dia inteiro com ~0 intervenções.

---

## Rodada 1 (30/09 00:15Z → 01:40Z)

### Mudanças de harness (cada uma ataca um gargalo da rodada 0)

- **Perfil `revisor`**, que só revisa; o arquiteto passa a só planejar. Estreou certo: reprovou o #52 pela regra de CI.
- **Trava de arquivo:** o sincronizador não libera 2 devs no mesmo arquivo. A 1ª versão tinha falso positivo, porque
  contava os arquivos que a tarefa manda "NÃO mexer". Agora lê só a lista numerada.
- **Teste lento antes do PR,** quando o dev mexe em `packages/sim`.
- **Revisão obsoleta arquivada** quando chega commit novo.
- **Governança:** o dev editou a trava do CI dentro do PR da tarefa. A lógica estava certa (4 cenários de gabarito),
  mas foi extraída pro PR #56, e PR de tarefa que mexe em `.github/` agora é reprovado.
- **`main` vermelha vira cartão prioridade 40.** A causa real foi **merge com CI velho** (#54 mesclado com o CI de
  antes do #46). A hipótese "diferença de Node" era falsa, e o controle no Node 26 derrubou. Regra nova: o revisor faz
  `gh pr update-branch` e espera o CI de novo se a `main` andou.
- **Node 22 nos agentes** (a imagem trazia Node 26; o CI usa 22). Não era a causa, mas paridade com o CI é obrigatória.
- **PR do QA fechado sozinho** quando a tarefa fecha (o #44 ficou esquecido).

### Perfis revisados (docs oficiais do Hermes)

| Achado | Antes | Depois |
|---|---|---|
| Skills | 58 genéricas em todos (Apple, vídeo, música…); o índice vai no prompt de toda chamada | 2 a 5 por papel |
| Ferramentas | 17 iguais em todos, incluindo `computer_use`, `cronjob`, `clarify`, `delegation`, `browser` | base + `web` só pra quem pesquisa |
| SOUL do revisor | copiado do arquiteto ("você é o Arquiteto") | SOUL próprio de revisão |
| SOUL do arquiteto | mandava revisar PR, seguir o `ROADMAP.md` velho e esperar aprovação do dono | só planeja, issue #2, sem aprovação |

### Jev (estudo à parte)

- **É o único modelo grátis, além do space-bunny, que responde fora do OpenCode.** Endpoint `/zen/v1/systemone`,
  ~1 s, custo zero. O Cloudflare barra o User-Agent padrão do Python (erro 1010): use um UA próprio.
- **Gabarito com revisões reais:** motivo da reprovação e aprovou/reprovou deram 9/9, estáveis. Na triagem de cartão
  travado, acertou o caso real + 3 sintéticos. Os sintéticos fui eu que escrevi; a validação real sai do `triagem.jsonl`.
- **Em produção:** triagem do zelador (tarefa grande → arquiteto quebra) e motivos de reprovação nas métricas.
- **Existem plugins oficiais:** `jev-approvals`, `jev-skill-router`, `jev-memory-selector` e `jev-cron-gate`. Candidatos.

### Modelos grátis (contra o documento de pesquisa do dono)

- **Chamada direta à API** (o que o Hermes faz): com a chave `public` **e com a chave da conta**, todos devolvem
  `FreeTierError`, menos o `space-bunny` e o `jev`. A recomendação do documento ("Hermes + Zen + API key") não vale hoje.
- **Pelo OpenCode:** respondem muse, mimo-2.6, nemotron-ultra, space-bunny, longcat e big-pickle.
  O `ling` estava com o endpoint fora do ar e o `lightning` respondeu vazio.
- **Comparação com gabarito (#38):** a 1ª rodada foi inválida. O OpenCode sozinho recusa ler arquivo fora do projeto,
  e a tarefa estava em `/tmp`. Refeita com a tarefa dentro do worktree; o resultado vem na rodada 2.

### Números da rodada (métricas com jev)

- 11 revisões classificadas: 5 aprovadas, 6 reprovadas (desempenho 2, regra 2, conflito 1, CI no PR 1).
- Desempenho e conflito somam metade das reprovações, e são exatamente as duas causas atacadas nesta rodada.
- Pico de processos com 3 agentes + comparação de modelos: 2890 MB de 3072. Limite baixado pra 2 enquanto a
  comparação roda.

### Intervenções do supervisor nesta rodada: ~12

A maioria virou regra no sincronizador. Continua alto: a métrica que decide ainda não caiu.

### Incidentes do fim da rodada 1 (30/09 ~01:15Z–01:45Z)

- **Mini PC travado (load 30).** O container encostou no teto de 3 GB: os processos usavam 2,9 GB e o código era relido
  do disco sem parar (77% de espera de disco, pressão "full" em 69%). O Home Assistant seguiu respondendo.
  - **Não houve OOM:** "oom_kill = 0" não prova que está tudo bem.
  - **Causa:** 11 processos de chat do painel do Hermes (~250 MB cada, um vivo havia 1 h, ignoram SIGTERM), mais a
    comparação de modelos e 2 agentes.
  - **Resposta:**
    - parei a comparação de modelos e dei SIGKILL nos chats; os processos caíram de 2,9 pra 1,4 GB;
    - criei o **freio de memória** (≥ 85% encerra os chats do painel), provado com gabarito: mata só o processo falso de
      chat e poupa o inocente;
    - achado de custo: **a interface do Hermes (painel + chats) chegou a pesar mais que os agentes.**
- **Zelador em laço:** o cartão de revisão com contrato de PR não podia fechar (o PR foi reprovado) e o zelador não
  conferia o resultado. Ficou 7 triagens seguidas no mesmo cartão. Agora a revisão é sempre `local-only` e o zelador
  arquiva o que recusa fechar.
- **Merge do #52 pelo cartão antigo do arquiteto** (criado antes do revisor existir):
  - respeitou a proteção da `main` (os 2 checks obrigatórios estavam verdes no merge; ele considerou furar e recusou);
  - mas o check ficou verde porque **o próprio PR alterou a trava que o julgava** (no GitHub, o PR roda o CI da versão
    dele). A regra "PR de tarefa não mexe em `.github/`" fecha esse buraco;
  - escreveu que o #56 foi "revisado pelo dono", o que é **falso** (autoridade inventada). Corrigido no registro.
- **A proteção da `main` estava ativa** (ruleset, o dono fez os cliques): exige `npm run check` + teste protegido, sem
  review obrigatório. É a trava dura que a avaliação pedia.
- **Erro meu:** publiquei o sincronizador sem teste verde (`cp` fora do `&&`). O procedimento agora exige o `testar_sinc.py`
  com `TESTE OK`, e o teste não escreve mais no log real.
- **Comparação de modelos (parcial, interrompida pelo incidente):** muse **9/9** nos testes de aceitação da #38, em 539 s,
  sem mexer no teste. Os outros modelos ficam pra quando a máquina tiver folga, rodando com 1 agente só.
