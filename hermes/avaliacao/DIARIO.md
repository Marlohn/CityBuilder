# Diário da avaliação: agentes Hermes + kanban + LLM grátis (CityBuilder)

## 01/10 23:52Z — decisão estruturada antes de outra rodada Dev

Dev208 diagnosticou de 22:48:12 até 23:17:07 e bloqueou `needs_input` em 23:16:59, citando
teste protegido e alternativas QA/Arquiteto. O zelador completou em 23:18:45 e criou outra rodada
Dev em 23:18:53. Isso comprova repetição do papel, não que o teste esteja errado. No código, o
tipo do evento não era usado; o zelador removia o bloqueio e o despacho via apenas chave/status.
O cenário antes da alteração criou `dev-ajuste-pr-208-3cc5697-retomar-r1`, sem decisão Arquiteto.

Agora o zelador lê o último evento estruturado, encaminha somente `needs_input` de ajuste Dev
do SHA atual a `escalar_pr` e só então fecha o bloqueio. Decisão aberta segura novos ajustes do
PR. Depois de concluída, o despacho normal volta com os mesmos limites e gates; o QA continua
decisão semântica do agente, nunca encaminhamento do supervisor por palavras do comentário.
Falha ao criar a escalada conserva o bloqueio. Não muda eventos/cartões antigos nem workers.

Cenários verificam tipo, papel, SHA, PR aberto, duplicatas, decisão aberta/concluída e erro de escrita.
Os 27 mutantes anteriores permanecem, com três novos para perda do encaminhamento, repetição de
Dev durante decisão e associação a SHA antigo. CI completo e merge atuais precedem implantação.
Sem instalar componente ou repetir tarefa do jogo; ganho de tempo depende de eventos reais futuros.

## 01/10 22:45Z — orçamento consumido explícito na escalada

No PR201, `dev-diagnostico-pr-201` terminou em 22:19:55Z e devolveu ao QA. O QA publicou a correção às
22:25:14Z, mas o Arquiteto voltou a orientar merge pelo Dev e manteve autorização no mesmo PR em 22:31,
22:41 e 22:45, sem novo HEAD. O script respeitou a trava de uma tentativa extra e chamou retomadas limitadas;
as mensagens dos agentes não produziram encaminhamento executável. Houve custo de novas rodadas sem avanço.

O corpo da escalada tinha instrução condicional de conferir se a tentativa fora usada, embora a chave e seu
estado já estivessem no dicionário consultado pelo script. Agora o cartão inclui esses fatos e escolhe a instrução
correta: chave ausente permite autorização única; chave existente informa status e orçamento consumido, sem
instruir reautorizar. Novo commit do QA não reinicia tentativas. SOUL do Arquiteto reforça o encaminhamento após
esgotamento. Não altera limites, cartões, labels ou features diretamente pelo supervisor. Cenários e mutantes do
sincronizador passam a rodar no check existente do CI, sem rede/LLM e sem mudar os quatro checks obrigatórios.

O cenário no harness falhou contra a produção anterior: o cartão não fornecia o orçamento apurado. Após mudança,
verifica estados terminais e a ausência da instrução contraditória. Os mutantes anteriores permanecem, com um
novo para omissão do orçamento consumido. Isso valida os fatos e a instrução entregue ao agente, não garante
que o LLM cumprirá a orientação. Eficácia depende das próximas escaladas reais. Publicar/aplicar só após CI/merge.

## 01/10 — reserva automática entre provedores, após #206

O dono pediu conferir fallback e desempenho por mais algumas rodadas, sem dependência futura do Codex.
Config real: Dev/QA coordenados por Zen `space-bunny-free`, sem fallback; outros três papéis Kilo Nemotron Ultra
grátis com reserva Zen. O CLI OpenCode usa Muse e não herda a reserva do Hermes. #206 expôs a recusa e evitou
espera infinita, mas a decisão de trocar ainda dependia do agente. Essa lacuna motivou tornar a recuperação
determinística no guard já existente e preencher a reserva nativa Dev/QA, mantendo os principais atuais.

