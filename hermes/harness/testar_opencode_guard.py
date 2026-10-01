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

    def scenario(code, limit=5, fallback=False):
        fake.write_text(f"#!{sys.executable}\nimport os,sys,time,subprocess,signal\n" + code)
        fake.chmod(0o700)
        out, err = io.StringIO(), io.StringIO()
        started = time.monotonic()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            execute = guard.run_with_fallback if fallback else guard.run
            rc = execute(["run", "pedido"], binary=str(fake), max_seconds=limit)
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
    kilo_error = ERROR.replace('providerID=opencode', 'providerID=kilo').replace(
        'modelID=muse-spark-1.3-contributor-free', 'modelID=nvidia/nemotron-3-ultra-550b-a55b:free').replace(
        'error.error="AI_APICallError: Rate limit exceeded. Please try again later."',
        'error.error.code=503 error.error.message="Upstream error from Nvidia: Service temporarily overloaded"')
    rc, _, err, seconds = scenario(f"print({kilo_error!r},file=sys.stderr,flush=True)\ntime.sleep(30)\n")
    assert rc == 75 and seconds < 5 and 'code=503' in err

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

    # Troca real do guard, simulando o CLI: retoma a sessão e usa a lista fixa de reservas.
    import json
    catalog = {"opencode": {"models": {"space-bunny-free": {"cost": {"input": 0, "output": 0}}}},
               "kilo": {"models": {"nvidia/nemotron-3-ultra-550b-a55b:free": {"cost": {"input": 0, "output": 0}}}}}
    cache = root / ".cache/opencode"
    cache.mkdir(parents=True)
    (cache / "models.json").write_text(json.dumps(catalog))
    calls = root / "calls.jsonl"
    previous = {name: os.environ.get(name) for name in ("HOME", "KILO_API_KEY")}
    os.environ.update(HOME=str(root), KILO_API_KEY="fixture-sem-segredo")
    try:
        code = (f"import json\nwith open({str(calls)!r},'a') as f: f.write(json.dumps(sys.argv[1:])+'\\n')\n"
                "if '--session' in sys.argv:\n print('RESERVA OK')\n sys.exit(0)\n"
                f"print({ERROR!r},file=sys.stderr,flush=True)\ntime.sleep(30)\n")
        rc, out, err, _ = scenario(code, fallback=True)
        invoked = [json.loads(line) for line in calls.read_text().splitlines()]
        assert rc == 0 and "RESERVA OK" in out and len(invoked) == 2
        assert invoked[1][invoked[1].index('--session') + 1] == 'ses_fixture'
        assert invoked[1][invoked[1].index('--model') + 1] == guard.KILO
        assert "fixture-sem-segredo" not in out + err

        calls.unlink()
        rc, out, _, _ = scenario(code.replace(repr(ERROR), repr(kilo_error)), fallback=True)
        invoked = [json.loads(line) for line in calls.read_text().splitlines()]
        assert rc == 0 and len(invoked) == 2 and guard.ZEN in invoked[1]

        # Todos falharam: três chamadas no máximo, sem recursão/ciclo e sem modelo pago.
        calls.unlink()
        both_fail = code.replace("if '--session' in sys.argv:\n print('RESERVA OK')\n sys.exit(0)\n", "")
        zen_error = ERROR.replace('modelID=muse-spark-1.3-contributor-free', 'modelID=space-bunny-free')
        both_fail = both_fail.replace(f'print({ERROR!r},file=sys.stderr,flush=True)',
            "model=sys.argv[sys.argv.index('--model')+1] if '--model' in sys.argv else ''\n"
            f"error={{'{guard.KILO}':{kilo_error!r},'{guard.ZEN}':{zen_error!r}}}.get(model,{ERROR!r})\n"
            "print(error,file=sys.stderr,flush=True)")
        rc, _, _, _ = scenario(both_fail, fallback=True)
        assert rc == 75 and len(calls.read_text().splitlines()) == 3
        catalog['kilo']['models']['nvidia/nemotron-3-ultra-550b-a55b:free']['cost']['input'] = 1
        (cache / 'models.json').write_text(json.dumps(catalog))
        calls.unlink()
        rc, _, err, _ = scenario(code, fallback=True)
        invoked = [json.loads(line) for line in calls.read_text().splitlines()]
        assert rc == 0 and len(invoked) == 2 and guard.KILO not in invoked[1] and 'NO_FALLBACK' in err
        catalog['opencode']['models']['space-bunny-free']['cost']['input'] = 1
        (cache / 'models.json').write_text(json.dumps(catalog))
        calls.unlink()
        rc, _, err, _ = scenario(code, fallback=True)
        assert rc == 75 and len(calls.read_text().splitlines()) == 1
        catalog['kilo']['models']['nvidia/nemotron-3-ultra-550b-a55b:free']['cost']['input'] = 0
        catalog['opencode']['models']['space-bunny-free']['cost']['input'] = 0
        (cache / 'models.json').write_text(json.dumps(catalog))
        os.environ.pop('KILO_API_KEY')
        calls.unlink()
        rc, _, err, _ = scenario(code, fallback=True)
        invoked = [json.loads(line) for line in calls.read_text().splitlines()]
        assert rc == 0 and len(invoked) == 2 and guard.KILO not in invoked[1] and 'credencial' in err
    finally:
        for name, value in previous.items():
            if value is None:
                os.environ.pop(name, None)
            else:
                os.environ[name] = value

    resumed = guard.resume_args(['run', '-m', 'old/model', '--session=ses_old', '--fork', '--continue',
                                 '--agent', 'build', '--dir', '/repo', 'pedido'], 'ses_current', guard.KILO)
    assert '-m' not in resumed and '--session=ses_old' not in resumed and '--fork' not in resumed
    assert resumed[:5] == ['run', '--session', 'ses_current', '--model', guard.KILO]
    assert '--agent' in resumed and '/repo' in resumed and 'pedido' in resumed

print("TESTE OK: falha rápida, filhos encerrados, reserva bidirecional na mesma sessão e limite/custo protegidos")
