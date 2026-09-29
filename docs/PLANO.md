# Plano do CityBuilder

> Documento vivo. Tudo aqui pode mudar, mas toda mudança precisa de um motivo escrito.

## 1. Objetivo

Um city builder isométrico que roda no navegador, inspirado no Cities: Skylines, com três características principais:

1. **Camadas separadas:** o motor da cidade funciona sem tela. A tela pode ser trocada por outra engine sem mexer no motor.
2. **Vida real simulada:** cada pessoa tem uma vida própria, do nascimento à morte, com escolhas aleatórias que fazem sentido.
3. **Evolução contínua por agentes de IA:** agentes com LLMs grátis (via Hermes Agent) melhoram o jogo em loop, 24h, sem quebrar o que já funciona.

## 2. Regras de ouro

1. **Tudo tem que fazer sentido na vida real.** Antes de criar qualquer coisa, perguntar: de onde veio? De quem é? Pra onde vai? Onde fica depois?
   - Nada surge ou some do nada. Um carro tem dono (pessoa ou empresa), origem, destino e lugar pra estacionar.
   - Uma pessoa só entra na cidade nascendo ou se mudando pra ela, e só sai morrendo ou se mudando.
2. **Nada fixo.** Todo número de regra de jogo fica em arquivo de config, com valor padrão e validação.
3. **Toda decisão de regra tem prova.** Ao criar uma regra (ex: chance de morrer), pesquisar uma fonte real e registrar no arquivo de decisões (`docs/decisoes/`).
4. **Teste primeiro (TDD).** O teste é escrito antes e falha. Depois o código faz ele passar.
5. **Sem exagero.** Se uma ideia não tem uso claro agora, fica no roadmap e não no código.
6. **Log pensando em quem vai corrigir.** Cada evento importante gera um log que explica o quê, quem, onde, quando e por quê.

## 3. Tecnologia

| Parte | Escolha | Por quê |
|---|---|---|
| Linguagem | TypeScript (modo estrito) em tudo | Linguagem mais usada no GitHub em 2025. O sistema de tipos pega a maioria dos erros que LLMs cometem. Um idioma só facilita pros agentes. |
| Motor da simulação | TypeScript puro, rodando em Web Worker (navegador) ou Node (servidor) | O mesmo código roda nos dois lugares. Dados das pessoas em arrays numéricos, que são rápidos. |
| Tela | Babylon.js | Não quebra código antigo entre versões (bom pros LLMs), já vem com sombras, efeitos e clique em objetos, e aguenta muitas luzes (cidade à noite). |
| Modelos 3D | Kenney City Kit (CC0, domínio público) | Grátis, low-poly, com ruas, casas e comércio. Trocáveis depois. |
| Testes | Vitest (unitário), fast-check (cidades aleatórias), Playwright (print da tela) | Rápidos e muito conhecidos pelos LLMs. |
| Config | Arquivos YAML validados por schema (zod) | YAML aceita comentários. A validação avisa na hora se um valor estiver errado. |
| Plano B de performance | Rust → WebAssembly, só para partes que forem medidas como lentas | Os mesmos testes provam que o resultado não mudou. |

Idioma: **código em inglês, documentação em português.**

## 4. Arquitetura em camadas

```
[ Tela (Babylon.js hoje, qualquer engine amanhã) ]
        ↑ estado da cidade          ↓ comandos
[ Contrato: lista de comandos + formato do estado (com versão) ]
        ↑
[ Motor da cidade: simulação pura, sem tela ]
        ↑
[ Cérebro das pessoas: regras hoje, IA melhor amanhã ]
```

Pastas previstas:

```
packages/
  sim/        motor da cidade (não pode importar nada de render)
  contract/   comandos, formato do estado, versões
  render/     tela em Babylon.js
  cli/        rodar a simulação pelo terminal e gerar relatórios
  bots/       prefeito automático (gera cidades pros testes)
config/       todos os números do jogo
scenarios/    cidades de teste
docs/         plano, decisões, papéis dos agentes
agents/       instruções de cada agente
```

Uma ferramenta automática (dependency-cruiser) impede que o motor importe a tela. Se alguém misturar as camadas, o CI falha.

