# Roadmap

> Gerado por `npm run roadmap:build`. Não edite à mão: mude as issues e rode de novo. Como funciona: docs/PLANO.md, seção 12.2.
>
> Nota = (alcance × impacto × confiança) ÷ esforço. 🚨 = urgente (passa na frente). Itens sem fonte ou sem métrica não entram.

Sinais medidos em 2026-09-29 em 4 cidades de teste (bot:avaliacao-1 5.161, bot:avaliacao-2 6.099, bot:avaliacao-3 4.099, cenario:bairro-basico 2.074 pessoas).

## Agora (até 10 itens; mistura: 50% features/construções, 30% correções/realismo, 20% técnico)

_Nada aqui._

## Próximo

_Nada aqui._

## Depois

_Nada aqui._

## Bloqueados (esperando dependência)

_Nada aqui._

## Entregues: conferência da métrica

_Nada entregue esperando conferência._

## Incompletos (falta campo obrigatório)

_Nenhum._

## Ideias esperando o Designer

_Nenhuma. Abra uma issue com o formulário "Ideia"._

## Sinais sem item (candidatos para o Designer)

Medidos pelo jogo e ainda não viraram issue. A nota é provisória (esforço padrão). Para criar o item, use o formulário "Item do roadmap" e cite o id no campo "Sinal de origem".

### Falta no jogo: Água tratada e esgoto

