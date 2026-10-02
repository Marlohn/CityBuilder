# Guia do código (para IAs e pessoas que vão mexer no projeto)

Este guia explica **onde fica cada coisa** e **como mudar sem quebrar**. As regras curtas estão em `AGENTS.md` (leia primeiro). Cada pacote tem também um `AGENTS.md` próprio com as regras daquele pedaço. O Hermes e outras ferramentas carregam esses arquivos sozinhos quando você entra na pasta.

Se algo aqui estiver diferente do código, **o código vale**. Nesse caso, corrija este guia no mesmo PR.

---

## 1. Mapa do projeto

```
config/             números das regras do jogo (YAML, cada valor com fonte ou PENDENTE)
data/               dados reais: prédios, tábua de mortalidade, fecundidade, nomes, tabela de referência
scenarios/          cidades de teste descritas em YAML (comandos por dia, bot, mudanças de config)
packages/
  contract/         o "idioma" entre motor e tela: comandos, visões, mensagens do Worker (zod)
  sim/              o motor. Não sabe que existe tela. Roda igual no Node e no navegador
  bots/             prefeito automático e leitura de cenários
  cli/              roda o jogo sem tela (npm run sim), carrega config/ e data/ do disco
  director/         IA diretora opcional (LLM), desligada por padrão
  roadmap/          motor de roadmap (sinais, fórmula, ROADMAP.md)
  render/           desenho 3D (Babylon.js), recebe só visões do contrato
  ui/               painéis em React, recebe só visões do contrato
  web/              junta tudo no navegador: Worker com o motor + render + ui
tests/
  unit/             testes rápidos que cruzam pacotes
  acceptance/       testes de aceitação do QA (o Dev não pode mexer)
  slow/             coorte do IBGE e cidade de 50 mil (SLOW=1)
  e2e/              navegador de verdade (Playwright)
tools/              scripts: check, calibração da demografia, geração de nomes
roadmap/            config do motor de roadmap e sinais medidos (signals.json)
hermes/             perfis prontos dos agentes (Designer, Arquiteto, QA, Dev) para o Hermes Agent
```

### Quem pode importar quem

```
contract  ←  sim  ←  bots  ←  cli  ←  roadmap
   ↑          ↑                ↑
   │          └──── director ──┘
   └── render, ui  ←  web (web também usa sim, dentro do Worker)
```

- `sim` não importa tela, UI, CLI, `fs`, Babylon nem React.
- `render` e `ui` só falam com o motor pelo `contract`.
- `contract` não importa nada do projeto.
- `director` não usa Node (roda no navegador também).

O `npm run check` confere essas regras (dependency-cruiser). Se quebrar, o CI falha.

---

## 2. Como o motor funciona

### O tempo

- 1 tick = alguns minutos do jogo (`config/time.yaml`).
- **1 dia do jogo = 1 ano de vida.** Uma pessoa faz aniversário uma vez por dia do jogo.
- Na velocidade 1x, um dia dura 2 minutos reais.

### Um tick, passo a passo (`packages/sim/src/sim.ts`)

1. Aplica os comandos da fila (construir, zonear, demolir...). Todo comando fica gravado em `commandLog`.
2. Termina as obras que ficaram prontas e avisa os sistemas (`onBuildingReady`).
3. Roda os sistemas **nesta ordem** (montada em `game.ts`): prontos → remoção → economia → crescimento → imigração → ciclo de vida → mercados (emprego, escola, UBS, casa) → trânsito.

A ordem importa. Mudar a ordem muda a cidade (e quebra os testes de referência).

### Onde ficam os dados

