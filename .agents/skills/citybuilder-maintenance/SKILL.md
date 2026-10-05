---
name: citybuilder-maintenance
description: Fluxo de manutenção do Marlohn/CityBuilder para triagem de issues, correção de bugs, revisão e correção de PRs, merges seguros, limpeza de branches, manutenção do repositório e implementação.
---

# Manutenção do CityBuilder

Use esta skill sempre que a tarefa envolver engenharia ou manutenção do repositório CityBuilder.

## Fonte de verdade

O GitHub é a fonte principal e atual do estado do projeto.

Antes de tomar decisões ou fazer mudanças:

1. Consulte o estado atual de `Marlohn/CityBuilder` no GitHub.
2. Leia o `AGENTS.md` da raiz.
3. Ao alterar um pacote, leia o `AGENTS.md` desse pacote.
4. Leia o código, testes, issue, PR, comentários, commits e histórico relevantes para a tarefa.
5. Consulte `docs/GUIA-DO-CODIGO.md`, `docs/VISAO.md`, `docs/PLANO.md` e `hermes/FACTORY.md` quando forem relevantes.

Se esta skill entrar em conflito com uma regra mais específica ou mais recente do repositório, prevalece a regra do repositório.

Não se baseie em suposições antigas quando o repositório puder ser consultado diretamente.

## Autonomia

Trabalhe com autonomia em tarefas de engenharia que sejam seguras.

Você pode investigar bugs, editar branches, criar commits focados, corrigir código, atualizar testes e documentação apropriados, revisar PRs, corrigir problemas encontrados em PRs, triar issues e fazer merge quando as condições de segurança do repositório estiverem satisfeitas.

Não interrompa o trabalho para fazer perguntas que possam ser respondidas consultando o repositório, histórico, testes, issues, PRs ou documentação.

Pergunte ao usuário somente quando houver uma decisão real de produto ambígua ou quando uma ação potencialmente destrutiva não puder ser comprovada como segura pelas evidências do repositório.

## Disciplina de mudanças

- Preserve o comportamento existente, salvo quando a tarefa exigir uma mudança.
- Prefira a menor mudança correta.
- Evite grandes reescritas arquiteturais sem necessidade concreta.
- Evite refactors oportunistas sem relação com a tarefa.
- Preserve compatibilidade, especialmente de contratos, schemas de configuração, saves e replays.
- Respeite os limites entre pacotes e as regras de determinismo da simulação.
- Nunca invente regras da simulação ou números do mundo real quando o projeto exigir dados com fonte.
- Não apague código, dados, branches, testes ou documentação potencialmente importantes sem antes verificar histórico e referências.
- Mantenha commits pequenos, focados e descritivos.

## Triagem de issues

Classifique issues abertas usando evidências do repositório:

- **válida**: o problema ou trabalho solicitado ainda existe;
- **duplicada**: outra issue já representa o mesmo trabalho;
- **resolvida**: o código atual já atende ao pedido;
- **obsoleta**: mudanças posteriores tornaram o pedido irrelevante.

Para cada issue, consulte descrição, comentários, código relacionado, commits/PRs relevantes e o comportamento atual antes de mudar seu estado.

Não feche uma issue apenas por ser antiga.

Ao implementar issues, mantenha rastreabilidade entre issue, branch, commits, PR e testes.

## Prioridade

Em geral, priorize:

1. perda/corrupção de dados, compatibilidade de save/replay, determinismo e regressões graves;
2. CI, build ou fluxo de desenvolvimento quebrados;
3. bugs funcionais importantes;
4. problemas arquiteturais que estejam causando defeitos concretos;
5. melhorias de produto e UX;
6. limpeza e manutenção.

Ajuste a prioridade quando dependências ou o contexto atual do repositório justificarem.

## Fluxo de pull requests

A `main` usa checks obrigatórios em modo estrito. Antes do merge, a branch da PR precisa conter o HEAD atual da `main`; CI verde de um merge sintético antigo não satisfaz essa regra. Se a API de merge responder `405` dizendo que os checks obrigatórios estão “expected” apesar de um CI verde, confira se a base avançou, sincronize a branch com a `main` atual e valide novamente o novo HEAD.

Ao revisar uma PR:

1. Leia a issue/tarefa relacionada e as regras do repositório.
2. Examine o diff completo e os caminhos de código afetados.
3. Verifique threads de revisão abertas e feedback anterior.
4. Verifique compatibilidade e mudanças de comportamento não intencionais.
5. Confira testes e CI para o HEAD exato da PR.
6. Corrija diretamente os defeitos quando isso for seguro e estiver dentro do escopo.
7. Rode ou confira novamente as validações apropriadas.
8. Faça merge somente quando o HEAD revisado continuar atual e os checks obrigatórios estiverem verdes.

Não considere CI verde, sozinho, prova suficiente; revise também o comportamento e o diff.

Se o HEAD ou a base da PR mudar de forma relevante depois da revisão, reavalie antes do merge.

## Limpeza de branches

Uma branch só é candidata a limpeza depois de verificar:

- se já foi mergeada;
- se contém commits que não são alcançáveis pela branch de destino;
- se possui PR aberta;
- se alguma issue, workflow ativo ou processo de recuperação ainda depende dela;
- se outra branch foi criada a partir dela.

Nunca apague uma branch apenas por ser antiga.

Prefira deixar uma branch possivelmente removível a apagar trabalho que ainda possa ter valor.

O workflow `.github/workflows/branch-hygiene.yml` pode apagar uma branch ao mesmo tempo em que um sweep a percorre. Ao manter esse fluxo, trate uma ref que desapareceu entre a listagem e a leitura/remoção como já limpa; erros de remoção de uma branch que ainda existe devem continuar falhando o job.

## Correção de bugs

Para bugs:

1. Reproduza ou estabeleça evidência da falha quando for viável.
2. Identifique a causa real, não apenas o sintoma visível.
3. Adicione ou identifique um teste de regressão quando apropriado.
4. Faça a menor correção correta.
5. Verifique comportamentos adjacentes para evitar regressões.
6. Valide usando os comandos documentados pelo repositório.
7. Registre detalhes úteis de reprodução na PR ou issue.

Use informações de replay e seed quando existirem para bugs da simulação.

## Validação

Siga as regras de validação do `AGENTS.md`.

No mínimo, para mudanças de código, rode os testes afetados e o check apropriado do repositório. Antes de considerar um merge seguro, exija os checks obrigatórios do CI para a revisão candidata exata.

Para mudanças cujo risco justifique, use também testes lentos, E2E, build ou comandos de simulação.

Nunca declare uma tarefa concluída se uma validação que deveria ter sido executada estiver falhando.

## Documentação

Atualize a documentação na mesma mudança quando houver alteração de comandos, arquitetura, regras, responsabilidades de pacotes, configuração ou fluxo de desenvolvimento.

Não edite artefatos gerados do roadmap quando o repositório disser explicitamente para não fazê-lo.

## Evolução desta skill

Atualize esta própria skill quando o trabalho de manutenção revelar conhecimento útil, reutilizável e específico do CityBuilder que possa melhorar tarefas futuras.

Exemplos do que merece entrar aqui:

- um procedimento recorrente que evita erros ou retrabalho;
- uma nova verificação importante antes de merge, limpeza ou manutenção;
- uma armadilha do repositório que não estava documentada;
- uma forma mais segura ou eficiente de investigar, validar ou corrigir problemas;
- uma convenção operacional estável descoberta no código, histórico, CI ou documentação.

Só adicione orientações sustentadas por evidência do repositório e que tenham valor além da tarefa atual.

Não use a skill como diário de trabalho. Evite registrar detalhes temporários de uma issue, PR, branch ou incidente específico, valores que mudam com frequência ou regras que já pertencem melhor ao `AGENTS.md`, ao `AGENTS.md` de um pacote ou à documentação oficial do projeto.

Ao atualizar a skill, preserve instruções úteis existentes, mantenha o texto conciso e remova ou corrija orientações que tenham ficado obsoletas quando houver evidência suficiente.

## Retorno ao usuário

Mantenha o status conciso e baseado em evidências.

Ao concluir uma tarefa, informe:
- o que mudou;
- o que foi validado;
- qualquer risco restante ou dependência não resolvida;
- referências relevantes de issue, PR e commit.

Não declare sucesso com base em intenção; declare apenas quando houver evidência no estado e nas validações do repositório.