- **Sinal:** `comparacao:saneamento` · categoria construcao · nota provisória 4.358
- **Medido:** Toda cidade real tem isso; a cidade de teste tem 5.161 e o jogo não oferece.
- **Alcance:** 4.358 pessoas · impacto 3 · prova: dado do jogo + fonte
- **Fonte:** Lei 14.026/2020 (marco do saneamento): meta de 99% com água potável e 90% com coleta e tratamento de esgoto até 2033 (https://www.gov.br/cidades/pt-br/assuntos/saneamento/marco-legal-do-saneamento)
- **Sugestão:** Criar água tratada e esgoto (pesquisar como funciona e o custo real antes).

### Falta no jogo: Hospital (leitos de internação)

- **Sinal:** `comparacao:hospital` · categoria construcao · nota provisória 3.486
- **Medido:** Cidades reais com mais de 8.000 habitantes têm isso. A cidade de teste tem 5.161, mas o jogo promete 50.000: vai precisar (alcance = pessoas de hoje).
- **Alcance:** 4.358 pessoas · impacto 3 · prova: só fonte
- **Fonte:** Portaria GM/MS 1.101/2002: 2,5 a 3 leitos por 1.000 habitantes (https://bvsms.saude.gov.br/bvs/saudelegis/gm/2002/prt1101_12_06_2002.html)
- **Sugestão:** Criar hospital (leitos de internação) (pesquisar como funciona e o custo real antes).

### Falta no jogo: Transporte público (ônibus)

- **Sinal:** `comparacao:transporte_publico` · categoria feature · nota provisória 2.324
- **Medido:** Cidades reais com mais de 20.000 habitantes têm isso. A cidade de teste tem 5.161, mas o jogo promete 50.000: vai precisar (alcance = pessoas de hoje).
- **Alcance:** 4.358 pessoas · impacto 2 · prova: só fonte
- **Fonte:** Lei 12.587/2012 (Política Nacional de Mobilidade Urbana): municípios com mais de 20 mil habitantes precisam de plano de mobilidade (https://www.planalto.gov.br/ccivil_03/_ato2011-2014/2012/lei/l12587.htm)
- **Sugestão:** Criar transporte público (ônibus) (pesquisar como funciona e o custo real antes).

### Realismo: Jovens 18-24 no ensino superior abaixo da vida real

- **Sinal:** `realismo:higherEducation` · categoria realismo · nota provisória 1.453
- **Medido:** Na cidade: 0 %. Na vida real: 15 a 45.
- **Alcance:** 4.358 pessoas · impacto 1 · prova: dado do jogo + fonte
- **Fonte:** PNAD Educação 2023: 30,5%
- **Sugestão:** Achar a regra que gera esse número (relatório + log) e corrigir com base na fonte.
- **Métrica sugerida:** `realism.higherEducation entre 15 e 45`

### Realismo: Crianças 6-17 na escola abaixo da vida real

- **Sinal:** `realismo:schoolEnrollment` · categoria realismo · nota provisória 1.280
- **Medido:** Na cidade: 72.36 %. Na vida real: 90 a 100. (apareceu em 3 de 4 cidades de teste; números de uma delas)
- **Alcance:** 3.840 pessoas · impacto 1 · prova: dado do jogo + fonte
- **Fonte:** PENDENTE: taxa de escolarização (PNAD Educação)
- **Sugestão:** Achar a regra que gera esse número (relatório + log) e corrigir com base na fonte.
- **Métrica sugerida:** `realism.schoolEnrollment entre 90 e 100`

### Desejo não atendido: pessoas sem UBS

- **Sinal:** `desejo:health` · categoria balanceamento · nota provisória 1.276
- **Medido:** 1.661 pessoas sem UBS numa cidade de 5.161 pessoas. O jogo já tem isso: o problema é o prefeito automático (ou o jogador) não atender, ou falta informação na tela para perceber. (apareceu em 3 de 4 cidades de teste; números de uma delas)
- **Alcance:** 1.276 pessoas · impacto 3 · prova: dado do jogo + fonte
- **Fonte:** PNAB 2017: 1 equipe de Saúde da Família para 2.000 a 3.500 pessoas (https://bvsms.saude.gov.br/bvs/saudelegis/gm/2017/prt2436_22_09_2017.html)
- **Sugestão:** Ensinar o prefeito automático a atender e mostrar a cobertura no mapa (camada de cobertura).
- **Métrica sugerida:** `unmet.health < 166`

### Realismo: Divórcios por mil adultos (20+) acima da vida real

- **Sinal:** `realismo:divorceRate` · categoria realismo · nota provisória 430
- **Medido:** Na cidade: 4.99 por mil. Na vida real: 1.5 a 4.5. (apareceu em 1 de 4 cidades de teste; números de uma delas)
- **Alcance:** 1.290 pessoas · impacto 1 · prova: dado do jogo + fonte
- **Fonte:** IBGE 2023: 2,8
- **Sugestão:** Achar a regra que gera esse número (relatório + log) e corrigir com base na fonte.
- **Métrica sugerida:** `realism.divorceRate entre 1.5 e 4.5`

### Realismo: Idade média ao casar (mulheres) acima da vida real

- **Sinal:** `realismo:marriageAgeFemale` · categoria realismo · nota provisória 430
- **Medido:** Na cidade: 35.68 anos. Na vida real: 25 a 34. (apareceu em 1 de 4 cidades de teste; números de uma delas)
- **Alcance:** 1.290 pessoas · impacto 1 · prova: dado do jogo + fonte
- **Fonte:** IBGE Registro Civil 2023: 29,2
- **Sugestão:** Achar a regra que gera esse número (relatório + log) e corrigir com base na fonte.
- **Métrica sugerida:** `realism.marriageAgeFemale entre 25 e 34`

### Valores sem fonte em config/economy.yaml (4)

- **Sinal:** `pendente:economy.yaml` · categoria realismo · nota provisória 363
- **Medido:** linha 5: PENDENTE: valor de jogo. Dá para ruas, uma escola e uma UBS no começo. | linha 12: completo R$ 2.660; superior completo R$ 6.177. PENDENTE: fundamental incompleto e médio | linha 15: Variação individual (desvio padrão relativo). PENDENTE: valor de jogo. | linha 19: PENDENTE: fração da renda gasta com o custo de vida.
- **Alcance:** 4.358 pessoas · impacto 0,5 · prova: só dado do jogo, falta fonte
- **Sugestão:** Pesquisar fonte real para cada valor PENDENTE e trocar o comentário pela fonte.

### Valores sem fonte em config/growth.yaml (5)

- **Sinal:** `pendente:growth.yaml` · categoria realismo · nota provisória 363
- **Medido:** linha 3: Demanda inicial por moradia quando a cidade está vazia. PENDENTE: valor de jogo. | linha 8: e 2,36 (Mirandópolis-SP). Usada a média ~2,15. PENDENTE: mais cidades. | linha 11: mais empregos (pelo menos um galpão). PENDENTE: taxa de crescimento real. | linha 15: Quantos prédios podem começar a ser construídos por dia do jogo. PENDENTE: valor de jogo.
- **Alcance:** 4.358 pessoas · impacto 0,5 · prova: só dado do jogo, falta fonte
- **Sugestão:** Pesquisar fonte real para cada valor PENDENTE e trocar o comentário pela fonte.

### Valores sem fonte em config/health.yaml (1)

- **Sinal:** `pendente:health.yaml` · categoria realismo · nota provisória 363
- **Medido:** linha 3: Distância máxima até a UBS. PENDENTE: sem fonte oficial encontrada; usado o mesmo limite de caminhada da escola.
- **Alcance:** 4.358 pessoas · impacto 0,5 · prova: só dado do jogo, falta fonte
- **Sugestão:** Pesquisar fonte real para cada valor PENDENTE e trocar o comentário pela fonte.

### Valores sem fonte em config/lifecycle.yaml (10)

- **Sinal:** `pendente:lifecycle.yaml` · categoria realismo · nota provisória 363
- **Medido:** linha 15: A chance anual por idade foi calibrada para aproximar essas médias. PENDENTE: calibração fina. | linha 18: são ~1,2%. PENDENTE: total exato de casamentos de 2023. | linha 21: Quantos solteiros cada pessoa "conhece" por ano ao procurar par. PENDENTE: valor de jogo. | linha 25: adultos casados, dá ~1,1% dos casais por ano. PENDENTE: fração de adultos casados.
- **Alcance:** 4.358 pessoas · impacto 0,5 · prova: só dado do jogo, falta fonte
- **Sugestão:** Pesquisar fonte real para cada valor PENDENTE e trocar o comentário pela fonte.

### Valores sem fonte em config/population.yaml (5)

- **Sinal:** `pendente:population.yaml` · categoria realismo · nota provisória 363
- **Medido:** linha 9: Tempo médio (em dias do jogo) para uma casa vaga ser ocupada quando há demanda. PENDENTE: valor de jogo. | linha 11: Limite de famílias chegando por dia do jogo. PENDENTE: valor de jogo (proteção de performance). | linha 15: modelo Rogers-Castro). PENDENTE: pesos exatos por tipo. | linha 33: No começo a cidade não tem empregos: os primeiros moradores trabalham fora. PENDENTE: valor de jogo.
- **Alcance:** 4.358 pessoas · impacto 0,5 · prova: só dado do jogo, falta fonte
- **Sugestão:** Pesquisar fonte real para cada valor PENDENTE e trocar o comentário pela fonte.

### Valores sem fonte em config/realism.yaml (3)

- **Sinal:** `pendente:realism.yaml` · categoria realismo · nota provisória 363
- **Medido:** linha 19: Faixa: Censo 2010 (10,8%) até estados mais envelhecidos. PENDENTE: faixa por UF. | linha 24: habitantes (PENDENTE: faixa por porte de cidade). | linha 30: - { id: schoolEnrollment, label: Crianças 6-17 na escola, unit: "%", min: 90, max: 100, source: "PENDENTE: taxa de escolarização (PNAD Educação)" }
- **Alcance:** 4.358 pessoas · impacto 0,5 · prova: só dado do jogo, falta fonte
- **Sugestão:** Pesquisar fonte real para cada valor PENDENTE e trocar o comentário pela fonte.

### Valores sem fonte em config/roads.yaml (3)

- **Sinal:** `pendente:roads.yaml` · categoria realismo · nota provisória 363
- **Medido:** linha 11: PENDENTE: capacidade por faixa em via urbana com cruzamentos. Valor usual de engenharia de tráfego. | linha 17: PENDENTE: avenida é mais larga; estimado como o dobro da rua. | linha 21: PENDENTE: fração exata.
- **Alcance:** 4.358 pessoas · impacto 0,5 · prova: só dado do jogo, falta fonte
- **Sugestão:** Pesquisar fonte real para cada valor PENDENTE e trocar o comentário pela fonte.

### Valores sem fonte em config/traffic.yaml (6)

- **Sinal:** `pendente:traffic.yaml` · categoria realismo · nota provisória 363
- **Medido:** linha 5: mensal da família. Os pontos abaixo foram escolhidos para aproximar os 48%. PENDENTE: calibração. | linha 7: Velocidade com que as famílias chegam ao equilíbrio (compra/venda por ano). PENDENTE: valor de jogo. | linha 9: PENDENTE: vagas de garagem por casa e por apartamento. | linha 11: Vagas por emprego em comércio/indústria. PENDENTE.
- **Alcance:** 4.358 pessoas · impacto 0,5 · prova: só dado do jogo, falta fonte
- **Sugestão:** Pesquisar fonte real para cada valor PENDENTE e trocar o comentário pela fonte.

### Valores sem fonte em config/world.yaml (1)

- **Sinal:** `pendente:world.yaml` · categoria realismo · nota provisória 363
- **Medido:** linha 9: Fração do mapa com vegetação nativa no início. PENDENTE: valor de jogo, sem fonte.
- **Alcance:** 4.358 pessoas · impacto 0,5 · prova: só dado do jogo, falta fonte
- **Sugestão:** Pesquisar fonte real para cada valor PENDENTE e trocar o comentário pela fonte.

### Desejo não atendido: crianças de 6 a 17 anos sem vaga em escola

- **Sinal:** `desejo:school` · categoria balanceamento · nota provisória 323
- **Medido:** 285 crianças de 6 a 17 anos sem vaga em escola numa cidade de 5.161 pessoas. O jogo já tem isso: o problema é o prefeito automático (ou o jogador) não atender, ou falta informação na tela para perceber. (apareceu em 3 de 4 cidades de teste; números de uma delas)
- **Alcance:** 484 pessoas · impacto 2 · prova: dado do jogo + fonte
- **Fonte:** LDB: ensino obrigatório dos 4 aos 17 anos (https://www.planalto.gov.br/ccivil_03/leis/l9394.htm)
- **Sugestão:** Ensinar o prefeito automático a atender e mostrar a cobertura no mapa (camada de cobertura).
- **Métrica sugerida:** `unmet.school < 29`

### Falta no jogo: Plano diretor (regras de zoneamento editáveis)

- **Sinal:** `comparacao:plano_diretor` · categoria feature · nota provisória 231
- **Medido:** Cidades reais com mais de 20.000 habitantes têm isso. A cidade de teste tem 5.161, mas o jogo promete 50.000: vai precisar (alcance = pessoas de hoje).
- **Alcance:** 1.734 pessoas · impacto 0,5 · prova: só fonte
- **Fonte:** Estatuto da Cidade (Lei 10.257/2001), art. 41: plano diretor obrigatório para cidades com mais de 20 mil habitantes (https://www.planalto.gov.br/ccivil_03/leis/leis_2001/l10257.htm)
- **Sugestão:** Criar plano diretor (regras de zoneamento editáveis) (pesquisar como funciona e o custo real antes).

### Falta no jogo: Faculdade (ensino superior presencial)

- **Sinal:** `comparacao:faculdade` · categoria construcao · nota provisória 199
- **Medido:** Cidades reais com mais de 50.000 habitantes têm isso. A cidade de teste tem 5.161, mas o jogo promete 50.000: vai precisar (alcance = pessoas de hoje).
- **Alcance:** 373 pessoas · impacto 2 · prova: só fonte
- **Fonte:** Censo da Educação Superior 2023 (INEP): 1.085 de 5.570 municípios têm cursos presenciais (https://www.gov.br/inep/pt-br/centrais-de-conteudo/noticias/censo-da-educacao-superior/mec-e-inep-divulgam-resultado-do-censo-superior-2023)
- **Sugestão:** Criar faculdade (ensino superior presencial) (pesquisar como funciona e o custo real antes).

### Realismo: Nível de ocupação acima da vida real

- **Sinal:** `realismo:employmentLevel` · categoria realismo · nota provisória 173
- **Medido:** Na cidade: 66.02 %. Na vida real: 50 a 66. (apareceu em 1 de 4 cidades de teste; números de uma delas)
- **Alcance:** 519 pessoas · impacto 1 · prova: dado do jogo + fonte
- **Fonte:** PNAD 2025: 59,1%
- **Sugestão:** Achar a regra que gera esse número (relatório + log) e corrigir com base na fonte.
- **Métrica sugerida:** `realism.employmentLevel entre 50 e 66`

### Falta no jogo: Creche (0 a 3 anos)

- **Sinal:** `comparacao:creche` · categoria construcao · nota provisória 136
- **Medido:** Cidades reais com mais de 1.000 habitantes têm isso; a cidade de teste tem 5.161 e o jogo não oferece.
- **Alcance:** 204 pessoas · impacto 2 · prova: dado do jogo + fonte
- **Fonte:** PNE, meta 1: atender pelo menos 50% das crianças de 0 a 3 anos em creche (em 2023 eram 39,8%, PNAD) (https://agenciadenoticias.ibge.gov.br/agencia-noticias/2012-agencia-de-noticias/noticias/42083-educacao-infantil-cresce-em-2023-e-retoma-patamar-pre-pandemia)
- **Sugestão:** Criar creche (0 a 3 anos) (pesquisar como funciona e o custo real antes).

### Desejo não atendido: famílias esperando casa própria

- **Sinal:** `desejo:housing` · categoria balanceamento · nota provisória 4
- **Medido:** 91 famílias esperando casa própria numa cidade de 2.074 pessoas. O jogo já tem isso: o problema é o prefeito automático (ou o jogador) não atender, ou falta informação na tela para perceber. (apareceu em 1 de 4 cidades de teste; números de uma delas)
- **Alcance:** 23 pessoas · impacto 1 · prova: só dado do jogo, falta fonte
- **Sugestão:** Ensinar o prefeito automático a atender e mostrar a cobertura no mapa (camada de cobertura).
- **Métrica sugerida:** `unmet.housing < 9`