OpenCode tem provedor Kilo nativo no catálogo (`KILO_API_KEY`), diferente do nome da credencial do Hermes
(`KILOCODE_API_KEY`). Sem instalar plugin, uma chamada curta sem ferramentas respondeu OK em 4,83s;
retomar uma sessão de supervisão recusada anteriormente respondeu OK em 5,42s. Catálogo confirmou custo zero
do Nemotron Ultra `:free` e Space Bunny grátis. Isso valida interface/retomada, não qualidade de código ou
ganho de desempenho entre modelos. Nenhuma tarefa do jogo foi repetida.

Uma verificação conjunta em 22:00:49Z encontrou Muse recusado e Kilo sobrecarregado com 503. O formato nativo
`error.error.code=503` não tinha `AI_APICallError` e escapava à detecção; a verificação terminou pelo limite
de 45s, não com sucesso. Corrigida a detecção desse log real e definida a sequência Muse→Kilo→Space Bunny,
no máximo três chamadas. Partindo de Kilo ou Space Bunny há uma reserva, sem retorno ao primeiro modelo.
O harness verifica trocas na mesma sessão, encerra cada grupo antes do seguinte, limita o total, ignora reserva
com custo não zero/credencial ausente e conserva os cenários de #206. Erro de teste não aciona reserva.
Após essa correção, uma chamada curta em 22:08:56Z recebeu a recusa do Muse, mudou automaticamente para Kilo
na mesma sessão `ses_f067c955dffeJ2tkEQpsbF82SK` e respondeu OK: exit 0 em 11,27s no total. Sem ferramentas ou
alterações. O terceiro passo fica validado pelo cenário simulado de falhas consecutivas; não houve nova falha
503 nessa chamada. Isso verifica recuperação do transporte, não tempo de entrega de feature.
O Hermes instalado normaliza a lista em `_init_fallback_chain` e aciona a troca em `route_classified_error`
para limite de uso; não alterar o core do Hermes. O comportamento real do coordenador com a nova config
ainda depende de novas sessões e falhas observadas. Deploy somente após CI completo verde e merge atual.

## 01/10 21:34Z — vaga Dev ocupada por OpenCode recusado pelo provedor

Depois das três entregas autônomas #191/#195/#199, o Dev #111 (`t_aba7ae20`, sessão Hermes
`20261001_203151_2880e2`) iniciou às 20:31:49Z. O OpenCode 1.18.33 registrou recusa do Muse
às 20:36:06.628Z e, após relançamento, 20:51:12.401Z: `AI_APICallError: Rate limit exceeded`.
As sessões OpenCode `ses_f06d19164ffeqGSg6AlF0TWTcK` e `ses_f06c3beaeffejexBNf8s0kHQFx`
tinham zero tokens e nenhum passo de ferramenta. O log entregue ao Hermes tinha só a abertura do modelo.
O processo 217840 continuava vivo; o coordenador repetiu esperas de cerca de 15 minutos, mantendo a vaga
única do perfil Dev ocupada e outros cartões prontos. Não é evidência de CPU insuficiente ou defeito da feature.

Uma chamada curta sem ferramentas, no clone seguro de supervisão, confirmou que `--print-logs --log-level ERROR`
expõe a recusa em stderr enquanto o CLI permanece aberto. O guard encerrou somente seu grupo de processos e
devolveu exit 75 em 3,24s. Uma chamada curta com `opencode/space-bunny-free` respondeu `OK` em 4,21s; custo
zero confirmado no catálogo local. São verificações de protocolo/acesso, não benchmarks nem repetição do jogo.

O harness reproduziu o comportamento anterior com processo simulado; após a mudança, falha rápida, isolamento
de stdout/título, preservação dos códigos de saída, timeout e encerramento de filhos passaram. O guard é
determinístico; Dev/QA recebem orientação para conferir o diff e fazer uma tentativa gratuita reserva.
Não escolhe modelo automaticamente nem altera arquivos do agente. CI completo e merge ainda necessários
antes do deploy. Melhora no tempo das próximas entregas ainda não medida. Nenhum worker foi interrompido.

