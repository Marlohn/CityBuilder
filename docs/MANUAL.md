# Manual do jogo

## A ideia

Você é quem planeja a cidade: abre ruas, define onde pode ter casa, comércio e indústria, e coloca escolas e postos de saúde. Quem constrói as casas e as lojas são as construtoras, e só quando há gente querendo morar ou trabalhar ali. Os moradores vivem a vida deles sozinhos.

O mapa começa vazio, com um **rio** no leste, alguns **lagos** e uma **avenida saindo da borda oeste**. Não dá para construir, zonear nem abrir via na água (ponte ainda não existe). Ela liga a cidade ao resto do mundo: é por ela que as famílias chegam e que o material das obras entra. Toda rua precisa se ligar a ela, senão nada é construído ali.

## O tempo

- **Cada dia do jogo = um ano de vida.** Em um dia, cada pessoa faz um aniversário.
- Na velocidade 1x, um dia dura 2 minutos. Botões no topo: ⏸ pausar, 🐢 devagar (bom para ver o trânsito), ▶ 1x, ▶▶ 2x, ▶▶▶ 4x.
- Se aparecer um aviso amarelo no topo, a simulação não está conseguindo acompanhar a velocidade. Diminua a velocidade.

## Câmera

| Ação | Como |
|---|---|
| Mover | W A S D ou setas |
| Arrastar o mapa | botão direito arrastando (o chão acompanha o mouse) |
| Girar | Q e E (segurando), ou botão do meio arrastando para os lados |
| Inclinar | Home e End, ou botão do meio arrastando para cima e para baixo |
| Zoom | roda do mouse, ou Z e X |
| Cancelar ferramenta | Esc |

Os controles são os mesmos do Cities: Skylines II.

## Ferramentas

| Ferramenta | O que faz |
|---|---|
| 🔍 Ver | Clique num prédio para ver quem mora, trabalha ou estuda ali. Clique numa pessoa para ver a história dela. |
| 🛣️ Rua | Via local, 30 km/h. Arraste em linha reta. |
| 🛤️ Avenida | Via arterial, 60 km/h, custa o dobro. Boa para ligar bairros. |
| 🏠 Casas | Zona residencial de baixa densidade. |
| 🏢 Prédios | Zona residencial de alta densidade (apartamentos). |
| 🏪 Comércio | Lojas e escritórios. |
| 🏭 Indústria | Galpões. |
| ⬜ Tirar zona | Remove a zona (onde ainda não tem prédio). |
| 🏫 Escola | Até 780 alunos em dois turnos. Precisa encostar numa via. |
| 🏥 UBS | Posto de saúde para até 3.500 pessoas. Precisa encostar numa via. |
| ↔️ Mover | Clique numa escola ou UBS e depois no lugar novo. A mudança custa 30% da obra (como no Cities: Skylines II, não é de graça). Alunos e pacientes continuam; quem ficar longe demais procura outra. |
| 🧨 Demolir | Arraste para demolir vias e prédios. Quem morava ou trabalhava ali precisa procurar outro lugar. |

Dica: só dá para construir em lote com frente para a rua. Quarteirões de 4 a 6 quadradinhos de fundo aproveitam bem o espaço.

## Como a cidade cresce

As barras de **Demanda** (painel Cidade) mostram o que está faltando:

- **Indústria** vende para fora da cidade e traz dinheiro "de fora". Ela cresce enquanto consegue contratar gente.
- **Comércio e serviços** crescem em cima disso: cada emprego "de fora" (indústria, ou morador que trabalha em outra cidade) sustenta mais ou menos mais um emprego local. É a teoria da base econômica, medida em cidades brasileiras pequenas.
- **Casas** aparecem quando há emprego sobrando e gente querendo vir.

Ou seja: sem indústria (ou emprego na região), a cidade não cresce muito.

## Os moradores

- Chegam de fora como famílias, quando há casa vaga e alguém da família arruma emprego.
- Nascem, estudam, procuram emprego (e às vezes demoram a achar), casam ou não, têm filhos ou não, se divorciam, se aposentam e morrem. As chances vêm das tabelas do IBGE.
- Cada um tem traços próprios (vontade de casar, de ter filhos, de estudar...), então as vidas são diferentes.
- Quem não acha casa, escola ou UBS fica registrado como **desejo não atendido**. Esse número aparece no painel Cidade e alimenta o roadmap do jogo.
- Carros têm dono (a família), dependem da renda e ficam estacionados em casa ou no destino.

## Água e luz

- A estrada de acesso traz água e luz da região, mas só o suficiente para uma cidade pequena (~4 mil pessoas).
- Depois disso a cidade precisa das suas:
  - 💧 **Poço artesiano**: água subterrânea, em qualquer lugar (40% das cidades brasileiras vivem só de poço, segundo a ANA). Abastece ~11 mil pessoas.
  - 💧 **Estação de tratamento de água (ETA)**: capta no rio ou lago (tem que ficar a até 3 quadradinhos da água). Abastece ~56 mil pessoas.
  - ⚡ **Subestação de energia**: abastece ~50 mil pessoas.
- As redes seguem as ruas: um prédio tem água se está na mesma malha de ruas de uma fonte com capacidade sobrando.
- Sem água ou luz, ninguém se muda para o prédio, as empresas não contratam e a construtora não constrói ali. Quem já mora num prédio que ficou sem água aparece em "Morando sem água".

## Serviços

- **Escola:** crianças de 6 a 17 anos precisam de uma escola a até 2 km de casa.
- **UBS:** cada pessoa se cadastra numa UBS a até 2 km. Sem UBS, o risco de morrer é maior.

## Dinheiro

- Modo padrão: **com orçamento**. A prefeitura começa com R$ 40 milhões.
- Receita: cerca de R$ 5.300 por morador por ano (média real dos municípios brasileiros).
- Despesas: escolas (custo por aluno do Fundeb), UBS e manutenção das vias.
- Obras custam: rua R$ 46.400 por quadradinho, avenida R$ 92.800, escola R$ 9 milhões, UBS R$ 2 milhões.
- Sem dinheiro, a obra é recusada (aparece um aviso). Para jogar sem se preocupar, use `?modo=livre` na URL.

## Painéis

- **Cidade:** demanda, pessoas, desejos não atendidos e contas da prefeitura.
- **Pessoas:** a lista de todos os moradores, com busca. Clique para ver a história completa.
- **Realismo:** a cidade comparada com o Brasil real (expectativa de vida, filhos por mulher, desemprego...). Precisa de uma cidade com pelo menos 1.500 pessoas e alguns anos de dados.
- **Desempenho:** quanto tempo cada parte da simulação gasta.
- **Ajuda:** o resumo deste manual.

## Salvar, abrir e reportar problema

- **💾 Salvar** baixa um arquivo com a sua cidade. **📂 Abrir** carrega de volta. O jogo refaz a cidade a partir das suas ações, então abrir uma cidade antiga pode levar alguns segundos.
- **🐞 Reportar problema** baixa um arquivo com tudo o que precisa para repetir o problema. Anexe numa issue "Bug" no GitHub.
