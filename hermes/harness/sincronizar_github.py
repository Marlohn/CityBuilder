"""Alimenta o kanban do Hermes a partir do GitHub do CityBuilder. Sem LLM.

Roda como cron --no-agent do perfil default (a cada 2 min; não usa LLM). O GitHub continua
sendo o quadro oficial (issues, etiquetas, PRs, CI); o kanban só decide QUEM trabalha e QUANDO.
Regra do dono (29/set): nada espera sem motivo — gatilho é evento, não relógio.

  PR aberto com `em-revisão`        -> cartão do arquiteto (revisar/mergear), 1 por commit
  PR dev/* sem `em-revisão`         -> cartão do dev (ajustar o que a revisão pediu, até 3)
  issue com `pronto-pra-dev`        -> cartão do dev   (até 3 rodadas; espera `Depende de #N`)
  issue com `pronto-pra-teste`      -> cartão do qa    (até 3 rodadas; espera `Depende de #N`)
  menos de 3 tarefas abertas        -> cartão do arquiteto (planejar o próximo item da issue #2)
  1x por dia                        -> cartão do designer
  1x por dia, se o qa está sem fila -> cartão do qa (caçar bug)
  cartão bloqueado                  -> fechado na hora (zelador) para liberar a próxima rodada

Sem GH_TOKEN, sai calado. Stdout vazio = nada a entregar (é o que o cron espera).
Cada cartão leva a chave no título ([chave]); a chave é também a idempotency-key.
"""

import collections
import datetime as dt
import hashlib
import json
import os
import re
import subprocess
import sys

REPO = "Marlohn/CityBuilder"
HERMES = "/opt/hermes/.venv/bin/hermes"
GH = "/opt/data/.local/bin/gh"
MAX_RODADAS = 3  # docs/PLANO.md 12: falhou 3 vezes, volta pro arquiteto quebrar
BRT = dt.timezone(dt.timedelta(hours=-3))


ACOES = "/opt/data/avaliacao/acoes.jsonl"


def registrar(acao, alvo, motivo="", impacto=False):
    """Toda ação automática com efeito colateral deixa UMA linha aqui (30/09, pedido do dono: nada que não dê
    pra rastrear depois). O diário no GitHub (issue 'Diário do loop') é montado a partir deste arquivo."""
    linha = {"quando": dt.datetime.now(BRT).isoformat(timespec="seconds"), "acao": acao, "alvo": alvo,
             "motivo": motivo, "impacto": impacto}
    with open(ACOES, "a") as f:
        f.write(json.dumps(linha, ensure_ascii=False) + "\n")
    print(f"{acao}: {alvo} {('(' + motivo + ')') if motivo else ''}")


def token():
    for arq in ("/opt/data/profiles/arquiteto/.env", "/opt/data/.env"):
        try:
            for linha in open(arq, encoding="utf-8"):
                if linha.startswith("GH_TOKEN=") and linha.strip() != "GH_TOKEN=":
                    return linha.split("=", 1)[1].strip()
        except OSError:
            pass
    return ""


def gh(*args):
    r = subprocess.run([GH, *args], capture_output=True, text=True, timeout=60)
    if r.returncode != 0:
        raise RuntimeError(f"gh {' '.join(args)}: {r.stderr.strip()[:300]}")
    return r.stdout


def cartoes():
    r = subprocess.run([HERMES, "kanban", "list", "--json", "--archived"],
                       capture_output=True, text=True, timeout=60)
    return json.loads(r.stdout or "[]")


DEPENDE = re.compile(r"depende\s+d[eao]s?\b[^\n]*", re.IGNORECASE)
# "#36" conta; "#4/1" (numeração interna da tarefa) não.
NUMERO = re.compile(r"#(\d+)(?![\d/])")


FECHA = re.compile(r"\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?|fecha)\s+#(\d+)", re.IGNORECASE)
ITEM = re.compile(r"###\s*Item do roadmap\s+#(\d+)")


# Só a lista numerada "1. `caminho`" do Arquiteto: o corpo também cita arquivos para dizer "NÃO mexa em
# `packages/contract`", e contar esses criava conflito falso (#36 x #40 em 30/set).
ARQS = re.compile(r"^\s*\d+\.\s+`((?:packages|config|data|tests|tools|docs)/[^`<>\s]+)`", re.MULTILINE)


def arquivos(corpo):
    """Arquivos que a tarefa vai mexer, pela lista numerada que o Arquiteto escreve."""
    return set(ARQS.findall(corpo or ""))


def dependencias(corpo):
    """Issues citadas nas linhas 'Depende de ...' do corpo (o Arquiteto escreve assim)."""
    return {int(n) for linha in DEPENDE.findall(corpo or "") for n in NUMERO.findall(linha)}


def chaves(lista):
    out = {}
    for c in lista:
        t = c.get("title") or ""
        if c.get("status") == "archived":
            continue  # arquivado à mão = não conta como rodada
        if t.startswith("[") and "]" in t:
            out[t[1:t.index("]")]] = c.get("status")
    return out


