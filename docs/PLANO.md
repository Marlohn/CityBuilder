# Plano do CityBuilder

> Documento vivo. Tudo aqui pode mudar, mas toda mudança precisa de um motivo escrito.
> Versão 2: revisão completa antes da implementação. O que mudou e por quê está na seção 14.

## 1. Objetivo

Um city builder isométrico que roda no navegador, inspirado no Cities: Skylines, com quatro pilares:

1. **Camadas separadas:** o motor da cidade funciona sem tela. A tela pode ser trocada por outra engine sem mexer no motor.
2. **Vida real simulada:** cada pessoa tem uma vida própria, do nascimento à morte, com escolhas aleatórias que fazem sentido.
3. **Performance desde o dia 1:** a cidade não pode travar quando cresce, que é o maior problema dos Cities: Skylines.
4. **Evolução contínua por agentes de IA:** agentes com LLMs grátis (via Hermes Agent) melhoram o jogo em loop, 24h, sem quebrar o que já funciona.

## 2. Regras de ouro

1. **Tudo tem que fazer sentido na vida real.** Antes de criar qualquer coisa, perguntar: de onde veio? De quem é? Pra onde vai? Onde fica depois?
   - Nada surge ou some do nada. Um carro tem dono (pessoa ou empresa), origem, destino e lugar pra estacionar.
   - Uma pessoa só entra na cidade nascendo ou se mudando pra ela, e só sai morrendo ou se mudando.
2. **Nada fixo.** Todo número de regra de jogo fica em arquivo de config, com valor padrão, explicação e validação.
3. **Toda regra tem prova.** Os valores padrão vêm de dados reais (de preferência IBGE), com a fonte anotada ao lado.
4. **Teste primeiro (TDD).** O teste é escrito antes e falha. Depois o código faz ele passar.
5. **Performance é regra, não detalhe.** Nenhuma mudança entra deixando o jogo mais lento sem que isso apareça e seja aprovado.
6. **Sem exagero.** Se uma ideia não tem uso claro agora, vai pro roadmap, não pro código.
7. **Pensar em quem vai corrigir.** Todo erro tem que vir com a informação necessária pra reproduzir e entender o problema, sem gastar tempo nem tokens adivinhando.

## 3. Tecnologia

| Parte | Escolha | Por quê |
|---|---|---|
| Linguagem | TypeScript (modo estrito) em tudo | Linguagem mais usada no GitHub desde 2025. O sistema de tipos pega a maioria dos erros que LLMs cometem. Uma linguagem só facilita pros agentes. |
| Motor da simulação | TypeScript puro, sem nenhuma dependência de navegador | Roda em Web Worker (navegador), em Node (testes e servidor) e no terminal. |
| Tela 3D | Babylon.js | Não quebra código antigo entre versões (bom pros LLMs, que aprenderam versões antigas). Já vem com sombras, efeitos, clique em objetos e desenho em lote. Aguenta muitas luzes (cidade à noite). |
| Menus e painéis | HTML por cima do 3D, com React | É o que os LLMs mais conhecem. Fica separado do 3D. |
| Modelos 3D | Kenney City Kit (CC0, domínio público) | Grátis, low-poly, com ruas, casas e comércio. Trocáveis depois. |
| Build | Vite + npm workspaces | Padrão de mercado e simples. |
| Qualidade | Biome (lint e formatação), dependency-cruiser (camadas) | Uma ferramenta só pra estilo, e outra que impede misturar camadas. |
| Testes | Vitest, fast-check (cidades aleatórias), Playwright (tela) | Rápidos e conhecidos pelos LLMs. |
| Config | YAML validado com zod | YAML aceita comentários. A validação avisa na hora se um valor estiver errado. |
| Publicação | GitHub Pages | Grátis pra repositório público. O jogo fica jogável por um link. |
| Plano B de performance | Rust → WebAssembly, só pra partes medidas como lentas | Os mesmos testes provam que o resultado não mudou. |

Idioma: **código em inglês, documentação em português.**