- **Pessoas, famílias, prédios, carros e eventos ficam em arrays numéricos** (`Int32Array`, `Uint8Array`...), um array por campo. Exemplo: `pop.birthTick[id]`, `pop.job[id]`. Nada de um objeto por pessoa. Isso evita as pausas do coletor de lixo e deixa 50 mil pessoas leves.
- Arrays crescem com `growTo` (`core/growable.ts`). Ao adicionar um campo novo em `Population`, lembre de crescer ele em `ensure`.
- `IndexedSet` (`core/indexedSet.ts`) guarda conjuntos com sorteio em tempo constante (vagas, casas livres...).
- Mercados (`markets/markets.ts`): vagas de emprego, escola, UBS e casa. `findNear` sorteia algumas vagas e pega a mais perto. `Markets.findActiveNear(rng, fromTile, filtro, samples, maxMeters?)` devolve o predio em uso mais proximo de um tipo do catalogo (por `service` ou `zone`), na mesma malha de vias de saida - e o destino da viagem (loja, UBS, escola), sem vaga.

### Sorteio e reprodutibilidade

- Todo sorteio usa `city.rng.<fluxo>` (`life`, `family`, `market`, `migration`, `growth`, `traits`). Cada sistema tem seu fluxo, então mexer num sistema não bagunça os sorteios dos outros.
- **Proibido no motor:** `Math.random`, `Math.pow`, `Math.exp`, `Math.log`, `Math.sin`, `Date.now`. Eles dão resultados diferentes entre navegadores ou entre execuções. Use tabelas prontas (`tools/`) ou `+ - * /`.
- Pedidos de rota feitos no tick T são respondidos no tick T+1, em ordem fixa.
- **Save = replay:** semente + mudanças de config + comandos com o tick. Abrir o save refaz a cidade exatamente igual (`save/replay.ts`). Por isso todo jeito de mudar a cidade precisa ser um **comando**.

### "Nada surge do nada"

- Toda pessoa nasce na cidade ou chega de fora do mapa pela estrada (e isso fica registrado).
- Todo carro tem dono (uma família), fica estacionado em algum lugar e toda viagem tem motivo.
- `debug/invariants.ts` confere essas regras. Os testes rodam várias sementes e exigem zero violações.
- **Trânsito na tela** (`view/trafficVisuals.ts`): como 1 minuto do jogo dura 0,08 s na velocidade 1x, cada viagem real (carro com a rota dele, ou pessoa a pé) é desenhada percorrendo o caminho numa velocidade que dá para ver. É só visual: a simulação não lê nada dali, então a cidade continua reproduzível.

### Logs e eventos

- **Eventos de vida** (`people/events.ts`, códigos `EV`): nasceu, casou, arrumou emprego, desejo não atendido... Ficam num formato compacto e viram a história da pessoa (`view/people.ts`).
- **Log técnico** (`core/log.ts`): JSON por linha com tick, sistema, evento, motivo e dados. Nível por sistema em `config/logging.yaml`. Veja com `npm run sim -- report --log=debug`.
- **Contadores de trabalho** (`sim.perf.count`): rotas calculadas, nós visitados, pessoas processadas. É isso que o teste de performance confere (não o tempo em ms).

---

## 3. Receitas: como fazer as mudanças mais comuns

Toda receita termina igual: `npm run format`, depois `npm run check` até dar `TUDO OK`.

### 3.1 Um valor novo de regra

1. Coloque o valor no `config/<assunto>.yaml`, com a **fonte** num comentário logo acima. Sem fonte, escreva `PENDENTE:` e o porquê.
2. Declare o campo em `packages/sim/src/config/schema.ts` (zod). Use os tipos prontos (`pos`, `nonneg`, `prob`, `intPos`).
3. Use no código com `sim.config.<assunto>.<campo>`.
4. Mudanças no schema precisam de aprovação do dono do projeto (é "formato").

Atenção: nos overrides (cenários e testes), objetos são mesclados, mas **arrays e tabelas numéricas são trocados inteiros** (`config/load.ts`).

### 3.1b De onde vem o custo de uma obra (e o custo anual) de um prédio