### Visual

Câmera 3D de verdade, em ângulo isométrico, com o mapa em grid (cada coisa ocupa quadradinhos). Dá pra girar de 90° em 90° e dar zoom. É o estilo "maquete em grid" dos city builders clássicos, só que em 3D com luz e sombra.

## 5. A simulação

### 5.1 Tempo

- O jogo anda em "ticks". Cada tick tem uma duração configurável.
- Há dois relógios configuráveis: o do dia a dia (hora, dia) e o da vida (idade). Padrão inicial: 1 ano de vida = 1 dia do jogo, pra dar pra ver gerações passando.

### 5.2 Registro da população

Existe uma lista oficial de todo mundo que mora na cidade (o "cartório"):
- id, nome, data de nascimento, família, casa, trabalho ou escola, personalidade, saúde, dinheiro.
- Todo evento de vida fica registrado: nasceu, mudou, casou, separou, trocou de emprego, morreu.
- Dá pra consultar pelo terminal: `npm run sim -- person 1234` mostra a história completa da pessoa.

### 5.3 Ciclo de vida (o "cérebro")

- Cada pessoa nasce com uma personalidade sorteada: vontade de casar, vontade de ter filhos, ambição, gosto por estudar, apego à cidade.
- As decisões juntam personalidade, situação (dinheiro, emprego, casa, saúde) e sorte. Ninguém segue roteiro: tem gente que nunca casa, que não tem filhos, que muda de cidade.
- As fases e chances vêm de dados reais pesquisados e ficam na config.
- Mortalidade pela lei de Gompertz (o risco dobra a cada ~8 anos de idade adulta), com modificadores (hospital perto, poluição etc.). Exemplo:

```yaml
death:
  referenceAge: 30      # idade usada como base
  baseRisk: 0.001       # risco por ano nessa idade
  doublingYears: 8      # a cada 8 anos, o risco dobra
  modifiers:
    nearHospital: 0.7   # hospital perto: 30% menos risco
    highPollution: 1.4  # poluição alta: 40% mais risco
```

- O cérebro fica atrás de uma interface (`CitizenBrain`). Dá pra trocar por um melhor sem mexer no resto.

### 5.4 Aleatório, mas reproduzível

Todo sorteio usa uma "semente". Cada jogo novo é diferente, mas a mesma semente repete tudo exatamente igual. Isso permite reproduzir qualquer bug de graça, sem gastar tokens tentando adivinhar o que aconteceu.

### 5.5 Trânsito e objetos que fazem sentido

- Carro é um bem de alguém: a pessoa compra (se tiver dinheiro), guarda em casa, usa pra ir a algum lugar, estaciona no destino.
- Caminhão de entrega pertence a uma empresa e leva mercadoria de A pra B.
- Toda viagem tem motivo (trabalho, escola, compras, lazer) e rota.
- Nada é criado só pra enfeitar a tela.

### 5.6 Escala

Meta inicial: 10 a 50 mil pessoas, cada uma simulada individualmente. Um teste de performance mede isso no CI. Se aguentar, sobe.

### 5.7 IA com LLM (opcional)

- Desligada por padrão. O jogo funciona 100% sem ela.
- Quando ligada, roda de vez em quando (ex: uma vez por mês do jogo), como uma "diretora" que olha a cidade e ajusta coisas grandes.
- Nos testes, usa respostas gravadas, pra dar sempre o mesmo resultado.
- **Treinar um LLM próprio:** não é o primeiro passo. O caminho que faz sentido é:
  1. Hoje: regras + dados reais (grátis, testável).
  2. Depois: dar ao LLM um "índice" (busca) com o estado da cidade e os documentos, pra ele consultar antes de decidir. Não precisa treinar nada.
  3. Só se valer a pena: usar os logs do jogo pra ajustar (fine-tuning) um modelo pequeno. Isso custa tempo e máquina, então só entra se os passos 1 e 2 não bastarem.

## 6. Testes

Tudo testável sem abrir o navegador, sempre que possível.

