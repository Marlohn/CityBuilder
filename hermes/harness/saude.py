"""Verificador de saúde do loop. SÓ LEITURA: não cria cartão, não escreve no GitHub, não muda config.

Uso, dentro do container: python3 /opt/data/scripts/saude.py      (sai com código 1 se algo falhar)
Um comando pra outro LLM (ou pra você, daqui a um mês) saber se o sistema descrito em hermes/OPERACAO.md ainda vale.
Cada linha é OK ou FALHA com a evidência ao lado; FALHA nunca é dita sem o número que a sustenta.
"""
import datetime as dt
import glob
import json
import os
import re
import subprocess
import sys
import urllib.request

HERMES = "/opt/hermes/.venv/bin/hermes"
GH = "/opt/data/.local/bin/gh"
REPO = "Marlohn/CityBuilder"
PAPEIS = ("designer", "arquiteto", "revisor", "qa", "dev")
KILO = ("designer", "arquiteto", "revisor")
falhas = 0


def ok(cond, texto, evidencia=""):
    global falhas
    falhas += 0 if cond else 1
    print(("OK    " if cond else "FALHA ") + texto + (f"  [{evidencia}]" if evidencia else ""))


def run(*a, **k):
    return subprocess.run(list(a), capture_output=True, text=True, timeout=k.get("t", 60))


def token():
    for linha in open("/opt/data/profiles/dev/.env"):
        if linha.startswith("GH_TOKEN="):
            return linha.split("=", 1)[1].strip()
    return ""


os.environ["GH_TOKEN"] = token()
os.environ["PATH"] = "/opt/data/.local/bin:" + os.environ["PATH"]

# 1. perfis: 5, SOUL igual ao do repo, origem registrada no clone do PRÓPRIO papel ------------------------------------
for p in PAPEIS:
    d, clone = f"/opt/data/profiles/{p}", f"/opt/data/cb/{p}/hermes/{p}"
    try:
        igual = open(f"{d}/SOUL.md").read() == open(f"{clone}/SOUL.md").read()
        fonte = re.search(r"^source:\s*(\S+)", open(f"{d}/distribution.yaml").read(), re.M).group(1)
    except OSError as e:
        ok(False, f"perfil {p}: arquivos", str(e))
        continue
    ok(igual, f"perfil {p}: SOUL == repo (clone em {run('git', '-C', f'/opt/data/cb/{p}', 'log', '--oneline', '-1').stdout.strip()[:7]})",
       "" if igual else f"diferente; rode: {HERMES} profile update {p} -y depois de git pull no clone")
    ok(fonte == clone, f"perfil {p}: origem registrada é o próprio clone", fonte)

# 2. crons ---------------------------------------------------------------------------------------------------------------
jobs = json.load(open("/opt/data/cron/jobs.json"))
jobs = jobs.get("jobs", jobs) if isinstance(jobs, dict) else jobs
por_nome = {j["name"]: j for j in jobs}
for nome in ("sincronizar-github", "freio-memoria"):
    j = por_nome.get(nome)
    ok(bool(j and j.get("enabled")), f"cron {nome} ativo", "" if j else "não existe")

# 3. scripts em produção == repo (main) ---------------------------------------------------------------------------------
run("git", "-C", "/opt/data/cb/dev", "fetch", "-q", "origin")
for f in ("sincronizar_github.py", "freio_memoria.py"):
    novo = run("git", "-C", "/opt/data/cb/dev", "show", f"origin/main:hermes/harness/{f}").stdout
    prod = open(f"/opt/data/scripts/{f}").read()
    ok(novo == prod, f"produção == repo/main: {f}")

# 4. GitHub: token, proteção da main -----------------------------------------------------------------------------------
r = run(GH, "api", "rate_limit", "--jq", ".resources.core.remaining")
ok(r.returncode == 0 and int(r.stdout or 0) > 500, "token do GitHub responde", f"{r.stdout.strip()} chamadas restantes/h")
r = run(GH, "api", f"repos/{REPO}/rules/branches/main", "--jq", "[.[].type] | join(\",\")")
ok("required_status_checks" in r.stdout, "main protegida (checks obrigatórios)", r.stdout.strip())

