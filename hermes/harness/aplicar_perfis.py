"""Aplica ao que é LOCAL do servidor nos perfis: ferramentas por papel, skills enxutas, modelo (Kilo/Zen) e chave do Kilo.

O SOUL.md NÃO é daqui: mora no repo (hermes/<papel>/SOUL.md) e chega com `hermes profile update <papel>` depois de
um `git pull` no clone /opt/data/distribuicao (nunca no clone de trabalho). Roda no container como uid 10000.
Idempotente. Backup do config.yaml antes de mexer.
"""
import os
import shutil
import subprocess
import yaml

H = "/opt/hermes/.venv/bin/hermes"
BASE = ["file", "terminal", "skills", "todo", "memory", "session_search"]
PAPEIS = {
    "designer": {"ferr": BASE + ["web"],
                 "skills": ["software-development/github", "research/grounded-citations", "web/blocked-page-recovery"]},
    "arquiteto": {"ferr": BASE + ["web"],
                  "skills": ["software-development/github", "software-development/codebase-inspection"]},
    "revisor": {"ferr": BASE,
                "skills": ["software-development/github", "software-development/systematic-debugging",
                           "software-development/codebase-inspection"]},
    "qa": {"ferr": BASE,
           "skills": ["software-development/github", "autonomous-ai-agents/opencode",
                      "software-development/test-driven-development", "software-development/systematic-debugging"]},
    "dev": {"ferr": BASE + ["web"],
            "skills": ["software-development/github", "autonomous-ai-agents/opencode",
                       "software-development/test-driven-development", "software-development/systematic-debugging",
                       "software-development/node-inspect-debugger"]},
}
# Modelo principal por papel (30/09). Kilo tem limite de ~200 req/h na conta: só os papéis de raciocínio e pouco
# volume vão nele (medido: arquiteto ~105/h com revisões antigas, revisor ~29/h, designer 1 ciclo/dia). qa/dev
# (~140/h juntos) ficam no Zen. Kilo falhou/429 => cai pro space-bunny do Zen (fallback provado com modelo quebrado).
KILO = {"provider": "kilocode", "default": "nvidia/nemotron-3-ultra-550b-a55b:free"}
RESERVA_ZEN = [{"provider": "custom:zen", "model": "space-bunny-free"}]
RESERVA_KILO = [{"provider": "kilocode", "model": "nvidia/nemotron-3-ultra-550b-a55b:free"}]
NO_KILO = {"designer", "arquiteto", "revisor"}
FONTE_SKILLS = "/opt/hermes/skills"
LINHA_PIPEFAIL = 'if [ -n "${BASH_VERSION:-}" ]; then set -o pipefail; fi'


def env_com_pipefail(linhas):
    """O terminal restaura exports, não opções Bash: novos workers precisam desta variável."""
    opcoes = next((l.split("=", 1)[1] for l in linhas if l.startswith("SHELLOPTS=")), "")
    opcoes = list(dict.fromkeys(o for o in opcoes.split(":") if o))
    if "pipefail" not in opcoes:
        opcoes.append("pipefail")
    return [l for l in linhas if not l.startswith("SHELLOPTS=")] + ["SHELLOPTS=" + ":".join(opcoes)]