def rodada(existentes, base):
    """Próxima rodada livre, ou None se já existe uma aberta ou estourou o limite."""
    for n in range(1, MAX_RODADAS + 1):
        st = existentes.get(f"{base}-r{n}")
        if st is None:
            return f"{base}-r{n}"
        if st not in ("done", "archived"):
            return None  # rodada anterior ainda aberta (ou bloqueada: espera humano)
    return None


CORPO = """{alvo}

Faça o ciclo do seu papel (SOUL.md) SÓ para este alvo. Não pegue outra tarefa.
Comece com o clone limpo: `git checkout main && git reset --hard origin/main && git pull`
(o clone é só seu; nada fica guardado entre ciclos fora do GitHub; ROADMAP.md e roadmap/signals.json
gerados localmente NÃO se commitam, o workflow do GitHub publica).
Texto para issue/PR/comentário vai SEMPRE por arquivo: escreva em /tmp/corpo.md e use
`gh ... --body-file /tmp/corpo.md` (com --body "..." o shell come crases e o texto sai cortado).
Antes de enviar, confira que não escapou caractere chinês/japonês no texto:
`LC_ALL=C.UTF-8 grep -nP '[\\x{{3000}}-\\x{{9fff}}]' /tmp/corpo.md` tem que sair vazio; se achar, corrija o arquivo e SÓ ENTÃO poste
(29/set: saíram "a mesma拥" e "a建模" e o agente precisou postar comentário de correção).
O DONO DISPENSOU APROVAÇÃO (29/set): PR que mexe em contrato, save, schema da config ou VISAO.md segue o
fluxo normal (CI verde + revisão do Arquiteto = merge). Ignore "precisa de aprovação do dono" nas issues e no
CODEOWNERS; nunca pare esperando o dono. Nesses PRs o Arquiteto revisa com mais rigor e explica no PR o que mudou.
{opencode}Ao terminar: kanban_complete com um resumo curto (issue/PR, o que fez, links).
Falta acesso ou algo quebrou fora do seu alcance? kanban_block com o motivo.
"""

# Só quem ESCREVE código delega ao OpenCode (muse-spark). Pesquisa e leitura o agente faz direto:
# em 29/set a regra "tudo pelo OpenCode" fez o designer rodar opencode só pra cumprir tabela.
OPENCODE = ("Para ESCREVER ou ALTERAR código e testes, use o OpenCode (skill opencode):\n"
            "`opencode run '<pedido completo>'` no seu clone; o modelo padrão já é o muse-spark.\n"
            "Ler código, rodar comandos e pesquisar você faz direto. Confira o diff antes de seguir.\n")
ESCREVE_CODIGO = {"qa", "dev"}
PR_DEV = ("A descrição do PR PRECISA ter a linha `Closes #<issue>` EM INGLÊS: \"Fecha #\" não fecha a issue "
          "no merge (29/set: PR #46 saiu com \"Fecha #37\").\n"
          "NUNCA altere .github/ (CI) dentro do PR da tarefa: a trava que vigia o Dev não pode ser mexida por "
          "ele no mesmo PR. CI errado? Abra OUTRO PR a partir da main, branch `fix/ci-<assunto>`, só com a "
          "mudança do CI, o motivo e a prova (cenário que a trava tem que pegar), etiqueta em-revisão; volte à "
          "tarefa quando ele entrar (29/set: o Dev mudou o ci.yml dentro do PR #52).\n"
          "Mexeu em packages/sim? Antes de abrir o PR rode também `npm run test:slow -- tests/slow/performance.test.ts` "
          "(~2 min): desempenho só aparece nele, e em 29/set o PR #52 voltou 2 vezes da revisão por isso.\n")


def criar(chave, titulo, papel, alvo, contrato="local-only", prioridade=0):
    corpo = CORPO.format(alvo=alvo, opencode=(OPENCODE if papel in ESCREVE_CODIGO else "") + (PR_DEV if papel == "dev" else ""))
    skills = ["--skill", "opencode"] if papel in ESCREVE_CODIGO else []
    subprocess.run(
        [HERMES, "kanban", "create", f"[{chave}] {titulo}", "--assignee", papel,
         "--workspace", f"dir:/opt/data/cb/{papel}", *skills,
         "--idempotency-key", chave, "--max-runtime", "2h", "--priority", str(prioridade),
         "--created-by", "sincronizador", "--completion-contract", contrato,
         "--body-file", "-"],
        input=corpo, capture_output=True, text=True, timeout=60, check=True)
    registrar("cartao_criado", f"[{chave}] -> {papel}", titulo[:80])