# 5. modelos: Kilo nos 3 papéis, chave viva ----------------------------------------------------------------------------
for p in KILO:
    cfg = open(f"/opt/data/profiles/{p}/config.yaml").read()
    ok("provider: kilocode" in cfg and "custom:zen" in cfg, f"perfil {p}: Kilo principal + reserva no Zen")
try:
    req = urllib.request.Request("https://api.kilo.ai/api/profile/balance",
                                 headers={"Authorization": "Bearer " + open("/opt/data/.kilo_key").read().strip(), "User-Agent": "citybuilder-saude/1.0"})
    ok(urllib.request.urlopen(req, timeout=20).status == 200, "chave do Kilo responde")
except Exception as e:
    ok(False, "chave do Kilo responde", str(e)[:80])

# 6. memória e concorrência --------------------------------------------------------------------------------------------
anon = next(int(x.split()[1]) for x in open("/sys/fs/cgroup/memory.stat") if x.startswith("anon "))
teto = int(open("/sys/fs/cgroup/memory.max").read())
psi = re.search(r"full avg10=[\d.]+ avg60=([\d.]+)", open("/sys/fs/cgroup/memory.pressure").read()).group(1)  # linha "full ..."
ok(anon < 0.85 * teto and float(psi) < 5, "memória do container", f"processos {anon // 1048576}/{teto // 1048576} MB, pressão full {psi}%")
mx = run(HERMES, "config", "get", "kanban.max_in_progress").stdout.strip().splitlines()[-1]
print(f"INFO  agentes simultâneos permitidos: {mx}")
d = os.statvfs("/opt/data")
ok(d.f_bavail * d.f_frsize > 20 * 2**30, "disco livre > 20 GB", f"{d.f_bavail * d.f_frsize // 2**30} GB")

# 7. o loop anda? (o invariante que faltou em 30/09: nada aberto E tarefa pronta sem PR do dev) ---------------------------
cartoes = json.loads(run(HERMES, "kanban", "list", "--json").stdout or "[]")
abertos = [c for c in cartoes if c["status"] in ("ready", "running", "todo", "blocked")]
prs = json.loads(run(GH, "pr", "list", "-R", REPO, "--state", "open", "--json", "number,headRefName,labels").stdout or "[]")
prs_dev = [p for p in prs if p["headRefName"].startswith(("dev/", "fix/main-"))]
prontas = json.loads(run(GH, "issue", "list", "-R", REPO, "--state", "open", "--label", "pronto-pra-dev", "--json", "number").stdout or "[]")
ocioso = not abertos and not prs_dev and prontas
ok(not ocioso, "loop não está ocioso com tarefa pronta",
   f"{len(abertos)} cartões abertos, {len(prs_dev)} PRs do dev abertos, prontas: {[i['number'] for i in prontas]}")
bloq = [c for c in cartoes if c["status"] == "blocked"]
ok(not bloq, "nenhum cartão bloqueado esperando", f"{len(bloq)}")
def revisao_aberta(n):
    return any(f"[revisar-pr-{n}-" in (c["title"] or "") and c["status"] not in ("done", "archived") for c in cartoes)


sem_cartao = [p["number"] for p in prs if any(lb["name"] == "em-revisão" for lb in p["labels"]) and not revisao_aberta(p["number"])]
ok(not sem_cartao, "todo PR em revisão tem cartão aberto (senão ficou parado; até 2 min é normal)", str(sem_cartao))

print(f"\n{'SAUDÁVEL' if not falhas else str(falhas) + ' FALHA(S)'}  ({dt.datetime.now().strftime('%d/%m %H:%M')})")
sys.exit(1 if falhas else 0)
