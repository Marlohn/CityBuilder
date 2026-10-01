"""Cenários de falha do CLI, sem LLM, rede ou clone de agente. Linux/Python padrão."""
import contextlib
import importlib.util
import io
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time

spec = importlib.util.spec_from_file_location("guard", Path(__file__).with_name("opencode_guard.py"))
guard = importlib.util.module_from_spec(spec)
spec.loader.exec_module(guard)
ERROR = ('timestamp=2026-10-01T20:51:12.401Z level=ERROR run=44c99761 '
         'message="stream error" providerID=opencode modelID=muse-spark-1.3-contributor-free '
         'session.id=ses_fixture small=false agent=build mode=primary '
         'error.error="AI_APICallError: Rate limit exceeded. Please try again later."')


def alive(pid):
    path = Path(f"/proc/{pid}/stat")
    return path.exists() and path.read_text().split(") ", 1)[1][0] != "Z"


def stopped(pid):
    deadline = time.monotonic() + 2
    while alive(pid) and time.monotonic() < deadline:
        time.sleep(.01)
    return not alive(pid)


with tempfile.TemporaryDirectory() as directory:
    root = Path(directory)
    fake = root / "opencode"

    def scenario(code, limit=5):
        fake.write_text(f"#!{sys.executable}\nimport os,sys,time,subprocess,signal\n" + code)
        fake.chmod(0o700)
        out, err = io.StringIO(), io.StringIO()
        started = time.monotonic()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            rc = guard.run(["run", "pedido"], binary=str(fake), max_seconds=limit)
        return rc, out.getvalue(), err.getvalue(), time.monotonic() - started

    # Antes: o processo continua vivo após o mesmo erro visto em produção.
    fake.write_text(f"#!{sys.executable}\nimport sys,time\nprint({ERROR!r},file=sys.stderr,flush=True)\ntime.sleep(30)\n")
    fake.chmod(0o700)
    old = subprocess.Popen([str(fake)], stderr=subprocess.PIPE, start_new_session=True)
    assert b"Rate limit exceeded" in old.stderr.readline()
    assert old.poll() is None, "o cenário precisa reproduzir o erro com processo ainda aberto"
    guard.stop_group(old)
    old.stderr.close()

    rc, out, err, seconds = scenario(f"print({ERROR!r},file=sys.stderr,flush=True)\ntime.sleep(30)\n")
    assert rc == 75 and seconds < 5 and "Rate limit exceeded" in err and "exit 75" in err

    # Erro em stderr fragmentado e sem newline também precisa devolver o controle.
    rc, _, err, _ = scenario(f"s={ERROR!r}\nsys.stderr.write(s[:90]);sys.stderr.flush();time.sleep(.1)\n"
                            "sys.stderr.write(s[90:]);sys.stderr.flush();time.sleep(30)\n")
    assert rc == 75 and "HERMES_OPENCODE_PROVIDER_ERROR" in err

    # Não confundir título, saída do teste nem erro da ferramenta com falha do provedor principal.
    title = ERROR.replace("small=false", "small=true")
    rc, out, err, _ = scenario(f"print({title!r},file=sys.stderr)\nprint({ERROR!r})\nprint('feito')\n")
    assert rc == 0 and "feito" in out and "HERMES_OPENCODE_PROVIDER_ERROR" not in err
    rc, _, _, _ = scenario("print('teste vermelho',file=sys.stderr)\nsys.exit(7)\n")
    assert rc == 7
    rc, _, err, _ = scenario("time.sleep(30)\n", limit=.2)
    assert rc == 124 and "HERMES_OPENCODE_TIMEOUT" in err

    # Um filho não pode seguir escrevendo no clone depois de falha ou timeout.
    pidfile = root / "child.pid"
    child = "import signal,time;signal.signal(signal.SIGTERM,signal.SIG_IGN);time.sleep(30)"
    code = (f"p=subprocess.Popen([sys.executable,'-c',{child!r}])\n"
            f"open({str(pidfile)!r},'w').write(str(p.pid))\ntime.sleep(.2)\n"
            f"print({ERROR!r},file=sys.stderr,flush=True)\ntime.sleep(30)\n")
    rc, _, _, _ = scenario(code)
    assert rc == 75 and stopped(int(pidfile.read_text()))
    rc, _, _, _ = scenario(code.replace(f"print({ERROR!r},file=sys.stderr,flush=True)", "pass"), limit=.4)
    assert rc == 124 and stopped(int(pidfile.read_text()))

print("TESTE OK: erro real reproduzido; falha rápida, saídas normais e filhos encerrados")