REPROVOU = ("ANTES DO MERGE, o CI tem que ter rodado sobre a main ATUAL: se "
            "`git merge-base --is-ancestor origin/main origin/<branch do PR>` falhar (a main andou), rode "
            "`gh pr update-branch N`, espere o CI ficar verde DE NOVO e só então faça merge (30/set: o #54 foi "
            "mesclado com CI de antes do #46 entrar; cada um verde sozinho, juntos quebraram a main).\n"
            "Reprovou (ou o PR tem conflito com a main)? Comente o que mudar (`gh pr comment N --body-file`) e TIRE "
            "a etiqueta: `gh pr edit N --remove-label em-revisão`. NÃO feche o PR: o sincronizador manda o Dev "
            "ajustar (até 3 rodadas; depois quebre a tarefa em partes menores).\n")
ZELADOR = "/opt/data/scripts/zelador.json"
ZELADOR_MIN = 0  # 29/set: ninguém destrava cartão; esperar 1 h era só atraso (pedido do dono: nada de espera sem motivo)
FILA_MINIMA = 3  # o Arquiteto planeja quando há menos que isso de tarefas abertas


JEV_URL = "https://opencode.ai/zen/v1/systemone"
# Sem User-Agent próprio o Cloudflare do Zen devolve 403/1010 para o urllib (medido 30/set).
JEV_UA = "citybuilder-sincronizador/1.0"
TRIAGEM_LOG = "/opt/data/avaliacao/triagem.jsonl"
CAUSAS = {
    "transitorio": "erro de rede, timeout do provedor, limite de taxa, servidor fora do ar; tentar de novo resolve",
    "orcamento": "estourou o limite de passos/iterações ou de tempo: tarefa grande demais ou agente se perdeu",
    "acesso": "falta permissão, token, arquivo, ou uma decisão humana de fora",
    "erro_do_agente": "o agente errou: comando inválido, bloqueado pela segurança, travou em laço",
}


def jev(estado, perguntas):
    """Decisão estruturada pelo jev (grátis, ~1 s). None se falhar: quem chama cai no comportamento antigo."""
    import urllib.request
    req = urllib.request.Request(JEV_URL, method="POST", data=json.dumps(
        {"model": "jev-1.13-free", "state": estado[:6000], "questions": perguntas}).encode(),
        headers={"Authorization": "Bearer public", "Content-Type": "application/json", "User-Agent": JEV_UA})
    try:
        return json.load(urllib.request.urlopen(req, timeout=30))["answers"]
    except Exception as e:  # rede, 4xx/5xx, formato: nunca derruba o sincronizador
        print(f"jev indisponível: {e}")
        return None


def triar(cid, titulo):
    """Classifica por que o cartão travou. Tarefa grande demais não volta pro mesmo agente: vai pro Arquiteto quebrar.

    Antes (29/set) o zelador fechava tudo igual e a issue ganhava outra rodada idêntica, que estourava de novo.
    """
    texto = subprocess.run([HERMES, "kanban", "show", cid], capture_output=True, text=True, timeout=60).stdout
    texto = "\n".join(l for l in texto.splitlines() if "heartbeat" not in l)
    r = jev(f"{titulo}\n{texto[-3000:]}", {"causa": {"type": "choice", "criteria": CAUSAS,
                                                     "instructions": "Por que este cartão de um agente de IA travou?"}})
    causa = r["causa"]["choice"] if r else None
    conf = r["causa"].get("confidence") if r else None
    with open(TRIAGEM_LOG, "a") as f:
        f.write(json.dumps({"quando": dt.datetime.now(BRT).isoformat(timespec="minutes"), "cartao": cid,
                            "titulo": titulo[:90], "causa": causa, "confianca": conf}, ensure_ascii=False) + "\n")
    m = re.match(r"^\[(dev|qa)-issue-(\d+)-", titulo)
    if causa == "orcamento" and (conf or 0) >= 0.8 and m:
        n = m.group(2)
        # tira a etiqueta para não nascer outra rodada igual; o Arquiteto quebra e reetiqueta as partes
        subprocess.run([GH, "issue", "edit", n, "-R", REPO, "--remove-label", "pronto-pra-dev",
                        "--remove-label", "pronto-pra-teste"], capture_output=True, timeout=60)
        registrar("tarefa_mandada_quebrar", f"issue #{n}", f"cartão {cid} estourou passos/tempo (jev: orcamento, "
                  f"confiança {conf}); etiquetas pronto-pra-* removidas", impacto=True)
        criar(f"arquiteto-quebrar-{n}", f"Quebrar a tarefa #{n} (travou por tamanho)", "arquiteto",
              f"A tarefa #{n} travou por ESTOURAR passos/tempo no cartão {cid} ({titulo[:60]}). Não é erro "
              "passageiro: é grande demais pra um ciclo. Quebre em Tarefas menores (máx. ~3 arquivos cada, com "
              f"`Depende de #N` quando precisar), etiquete a primeira `pronto-pra-teste` e comente na #{n} o que "
              "virou o quê (feche-a se foi toda substituída).", prioridade=15)
    return causa


