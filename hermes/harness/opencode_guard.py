#!/opt/hermes/.venv/bin/python
"""Devolve ao Hermes erros de provedor que deixam `opencode run` aberto.

Instalado como opencode em uma pasta anterior ao binário real no PATH. Outros
comandos continuam no binário original. Reservas gratuitas limitadas, na mesma sessão.
"""
import codecs
import os
import re
import json
import selectors
import signal
import subprocess
import sys
import time

REAL = "/opt/data/.local/bin/opencode"
MAX_SECONDS = 3600
PROVIDER_FAILURE = 75
KILO = "kilo/nvidia/nemotron-3-ultra-550b-a55b:free"
ZEN = "opencode/space-bunny-free"
ROUTES = {"opencode/muse-spark-1.3-contributor-free": (KILO, ZEN), ZEN: (KILO,), KILO: (ZEN,)}


def provider_error(line):
    # Somente o log de erro estruturado do processo, não texto de stdout/testes.
    structured = all(marker in line for marker in (
        "level=ERROR ", 'message="stream error"', "providerID=", "small=false ",
    ))
    return structured and (('error.error=' in line and 'AI_' in line)
                           or re.search(r'error\.error\.code=[45][0-9]{2}(?:\s|$)', line))


def stop_group(process):
    """Encerra só o grupo criado por esta chamada, incluindo filhos do comando."""
    try:
        os.killpg(process.pid, signal.SIGTERM)
    except ProcessLookupError:
        pass
    try:
        process.wait(timeout=2)
    except subprocess.TimeoutExpired:
        pass
    # O pai pode sair antes dos filhos. Não deixe o clone com um escritor órfão.
    try:
        os.killpg(process.pid, signal.SIGKILL)
    except ProcessLookupError:
        pass
    process.wait()


def run(args, binary=REAL, max_seconds=MAX_SECONDS, failure=None):
    process = subprocess.Popen(
        [binary, "--print-logs", "--log-level", "ERROR", *args],
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True,
    )
    started = time.monotonic()
    stderr_line = ""
    decoders = {stream: codecs.getincrementaldecoder("utf-8")("replace")
                for stream in (process.stdout, process.stderr)}
    try:
        with selectors.DefaultSelector() as selector:
            for stream, target in ((process.stdout, sys.stdout), (process.stderr, sys.stderr)):
                os.set_blocking(stream.fileno(), False)
                selector.register(stream, selectors.EVENT_READ, target)
            while selector.get_map():
                if time.monotonic() - started >= max_seconds:
                    print("HERMES_OPENCODE_TIMEOUT: limite de execução atingido; confira o diff antes de retomar.",
                          file=sys.stderr, flush=True)
                    return 124
                for key, _ in selector.select(timeout=0.1):
                    chunk = os.read(key.fd, 65536)
                    if not chunk:
                        key.data.write(decoders[key.fileobj].decode(b"", final=True))
                        key.data.flush()
                        selector.unregister(key.fileobj)
                        continue
                    text = decoders[key.fileobj].decode(chunk)
                    key.data.write(text)
                    key.data.flush()
                    if key.fileobj is process.stderr:
                        stderr_line += text
                        # Examinar também a linha ainda sem newline: erro não pode depender do flush final.
                        error = next((line for line in stderr_line.splitlines() if provider_error(line)), None)
                        if error:
                            if failure is not None:
                                for field in ("providerID", "modelID", "session.id"):
                                    match = re.search(re.escape(field) + r"=([A-Za-z0-9./:_-]+)(?:\s|$)", error)
                                    if match:
                                        failure[field] = match.group(1)
                            print("HERMES_OPENCODE_PROVIDER_ERROR: chamada encerrada (exit 75); "
                                  "preserve o diff. Falha do provedor, não do teste do jogo.",
                                  file=sys.stderr, flush=True)
                            return PROVIDER_FAILURE
                        stderr_line = stderr_line.rsplit("\n", 1)[-1][-65536:]
            return process.wait(timeout=2)
    finally:
        stop_group(process)
        process.stdout.close()
        process.stderr.close()