**Por que não Rust desde o começo?** O gargalo das cidades grandes é principalmente de algoritmo (quantas rotas calcular e como calcular), não de linguagem. Um algoritmo melhor em TypeScript ganha de um algoritmo ruim em Rust. E Rust é bem mais difícil pros LLMs grátis. Se uma parte específica precisar, ela vira Rust depois.

## 4. Arquitetura

```
[ Tela: Babylon.js + painéis HTML (qualquer engine amanhã) ]
        ↑ estado da cidade          ↓ comandos
[ Contrato: comandos + formato do estado (com versão) ]
        ↑
[ Motor da cidade: simulação pura, sem tela ]
        ↑
[ Cérebro das pessoas: regras hoje, IA melhor amanhã ]
```

- A tela **nunca** muda a cidade direto. Ela só manda comandos ("construir rua de A até B") e lê o estado.
- Toda mudança na cidade acontece por comando. Isso permite gravar e repetir uma partida inteira (seção 5.9).

Pastas:

```
packages/
  sim/        motor da cidade (proibido importar render ou ui)
  contract/   comandos, formato do estado, versões
  render/     tela 3D em Babylon.js
  ui/         painéis e menus em React
  cli/        simulação pelo terminal, relatórios e replays
  bots/       prefeito automático (gera cidades pros testes)
config/       todos os números do jogo (com fonte anotada)
data/         nomes, tipos de prédio, tábuas do IBGE
scenarios/    cidades de teste
docs/         plano e decisões
agents/       instruções de cada agente
```

## 5. A simulação

### 5.1 Mapa

- Grid de quadradinhos. **Cada quadradinho tem 16 m × 16 m**, mais ou menos o tamanho de um lote de casa.
- **Mapa padrão: 256 × 256 quadradinhos** (cerca de 4 km × 4 km). Tudo configurável.
- Por que esse tamanho: a meta é 100 mil pessoas. A cidade de São Paulo tem cerca de 7.500 habitantes por km² (IBGE, Censo 2022). Com essa densidade, 16 km² comportam uns 120 mil habitantes. No mapa de 128 × 128 (4 km²), 50 mil pessoas dariam o dobro da densidade de São Paulo, o que não é realista.

### 5.2 Tempo

- **Cada dia do jogo representa um ano de vida.** O calendário mostra anos, e o relógio mostra as horas do dia. É o mesmo esquema do mod "Real Time" do Cities: Skylines. No jogo original, as pessoas vivem só uns 6 anos do calendário, o que não faz sentido.
- Assim a rotina (acordar, trabalhar, voltar pra casa) e a vida (crescer, casar, envelhecer) andam juntas sem contradição.
- Padrão inicial: 1 dia do jogo = 2 minutos reais na velocidade 1x. Uma vida de ~76 anos dura umas 2 horas e meia de jogo. Velocidades 1x, 2x e 4x, além de pausa.

### 5.3 Registro da população (o "cartório")

- Lista oficial de todo mundo que mora na cidade: id, nome, sexo, nascimento, família, casa, trabalho ou escola, personalidade, saúde, dinheiro.
- Todo evento de vida fica registrado: chegou, nasceu, estudou, trabalhou, casou, separou, se mudou, morreu.
- Consulta pelo jogo (lista pesquisável) e pelo terminal: `npm run sim -- person 1234` mostra a história completa.
- Nomes vêm da API de nomes do IBGE (Censo 2010), salvos num arquivo de dados.

### 5.4 Ciclo de vida (o "cérebro")

- Cada pessoa nasce com uma personalidade sorteada: vontade de casar, vontade de ter filhos, ambição, gosto por estudar, apego à cidade.
- Cada decisão junta personalidade, situação (dinheiro, emprego, casa, saúde) e sorte. Ninguém segue roteiro: tem gente que nunca casa, que não tem filhos, que muda de cidade.
- Valores padrão com base em dados reais do Brasil:
  - **Mortalidade:** tábua completa de mortalidade do IBGE (2023), por idade e sexo. Expectativa de vida ao nascer de 76,4 anos (homens 73,1; mulheres 79,7) e mortalidade infantil de 12,5 por mil. A tábua já cobre desde bebês até idosos, coisa que uma fórmula simples não cobre. Por cima dela, modificadores configuráveis (ex: hospital perto diminui o risco).
  - **Filhos:** taxa de fecundidade de 1,57 filho por mulher (IBGE, 2023). Como fica abaixo de 2,1, a cidade encolhe sem imigração. Isso é realista: as cidades de verdade também crescem com gente que chega.