def zelar(lista):
    """Cartão bloqueado há mais de 1 h é fechado para liberar a próxima rodada.

    O dono não atende bloqueio (29/set: "não quero fazer mais nada"); sem isto um cartão travado
    (ex.: orçamento de passos estourado) segurava a issue para sempre. A issue ganha nova rodada
    (até MAX_RODADAS) e o motivo fica no resumo do cartão.
    """
    try:
        visto = json.load(open(ZELADOR))
    except (OSError, ValueError):
        visto = {}
    agora = dt.datetime.now().timestamp()
    bloqueados = {c["id"] for c in lista if c.get("status") == "blocked"}
    for cid in bloqueados:
        desde = visto.setdefault(cid, agora)
        if agora - desde >= ZELADOR_MIN * 60:
            titulo = next((c.get("title") or "" for c in lista if c["id"] == cid), "")
            try:
                causa = triar(cid, titulo)
            except Exception as e:  # triagem é bônus; liberar o cartão é obrigação
                causa = f"triagem falhou: {e}"[:120]
            r = subprocess.run([HERMES, "kanban", "complete", cid, "--summary",
                                "Zelador: bloqueado sem ninguém para destravar; fechado para liberar a próxima rodada "
                                "(o motivo está nos eventos/diagnóstico deste cartão)."],
                               capture_output=True, text=True, timeout=60)
            if r.returncode != 0 or "cannot complete" in (r.stdout + r.stderr):
                # contrato de PR ou estado terminal recusam o complete: arquiva pra não triar de novo a cada ciclo
                subprocess.run([HERMES, "kanban", "archive", cid], capture_output=True, timeout=60)
                registrar("zelador_arquivou", f"{cid} {titulo[:60]}",
                          f"travou por {causa}; não fechava: {(r.stdout + r.stderr).strip()[:80]}", impacto=True)
            else:
                registrar("zelador_liberou", f"{cid} {titulo[:60]}", f"travou por {causa}")
            visto.pop(cid, None)
    visto = {k: v for k, v in visto.items() if k in bloqueados}
    json.dump(visto, open(ZELADOR, "w"))


FREIO_LOG = "/opt/data/avaliacao/freio.jsonl"
FREIO_PCT = 0.85


