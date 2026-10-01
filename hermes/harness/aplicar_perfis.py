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
NO_KILO = {"designer", "arquiteto", "revisor"}
FONTE_SKILLS = "/opt/hermes/skills"

for papel, cfg in PAPEIS.items():
    d = f"/opt/data/profiles/{papel}"
    if not os.path.exists(f"{d}/config.yaml.bak-20260930-revisao"):
        shutil.copy(f"{d}/config.yaml", f"{d}/config.yaml.bak-20260930-revisao")
    c = yaml.safe_load(open(f"{d}/config.yaml")) or {}
    # O envelope antigo abortava a espera em 420 s, antes do terminal (até 600 s),
    # enquanto o processo continuava vivo. Background + poll curto é a regra do SOUL.
    c.setdefault("timeouts", {}).setdefault("tools", {}).update(sequential_call=900, concurrent_batch=900)
    c["platform_toolsets"] = {"cli": cfg["ferr"]}
    if papel in NO_KILO:
        if not os.path.exists(f"{d}/.env.bak-20260930-kilo"):
            shutil.copy(f"{d}/.env", f"{d}/.env.bak-20260930-kilo")
        env = [l for l in open(f"{d}/.env").read().splitlines() if not l.startswith("KILOCODE_API_KEY=")]
        env.append("KILOCODE_API_KEY=" + open("/opt/data/.kilo_key").read().strip())
        open(f"{d}/.env", "w").write("\n".join(env) + "\n")
        os.chmod(f"{d}/.env", 0o600)
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