## 01/10 15:43Z — preparação do navegador no CI

Nos jobs de tela dos runs `36881805274` (#181) e `36882075526` (#180), a instalação de Chromium e
dependências levou 5min26s e 5min19s; os testes levaram 7min24s e 5min06s. Logs mostram esperas nos
downloads de fontes/Mesa no mirror Ubuntu. Isso é tempo externo ao mini PC, sem relação com mais vagas locais.

O job passa a usar a [imagem oficial do Playwright](https://playwright.dev/docs/ci#via-containers),
`mcr.microsoft.com/playwright:v1.63.0-noble`; o registro MCR respondeu 200 e o lock confirma versão 1.63.0.
Conserva Node22, comando e todos os testes, nome do check e proteções. A imagem traz browsers e bibliotecas;
a conferência de versão falha com mensagem direta se o pacote e a imagem divergem numa atualização futura.
Nenhuma imagem ou ferramenta foi instalada no mini PC. O pull da imagem também custa tempo: só o CI real
do PR e as próximas entregas podem confirmar economia. Sem benchmark repetindo tarefa e sem promessa de ganho.
Fonte de configuração: [Docker oficial](https://playwright.dev/docs/docker), com `--init` e `--ipc=host`.

## 01/10 15:12Z — teste local verde, mas código não enviado

Na sessão Dev `20261001_145857_57bf5c` da tarefa #173, o teste afetado passou 3/3 e o check local
passou após alterar contrato, stats e UI. O agente fez push sem `git add`/`git commit`: o PR #180
ficou no SHA `c2f4394`, que continha apenas o teste do QA. O CI reprovou duas asserções porque
`unmet.hospital` ainda era inexistente no código enviado. Isso não foi lentidão do hardware ou do GitHub.
O sincronizador devolveu sozinho; Dev `t_d444334e` publicou a correção `bcf134d` às 15:09Z e concluiu
às 15:11Z. O CI novo ainda estava em execução. O supervisor não escreveu a feature nem encaminhou cartões.

O SOUL Dev passa a pedir commit explícito, árvore limpa e comparação do SHA local, branch remota e PR
antes de concluir, registrando o SHA dos testes. É orientação, não trava nova: o benefício depende das
próximas entregas reais. O deploy só acontece após merge validado e será registrado no PR.
Também foi corrigida a afirmação antiga sobre capacidade: dois workers configurados não provam que
três sejam inviáveis no fluxo atual. Coleta passiva temporária iniciada em 15:03:13Z, a cada 15 s,
por 30 min, em `/opt/data/avaliacao/recursos-ciclo-rapido-20261001.jsonl`; não é parte da fábrica.

Às 15:19Z, foi conferido outro defeito: o ajuste de #180 substituiu a descrição e apagou `Closes #173`.
O sincronizador só reconhecia o vínculo pelo texto e criou `dev-issue-173-r2` além de `dev-ajuste-pr-180-bcf134d`.
A correção considera também a branch exata `dev/N` dos PRs abertos. `qa/N` e nomes parecidos continuam sem
reservar tarefa do Dev; o QA que precisa destravar esse PR mantém prioridade. O cenário reproduziu a duplicata
na versão anterior e ganha mutante para impedir regressão. O supervisor não interrompeu o clone ativo.
O segundo CI de #180 falhou em dois snapshots de `tests/unit/reference.test.ts`; esse ajuste segue com o Dev.

## 01/10 13:25Z — diagnóstico terminou, mas não havia retorno ao Dev

PR #165 implantado às 13:15:12Z; main `4324ded` e Pages verdes. Config e SOUL Dev conferidos, saúde OK.
As sessões já ativas preservaram suas ferramentas antigas. Nenhuma entrega nova completa após esse deploy.

Arquiteto concluiu `t_03460b00` às 13:19:10Z, após 46min41s. No comentário #156 registrou regressão do hospital:
na medição dele, população 18.516 na main contra 8.586 no PR e caixa final negativo. O supervisor conferiu o
registro e o encaminhamento; não repetiu a simulação nem implementou a correção. O agente manteve a issue
`pronto-pra-dev`, mas as três chaves `dev-ajuste-pr-156-*` já estavam gastas. O sincronizador não criava outro Dev
nem reabria a decisão do Arquiteto no mesmo SHA: diagnóstico concluído deixava o PR parado.

Correção: autorização explícita `pronto-pra-dev` **no PR**, cartão do Arquiteto concluído para o SHA atual e uma
única tentativa adicional por PR. Sem autorização, reencaminha ao Arquiteto com retomadas limitadas. Depois dessa
tentativa, ele deve quebrar a tarefa e fechar o PR antigo. Não reinicia o orçamento de três nem contorna QA/CI.
O caso #156 voltará ao Arquiteto para autorizar ou dividir; nenhum rótulo de encaminhamento é aplicado pelo Codex.
JEV não agrega aqui: é estado de cartões e etiquetas, resolvido por regra determinística.

## 01/10 13:00Z — pesquisa do Dev sem ferramenta web

PR de documentação #161 mesclado com os checks completos verdes e branch atualizada; não exige deploy funcional.
A primeira candidata nova é #162: QA iniciou às 12:34:30Z, terminou às 12:40:30Z e abriu o rascunho #164.
Dev iniciou às 12:43:31Z. A tarefa pede cinco valores de custos/prazos com fontes. Não está publicada nem conta como entrega.

Sessão `20261001_124333_70246b`: ao redor de 12:53Z já havia 48 chamadas, aproximadamente 51 mil tokens de entrada
e 18 mil de saída. Houve pesquisa por `curl`, resposta 429 do FNDE e esperas `sleep 45` e `sleep 40`, depois buscas
DuckDuckGo via Jina. O perfil Dev não tinha `web`; Designer e Arquiteto tinham. São fatos do config e das mensagens,
não prova de que toda a demora vem disso. O container já oferece pesquisa e extração sem instalação adicional:
uma consulta oficial retornou em 3,48 s. A disponibilidade dos provedores gratuitos pode variar.

Correção proposta: liberar `web` no Dev e orientar pesquisa com as ferramentas do Hermes, sem repetir página bloqueada
com sleeps/proxies. A fonte deve sustentar o número; pesquisa incompleta segue o tratamento de tarefa travada.
Sem novo serviço, skill ou JEV. Ganho de tempo ainda não medido; avaliar nas próximas tarefas reais. A sessão ativa
mantém sua configuração original e não será interrompida para aplicar esta mudança.

## 01/10 09:28 Brasília (12:28Z) — proteção nativa e acompanhamento retomado

PR #160 implantado às 12:06:03Z. O Hermes publicou #153 (11:49:22Z, revisão 8min26s) e #154 (12:14:10Z,
revisão 7min23s), com CI dos HEADs e Pages verdes, sem intervenção operacional nesses merges. Ambos são trabalho
iniciado antes dos deploys; não contam como as três entregas novas. A meta de dez minutos não está comprovada.

Ao auditar #154, o Revisor usou main antiga `5f2eaf8`; a main já tinha `e23d219`. A API de proteção clássica deu 404,
mas a leitura de rulesets confirmou proteção ativa: só dois checks obrigatórios e strict=false. Corrigido o diagnóstico
inicial de ausência de proteção. A tentativa de ajustar esse ruleset deu 403; o acompanhamento temporário foi removido
por bloqueio de permissão, sem parar o Hermes. O dono adicionou Administration: write e autorizou continuar.

PUT e GET confirmaram às 12:28:53Z: ruleset existente `24212946` com strict=true e quatro checks obrigatórios da
GitHub Actions. Condições, bypass vazio e regras de exclusão/force-push preservados. Sem plugin ou serviço novo.
Contagem de três entregas novas permanece em zero; acompanhamento retomado após a alteração de configuração.

JEV: uma consulta de observação sobre #156 às 12:02Z respondeu `investigar` em 1,134 s. Havia CI do PR vermelho,
alegação do Dev de falha também na main e CI da main verde. A resposta não mudou o fluxo nem comprova economia
de tempo. Confiança retornada não é prova de acerto. Registro em `/opt/data/avaliacao/jev-observacoes.jsonl` e
comentário no #159. Uso pontual, somente se poupar decisão/releitura custosa; sem plugins ou benchmarks repetidos.

## 01/10 11:45Z — retomada não pode virar espera de CI

Após deploy do #159 às 11:30:05Z, o sincronizador criou retomadas e atualizou `dev/120` e `dev/144` sem LLM.
O Dev ajustou #156 em 3min54s, mas o CI ainda estava vermelho (aceitação #48); não conta como entrega publicada.
Main e Pages do #159 verdes. Nenhuma entrega nova completa contada nesta checagem.

Falha confirmada na sessão `20261001_113021_948087` do Arquiteto: depois de atualizar #154, executou `sleep 60`
e `sleep 420` esperando checks. A mudança de SHA também criou outro cartão de escalada para #154 enquanto o
primeiro estava ativo. Correção: impedir segunda escalada ativa por PR e explicitar no SOUL que Arquiteto encaminha
sem esperar CI; infraestrutura corrigida volta para o gate com `em-revisão`. Não alterar clones ativos nem cancelar
o agente só para aplicar SOUL. Intervenção registrada; a meta das três entregas autônomas permanece pendente.

## 01/10 — deploy confirmado e correção de fila parada

O PR #133 entrou em 01/10 às 00:46:16Z, com CI verde, mas o servidor ainda usava sincronizador e perfis anteriores.
As entregas da madrugada não são evidência do ciclo rápido. Deploy efetivo confirmado às **11:10:49Z**:
clone de distribuição atualizado, cinco SOULs aplicados, timeouts de ferramentas em 900 s e ambiente local ativo.
Nenhum clone de agente foi resetado pela supervisão.

Logo após o deploy, não havia cartões ativos, apesar dos PRs #149, #151, #153 e #156 ainda abertos com `em-revisão`.
O roteamento só chamava o gate de CI/main quando a chave da revisão nunca havia existido. Uma revisão concluída
do mesmo SHA escondia o PR dos ciclos seguintes. Corrigido para reavaliar PR aberto, retomar revisão verde com
chave própria e devolver falha ao Dev. Ajuste concluído sem novo commit também pode ser retomado, respeitando
o limite total de três ajustes. Limite esgotado encaminha ao Arquiteto, em vez de abandonar o PR em silêncio.
Nas issues #142 e #143, comentários do QA/Arquiteto confirmavam correções publicadas, mas `pronto-pra-teste`
continuava presente. Os SOULs agora exigem executar e conferir a troca de etiquetas. Uma escalada de issue
concluída sem encaminhamento recebe retomada limitada, sem duplicar cartão ativo.

Validação da correção: cenários do harness sem rede e 21 regressões injetadas detectadas. CI completo permanece
obrigatório antes de merge. Esta foi intervenção de implantação; a contagem de três entregas autônomas novas
continua pendente, sem afirmar que a meta de dez minutos foi atingida.

## 30/09 à noite — ciclo rápido, entregas reais

Pedido do dono: fábrica autônoma, buscando uma pequena entrega jogável a cada 10 minutos no conjunto dos projetos.
Sem repetir a mesma tarefa para comparar modelos; ajustar o fluxo enquanto entrega trabalho novo.

Linha de base observada entre 18:17Z e 00:17Z (seis horas): 7 PRs `dev/*` mesclados, cerca de um a cada 51 min.
As duas vagas somaram aproximadamente 651 de 720 minutos disponíveis (~90%). Na janela, as sessões do Revisor
registraram cerca de 44 min em comandos de espera; checagens completas do Dev e Revisor atingiram o envelope
de 420 s e foram iniciadas novamente. São medições de registros, não benchmark controlado; há trabalho em andamento
nas bordas da janela. PR #113: ~95 min de fila para ~8 min de revisão. CPU medida perto de quatro núcleos ocupados
durante checks simultâneos, sem pressão relevante de memória naquele instante.

Mudança: validação local explícita + CI completo obrigatório; gate de CI/main no sincronizador; revisão sem espera
nem execução de testes; timeouts do Hermes coerentes com terminal; instrução de uma execução em background acompanhada
pelo mesmo identificador. Duas vagas e modelos mantidos. Procedimento e reversão em `hermes/OPERACAO.md`.

Resultados das primeiras entregas e eventuais intervenções serão registrados abaixo depois de observados.

Durante a implantação, achado adicional no PR #129: a trava de aceitação reprovou
`118-dados-hospital.test.ts` depois de um rebase, apesar de o arquivo ser idêntico nas branches QA e Dev.
Confirmado com diff direto vazio e diff de três pontos listando o arquivo. A trava passa a comparar os conteúdos
dos commits QA/Dev diretamente; alteração real continua barrada e arquivos idênticos à main continuam permitidos.
Correção do fluxo no PR de infraestrutura, sem modificar o teste ou o código do hospital.

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

---

## Rodada 2 (30/09 02:00Z → ~12:00Z): tirar o que sobrou de remendo

Pedido do dono: o loop tem que rodar **sozinho** depois que o supervisor for desligado, então todo remendo vira problema.
A rodada revisou tudo que o supervisor tinha montado e cortou o que não tinha evidência.

### O que mudou (e o dado que justifica)

| Peça | Antes | Agora | Por quê |
|---|---|---|---|
| Sincronizador | 620 linhas | ~340 | Só faz GitHub → kanban. O resto era peça que só o supervisor entendia |
| Diário no GitHub (#61) e `acoes.jsonl` | 60 linhas + issue + arquivo | removidos | Repetiam o que o Hermes e o GitHub já guardam; o rastro passou a ficar **no próprio alvo** (cartão ou comentário) |
| Triagem de cartão travado pelo jev | classificava o motivo | removida | 12 registros, todos dos **mesmos 2 cartões**, sempre "acesso": rodou só em cima de um bug do supervisor, nunca num caso real. A função dela (3 rodadas → arquiteto) virou regra sem LLM |
| Vigia de consumo do Kilo | contava chamadas/h | removido | O Kilo não informa uso; era estimativa. O efeito (chamadas no Zen num papel do Kilo) aparece em `metricas.py` |
| Freio de memória | dentro do sincronizador | arquivo e cron próprios | Uma peça que falha não derruba a outra. Casa pelo argv exato |
| Regras coladas em todo cartão | ~30 linhas por cartão | 4 linhas | As regras foram pro `AGENTS.md` e pros `SOUL.md`, que são versionados e chegam com `hermes profile update` |
| "Arquivar cartão obsoleto" (2 lugares) | código de limpeza | 1 regra: **um cartão aberto por assunto** | Prevenir em vez de limpar |

### Achados (com número)

1. **Um bug do próprio harness escondeu 2 tarefas por ~9 h.** O PR rascunho do QA (`qa/49`, "Closes #49") era contado como
   trabalho do dev; a #49 nunca ganhou cartão e a #39, que divide `trafficSystem.ts` com ela, ficou presa atrás. O loop ficou
   **sem nenhum cartão aberto** a noite toda. Já estava em produção e nenhum teste antigo pegava: **só a fumaça com o GitHub
   real** mostrou que "não criar nada" estava errado. Lição: teste com dado falso não acha bug de premissa. O que faltou
   foi um aviso de "loop ocioso com tarefa pronta" (ver **Pendências** do `OPERACAO.md`).
2. **A `main` vermelha se consertou sozinha, sem supervisor.** Vermelha às 23:15 (BRT), o cartão de prioridade 40 foi ao dev,
   que abriu o PR #65 (Playwright); o revisor revisou duas vezes e mesclou às 00:37: **~1 h 20, zero intervenções**.
   É a prova mais forte de autonomia até agora.
3. **Kilo (nemotron-3-ultra) funciona e é mais enxuto.** Depois da troca, todas as sessões dos 3 papéis ficaram 100% no
   Kilo, sem fallback. Designer: 36–60 chamadas em 31–36 min (Zen) → **19 chamadas em 7 min**. Revisão do #65: 24 chamadas
   em 8 min e 12 em 11 min. Tarefas diferentes: indício, não prova. A revisão do #57, que já estava rodando **no Zen** antes da
   troca, ficou ~1 h a mais depois de o PR já estar mesclado.
4. **A trava de segurança do Hermes bloqueia 3–9% das chamadas** (`BLOCKED: Command flagged as dangerous`), no QA 15,8% antes da
   revisão de ferramentas e 6,7% depois. O maior culpado é o `git reset --hard` do começo de todo cartão (32 sessões).
   Liberar é decisão do dono (ver `OPERACAO.md`). Custo: ~5% das chamadas, então o loop funciona sem isso.
5. **Espera de CI não é o gargalo:** 4% das chamadas do arquiteto e 13% do revisor. A ideia "só gerar o cartão de revisão
   depois do CI" foi **descartada por dado** antes de virar código.
6. **Memória: não cabe empurrar pra 3 agentes.** 2 agentes ≈ 2,0–2,1 GB de processos; com a comparação de modelos junto,
   2,6–2,7 GB de 3 GB. O freio disparou 2 vezes na noite **sem ter terminal de chat pra matar**: a pressão era dos agentes.
7. **Jev pra detectar issue duplicada:** 6/6 duplicatas achadas (2 reais, #59 e #60, criadas pelos agentes, e 4 reescritas), 12
   controles certos, 2 "erros" que eram **sobreposições reais** (#31 Faculdade ↔ #64 "Jovens no ensino superior"), e 1 erro
   genuíno com confiança 0,52. Aprovado no gabarito, **não ligado**.

### Erros do supervisor nesta rodada (registro honesto)

- Tinha publicado o vigia do Kilo por **estimativa** e só o dono questionou; refiz e depois removi.
- Deixei sobras de teste na máquina (um serviço `gateway-teste-kilo` órfão dentro do container, logs de perfis apagados) e
  gravei uma linha de teste no `acoes.jsonl` de produção. Limpei.
- O freio casava texto solto na linha de comando e podia matar processo inocente: **o teste que escrevi pegou**, e corrigi.
- O perfil do revisor tinha a origem registrada apontando pro arquiteto desde o setup inicial (um `profile update` colou o
  SOUL errado; ele estava ocioso). Achado pela conferência do "antes e depois" e corrigido.
- Patches feitos no Windows gravaram CRLF e o primeiro diff do PR mostrava arquivos inteiros reescritos. Normalizei.

### Intervenções do supervisor nesta rodada

O loop **pediu** 1: a tarefa escondida, que nem ele nem ninguém sabia estar escondida (só o supervisor viu). As outras foram
melhorias de arquitetura por iniciativa do supervisor, não socorro. O número que decide segue sendo intervenções por dia.

### Ações manuais do supervisor (rastro, já que o diário do GitHub foi removido)

- PR #66 (harness enxuto, freio próprio, SOULs e `AGENTS.md`), mesclado por mim com CI verde, **sem passar pelo revisor**
  (é o harness; o revisor gastou 47 min num PR de docs).
- `hermes profile update` nos 5 perfis; corrigi a origem registrada do revisor (backup `distribution.yaml.bak-20260930-fonte`).
- Troquei o sincronizador em produção (cópia do anterior em `sincronizar_github.py.bak-antes-v2`), criei o cron `freio-memoria`,
  removi `zelador.json`, `testar_diario.py`, `testar_kilo.py`, `diario-estado.json`.
- Comentei e **fechei a issue #61** e apaguei a etiqueta `diario-loop`.
- Bake-off: relancei os 5 modelos que faltavam (a rodada 1 deles era inválida: o OpenCode recusou ler a tarefa em `/tmp`).

### Veredito parcial (dia 2)

Melhorou onde importa: a autonomia foi **provada** num caso (`main` vermelha) e o sistema ficou menor. Mas o bug de 9 h mostra o
risco real de rodar sem supervisor: **falha silenciosa**, o loop parado sem ninguém saber. Antes de dar por concluído, falta
um aviso de "loop ocioso com tarefa pronta". Comparação de modelos: resultados abaixo quando terminarem.

### Comparação de modelos para escrever código (30/09, tarefa #38, 9 testes de aceitação, via `opencode run`)

Uma tarefa por modelo: é indício, não prova. Todos sem mexer no teste. Bruto em `/opt/data/avaliacao/bakeoff2.jsonl`.

| Modelo | Tempo | Aceitação | `npm run check` | Linhas / arquivos |
|---|---|---|---|---|
| big-pickle | 167 s | 9/9 | **vermelho** | 119 / 2 |
| space-bunny | 303 s | 9/9 | verde | 84 / 3 |
| nemotron-3-ultra | 439 s | 9/9 | verde | 71 / 1 |
| muse (o atual do dev/qa) | 539 s | 9/9 | verde | 101 / 2 |
| longcat-2.5-preview | 699 s | 9/9 | verde | 107 / 2 |
| mimo-v2.6-flash | 1380 s | 9/9 | verde | 98 / 3 |
| nemotron-3.5-lightning | estourou 1500 s | 6/9 | vermelho | 47 / 1 |

- Cinco modelos entregam o mesmo resultado; o muse não é o mais rápido. `space-bunny` (303 s) e `nemotron-3-ultra` (439 s, o menor diff)
  foram melhores que ele nesta tarefa. `big-pickle` é rápido mas deixa o `check` vermelho; `lightning` não serve.
- Não troquei o modelo do dev: falta uma 2ª tarefa (a #49 tem teste pronto) para ver se a ordem se mantém. Candidato: `bakeoff.sh` com `nemotron-3-ultra` e `space-bunny`.

### Tarde de 30/09: o loop andando com 3 agentes (e o que não coube)

- **Entregas sem supervisor entre ~12:30 e ~13:20 (UTC):** #39, #72, #49 e #40 mescladas; #81 e #82 já com teste do QA, #81 implementada. O arquiteto
  planejou o #26 sozinho e o QA e o dev o entregaram em sequência.
- **Bloqueios de comando caíram de 3–9% para ~0–2%** depois de o dono liberar `approvals.single_query_mode` (0 em 416 chamadas nas últimas 2 h).
- **Falhas de desenho achadas com dado e corrigidas (cada uma com cenário e mutante):**
  - fila do arquiteto contava tarefa presa como "fila cheia" e segurava 3 bugs urgentes independentes;
  - o GitHub não fechou a #39 mesmo com `Closes #39` no PR mesclado (`closingIssuesReferences` vazio);
  - teste do QA errado não tinha caminho (o dev não pode mexer nele): revisor devolve ao QA, e o dev também sabe devolver;
  - o revisor "devolvia" bloqueando o cartão em vez de trocar a etiqueta; o SOUL agora diz o comando;
  - o arquiteto replanejava item por cima de tarefas **fechadas** (`gh issue list` só mostra abertas);
  - item do roadmap com `pronto-pra-teste` virava cartão de QA; só issue com a etiqueta `tarefa` ganha cartão;
  - revisão repetida enquanto a tarefa espera o QA (#49 e #40, ~15 min cada);
  - QA de tarefa com PR do dev pronto passa na frente (terminar antes de começar).
- **Erros do supervisor:** o deploy dos SOULs deu `reset` no clone de trabalho do dev no meio de um cartão (perdeu ~3 min de edição não
  commitada; o agente se recuperou). Agora a origem dos perfis é `/opt/data/distribuicao`, um clone só pra isso. Também subi para 3
  agentes com base em amostras pontuais de memória: às 13:00 a máquina engasgou (2.817 MB, pressão de disco ~24% por 5 min, load 20).
  Voltei para 2.
- **Intervenções do supervisor na tarde:** 3 encaminhamentos manuais (#49, #40 e prioridade de um cartão) e 1 correção de etiquetas (#21).
  Todos ficaram como regra ou instrução de SOUL depois.