- O cérebro fica atrás de uma interface (`CitizenBrain`). Dá pra trocar por um melhor sem mexer no resto.

Exemplo de config:

```yaml
mortality:
  table: data/ibge/tabua-mortalidade-2023.csv  # risco por idade e sexo
  modifiers:
    nearHospital: 0.8    # hospital perto: 20% menos risco (exemplo; valor final precisa de fonte)
```

### 5.5 Economia e crescimento

- O mapa começa vazio. As pessoas chegam "de fora do mapa" quando existem casas vagas e empregos, e a chegada fica registrada.
- As zonas (residencial, comercial, industrial) crescem conforme a demanda, como no Cities: Skylines.
- Dois modos de dinheiro: com orçamento (padrão; impostos, gastos, pode ficar no vermelho) e livre (dinheiro infinito).

### 5.6 Serviços

- **Na primeira versão:** escola e saúde, porque o ciclo de vida depende delas (estudar, adoecer, morrer).
- **Depois (roadmap):** água, energia, lixo, polícia, bombeiro, transporte público.

### 5.7 Trânsito e objetos que fazem sentido

- Carro é um bem de alguém: a pessoa compra (se tiver dinheiro), guarda em casa, usa pra ir a algum lugar e estaciona no destino.
- Caminhão de entrega pertence a uma empresa e leva mercadoria de A pra B.
- Toda viagem tem motivo (trabalho, escola, compras, lazer), origem, destino e rota.
- Nada é criado só pra enfeitar a tela.

### 5.8 Aleatório, mas reproduzível

- Todo sorteio usa uma "semente". Cada jogo novo é diferente, mas a mesma semente repete tudo igual.
- A matemática do motor não usa funções que dão resultados diferentes em cada navegador (como `Math.pow` e `Math.exp`). No lugar delas, entram tabelas prontas. Um teste confere se o Node e o Chromium chegam exatamente no mesmo resultado.

### 5.9 Save e replay

- Save = foto da cidade (formato binário, com versão) + lista dos comandos dados depois dela.
- Como tudo é reproduzível, **um bug vira um arquivo pequeno** (semente + comandos) que repete o problema exatamente. Isso economiza muito tempo e token dos agentes.
- Botão "reportar problema" no jogo exporta esse arquivo.
- Saves antigos continuam abrindo depois de atualizações (migração por versão).

## 6. Performance

### 6.1 O problema que queremos evitar

Pelos relatos de jogadores do Cities: Skylines 2, cidades grandes travam por causa do processador, não da placa de vídeo. Cada viagem precisa de um cálculo de rota. Quanto mais gente e mais ruas, mais pesado fica, e o jogo desacelera a simulação.

### 6.2 Metas

- 50 mil pessoas rodando liso na velocidade 1x. Depois, 100 mil ou mais.
- A tela nunca trava por causa da simulação. No pior caso, a simulação fica mais lenta e o jogo avisa, mas você continua construindo.

### 6.3 Como garantir

1. **Simulação fora da tela.** O motor roda num Web Worker. Rotas são calculadas por vários workers em paralelo. Cada um tem uma cópia do mapa de ruas, que muda pouco, então não precisamos de recursos que exigem configuração especial do servidor (o GitHub Pages não permite).
2. **Paralelo, mas reproduzível.** Os resultados das rotas são aplicados sempre na mesma ordem, não na ordem em que ficam prontos. Nos testes, tudo roda numa thread só e dá exatamente o mesmo resultado.
3. **Rotas inteligentes.**
   - Rotas repetidas ficam guardadas (casa → trabalho não é recalculada todo dia).
   - O mapa de ruas é dividido em regiões: primeiro acha o caminho entre regiões, depois dentro delas.
   - Construir uma rua só invalida as rotas daquela área.
   - Os pedidos de rota entram numa fila com limite por tick.