for papel, cfg in PAPEIS.items():
    d = f"/opt/data/profiles/{papel}"
    if not os.path.exists(f"{d}/config.yaml.bak-20260930-revisao"):
        shutil.copy(f"{d}/config.yaml", f"{d}/config.yaml.bak-20260930-revisao")
    c = yaml.safe_load(open(f"{d}/config.yaml")) or {}
    if papel in ("dev", "qa"):
        backup = f"{d}/config.yaml.bak-20261001-reserva"
        if not os.path.exists(backup):
            shutil.copy(f"{d}/config.yaml", backup)
        c["fallback_providers"] = [dict(e) for e in RESERVA_KILO]
    # O envelope antigo abortava a espera em 420 s, antes do terminal (até 600 s),
    # enquanto o processo continuava vivo. Background + poll curto é a regra do SOUL.
    c.setdefault("timeouts", {}).setdefault("tools", {}).update(sequential_call=900, concurrent_batch=900)
    c["platform_toolsets"] = {"cli": cfg["ferr"]}
    if papel in NO_KILO or papel in ("dev", "qa"):
        backup_env = f"{d}/.env.bak-20261001-reserva"
        if not os.path.exists(backup_env):
            shutil.copy(f"{d}/.env", backup_env)
        env = [l for l in open(f"{d}/.env").read().splitlines() if not l.startswith("KILOCODE_API_KEY=")]
        env.append("KILOCODE_API_KEY=" + open("/opt/data/.kilo_key").read().strip())
        if papel in ("dev", "qa"):
            backup_pipeline = f"{d}/.env.bak-20261002-pipefail"
            if not os.path.exists(backup_pipeline):
                shutil.copy(f"{d}/.env", backup_pipeline)
            env = env_com_pipefail(env)
        open(f"{d}/.env", "w").write("\n".join(env) + "\n")
        os.chmod(f"{d}/.env", 0o600)
    if papel in NO_KILO:
        c["model"] = dict(KILO)
        c["fallback_providers"] = [dict(e) for e in RESERVA_ZEN]  # custom_providers (zen) continua definido
    yaml.safe_dump(c, open(f"{d}/config.yaml", "w"), allow_unicode=True, sort_keys=False)
    r = subprocess.run([H, "-p", papel, "skills", "opt-out", "--remove", "--yes"], capture_output=True, text=True)
    if r.returncode != 0:
        raise SystemExit(f"{papel}: opt-out falhou: {r.stderr[-300:]}")
    for s in cfg["skills"]:
        dst = f"{d}/skills/{s}"
        if not os.path.exists(f"{dst}/SKILL.md"):
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            shutil.copytree(f"{FONTE_SKILLS}/{s}", dst, dirs_exist_ok=True)
    print(f"{papel}: aplicado")

# Os HOME dos cinco perfis já carregam este arquivo comum no terminal. O OpenCode
# herda a variável: mesmo a chamada antiga `npm run check` vira validação local.
# No GitHub CI, tools/check.ts ignora esta variável e sempre roda a suíte inteira.
ambiente = "/opt/data/opencode/profile.sh"
with open(ambiente) as f:
    conteudo = f.read()
linha = "export CITYBUILDER_LOCAL_CHECK=1"
if linha not in conteudo.splitlines():
    shutil.copy(ambiente, ambiente + ".bak-ciclo-rapido")
    with open(ambiente, "a") as f:
        f.write("\n# Ciclo rápido: suíte completa obrigatória no GitHub CI.\n" + linha + "\n")

# Guard do CLI: erro de provedor deve voltar ao agente, não deixar `run` aberto.
# Não substitui binário nem interrompe chamadas já iniciadas. Aplicar só após CI/merge.
guard_dir = "/opt/data/opencode/guard/bin"
os.makedirs(guard_dir, exist_ok=True)
guard_path = f"{guard_dir}/opencode"
if os.path.exists(guard_path):
    shutil.copy(guard_path, guard_path + ".bak-anterior")
shutil.copy(os.path.join(os.path.dirname(__file__), "opencode_guard.py"), guard_path + ".new")
os.chmod(guard_path + ".new", 0o755)
os.replace(guard_path + ".new", guard_path)
linha_guard = f'PATH="{guard_dir}:$PATH"; export PATH'
if linha_guard not in conteudo.splitlines():
    shutil.copy(ambiente, ambiente + ".bak-20261001-opencode-guard")
    with open(ambiente, "a") as f:
        f.write("\n# Falha rápida de provedor no OpenCode; demais comandos usam o binário real.\n" + linha_guard + "\n")
linha_kilo = 'if [ -r /opt/data/.kilo_key ]; then KILO_API_KEY="$(cat /opt/data/.kilo_key)"; export KILO_API_KEY; fi'
with open(ambiente) as f:
    atual = f.read()
if linha_kilo not in atual.splitlines():
    shutil.copy(ambiente, ambiente + ".bak-20261001-reserva")
    with open(ambiente, "a") as f:
        f.write("\n# Credencial existente; nome exigido pelo provedor nativo do OpenCode. Nunca imprimir.\n" + linha_kilo + "\n")

# A saída do guard não pode virar sucesso ao filtrar o log com `| tail`.
# Só muda novas shells Bash. Sem errexit: o agente ainda pode tratar erros normalmente.
with open(ambiente) as f:
    atual = f.read()
if LINHA_PIPEFAIL not in atual.splitlines():
    shutil.copy(ambiente, ambiente + ".bak-20261002-pipefail")
    with open(ambiente, "a") as f:
        f.write("\n# Preserve falhas do produtor mesmo quando a saída passa por um filtro.\n" + LINHA_PIPEFAIL + "\n")