Dinheiro e prazo de `data/buildings.yaml` (`cost`, `upkeepPerYear`, `constructionMonths`) nunca
saem de cabeça. O caminho é:

1. **Obra (`cost`)**: procure o valor de convênio ou investimento publicado para a mesma unidade.
   FNDE (escola), Novo PAC Cidades / Ministério da Saúde (UBS e hospital), ou preço do m² do
   SINAPI (Caixa) quando não houver convênio: `custo = área construída x R$/m²`. Exemplo no arquivo:
   hospital de 100 leitos por R$ 56 milhões = R$ 560 mil por leito; `560.000 x 90 = R$ 50.400.000`.
2. **Custo anual (`upkeepPerYear`)**: despesa com pessoal da unidade, não a obra. Equipe de saúde
   (Fiocruz, PNAB), gasto médio por internação x giro de leitos (SIH/DATASUS), VAAF do Fundeb para
   escola. Escreva a conta: `valor mensal x 12`, `gasto por internação x internações por leito/ano`.
3. **Prazo (`constructionMonths`)**: prazo em dias ou meses do instrumento oficial (resolução do
   FNDE, portaria do Ministério da Saúde, cronograma da ordem de serviço, prazo de execução do
   chamamento público). Para edifício, o prazo sai do edital/termo de referência do órgão que publica
   o cronograma físico-financeiro (CBOPC da Caixa, chamamento público estadual ou municipal);
   `dias / 30 = meses`. No jogo 1 dia = 1 ano: 12 meses de prazo = 1 dia de jogo.
4. **Regra da conta**: o link da fonte e a conta que leva do dado ao número do jogo vão **na mesma
   linha de comentário logo acima** do campo (é o que `tests/unit/costs-sourced.test.ts` cobra).
   Comentário em português, número em reais/meses inteiros.
5. **Sem fonte primária**: procure a conta que chega ao número a partir de um dado publicado. Se não
   houver lastro, deixe `PENDENTE:` com o porquê e comente na issue. Nunca troque `PENDENTE` por
   outro número sem fonte.
6. Mudou dinheiro ou prazo, atualize o snapshot da cidade de referência
   (`npm test -- tests/unit/reference -u`) e cole no PR o número antes e depois.

### 3.2 Um tipo de prédio novo (de zona)

1. Adicione em `data/buildings.yaml` com `zone`, tamanho (`w`, `h`), `homes` ou `jobs`, `constructionMonths` e `models`. Cada número com a conta ou fonte no comentário.
2. Os modelos 3D ficam em `packages/web/public/models/` (Kenney, CC0). Modelos `proc/...` são desenhados por código em `packages/render`.
3. O crescimento (`systems/growth.ts`) já escolhe entre os tipos da zona. Não precisa mudar código.

### 3.3 Um serviço novo (ex.: creche, hospital)

Serviço mexe em várias camadas. O Arquiteto deve quebrar em tarefas:

1. Prédio em `data/buildings.yaml` com `service` (e o valor novo no enum de `schema.ts`).
2. Mercado de vagas em `markets/markets.ts` e quem procura vaga em `systems/matching.ts`.
3. Custo anual em `systems/economy.ts`.
4. Botão na barra de ferramentas (`packages/web/src/tools.ts`).
5. Desejo não atendido (receita 3.6) para o roadmap medir o efeito.
6. Linha na tabela de referência (`data/reference/cidade-real.yaml`): troque `inGame: ""` pelo nome do serviço.

### 3.4 Um sistema novo

1. Crie `packages/sim/src/systems/<nome>.ts` implementando `System` (`name`, `tick()`, e os ganchos se precisar).
2. Registre em `game.ts`, no lugar certo da ordem, com um comentário dizendo **por que ali**.
3. Distribua o trabalho: coisa de vida roda uma vez por pessoa por dia do jogo, espalhada pelos ticks (`city.slots`). Não percorra todo mundo em todo tick.
4. Conte o trabalho com `sim.perf.count("<nome>")` e registre decisões com `sim.log.debug(...)`.

