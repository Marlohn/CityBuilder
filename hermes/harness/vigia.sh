# Roda NO mini PC (ssh bash -s). Sai quando o quadro muda (cartão novo, terminou, travou) ou após MAX min.
MAX=${MAX:-40}
K() { docker exec -u 10000 -e HOME=/opt/data hermes-citybuilder /opt/hermes/.venv/bin/hermes kanban "$@" 2>/dev/null; }
estado() { K list --json | docker exec -i hermes-citybuilder /opt/hermes/.venv/bin/python3 -c "import sys,json;print(' '.join(sorted(c['id']+':'+c['status'] for c in json.load(sys.stdin))))"; }
mem() { docker exec hermes-citybuilder awk '$1=="anon"{print $2}' /sys/fs/cgroup/memory.stat; }  # so memoria de processo (cache nao conta: o kernel descarta)
pico=0; antes=$(estado); ini=$(date +%s)
while [ $(( $(date +%s) - ini )) -lt $((MAX*60)) ]; do
  sleep 60
  m=$(mem); [ "$m" -gt "$pico" ] && pico=$m
  agora=$(estado)
  fim() { echo "$1" | tr " " "
" | grep -E ":(done|blocked)$" | sort; }
  [ "$(fim "$agora")" != "$(fim "$antes")" ] && break
done
echo "== $(date +%H:%M) mudou? $([ "$agora" != "$antes" ] && echo SIM || echo nao)"
echo "antes: $antes"; echo "agora: $agora"
K list | tail -8
for t in $(echo "$agora" | tr ' ' '\n' | grep -E ':(done|blocked)$' | cut -d: -f1); do
  echo "$antes" | grep -q "$t:$(echo "$agora" | tr ' ' '\n' | grep "^$t:" | cut -d: -f2)" && continue
  echo "######## $t"; K show "$t" | sed -n '/Latest summary:/,/Events/p' | head -25 | cut -c1-600
done
lim=$(docker exec hermes-citybuilder cat /sys/fs/cgroup/memory.max)
echo "MEMORIA container: pico de PROCESSOS (anon) nesta janela $((pico/1048576)) MB de $((lim/1048576)) MB | rodando: $(K list | grep -c running) | max_in_progress=$(docker exec -u 10000 -e HOME=/opt/data hermes-citybuilder /opt/hermes/.venv/bin/hermes config get kanban.max_in_progress 2>/dev/null)"
free -m | sed -n 2,3p; uptime
