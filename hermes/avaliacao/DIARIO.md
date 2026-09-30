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
