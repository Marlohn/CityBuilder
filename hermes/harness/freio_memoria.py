"""Freio de memória do container: encerra os terminais de chat do painel quando a memória encosta no teto.

Cron --no-agent a cada 2 min, separado do sincronizador (uma peça que falha não derruba a outra).

Por que existe (30/09): o painel do Hermes guarda cada terminal de chat 30 min depois de o navegador fechar, com teto
FIXO no código de 16 terminais (PtySessionRegistry(ttl=30*60, max_sessions=16) em hermes_cli/web_server_chat.py;
não há opção de config). Cada terminal (tui_gateway + ui-tui) usa ~250 MB: 16 x 250 MB passa dos 3 GB do container.
Em 30/09 eram 11 terminais + 2 agentes = 2.910/3.072 MB; o container passou a reler o próprio código do disco
(pressão 'full' em 69%, load 30) e travou o mini PC da casa. Os terminais ignoram SIGTERM: é SIGKILL. Quem estava
usando só reabre o chat; o trabalho dos agentes vem antes.

Quando apagar: se uma versão futura do Hermes deixar configurar o teto/TTL dos terminais do painel, configure lá
e remova este arquivo e o cron `freio-memoria`. O rastro de cada disparo: uma linha em freio.jsonl e no stdout do cron.
"""

import datetime as dt
import json
import os
import signal

PCT = 0.85  # fração do teto (memória de processo, anon; o cache de arquivos o kernel descarta sozinho)
LOG = "/opt/data/avaliacao/freio.jsonl"
BRT = dt.timezone(dt.timedelta(hours=-3))


def anon_e_teto():
    anon = next(int(x.split()[1]) for x in open("/sys/fs/cgroup/memory.stat") if x.startswith("anon "))
    return anon, int(open("/sys/fs/cgroup/memory.max").read().strip())


def eh_terminal_do_painel(argv):
    """O argv de verdade, não texto solto na linha de comando: um `sh -c` ou um `grep` que só CITAM o nome não contam.
    O painel roda `hermes --tui` = `node .../ui-tui/dist/entry.js`, que sobe `python -m tui_gateway.entry`."""
    exe = os.path.basename(argv[0]) if argv else ""
    if exe.startswith("python") and "-m" in argv[:-1] and argv[argv.index("-m") + 1] == "tui_gateway.entry":
        return True
    return exe in ("node", "nodejs") and any(a.endswith("/ui-tui/dist/entry.js") for a in argv[1:])


def terminais_do_painel():
    alvos = []
    for p in os.listdir("/proc"):
        if not p.isdigit():
            continue
        try:
            argv = open(f"/proc/{p}/cmdline", "rb").read().decode(errors="replace").split("\0")
        except OSError:
            continue
        if eh_terminal_do_painel([a for a in argv if a]):
            alvos.append(int(p))
    return alvos


def main():
    try:
        anon, teto = anon_e_teto()
    except (OSError, ValueError, StopIteration):
        return  # sem cgroup v2 legível (ou teto "max"): nada a fazer
    if anon < PCT * teto:
        return
    alvos = terminais_do_painel()
    for pid in alvos:
        try:
            os.kill(pid, signal.SIGKILL)
        except OSError:
            pass
    linha = {"quando": dt.datetime.now(BRT).isoformat(timespec="minutes"), "anon_mb": anon // 1048576,
             "teto_mb": teto // 1048576, "encerrados": len(alvos)}
    with open(LOG, "a") as f:
        f.write(json.dumps(linha) + "\n")
    print(f"freio de memória: {len(alvos)} terminais de chat do painel encerrados "
          f"(processos em {linha['anon_mb']}/{linha['teto_mb']} MB, limite {int(PCT * 100)}%)")


if __name__ == "__main__":
    main()