4. **Nem todo mundo pensa ao mesmo tempo.** Decisões de vida rodam uma vez por dia do jogo (= uma vez por ano de vida), divididas ao longo dos ticks. Só o que precisa (carros em movimento) roda todo tick.
5. **Detalhe só onde se vê.** Todo carro e toda pessoa existem sempre. Mas o carro longe da câmera tem a posição calculada de um jeito barato ("chega em X minutos"). Perto da câmera, o movimento é detalhado.
6. **Dados compactos.** Pessoas e carros ficam em arrays numéricos, não em milhares de objetos soltos. Isso evita as pausas do coletor de lixo do JavaScript.
7. **Tela leve.** Prédios iguais são desenhados em lote, objetos parados não são recalculados, e o que está longe usa modelos mais simples.
8. **Histórico leve.** Os eventos de vida ficam num formato compacto. Log em texto detalhado só quando pedido (debug).

### 6.4 Como medir sem teste instável

- Tempo de relógio varia de máquina pra máquina, então um teste baseado só nele falharia à toa e faria os agentes perderem tempo.
- Por isso o teste que barra mudanças conta **trabalho** em vez de tempo: quantas rotas foram calculadas, quantos nós foram visitados, quantas pessoas foram processadas. Isso dá sempre o mesmo número e não depende da máquina.
- O tempo real (ticks por segundo) também é medido e aparece no relatório, com um limite mais folgado.
- Cidades de estresse (50 mil e 100 mil pessoas) são geradas pelo prefeito automático.
- Os servidores de teste do GitHub pra repositório público têm 4 núcleos e 16 GB de RAM, e são grátis. Eles servem de "máquina de referência".

Todos os limites ficam na config.

## 7. IA com LLM (opcional)

- Desligada por padrão. O jogo funciona 100% sem ela.
- Quando ligada, roda de vez em quando (ex: uma vez por ano do jogo), como uma "diretora" que olha a cidade e ajusta coisas grandes.
- Nos testes, usa respostas gravadas, pra dar sempre o mesmo resultado.
- Treinar um LLM próprio não é o primeiro passo:
  1. Hoje: regras + dados reais (grátis e testável).
  2. Depois: dar ao LLM um "índice" (busca) com o estado da cidade e os documentos, pra ele consultar antes de decidir.
  3. Só se valer a pena: usar os logs do jogo pra ajustar um modelo pequeno.

## 8. Testes

Tudo testável sem abrir o navegador, sempre que possível.

| Tipo | O que prova |
|---|---|
| Unitário | Uma regra isolada. Ex: "casa sem rua não cresce". |
| Cenário | Uma cidade descrita em arquivo roda N ticks e confere o resultado. |
| Cidades aleatórias | Muitas cidades com sementes diferentes, checando regras que nunca podem quebrar: população negativa, dinheiro sumindo, carro sem dono, pessoa sem registro, alguém surgindo do nada. |
| Referência | O resultado de algumas cidades fica guardado. Se mudar, alguém aprova de propósito. |
| Reprodutibilidade | Node e Chromium chegam no mesmo resultado com a mesma semente. |
| Performance | Contadores de trabalho (fixos) e ticks por segundo (informativo). |
| Tela | O Playwright abre o jogo, carrega um cenário e compara com o print aprovado. |

- Um comando só: `npm run check` roda tudo e responde em texto curto o que passou e o que quebrou.
- Toda falha mostra a semente e o comando exato pra reproduzir.

## 9. Placar de realismo (ideia nova)

- Um relatório automático compara os números da cidade com a vida real: expectativa de vida, mortalidade infantil, filhos por mulher, desemprego, tempo de deslocamento.
- As faixas aceitáveis vêm de fontes reais (IBGE) e ficam na config.
- Número fora da faixa vira um alerta. Exemplo: "expectativa de vida na cidade = 45 anos, a faixa real é 70 a 82". O alerta vira uma Issue pro Designer.
- É assim que "o jogo gera o roadmap" de um jeito que faz sentido: o jogo aponta o problema com dados, e o agente decide a prioridade.

