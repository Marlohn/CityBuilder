"""Aplica a revisão dos perfis (30/set): ferramentas por papel, skills enxutas, SOUL do arquiteto e do revisor.

Roda no container como uid 10000. Idempotente. Backup de config.yaml e SOUL.md antes de mexer.
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
    "dev": {"ferr": BASE,
            "skills": ["software-development/github", "autonomous-ai-agents/opencode",
                       "software-development/test-driven-development", "software-development/systematic-debugging",
                       "software-development/node-inspect-debugger"]},
}
FONTE_SKILLS = "/opt/hermes/skills"
SOULS = {"arquiteto": "/tmp/SOUL-arquiteto.md", "revisor": "/tmp/SOUL-revisor.md"}

for papel, cfg in PAPEIS.items():
    d = f"/opt/data/profiles/{papel}"
    for f in ("config.yaml", "SOUL.md"):
        if not os.path.exists(f"{d}/{f}.bak-20260930-revisao"):
            shutil.copy(f"{d}/{f}", f"{d}/{f}.bak-20260930-revisao")
    c = yaml.safe_load(open(f"{d}/config.yaml")) or {}
    c["platform_toolsets"] = {"cli": cfg["ferr"]}
    yaml.safe_dump(c, open(f"{d}/config.yaml", "w"), allow_unicode=True, sort_keys=False)
    r = subprocess.run([H, "-p", papel, "skills", "opt-out", "--remove", "--yes"], capture_output=True, text=True)
    if r.returncode != 0:
        raise SystemExit(f"{papel}: opt-out falhou: {r.stderr[-300:]}")
    for s in cfg["skills"]:
        dst = f"{d}/skills/{s}"
        if not os.path.exists(f"{dst}/SKILL.md"):
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            shutil.copytree(f"{FONTE_SKILLS}/{s}", dst, dirs_exist_ok=True)
    if papel in SOULS:
        shutil.copy(SOULS[papel], f"{d}/SOUL.md")
    print(f"{papel}: aplicado")