### 3.5 Um evento de vida novo

1. Código novo em `EV` (`people/events.ts`). Nunca reaproveite nem renumere um código existente, porque isso quebra saves antigos.
2. Texto em português em `view/people.ts`.
3. Registre com `city.log(EV.<nome>, pessoa, a, b)`.

### 3.6 Um desejo não atendido novo

Isso é o que alimenta o roadmap ("4.200 pessoas queriam X e não tinha"):

1. Código em `UNMET` (`people/events.ts`) e registre com `city.log(EV.unmet, pessoa, UNMET.<nome>)` na hora em que a pessoa desiste.
2. Conte no censo (`people/census.ts`) e exponha em `view/stats.ts` (`unmet`) e no contrato (`UnmetDesireCounts`).
3. Adicione em `DESIRES` (`packages/roadmap/src/signals.ts`) para virar sinal.

### 3.7 Um indicador de realismo novo

1. Linha em `config/realism.yaml` com faixa real (`min`, `max`) e fonte.
2. A conta em `metrics/realism.ts` (`computeRealism`). Se precisar de amostra mínima, use `minSamples`.

### 3.8 Um comando novo (algo que o jogador ou bot pode fazer)

1. Formato em `packages/contract/src/commands.ts` (precisa de aprovação do dono).
2. Regra em `packages/sim/src/commands/apply.ts`: devolva `ok: false` com um motivo em português quando não pode.
3. Teste em `packages/sim/test/commands.test.ts`.
4. Ferramenta na tela (`packages/web/src/tools.ts`), se o jogador puder usar.

### 3.9 Uma métrica nova para o roadmap

Adicione em `metricsOf` (`packages/roadmap/src/signals.ts`). O nome vira o id usado no campo "Métrica de sucesso" dos itens (ex.: `unmet.university`).

### 3.10 Um ajuste novo da diretora (IA)

1. Nome em `DIRECTOR_PARAMS` (contrato), limites em `config/director.yaml` e no schema.
2. Valor inicial 1 em `sim.modifiers` e o sistema que usa multiplica por ele.
3. Texto explicando o ajuste em `PARAM_TEXT` (`packages/director/src/director.ts`).

### 3.11 Carro que some da tela e bug

Na tela, um carro dentro do mapa está SEMPRE desenhado: ou na viagem visual (TrafficVisuals) ou como estacionado. Carro andando e invisível é bug.

- A viagem visual fica em `packages/sim/src/view/trafficVisuals.ts`: rota de 1 quadradinho é repetida em vez de descartada, viagem cortada pelo limite de tela vira viagem parada no último quadradinho, e a tela reconcilia carro andando que perdeu a viagem porque o log de viagens do motor é aparado.
- O desenho fica em `packages/web/src/worker.ts`, que só desenha os carros estacionados que a tela não está desenhando.

O limite de tela (`DEFAULT_TRAFFIC_VISUALS.maxActive`, em `trafficVisuals.ts`) é número técnico de memória/desenho, não é regra de jogo e não vai para a config.

### 3.12 Contar viagens de ontem por motivo no relatório

1. Campo novo em `YearCounters` (`packages/sim/src/city.ts`) com zero em `emptyYear()`.
2. Método em `City` que soma no ano atual (o `game.ts` vira `city.year` em `city.lastYear` no fim do ano, e 1 dia do jogo = 1 ano).
3. Leitura em `view/report.ts` a partir de `city.lastYear`, com o helper `n()` (ponto de milhar).
4. Não mexa em `packages/contract` nem no `StatsView`: contagem de ontem é dado do motor, não visão para a tela.

### 3.13 Uma categoria financeira nova

Para criar uma categoria de receita ou despesa (ex.: `taxa_lixo`), siga estas camadas:

1. Lance o valor no motor em `packages/sim/src/systems/economy.ts` (custeio e receita anual)
   ou em `packages/sim/src/commands/apply.ts` (obra pontual). Use `treasury.earn(valor, categoria)`
   para receita, `treasury.charge(valor, categoria)` para custeio que acontece mesmo sem
   dinheiro e `treasury.trySpend(valor, categoria)` para obra que só acontece com dinheiro.
   Os três moram em `packages/sim/src/economy/treasury.ts` e guardam o breakdown do ano
   corrente em `revenue`/`expenses` por categoria.
2. Guarde no ano em `packages/sim/src/city.ts`: `YearCounters.revenueByCategory` e
   `YearCounters.expensesByCategory` (ano corrente), mais `YearSummary` e
   `City.yearlyHistory` (um resumo por ano fechado, com `moneyEnd`). O fechamento do ano
   fica em `packages/sim/src/game.ts` (chama `treasury.closeYear()` e empurra em `yearlyHistory`).
3. Classifique em `packages/sim/src/view/stats.ts`: se for custeio (repete todo ano, ex.:
   `educacao`, `saude`, `agua_e_luz`, `manutencao_vias`), some em `operatingCost`; se for obra
   (uma vez, ex.: `obras_vias`, `obras_servicos`), some em `investmentCost`. O `netOperating`
   é receita menos custeio; o investimento fica separado em `investment`.
4. Exponha no contrato em `packages/contract/src/view.ts`: `FinanceCategorySummary`
   (`revenueByCategory`, `expensesByCategory`, `netOperating`, `investment`, `yearlyHistory`)
   e `YearSummary`. Não mude o significado de campos que já existem (o save e a tela usam eles).
5. Mostre no relatório em `packages/sim/src/view/report.ts`, na seção `## Prefeitura`, com os
   helpers `money()`/`n()`. Receita usa `Receita — <categoria>`, despesa usa `Despesa — <categoria>`
   sob o subtítulo de custeio ou de investimento, conforme a classificação do passo 3.
6. Mostre na UI em `packages/ui` (painel de finanças): leia só do `StatsView.finance` do contrato,
   sem importar o motor. Nada de lógica de conta na tela, só exibição.

### 3.14 Mudou uma regra que muda a cidade? Suba a versão do save

O save é um replay (`packages/sim/src/save/replay.ts`): semente + comandos com o tick.
Quando uma mudança de regra impede o save antigo de refazer a mesma cidade,
suba `REPLAY_VERSION` em +1 e adicione um degrau em `MIGRATIONS` com a versão
de destino como chave (ex.: `3: (r) => ({ ...r, version: 3 })`).

1. Cada migração é uma função pura: recebe um `Replay` e devolve um `Replay` NOVO, sem mudar o original.
2. A corrente é degrau por degrau: `applyMigrations` começa na versão do save e aplica `v -> v + 1` até a atual. Se faltar um degrau, recusa com erro em vez de abrir pela metade.
3. Na escrita nada muda: `makeReplay` sempre grava na versão atual. A migração só acontece na leitura (`parseReplay`), sobre uma cópia.

### 3.15 Renomeou ou tirou um comando? O que acontece com o save antigo

O save antigo com o nome velho **é recusado** com mensagem em português
(`comando inválido no tick <tick> (type "<type>")...`, em
`packages/sim/src/save/commandCompat.ts`), em vez de abrir diferente ou pela
metade. Abrir "do jeito que dá" refaria outra cidade com a mesma semente, e o
replay deixaria de ser fiel: o certo é recusar e dizer tick, type e versão do
save.

A correção é escrever a migração, nunca afrouxar o `CommandSchema`:

1. Suba `REPLAY_VERSION` e adicione o degrau em `MIGRATIONS`
   (`packages/sim/src/save/replay.ts`) que renomeia/reescreve o comando velho
   para o formato atual.