def free_model(model):
    """Falha fechada se não houver custo zero no catálogo local do CLI."""
    try:
        from pathlib import Path
        catalog = json.loads((Path.home() / ".cache/opencode/models.json").read_text())
        provider, identifier = model.split("/", 1)
        cost = catalog[provider]["models"][identifier]["cost"]
        return cost.get("input") == 0 and cost.get("output") == 0 and all(value == 0 for value in cost.values())
    except (OSError, ValueError, KeyError, TypeError):
        return False


def resume_args(args, session, model):
    # Não criar outro histórico nem deixar flags antigas vencerem o modelo reserva.
    keep = []
    i = 1
    while i < len(args):
        arg = args[i]
        if arg in ("-m", "--model", "-s", "--session"):
            i += 2
            continue
        if arg in ("-c", "--continue", "--fork") or arg.startswith(("--model=", "--session=")):
            i += 1
            continue
        keep.append(arg)
        i += 1
    return ["run", "--session", session, "--model", model, *keep,
            "Continue a partir do estado atual desta sessão; preserve os arquivos e não repita ações já concluídas."]


def run_with_fallback(args, binary=REAL, max_seconds=MAX_SECONDS):
    failure = {}
    start = time.monotonic()
    rc = run(args, binary=binary, max_seconds=max_seconds, failure=failure)
    if rc != PROVIDER_FAILURE:
        return rc
    primary = failure.get("providerID", "") + "/" + failure.get("modelID", "")
    backups = ROUTES.get(primary, ())
    session = failure.get("session.id", "")
    if not backups or not re.fullmatch(r"ses_[A-Za-z0-9]+", session) or any(
            arg == '--attach' or arg.startswith('--attach=') for arg in args):
        print("HERMES_OPENCODE_NO_FALLBACK: rota/sessão local não confirmada; registre o erro e pare.", file=sys.stderr)
        return rc
    for index, backup in enumerate(backups, 1):
        if not free_model(backup) or (backup == KILO and not os.environ.get("KILO_API_KEY")):
            print(f"HERMES_OPENCODE_NO_FALLBACK: custo/credencial não confirmado para {backup}; etapa ignorada.",
                  file=sys.stderr, flush=True)
            continue
        remaining = max_seconds - (time.monotonic() - start)
        if remaining <= 0:
            return 124
        print(f"HERMES_OPENCODE_FALLBACK: {primary} -> {backup}; session={session}; reserva {index}/{len(backups)}.",
              file=sys.stderr, flush=True)
        # O grupo anterior já foi encerrado. Lista fixa, sem recursão ou retorno ao primeiro modelo.
        failure = {}
        rc = run(resume_args(args, session, backup), binary=binary, max_seconds=remaining, failure=failure)
        print(f"HERMES_OPENCODE_FALLBACK_RESULT: model={backup} exit={rc}", file=sys.stderr, flush=True)
        if rc != PROVIDER_FAILURE:
            return rc
        actual = failure.get('providerID', '') + '/' + failure.get('modelID', '')
        if actual != backup or failure.get('session.id') != session:
            return rc
    return rc


def main():
    args = sys.argv[1:]
    if not args or args[0] != "run" or "--help" in args or "-h" in args:
        os.execv(REAL, [REAL, *args])
    def interrupted(signum, _frame):
        raise KeyboardInterrupt(signum)
    signal.signal(signal.SIGTERM, interrupted)
    signal.signal(signal.SIGINT, interrupted)
    try:
        return run_with_fallback(args)
    except KeyboardInterrupt as exc:
        return 128 + (exc.args[0] if exc.args else signal.SIGINT)
    except OSError as exc:
        print(f"HERMES_OPENCODE_START_ERROR: {exc}", file=sys.stderr)
        return 127


if __name__ == "__main__":
    sys.exit(main())
