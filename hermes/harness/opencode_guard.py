#!/opt/hermes/.venv/bin/python
"""Devolve ao Hermes erros de provedor que deixam `opencode run` aberto.

Instalado como opencode em uma pasta anterior ao binário real no PATH. Outros
comandos continuam no binário original. Não escolhe modelo nem altera arquivos.
"""
import codecs
import os
import selectors
import signal
import subprocess
import sys
import time

REAL = "/opt/data/.local/bin/opencode"
MAX_SECONDS = 3600
PROVIDER_FAILURE = 75


def provider_error(line):
    # Somente o log de erro estruturado do processo, não texto de stdout/testes.
    return all(marker in line for marker in (
        "level=ERROR ", 'message="stream error"', "providerID=", "small=false ",
        "error.error=", "AI_",
    ))


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


def run(args, binary=REAL, max_seconds=MAX_SECONDS):
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
                        if any(provider_error(line) for line in stderr_line.splitlines()):
                            print("HERMES_OPENCODE_PROVIDER_ERROR: falha do provedor; encerrando esta execução (exit 75). "
                                  "Preserve os arquivos e confira o diff. Não é falha do teste do jogo. "
                                  "Tente no máximo uma vez opencode run -m opencode/space-bunny-free com o estado atual; "
                                  "se já usou esse reserva ou ele também falhar, registre os erros e pare.",
                                  file=sys.stderr, flush=True)
                            return PROVIDER_FAILURE
                        stderr_line = stderr_line.rsplit("\n", 1)[-1][-65536:]
            return process.wait(timeout=2)
    finally:
        stop_group(process)
        process.stdout.close()
        process.stderr.close()


def main():
    args = sys.argv[1:]
    if not args or args[0] != "run" or "--help" in args or "-h" in args:
        os.execv(REAL, [REAL, *args])
    def interrupted(signum, _frame):
        raise KeyboardInterrupt(signum)
    signal.signal(signal.SIGTERM, interrupted)
    signal.signal(signal.SIGINT, interrupted)
    try:
        return run(args)
    except KeyboardInterrupt as exc:
        return 128 + (exc.args[0] if exc.args else signal.SIGINT)
    except OSError as exc:
        print(f"HERMES_OPENCODE_START_ERROR: {exc}", file=sys.stderr)
        return 127


if __name__ == "__main__":
    sys.exit(main())