## 10. Logs

- Logs estruturados (JSON por linha): tick, sistema, entidade, evento, motivo, valores.
- Nível configurável por sistema (erro, aviso, info, debug).
- Tempo gasto por sistema em cada tick, pra achar na hora quem está pesando.
- Relatório da cidade em texto (`npm run sim -- report`): população, empregos, nascimentos, mortes, trânsito, dinheiro, placar de realismo. É isso que os agentes leem.

## 11. Não quebrar ao evoluir

- Camadas protegidas por ferramenta automática.
- Contrato e save com número de versão e migração.
- Cada sistema (vida, economia, trânsito) é um módulo isolado com seus testes.
- Conteúdo (tipos de prédio, profissões etc.) é dado, não código.
- Branch `main` protegida: só entra com CI verde.

## 12. Agentes

| Agente | Papel |
|---|---|
| **Designer do jogo** | Decide **o que** melhorar. Lê relatórios, alertas do placar de realismo e ideias do dono, e mantém o roadmap priorizado. |
| **Arquiteto** | Decide **como**. Quebra os itens em tarefas pequenas e revisa o código no final. |
| **QA** | Escreve o teste de aceitação que falha **antes** do dev. Depois tenta quebrar o que foi feito. |
| **Dev** | Faz os testes passarem. Não pode alterar os testes de aceitação do QA (um check automático bloqueia). |

Juízes que não são LLM:
- **O CI:** se falhar, não entra.
- **O dono do projeto:** aprova mudanças grandes (contrato, formato de save, schema da config). O arquivo CODEOWNERS do GitHub obriga isso.

Regras pra funcionar com qualquer LLM grátis:
- Tarefa pequena: no máximo uns 3 arquivos.
- Todo pedido segue um modelo fixo com "tá pronto quando...".
- Se uma tarefa falhar 3 vezes, volta pro arquiteto quebrar em pedaços menores.
- Bug sempre vem com o arquivo de replay (semente + comandos).
- Cada agente tem suas instruções em `agents/<papel>.md`, que vira o perfil dele no Hermes.

### 12.1 Loop de desenvolvimento

- O quadro oficial é o GitHub: Issues pra tarefas e Pull Requests pro código.
- Etiquetas organizam o fluxo: `ideia` → `roadmap` → `pronto-pra-teste` → `pronto-pra-dev` → `em-revisão`, com `prioridade:alta/média/baixa`.
- Ideias do dono: você abre uma Issue com a etiqueta `ideia`, escrita do jeito que quiser. O Designer lê, reescreve no formato padrão, estima o valor e o esforço, e encaixa no roadmap.
- O `ROADMAP.md` é gerado automaticamente a partir das Issues.

## 13. Fases

| Fase | Entrega |
|---|---|
| 0 | Esqueleto: monorepo, ferramentas, CI, config com validação, semente, logs, `npm run check`, instruções dos agentes, publicação no GitHub Pages |
| 1 | Mapa, ruas, zonas e tela isométrica 3D com câmera (girar e zoom) |
| 2 | Registro da população, chegada de moradores, prédios crescendo, empregos e economia básica. Deslocamento calculado pelo tempo de viagem nas ruas, ainda sem carros na tela |
| 3 | Ciclo de vida completo com dados do IBGE, escola e saúde, placar de realismo |
| 4 | Trânsito: carros com dono, rotas em paralelo, cache e estacionamento |
| 5 | Prefeito automático, cidades de estresse (50 mil e 100 mil), save e replay |
| 6 | IA opcional (diretora com LLM) |

- Cada fase é feita em vários commits pequenos e só termina com `npm run check` verde.
- No fim de cada fase: um resumo pra você, um print da tela e os números de performance.

## 14. Revisão v2: o que mudou e por quê