| Tipo | O que prova |
|---|---|
| Unitário | Uma regra isolada. Ex: "casa sem rua não cresce". |
| Cenário | Uma cidade descrita em arquivo roda N ticks e confere o resultado. |
| Cidades aleatórias | Mil cidades com sementes diferentes, checando regras que nunca podem quebrar (população negativa, dinheiro sumindo, carro sem dono, pessoa sem registro). |
| Cenário de referência | O resultado de algumas cidades fica guardado. Se mudar, alguém precisa aprovar de propósito. |
| Print da tela | O Playwright abre o jogo, carrega um cenário e compara com o print aprovado. |
| Performance | Mede ticks por segundo com a população alvo. |

Um comando só: `npm run check` roda tudo e responde em texto curto o que passou e o que quebrou.

O **prefeito automático** (bot) constrói cidades sozinho a partir de uma semente. Serve pra gerar cenários de teste sem esforço.

## 7. Logs

- Logs estruturados (JSON por linha) com: tick, sistema, entidade, evento, motivo, valores.
- Níveis: erro, aviso, info, debug. O nível é configurável por sistema.
- Cada falha de teste imprime a semente e o comando exato pra reproduzir.
- Relatório da cidade em texto (`npm run sim -- report`): população, empregos, nascimentos, mortes, trânsito, dinheiro. É isso que os agentes leem.

## 8. Não quebrar ao evoluir

- Camadas protegidas por ferramenta automática.
- Contrato e save com número de versão, com migração de versões antigas.
- Cada sistema (vida, economia, trânsito) é um módulo isolado com seus próprios testes.
- Conteúdo (tipos de prédio, profissões etc.) é dado, não código.
- Branch `main` protegida: só entra com CI verde.

## 9. Agentes

| Agente | Papel |
|---|---|
| **Designer do jogo** | Decide **o que** melhorar. Lê os relatórios da simulação e as ideias do dono do projeto, e mantém o roadmap priorizado. |
| **Arquiteto** | Decide **como**. Quebra os itens do roadmap em tarefas pequenas e revisa o código no final. |
| **QA** | Escreve o teste que falha **antes** do dev. Depois tenta quebrar o que foi feito. |
| **Dev** | Faz os testes passarem. Não pode alterar os testes do QA. |

Juízes que não são LLM: o **CI** (se falhar, não entra) e o **dono do projeto** (aprova mudanças grandes, como o contrato).

Regras pra funcionar com qualquer LLM grátis:
- Tarefa pequena: no máximo uns 3 arquivos.
- Todo pedido segue um modelo fixo com "tá pronto quando...".
- Se uma tarefa falhar 3 vezes, volta pro arquiteto quebrar em pedaços menores.
- Cada agente tem suas instruções em `agents/<papel>.md`, que vira o perfil dele no Hermes.

### 9.1 Loop de desenvolvimento e roadmap

- O quadro oficial é o GitHub: Issues pra tarefas e Pull Requests pro código.
- Quem prioriza é o **Designer** (um agente), não o jogo em si. O jogo fornece os dados: relatórios e problemas detectados automaticamente (ex: "30% desempregados").
- Ideias do dono: você abre uma Issue com a etiqueta `ideia`, escrita do jeito que quiser. O Designer lê, reescreve no formato padrão, estima o valor e o esforço, e coloca no roadmap na posição certa.
- Etiquetas de prioridade e estado (ex: `prioridade:alta`, `pronto-pra-dev`) organizam o fluxo. O `ROADMAP.md` é gerado a partir das Issues.

## 10. Fases

| Fase | Entrega |
|---|---|
| 0 | Esqueleto: repositório, ferramentas, CI, configs, docs dos agentes |
| 1 | Grid, ruas, zonas (residencial, comercial, industrial) e tela isométrica |
| 2 | Prédios crescendo, economia básica e registro da população |
| 3 | Ciclo de vida completo das pessoas |
| 4 | Trânsito: carros com dono, rotas e estacionamento |
| 5 | Prefeito automático e testes de escala |
| 6 | IA opcional (diretora com LLM) |

Um commit por fase, e cada fase só termina com `npm run check` verde.

## 11. Pendências

- Deixar o repositório público (feito pelo dono nas configurações do GitHub).
- Validar com pesquisa os números padrão de cada regra antes de implementá-la.
