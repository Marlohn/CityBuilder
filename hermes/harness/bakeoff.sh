#!/bin/bash
# Comparação de modelos grátis (via OpenCode) numa tarefa real com gabarito: issue #38 do CityBuilder.
# Parte de qa/38 (teste de aceitação existe, implementação não: 7 falham / 2 passam). Cada modelo num
# worktree limpo, mesma instrução, 25 min. Resultado em /opt/data/avaliacao/bakeoff.jsonl (1 linha por modelo).
export HOME=/opt/data/home PATH=/opt/data/.local/bin:$PATH OPENCODE_CONFIG=/opt/data/opencode/opencode.json
export GH_TOKEN=$(sed -n 's/^GH_TOKEN=//p' /opt/data/profiles/dev/.env) LANG=C.UTF-8 LC_ALL=C.UTF-8
OUT=/opt/data/avaliacao/bakeoff2.jsonl
TESTE=tests/acceptance/38-destino-predio-ativo.test.ts
gh issue view 38 -R Marlohn/CityBuilder --json title,body --jq '"# " + .title + "\n\n" + .body' > /tmp/issue38.md  # copiado pra dentro do worktree: o OpenCode nega ler fora do projeto (auto-reject)
PEDIDO="Você é o Dev do CityBuilder. Leia AGENTS.md e a tarefa em TAREFA.md (na raiz). Faça o teste de aceitação $TESTE passar SEM alterar nenhum arquivo em tests/acceptance/. Rode 'npx vitest run $TESTE' e 'npm run check' até ficarem verdes. Não faça commit nem push."
for m in "$@"; do
  W=/tmp/bake-$m; git -C /tmp/cifix worktree remove --force "$W" 2>/dev/null; rm -rf "$W"
  git -C /tmp/cifix worktree add -q --detach "$W" origin/qa/38 && cd "$W" && npm ci --no-audit --no-fund --silent >/dev/null 2>&1 && cp /tmp/issue38.md TAREFA.md
  ini=$(date +%s)
  timeout 1500 opencode run -m "opencode/$m" "$PEDIDO" > "/opt/data/avaliacao/bakeoff-$m.log" 2>&1; rc=$?
  dur=$(( $(date +%s) - ini ))
  res=$(timeout 300 npx vitest run "$TESTE" 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E '^ +Tests ' | tr -s ' ')
  timeout 600 npm run check > "/tmp/check-$m.txt" 2>&1; chk=$(grep -q 'TUDO OK' "/tmp/check-$m.txt" && echo verde || echo vermelho)
  trapaca=$(git status --porcelain -- tests/acceptance | wc -l)
  linhas=$(git diff --numstat -- . ':!tests/acceptance' | awk '{a+=$1+$2} END {print a+0}')
  arqs=$(git status --porcelain -- . ':!tests/acceptance' ':!TAREFA.md' | wc -l)
  printf '{"modelo":"%s","segundos":%d,"rc_opencode":%d,"aceitacao":"%s","check":"%s","mexeu_no_teste":%d,"linhas":%d,"arquivos":%d,"quando":"%s"}\n' \
    "$m" "$dur" "$rc" "$res" "$chk" "$trapaca" "$linhas" "$arqs" "$(date -u +%FT%TZ)" >> "$OUT"
  cd /tmp && git -C /tmp/cifix worktree remove --force "$W" 2>/dev/null; rm -rf "$W"
done
echo FIM >> "$OUT"