| Antes | Agora | Motivo |
|---|---|---|
| Mapa 128 × 128 | 256 × 256, com quadradinho de 16 m | Com 128 × 128, 50 mil pessoas dariam o dobro da densidade de São Paulo. |
| Dois relógios separados (dia e vida) | Cada dia do jogo = um ano de vida | Mais simples e sem contradição. Já foi testado pela comunidade (mod Real Time). |
| Mortalidade pela fórmula de Gompertz | Tábua real do IBGE + modificadores | Dado real, que cobre também a mortalidade infantil. |
| Teste de performance por tempo | Contadores de trabalho (fixos) + tempo como informação | Teste por tempo varia por máquina e faria os agentes perderem tempo com falha falsa. |
| Rotas em paralelo, sem regra de ordem | Resultados aplicados sempre na mesma ordem | Sem isso, a simulação deixaria de ser reproduzível. |
| Matemática livre | Sem `Math.pow`/`Math.exp` no motor | Essas funções podem dar resultados diferentes em cada navegador. |
| Save simples | Save + replay de comandos | Transforma todo bug num arquivo pequeno e reproduzível. |
| (não tinha) | Placar de realismo | Detecta "viagem na maionese" com dados e alimenta o roadmap. |
| (não tinha) | Escopo de serviços definido | Escola e saúde entram primeiro porque o ciclo de vida depende delas. |
| (não tinha) | Publicação no GitHub Pages | Pra dar pra jogar por um link. |
| Um commit por fase | Vários commits pequenos por fase | Commit gigante é difícil de revisar e de desfazer. |

## 15. Pendências do dono

- Deixar o repositório público (GitHub → Settings → General → Change visibility).
- Depois de público: ativar a proteção da branch `main` e o GitHub Pages.

## 16. Fontes

- Octoverse 2025 (TypeScript em 1º): https://github.blog/news-insights/octoverse/octoverse-a-new-developer-joins-github-every-second-as-ai-leads-typescript-to-1/
- Compatibilidade do Babylon.js: https://babylonjs.medium.com/there-and-back-again-a-tale-of-backwards-compatibility-in-babylon-js-47ffc4f7ed6f
- Babylon.js 9 (clustered lighting): https://app.cinevva.com/news/2026-03-26-babylonjs-9
- Kenney City Kit: https://kenney.nl/assets/city-kit-roads
- IBGE, expectativa de vida 2023: https://agenciadenoticias.ibge.gov.br/agencia-noticias/2012-agencia-de-noticias/noticias/41984-em-2023-expectativa-de-vida-chega-aos-76-4-anos-e-supera-patamar-pre-pandemia
- IBGE, tábuas de mortalidade: https://www.ibge.gov.br/estatisticas/sociais/populacao/9126-tabuas-completas-de-mortalidade.html
- IBGE, fecundidade 2023 (1,57): https://agenciabrasil.ebc.com.br/radioagencia-nacional/saude/audio/2024-08/taxa-de-fecundidade-no-brasil-cai-para-157-filho-por-mulher
- IBGE, densidade de São Paulo: https://www.ibge.gov.br/cidades-e-estados/sp/sao-paulo.html
- IBGE, API de nomes: https://servicodados.ibge.gov.br/api/docs/nomes?versao=2
- Mod Real Time (1 dia = 1 ano): https://github.com/dymanoid/RealTime
- Vida curta no Cities: Skylines: https://forum.paradoxplaza.com/forum/threads/game-mechanic-cims-lifespans-about-6-years-and-they-die-at-the-same-time.843496/
- Gargalo de CPU no CS2: https://steamcommunity.com/app/949230/discussions/0/3937895062992023535/?ctp=2
- `Math.pow` diferente entre navegadores: https://github.com/mdn/browser-compat-data/issues/19429
- GitHub Pages sem headers COOP/COEP: https://github.com/orgs/community/discussions/13309
- Servidores de CI do GitHub (4 núcleos, grátis em repo público): https://github.blog/news-insights/product-news/github-hosted-runners-double-the-power-for-open-source/
- Papéis em times de agentes (MetaGPT): https://arxiv.org/html/2308.00352v6
