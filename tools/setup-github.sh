#!/usr/bin/env bash
# Cria (ou atualiza) as etiquetas que o fluxo dos agentes usa. Rode uma vez, com o gh logado:
#   bash tools/setup-github.sh
set -euo pipefail
label() { gh label create "$1" --color "$2" --description "$3" --force; }
label ideia            fbca04 "Ideia livre (do dono ou de alguém). O Designer organiza."
label do-dono          d93f0b "Veio do dono do projeto: ganha peso extra no roadmap."
label roadmap          0e8a16 "Item do roadmap (formulário padrão)."
label roadmap-gerado   c2e0c6 "Issue onde o roadmap gerado é publicado."
label tarefa           1d76db "Tarefa pequena criada pelo Arquiteto."
label pronto-pra-teste bfdadc "Tarefa esperando o QA escrever o teste."
label pronto-pra-dev   5319e7 "Teste do QA pronto; esperando o Dev."
label em-revisão       0052cc "PR esperando a revisão do Arquiteto."
label entregue         0e8a16 "Item entregue: o motor confere a métrica."
label não-resolveu     b60205 "Entregue, mas a métrica não mudou como esperado."
label recusado         cccccc "Não faz sentido com a realidade ou com a visão (explicado na issue)."
label bug              d73a4a "Algo quebrado (com o comando ou replay para reproduzir)."
echo "Etiquetas prontas."