2. A validação (`validateReplayCommands`) roda DEPOIS da migração, com o mesmo
   `parseCommand` do contrato que a tela usa. Limite de regra em runtime (ex.:
   `factor` da diretora fora da config) continua sendo recusado na hora de
   jogar, não na abertura do save.
3. Nunca remova nem renomeie um type no `CommandSchema`
   (`packages/contract/src/commands.ts`) e nunca afrouxe o schema para o save
   velho passar: saves antigos usam os nomes antigos.

### 3.16 Parâmetros do prefeito automático (bot)

Os gatilhos do bot ficam em `MayorOptions` (`packages/bots/src/mayor.ts`):
`schoolTrigger`, `clinicTrigger` e `nearbyTiles`, cada um com a conta e a fonte
(ou `PENDENTE`) no JSDoc do campo. O cenário sobrescreve por `bot:` no yaml
(ex.: `scenarios/estresse.yaml` usa `bot: { highDensityShare: 0.9 }`).

---

## 4. Testes

| Onde | Para quê | Como rodar |
|---|---|---|
| `packages/*/test`, `packages/*/src/**/*.test.ts` | regra isolada de um pacote | `npm test -- <arquivo>` |
| `tests/unit` | cruzando pacotes (save, cidade inteira) | `npm test -- tests/unit` |
| `tests/unit/reference.test.ts` | **cidades de referência**: o resultado guardado de algumas cidades. Mudou sem querer = bug; mudou de propósito = atualize com `-u` e explique no PR | `npm test -- tests/unit/reference -u` |
| `tests/acceptance` | critérios de uma tarefa (escritos pelo QA **antes** do código) | `npm test -- tests/acceptance` |
| `tests/slow` | coorte de 10 mil bebês contra o IBGE, cidade de 50 mil | `npm run test:slow` |
| `tests/e2e` | navegador: abre o jogo, confere que Node e Chromium dão a mesma cidade | `npm run test:e2e` |

- Para montar uma cidade num teste: `createTestGame` (`tests/helpers.ts`). Veja o exemplo em `tests/acceptance/exemplo-cidade-cresce.test.ts`.
- Sempre com semente fixa. Nunca teste tempo em ms: use contadores de trabalho.
- Mensagem de erro em português, dizendo o que se esperava e o comando para reproduzir.

---

## 5. Depurar

1. **Relatório:** `npm run sim -- report --seed=X --days=N` (use `--bot` para o prefeito automático). Mostra população, mercados, desejos não atendidos, dinheiro, placar de realismo e o tempo de cada sistema.
2. **Uma pessoa:** `npm run sim -- person <id> --seed=X --days=N` mostra a vida inteira dela.
3. **Log:** `--log=debug` mostra cada decisão com o motivo.
4. **Bug do navegador:** o botão "Reportar problema" gera um arquivo. `npm run sim -- replay bug.json` repete a cidade exatamente, com as regras quebradas listadas.
5. **Regras quebradas:** `checkInvariants(game.city)` diz qual pessoa, prédio ou carro está errado.

---

## 6. Armadilhas conhecidas (já aconteceram)