def freio_memoria():
    """Encerra as sessões de chat do painel quando o container encosta no teto de memória.

    30/09: 11 processos de chat do painel (tui_gateway, ~250 MB cada, um vivo havia 1 h) + 2 agentes
    levaram o container a 2.910/3.072 MB; ele passou a reler o próprio código do disco (pressão 'full'
    em 69%, load 30) e travou o mini PC da casa. Chat do painel é interface; o trabalho dos agentes vem
    antes. Eles ignoram SIGTERM: é SIGKILL. Quem estava usando só reabre o chat.
    """
    import signal
    try:
        anon = next(int(l.split()[1]) for l in open("/sys/fs/cgroup/memory.stat") if l.startswith("anon "))
        teto = int(open("/sys/fs/cgroup/memory.max").read().strip())
    except (OSError, ValueError, StopIteration):
        return  # sem cgroup v2 legível (ou teto "max"): nada a fazer
    if anon < FREIO_PCT * teto:
        return
    alvos = []
    for p in os.listdir("/proc"):
        if not p.isdigit():
            continue
        try:
            cmd = open(f"/proc/{p}/cmdline", "rb").read().replace(b"\0", b" ").decode(errors="replace")
        except OSError:
            continue
        if "tui_gateway.entry" in cmd or "ui-tui/dist/entry.js" in cmd:
            alvos.append(int(p))
    for pid in alvos:
        try:
            os.kill(pid, signal.SIGKILL)
        except OSError:
            pass
    with open(FREIO_LOG, "a") as f:
        f.write(json.dumps({"quando": dt.datetime.now(BRT).isoformat(timespec="minutes"),
                            "anon_mb": anon // 1048576, "teto_mb": teto // 1048576, "encerrados": len(alvos)}) + "\n")
    registrar("freio_memoria", f"{len(alvos)} sessões de chat do painel encerradas",
              f"processos em {anon // 1048576}/{teto // 1048576} MB (limite {int(FREIO_PCT * 100)}%)", impacto=True)


def main_vermelha(existentes, lista):
    """CI da main vermelho trava todo merge. Vira cartão do Dev na frente de tudo, um por commit da main.

    30/set: a main ficou vermelha (teste da #48 dependia da versão do Node) e o loop parou: o Revisor
    reprovava tudo com razão e ninguém tinha tarefa de consertar a main.
    """
    sha = json.loads(gh("api", f"repos/{REPO}/commits/main"))["sha"]
    # Cartão de conserto de um commit velho da main que nem começou já não serve (30/set: o #52 consertou o
    # 802a78f enquanto o cartão dele esperava). Rodando, segue: o agente vê a main nova.
    for c in lista:
        t = c.get("title") or ""
        if (t.startswith("[main-vermelha-") and not t.startswith(f"[main-vermelha-{sha[:7]}]")
                and c.get("status") in ("ready", "todo")):
            subprocess.run([HERMES, "kanban", "archive", c["id"]], capture_output=True, timeout=60)
            registrar("cartao_obsoleto_arquivado", t[:60], f"a main andou para {sha[:7]}")
    runs = json.loads(gh("api", f"repos/{REPO}/commits/{sha}/check-runs"))["check_runs"]
    falhas = [r for r in runs if r.get("conclusion") == "failure" and r["name"] != "testes de aceitação protegidos"]
    if not falhas:
        return
    chave = f"main-vermelha-{sha[:7]}"
    if chave in existentes:
        return
    lista = "\n".join(f"- {r['name']}: {r['html_url']}" for r in falhas)
    registrar("main_vermelha", f"main {sha[:7]}", "; ".join(r["name"] for r in falhas), impacto=True)
    criar(chave, f"Consertar a main: CI vermelho em {sha[:7]}", "dev",
          f"O CI da main está VERMELHO no commit {sha[:7]} e isso trava todo merge:\n{lista}\n"
          "Leia o log (`gh run view <id> --log-failed`), reproduza local (o seu Node é o mesmo do CI) e conserte a "
          "CAUSA num PR `fix/main-<assunto>` a partir da main, etiqueta em-revisão. Não apague nem afrouxe teste "
          "pra ficar verde: se o teste estiver errado, explique no PR com número.", prioridade=40)


def aviso_ci(pr):
    """PR que mexe em .github/ ganha aviso no cartão de revisão (checado aqui, fora do alcance dos agentes)."""
    arquivos = [f["path"] for f in gh_json("pr", "view", str(pr["number"]), "-R", REPO, "--json", "files")["files"]]
    ci = [a for a in arquivos if a.startswith(".github/")]
    if not ci:
        return ""
    if pr["headRefName"].startswith("dev/"):
        return (f"REPROVE: este PR de tarefa mexe no CI ({', '.join(ci)}). Mudança de CI não entra em PR de "
                "tarefa (a trava vigia o próprio Dev): peça um PR separado `fix/ci-...` só com ela.\n")
    return (f"ATENÇÃO, mudança de CI ({', '.join(ci)}): revise com rigor dobrado. Exija a prova de que a trava "
            "continua pegando o que deve (ex.: Dev alterando teste do QA tem que ficar vermelho) e que o caso "
            "que motivou a mudança fica verde.\n")


def gh_json(*args):
    return json.loads(gh(*args) or "{}")


DIARIO_ESTADO = "/opt/data/avaliacao/diario-estado.json"
DIARIO_TITULO = "🤖 Diário do loop (ações automáticas)"
NOMES = {"cartao_criado": "cartões criados", "zelador_liberou": "cartões travados liberados",
         "zelador_arquivou": "cartões arquivados à força", "freio_memoria": "freio de memória",
         "cartao_obsoleto_arquivado": "cartões obsoletos arquivados", "pr_qa_fechado": "PRs do QA fechados",
         "main_vermelha": "main vermelha", "tarefa_mandada_quebrar": "tarefas mandadas quebrar"}


def diario_github():
    """Publica o que o loop fez sozinho numa issue fixa do GitHub, onde o dono já olha.

    Ação de impacto (impacto=True): comentário na hora. O resto: um resumo por dia, com a contagem por tipo e a
    lista do que não é rotina. Resumo diário tem motivo: é leitura pra humano, não urgência.
    """
    try:
        est = json.load(open(DIARIO_ESTADO))
    except (OSError, ValueError):
        est = {}
    try:
        acoes = [json.loads(l) for l in open(ACOES)]
    except OSError:
        acoes = []
    hoje = dt.datetime.now(BRT).strftime("%Y-%m-%d")
    if "issue" not in est:
        subprocess.run([GH, "label", "create", "diario-loop", "-R", REPO, "--color", "ededed", "--force",
                        "--description", "Registro automático do que o loop de agentes fez sozinho"],
                       capture_output=True, timeout=60)
        corpo = ("Registro automático, escrito pelo sincronizador (`hermes/harness/sincronizar_github.py`), de tudo "
                 "que o loop de agentes faz **sozinho** e que tem efeito: cartão travado liberado ou arquivado, freio de "
                 "memória, PR do QA fechado, main vermelha, tarefa mandada quebrar.\n\n- Ação de impacto: comentário na "
                 "hora.\n- Resto: um resumo por dia.\n\nFonte completa: `/opt/data/avaliacao/acoes.jsonl` no mini PC. "
                 "Não é item de roadmap.")
        url = subprocess.run([GH, "issue", "create", "-R", REPO, "--title", DIARIO_TITULO, "--label", "diario-loop",
                              "--body", corpo], capture_output=True, text=True, timeout=60).stdout.strip()
        if not url:
            return
        # sem microssegundos, e ainda assim: 1 s pra trás pra não perder ação do mesmo segundo da criação
        corte = dt.datetime.now(BRT).replace(microsecond=0) - dt.timedelta(seconds=1)
        est = {"issue": int(url.rstrip("/").split("/")[-1]), "dia": hoje, "impacto_ate": corte.isoformat()}
        json.dump(est, open(DIARIO_ESTADO, "w"))
        return

    def postar(texto):
        r = subprocess.run([GH, "issue", "comment", str(est["issue"]), "-R", REPO, "--body-file", "-"],
                           input=texto, capture_output=True, text=True, timeout=60)
        return r.returncode == 0

    # compara como horário, não como texto: "…:05-03:00" < "…:05.123-03:00" como texto escondia a ação (30/09, pego no teste)
    ate = dt.datetime.fromisoformat(est.get("impacto_ate") or "1970-01-01T00:00:00-03:00")
    novos = [a for a in acoes if a.get("impacto") and dt.datetime.fromisoformat(a["quando"]) > ate]
    if novos:
        linhas = "\n".join(f"- `{a['quando'][11:16]}` **{NOMES.get(a['acao'], a['acao'])}**: {a['alvo']}"
                           + (f" ({a['motivo']})" if a["motivo"] else "") for a in novos)
        if postar(f"⚠️ **Ação de impacto** ({len(novos)}):\n\n{linhas}"):
            est["impacto_ate"] = max(a["quando"] for a in novos)
    if est.get("dia", hoje) < hoje:
        do_dia = [a for a in acoes if a["quando"][:10] == est["dia"]]
        if do_dia:
            cont = collections.Counter(a["acao"] for a in do_dia)
            resumo = " · ".join(f"{NOMES.get(k, k)}: {v}" for k, v in cont.most_common())
            fora_rotina = [a for a in do_dia if a["acao"] != "cartao_criado"][-30:]
            lista = "\n".join(f"- `{a['quando'][11:16]}` {NOMES.get(a['acao'], a['acao'])}: {a['alvo']}"
                              + (f" ({a['motivo']})" if a["motivo"] else "") for a in fora_rotina)
            if not postar(f"📋 **Resumo de {est['dia']}**: {resumo}\n\n{lista or '(só rotina)'}"):
                return
        est["dia"] = hoje
    json.dump(est, open(DIARIO_ESTADO, "w"))


KILO_LIMITE_H = 200   # limite da conta do dono no Kilo (informado por ele em 30/09); o Kilo NÃO manda cabeçalho de uso
KILO_AVISO = 170


def uso_kilo():
    """Conta as chamadas feitas pelo Kilo na última hora (sessões dos perfis) e avisa perto do limite, 1x por hora.

    Passar do limite não trava ninguém (o fallback leva pro Zen), mas degrada o modelo dos papéis de raciocínio:
    precisa aparecer no diário pra decidir se muda a divisão de papéis.
    """
    import glob
    import sqlite3
    desde = dt.datetime.now().timestamp() - 3600
    total = 0
    for db in glob.glob("/opt/data/profiles/*/state.db"):
        try:
            c = sqlite3.connect(f"file:{db}?mode=ro", uri=True, timeout=5)
            total += c.execute("select coalesce(sum(api_call_count),0) from sessions where billing_base_url like "
                               "'%kilo.ai%' and coalesce(last_activity_at, ended_at, started_at) >= ?",
                               (desde,)).fetchone()[0]
        except sqlite3.Error:
            continue
    hora = dt.datetime.now(BRT).strftime("%Y-%m-%dT%H")
    marca = "/opt/data/avaliacao/kilo-avisado"
    if total >= KILO_AVISO and (not os.path.exists(marca) or open(marca).read() != hora):
        registrar("kilo_perto_do_limite", f"{total} chamadas na última hora", f"limite da conta {KILO_LIMITE_H}/h; "
                  "passando disso o fallback leva pro Zen (space-bunny)", impacto=True)
        open(marca, "w").write(hora)
    return total


def main():
    freio_memoria()
    try:
        uso_kilo()
    except Exception as e:
        print(f"contagem do Kilo falhou: {e}")  # antes de tudo e sem depender do GitHub: protege a máquina mesmo sem token/rede
    tk = token()
    if not tk:
        return
    os.environ["GH_TOKEN"] = tk
    existentes = chaves(cartoes())
    agora = dt.datetime.now(BRT)
    dia = agora.strftime("%Y%m%d")

    # Protegida = a main exige checks do CI. Vale proteção clássica OU ruleset (o botão
    # "Protect this branch" cria ruleset; o endpoint /protection só enxerga a clássica).
    try:
        regras = json.loads(gh("api", f"repos/{REPO}/rules/branches/main"))
        protegida = any(r.get("type") == "required_status_checks" for r in regras)
    except (RuntimeError, ValueError):
        protegida = False
    if not protegida:
        try:
            gh("api", f"repos/{REPO}/branches/main/protection")
            protegida = True
        except RuntimeError:
            pass

    cartoes_atuais = cartoes()
    zelar(cartoes_atuais)

    main_vermelha(existentes, cartoes_atuais)

    prs_abertos = json.loads(gh("pr", "list", "-R", REPO, "--state", "open", "--json",
                                "number,title,body,labels,headRefName,headRefOid,url", "--limit", "50"))
    # Issue com PR aberto que a fecha já está com alguém (29/set: a #38 seguia 'pronto-pra-dev' com o PR #43 em revisão).
    com_pr = {int(n) for pr in prs_abertos for n in FECHA.findall(pr["body"] or "")}

    for pr in prs_abertos:
        em_revisao = any(l["name"] == "em-revisão" for l in pr["labels"])
        sha = pr["headRefOid"][:7]
        if em_revisao:
            chave = f"revisar-pr-{pr['number']}-{sha}"
            # Commit novo torna obsoleta a revisão do commit anterior que ainda nem começou (30/set: #52 tinha
            # dois cartões na fila, um por commit). Revisão já rodando segue; ela olha o PR como está.
            for c in cartoes_atuais:
                t = c.get("title") or ""
                if (t.startswith(f"[revisar-pr-{pr['number']}-") and not t.startswith(f"[{chave}]")
                        and c.get("status") in ("ready", "todo")):
                    subprocess.run([HERMES, "kanban", "archive", c["id"]], capture_output=True, timeout=60)
                    registrar("cartao_obsoleto_arquivado", t[:60], f"PR #{pr['number']} ganhou commit novo {sha}")
            if chave not in existentes:
                criar(chave, f"Revisar PR #{pr['number']}: {pr['title']}", "revisor",
                      f"Revise o PR #{pr['number']} ({pr['url']}). Aprovou e o CI está verde? Faça o merge.\n"
                      + aviso_ci(pr) + REPROVOU,
                      # Sem contrato de PR: ele só deixa fechar o cartão com o PR verde, e revisão que
                      # REPROVA nunca fecharia (30/set: cartão do #56 travou e o zelador girou em laço).
                      # A trava de verdade é a proteção da main (ruleset com checks obrigatórios).
                      contrato="local-only", prioridade=30)
        if not em_revisao and pr["headRefName"].startswith(("dev/", "fix/main-")):
            # PR do Dev fora de revisão = o Arquiteto pediu mudanças (tirou a etiqueta). Volta pro Dev,
            # uma rodada por commit, no máximo 3; depois disso o Arquiteto quebra a tarefa (PLANO 12).
            base = f"dev-ajuste-pr-{pr['number']}-"
            if sum(k.startswith(base) for k in existentes) < MAX_RODADAS and base + sha not in existentes:
                criar(base + sha, f"Ajustar PR #{pr['number']} pedido na revisão: {pr['title']}", "dev",
                      f"O Arquiteto pediu mudanças no PR #{pr['number']} ({pr['url']}). Leia o último comentário "
                      f"de revisão (`gh pr view {pr['number']} --comments`), ajuste no MESMO branch "
                      f"{pr['headRefName']} (conflito com a main: `git merge origin/main` e resolva), deixe "
                      f"`npm run check` verde, dê push e recoloque a etiqueta: "
                      f"`gh pr edit {pr['number']} --add-label em-revisão`.", prioridade=25)

    todas = json.loads(gh("issue", "list", "-R", REPO, "--state", "open",
                          "--json", "number,labels", "--limit", "300"))
    abertas = {i["number"] for i in todas}
    # PR rascunho do QA (qa/N) de tarefa já fechada fica aberto e vermelho pra sempre (30/set: #44 da #37,
    # entregue no #46). A regra do repo é fechar o PR do QA quando o do Dev entra: faz aqui, sem LLM.
    for pr in prs_abertos:
        m = re.fullmatch(r"qa/(\d+)", pr["headRefName"])
        if m and int(m.group(1)) not in abertas:
            subprocess.run([GH, "pr", "close", str(pr["number"]), "-R", REPO, "--comment",
                            f"Fechado pelo sincronizador: a tarefa #{m.group(1)} já foi entregue (issue fechada). "
                            "O teste deste PR entrou na main junto com o PR do Dev."], capture_output=True, timeout=60)
            registrar("pr_qa_fechado", f"PR #{pr['number']}", f"tarefa #{m.group(1)} já entregue")
    # PLANO 12.2: bug passa na frente de tudo. Tarefa de item com etiqueta bug ganha prioridade.
    bugs = {i["number"] for i in todas if any(l["name"] == "bug" for l in i["labels"])}
    for etiqueta, papel, prio in (("pronto-pra-dev", "dev", 20), ("pronto-pra-teste", "qa", 10)):
        lista = json.loads(gh("issue", "list", "-R", REPO, "--state", "open", "--label", etiqueta,
                              "--json", "number,title,body", "--limit", "30"))
        if papel == "dev":
            # Dois devs no mesmo arquivo = conflito garantido e uma rodada de revisão a mais (29/set: #36, #37 e #48
            # em trafficSystem.ts). A tarefa espera o PR da outra entrar; o dev parado é barato, a revisão não é.
            corpos = {i["number"]: i["body"] for i in lista}
            ativos = com_pr | {int(k.split("-")[2]) for k, st in existentes.items()
                               if k.startswith("dev-issue-") and st in ("ready", "running")}
            ocupados = set().union(*(arquivos(corpos.get(n)) for n in ativos)) if ativos else set()
        for iss in sorted(lista, key=lambda i: i["number"]):  # menor número primeiro = ordem do Arquiteto
            if papel == "dev" and iss["number"] in com_pr:
                continue
            if papel == "dev" and iss["number"] not in ativos and arquivos(iss["body"]) & ocupados:
                continue
            if dependencias(iss["body"]) & abertas:
                continue  # espera as dependências fecharem (29/set: #39 dependia de #36-#38)
            chave = rodada(existentes, f"{papel}-issue-{iss['number']}")
            if chave:
                item = ITEM.search(iss["body"] or "")
                eh_bug = iss["number"] in bugs or (item and int(item.group(1)) in bugs)
                if papel == "dev":
                    ocupados |= arquivos(iss["body"])
                criar(chave, f"Issue #{iss['number']}: {iss['title']}", papel,
                      f"Sua tarefa: issue #{iss['number']} (https://github.com/{REPO}/issues/{iss['number']}).",
                      prioridade=prio + (5 if eh_bug else 0))

    # Planejar por EVENTO, não por relógio: quando a fila de tarefas está acabando. A chave muda quando
    # muda o conjunto de tarefas/itens abertos, então não replaneja o nada enquanto nada mudou.
    tarefas = sorted(i["number"] for i in todas if any(l["name"] == "tarefa" for l in i["labels"]))
    itens = sorted(i["number"] for i in todas if any(l["name"] == "roadmap" for l in i["labels"]))
    fixos = []
    if len(tarefas) < FILA_MINIMA:
        estado = hashlib.sha1(json.dumps([tarefas, itens]).encode()).hexdigest()[:8]
        fixos.append((f"arquiteto-plano-{estado}", "Planejar o próximo item do ROADMAP", "arquiteto",
              "Sua tarefa: passo 3 do seu ciclo (planejar o primeiro item de Agora sem tarefas). Sem item? Pare.\n"
              "A ordem OFICIAL é a publicada na issue #2 (`gh issue view 2`), que o workflow atualiza; o "
              "ROADMAP.md commitado na main fica velho (em 29/set ele fez o #4 passar na frente dos bugs 🚨).\n"
              "Item que já tem issue Tarefa apontando pra ele (`gh issue list --label tarefa`) conta como planejado.\n"
              "Tarefa que precisa de outra antes: escreva no corpo uma linha própria `Depende de #N, #M` com os "
              "NÚMEROS das issues (o sincronizador lê essa linha e só libera a tarefa quando elas fecharem; "
              "\"rode as anteriores antes\" sem número não é lido).", 0, 0))
    fixos.append((f"designer-{dia}", "Ciclo diário do Designer", "designer",
                  "Sua tarefa: um ciclo completo do Designer (um item só).", 0, 0))
    qa_ocioso = not any(any(l["name"] == "pronto-pra-teste" for l in i["labels"]) for i in todas)
    if qa_ocioso:  # tarefa de verdade vem antes; caça só ocupa o QA quando ele não tem fila
        fixos.append((f"qa-caca-{dia}", "Caçar bug no que entrou", "qa",
                      "Sua tarefa: passo 5 do seu ciclo (tentar quebrar o que entrou). No máximo UM bug por ciclo.\n"
                      "Achou? 1) o teste/replay que reproduz vai num commit no branch `qa/bug-<assunto>` com push; "
                      "2) issue Bug citando o branch e o comando exato; 3) kanban_complete na hora.\n"
                      "A API do GitHub NÃO anexa arquivo em issue: nunca escreva 'anexado', nunca use base64 "
                      "(em 29/set isso gastou o orçamento inteiro e a issue saiu dizendo que tinha anexo).", 0, 0))
    for chave, titulo, papel, alvo, _hora, prio in fixos:
        if chave not in existentes:
            criar(chave, titulo, papel, alvo, prioridade=prio)
    try:
        diario_github()
    except Exception as e:  # o diário não pode derrubar o ciclo; a fonte (acoes.jsonl) já foi gravada
        print(f"diário do GitHub falhou: {e}")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:  # o cron entrega stdout; erro vira uma linha legível
        print(f"sincronizador falhou: {e}")
        sys.exit(1)
