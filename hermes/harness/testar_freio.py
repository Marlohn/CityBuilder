"""Gabarito do freio de memória. Uso: python3 testar_freio.py [caminho do freio_memoria.py]  (roda no container)

Alvos de brinquedo com o argv REAL do painel: `python -m tui_gateway.entry` e `node .../ui-tui/dist/entry.js`.
Controles que NÃO podem morrer: processo comum e processos que só CITAM o nome (um `sh -c`, um `python -c ... nome`).
"""
import importlib.util
import json
import os
import shutil
import signal
import subprocess
import sys
import tempfile
import time

CAMINHO = sys.argv[1] if len(sys.argv) > 1 else "/opt/data/scripts/freio_memoria.py"
spec = importlib.util.spec_from_file_location("f", CAMINHO)
f = importlib.util.module_from_spec(spec)
spec.loader.exec_module(f)
f.LOG = tempfile.mktemp(suffix=".jsonl")

# 1) a função que decide, com argv de verdade (sem processo nenhum)
assert f.eh_terminal_do_painel(["/opt/hermes/.venv/bin/python3", "-m", "tui_gateway.entry"])
assert f.eh_terminal_do_painel(["python3", "-u", "-m", "tui_gateway.entry", "--x"])
assert f.eh_terminal_do_painel(["node", "--enable-source-maps", "/opt/hermes/ui-tui/dist/entry.js"])
assert not f.eh_terminal_do_painel(["sh", "-c", "sed s/x/tui_gateway.entry/ ui-tui/dist/entry.js"])
assert not f.eh_terminal_do_painel(["grep", "-r", "tui_gateway.entry", "/opt"])
assert not f.eh_terminal_do_painel(["python3", "-c", "import time", "tui_gateway.entry"])
assert not f.eh_terminal_do_painel(["python3", "-m", "outro.modulo"])
assert not f.eh_terminal_do_painel(["python3", "-m"])
assert not f.eh_terminal_do_painel([])
print("decisão por argv: ok")

# 2) com processos de verdade
tmp = tempfile.mkdtemp()
os.makedirs(f"{tmp}/tui_gateway")
open(f"{tmp}/tui_gateway/__init__.py", "w").close()
open(f"{tmp}/tui_gateway/entry.py", "w").write("import time\ntime.sleep(120)\n")
os.makedirs(f"{tmp}/ui-tui/dist")
open(f"{tmp}/ui-tui/dist/entry.js", "w").write("setTimeout(() => {}, 120000)\n")
env = {**os.environ, "PYTHONPATH": tmp}
alvos = [subprocess.Popen([sys.executable, "-m", "tui_gateway.entry"], env=env, cwd=tmp)]
if shutil.which("node"):
    alvos.append(subprocess.Popen(["node", f"{tmp}/ui-tui/dist/entry.js"]))
controles = [
    subprocess.Popen([sys.executable, "-c", "import time; time.sleep(120)"]),
    subprocess.Popen(["sh", "-c", "sleep 120  # tui_gateway.entry ui-tui/dist/entry.js"], start_new_session=True),
    subprocess.Popen([sys.executable, "-c", "import time; time.sleep(120)", "tui_gateway.entry", f"{tmp}/ui-tui/dist/entry.js"]),
]
time.sleep(1.0)
try:
    anon, teto = f.anon_e_teto()
    assert 0 < anon < teto, (anon, teto)

    f.PCT = 1.01  # limite acima do teto: memória "normal"
    f.main()
    assert all(p.poll() is None for p in alvos) and not os.path.exists(f.LOG), "abaixo do limite não pode matar nem registrar"
    print("abaixo do limite: nada acontece: ok")

    f.PCT = 0.0  # tudo acima do limite: tem que agir
    f.main()
    for p in alvos:
        p.wait(timeout=5)
        assert p.returncode == -9, f"o alvo devia morrer por SIGKILL, saiu com {p.returncode}"
    assert all(p.poll() is None for p in controles), "matou processo que não é terminal do painel: o freio está largo"
    linhas = [json.loads(x) for x in open(f.LOG)]
    assert len(linhas) == 1 and linhas[0]["encerrados"] == len(alvos) and linhas[0]["teto_mb"] > 0, linhas
    print(f"acima do limite: mata os {len(alvos)} terminais do painel, poupa os controles e deixa rastro: ok")
finally:
    for p in alvos + controles:
        try:
            os.killpg(p.pid, signal.SIGKILL) if p.args[0] == "sh" else p.kill()  # o sh tem filho (sleep): mata o grupo
        except OSError:
            pass
    shutil.rmtree(tmp, ignore_errors=True)
    if os.path.exists(f.LOG):
        os.unlink(f.LOG)
print("TESTE OK")
