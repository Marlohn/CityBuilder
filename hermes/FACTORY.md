# Ciclo de produto autônomo

Este fluxo implementa a revisão geral aprovada em 03/10/2026. A fábrica continua usando
o Kanban como histórico, GitHub como registro de missões/PRs e Pages para publicação.

## Funcionamento

O cron existente chama o controlador sem LLM. Cada etapa roda num runner GitHub:
observação pela interface → implementação direta → CI → avaliação independente
da main e candidata → merge protegido → Pages → conferência da publicação.

Uma missão usa um cartão sem assignee, reservado pelo controlador externo. Não ganha
worker Hermes nem coordenador LLM. Os perfis antigos e seus cartões são preservados.
Estado e evidências ficam vinculados ao cartão, issue, PR e execuções GitHub.
O arquivo local state.json guarda apenas o cursor necessário para retomar esse estado.

## Regras das missões

- Uma entrega representa um comportamento, sem limite artificial de três arquivos.
- Critérios são fixados antes da implementação. O executor não altera o avaliador,
  a infraestrutura, dependências nem testes de aceitação existentes.
- Testes apropriados antes do código. Testes afetados e verificações locais rodam no
  runner. CI completo sobre a integração continua obrigatório antes do merge.
- Fatos/regras novos da simulação precisam de fontes. Interface precisa de evidência funcional.
- O avaliador experimenta ambas as versões e cita imagens de ações reais. Não aprova
  só por teste verde ou pelo resumo do executor. Evidência inexistente ou alterada reprova.
- Main ou candidata mudou? A avaliação anterior perde validade e precisa ser refeita.
- Até duas rodadas de correção após reprovação/CI, dentro de quatro horas totais.
- Só iniciar missão sobre main cujo CI terminou com sucesso. Três falhas consecutivas
  suspendem o ciclo, com causa e evidência preservadas; não gerar missões indefinidamente.
- Código e provas são preservados ao bloquear/descartar. Não renovar limite clonando tarefa.
- Modelos e navegador trabalham sob demanda. Espera de job/CI não ocupa uma sessão de LLM.

Para cartões antigos continuam valendo as regras do fluxo anterior. Missões geradas
por este controlador seguem estas regras específicas; os agentes leem este documento.

## Navegador público

O agente chama `npm run factory:browser -- act '[ações JSON]' baseline` (ou candidate).
Pode clicar controles por role/name, clicar coordenadas, arrastar, usar teclas, esperar
até três segundos ou reiniciar a jornada. Não oferece evaluate ou comandos internos.
Cada resposta traz imagem, texto da interface, controles, ações, erros e hash da imagem.
Ver a imagem exige usar a ferramenta read no caminho retornado.

## Instalação e transição

Fonte: hermes/harness/factory.py; integração: sincronizar_github.py; job: factory.yml.
Config de produção: /opt/data/factory/config.json. Exemplo:

```json
{"enabled": true, "max_mission_seconds": 14400, "cooldown_seconds": 1800}
```

A existência da configuração seleciona este controlador e suprime o despacho antigo.
enabled=false deixa o ciclo parado; não reativa automaticamente o fluxo antigo.
Antes de ativar, verificar que não existem workers Hermes executando e preservar branches.
O runner não recebe credencial de escrita. Ele devolve código em um bundle Git; o controlador
confere o SHA, a ancestralidade e os arquivos protegidos antes de publicar a branch com a
credencial já existente no mini PC. A criação/atualização do PR continua disparando o CI.
Space Bunny também respondeu a uma prova visual com HOME novo e sem chave/token.
OpenCode está fixado em 1.18.33; a oferta gratuita pode mudar e exige conferência no runner.
Nenhum segredo é gravado em contexto ou artefatos; o modelo não recebe GH_TOKEN.
Não substituir silenciosamente por um modelo textual.
O controlador usa `repository_dispatch` (`factory-stage`), com **Contents: Read and write**
já disponível para publicar branches. A API foi conferida com a credencial atual. O disparo
manual `workflow_dispatch` continua disponível para operadores e exige Actions: write;
o controlador não depende dessa ampliação de acesso.
HTTP 401/403 no disparo bloqueia a missão e suspende o ciclo imediatamente, preservando
o motivo em `halted_reason` e `needs_access`. Depois de corrigir a permissão, retirar esses
dois campos e definir `next_at=0` para iniciar uma missão nova. Não reabrir orçamento de
uma implementação anterior; neste caso nenhum modelo chegou a ser iniciado.

Rollback: enabled=false impede novas chamadas, mas não interrompe jobs existentes.
Antes de voltar ao sincronizador antigo, concluir/cancelar explicitamente a missão externa,
preservar estado/branches e remover a configuração. Não ativar os dois despachos juntos.
Se state.json contiver halted_reason, corrigir a causa documentada antes de retirar esse
campo. O limite existe para detectar falta de capacidade, sem esconder dias improdutivos.

## Prova de capacidade

A primeira missão é o piloto de descoberta e entrega. Imagem inicial sozinha não passa:
é necessário registrar interação, justificar uma oportunidade e avaliá-la independentemente.
Uma entrega só conta após versão publicada identificada e conferência de abertura/controle.
Disponibilidade do modelo, qualidade das escolhas e autonomia de 24 horas ainda precisam
ser medidas em funcionamento. Este fluxo não transforma um teste verde em prova de diversão.

OpenCode 1.18.33 aplica a permissão `read` ao caminho relativo ao worktree: imagens
e registros usam `out/factory/*`. A leitura de uma captura real foi conferida com o
modelo gratuito. IDs de critérios aceitam letras maiúsculas e minúsculas (ex.: `AC1`);
o avaliador continua obrigado a usar exatamente os IDs fixados na descoberta.