- **Atualizar Playwright sem a imagem do CI:** o job de tela usa `mcr.microsoft.com/playwright:v1.63.0-noble`, com navegador e dependências prontos. Ao atualizar `@playwright/test`/`package-lock.json`, atualize também a imagem e a conferência de versão em `.github/workflows/ci.yml`. O comando e todos os testes de tela continuam iguais; não reinstale dependências via apt em cada execução.
- **Esconder o erro com `| tail`:** `npm run check | tail` devolve sucesso mesmo quando falha. Use `set -o pipefail` antes.
- **CI em duas partes:** Vitest e Playwright usam `--shard=1/2` e `--shard=2/2` em máquinas separadas. Nenhum arquivo é excluído. Os checks obrigatórios `npm run check` e `teste de tela (Playwright)` só ficam verdes quando todas as partes passam; falha, cancelamento ou parte pulada impedem o verde. Tipos, estilo, camadas, cenários/mutantes do Hermes e testes lentos continuam obrigatórios. Reversão: restaurar `.github/workflows/ci.yml` anterior, sem mudar a proteção da branch.
- **Idade no aniversário:** quem faz aniversário hoje viveu `idade - 1` anos completos. Usar a idade nova zerou a mortalidade infantil.
- **Ordem dos eventos:** registre a chegada antes de mover a família para a casa, senão o verificador acha alguém "surgindo do nada".
- **Filhos acompanham os pais:** ao mudar um adulto de casa, veja os filhos menores (`people/actions.ts`).
- **Pedidos de rota em ganchos:** pedidos feitos dentro de `onBuildingRemoved` etc. também seguem a regra T+1. Não misture com as viagens do tick.
- **Comprar sem vender:** qualquer coisa que as famílias adquirem (carro...) precisa de saída também, senão o número só sobe.
- **Bot que para no meio:** o prefeito automático só abre uma etapa de bairro se tiver dinheiro para ela inteira. Rua solta = ninguém chega.
- **Serviço caro esperando receita:** um serviço permanente (hospital) só entra quando a receita do último ano
  fechado paga o `upkeepPerYear`; enquanto espera, o prefeito **não** marca `saving`, senão a cidade para de
  abrir bairros e trava (`packages/bots/src/mayor.ts`).
- **Formatador depois de editar por script:** o `npm run format` muda quebras de linha. Edite de novo só depois de reler o arquivo.

---

## 7. Mantendo a documentação em dia

Mudou isto → atualize aquilo **no mesmo PR**:

| Mudou | Atualize |
|---|---|
| Receita por porte de cidade (tabela `economy.revenuePerResidentByPopulation` em `config/economy.yaml`) | comentário de cada ponto com a fonte ao lado e `docs/VISAO.md` se muda o pressuposto |
| Regra de jogo nova ou valor com fonte (ex.: rotina em `config/traffic.yaml`) | comentário no `config/*.yaml` e, se for grande, `docs/PLANO.md` |
| Renomeou ou removeu um comando (save antigo com o nome velho) | receita 3.15: escreva a migração em `packages/sim/src/save/replay.ts`, nunca afrouxe o `CommandSchema`; a validação mora em `packages/sim/src/save/commandCompat.ts` |
| Pasta ou pacote novo | seção 1 deste guia e o `AGENTS.md` do pacote |
| Comando de terminal novo | tabela de comandos do `AGENTS.md` e o README |
| Jeito novo de fazer algo comum | uma receita na seção 3 |
| Bug que pode acontecer de novo | uma linha na seção 6 |
| Papel de agente ou fluxo no GitHub | `agents/<papel>.md` e `hermes/<papel>/SOUL.md` |
| Erro de provedor deixa OpenCode aberto | `hermes/harness/opencode_guard.py`, cenários em `testar_opencode_guard.py` e deploy em `hermes/OPERACAO.md` |
| Algo que o jogador vê | `docs/MANUAL.md` |
| Volta de compras/saúde/lazer (motivo do dia, destino e volta para casa) | `packages/sim/src/traffic/trafficSystem.ts` (monta a volta) e números em `config/traffic.yaml` (routine.errand*) |
| Mercado de saúde separado por tipo de prédio (UBS não é leito, leito não é posto de saúde) | filtro por `tipo.id` no construtor de `VacancyMarket` em `packages/sim/src/markets/markets.ts` (`clinics` = `ubs`, `hospitals` = `hospital`) |
| Parâmetro novo do prefeito automático (`schoolTrigger`, `clinicTrigger`, `nearbyTiles` em `MayorOptions`) | JSDoc do campo em `packages/bots/src/mayor.ts` com a conta e a fonte (ou `PENDENTE`) |
