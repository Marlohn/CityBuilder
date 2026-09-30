"""Ponte GitHub -> kanban do Hermes. Sem LLM.

Roda como cron --no-agent do perfil default (a cada 2 min). O GitHub é o quadro oficial (issues, etiquetas, PRs, CI);
o kanban só decide QUEM trabalha e QUANDO. Regra do dono (29/09): nada espera sem motivo, o gatilho é evento, não
relógio (só os dois ciclos diários abaixo são decisão de produto). Cada regra deixa o rastro NO PRÓPRIO ALVO: o
cartão (created_by=sincronizador, com o resumo) ou um comentário no PR/issue. Não existe registro paralelo.

  PR com `em-revisão`                         -> revisor revisa e mescla (1 cartão aberto por PR, 1 por commit)
  PR dev/* ou fix/main-* sem `em-revisão`     -> dev ajusta o que a revisão pediu (até 3 por PR)
  issue `pronto-pra-dev` / `pronto-pra-teste` -> dev / qa (até 3 rodadas; espera `Depende de #N`; 1 dev por arquivo)
  3 rodadas sem entrega                       -> arquiteto quebra a tarefa (docs/PLANO.md 12)
  menos de 3 tarefas abertas                  -> arquiteto planeja o próximo item da issue #2
  CI da main vermelho                         -> dev conserta, na frente de tudo (1 por vez)
  cartão bloqueado                            -> fechado na hora, com o motivo, para liberar a próxima rodada
  PR qa/N de tarefa já entregue               -> fechado
  PR dev/N mesclado, tarefa N ainda aberta    -> issue fechada (o GitHub nem sempre fecha)
  1x por dia                                  -> designer; qa caça bug (se está sem fila)

Sem GH_TOKEN, sai calado. Stdout vazio = nada a entregar (é o que o cron espera). Cada cartão leva a chave no
título ([chave]); a chave também é a idempotency-key. Freio de memória do painel: outro arquivo (freio_memoria.py).
"""

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
FILA_MINIMA = 3  # o arquiteto planeja quando há menos que isso de tarefas PRONTAS PARA COMEÇAR (sem dependência aberta)
BRT = dt.timezone(dt.timedelta(hours=-3))
TERMINAIS = ("done", "archived")


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


def gh_escrever(*args, texto=None):
    """Escreve no GitHub sem derrubar o ciclo: o rastro é bônus, o cartão já foi criado."""
    r = subprocess.run([GH, *args], input=texto, capture_output=True, text=True, timeout=60)
    if r.returncode != 0:
        print(f"gh {' '.join(args[:3])} falhou: {r.stderr.strip()[:120]}")
    return r.returncode == 0


def cartoes():
    r = subprocess.run([HERMES, "kanban", "list", "--json", "--archived"], capture_output=True, text=True, timeout=60)
    return json.loads(r.stdout or "[]")


DEPENDE = re.compile(r"depende\s+d[eao]s?\b[^\n]*", re.IGNORECASE)
# "#36" conta; "#4/1" (numeração interna da tarefa) não.
NUMERO = re.compile(r"#(\d+)(?![\d/])")
FECHA = re.compile(r"\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?|fecha)\s+#(\d+)", re.IGNORECASE)
ITEM = re.compile(r"###\s*Item do roadmap\s+#(\d+)")
# Só a lista numerada "1. `caminho`" do Arquiteto: o corpo também cita arquivos para dizer "NÃO mexa em
# `packages/contract`", e contar esses criava conflito falso (#36 x #40 em 30/09).
ARQS = re.compile(r"^\s*\d+\.\s+`((?:packages|config|data|tests|tools|docs)/[^`<>\s]+)`", re.MULTILINE)


def arquivos(corpo):
    """Arquivos que a tarefa vai mexer, pela lista numerada que o Arquiteto escreve."""
    return set(ARQS.findall(corpo or ""))


def dependencias(corpo):
    """Issues citadas nas linhas 'Depende de ...' do corpo (o Arquiteto escreve assim)."""
    return {int(n) for linha in DEPENDE.findall(corpo or "") for n in NUMERO.findall(linha)}


def chaves(lista):
    """chave -> status de TODO cartão já criado, arquivado incluso. Arquivar NÃO libera a chave: o Hermes cria outro
    cartão se a chave for reusada depois de arquivada (verificado 30/09), e o sincronizador refaria o cartão a cada
    ciclo. Com a chave repetida, vale o cartão aberto."""
    out = {}
    for c in lista:
        t = c.get("title") or ""
        if not (t.startswith("[") and "]" in t):
            continue
        k = t[1:t.index("]")]
        if k not in out or out[k] in TERMINAIS:
            out[k] = c.get("status")
    return out


def aberto(existentes, prefixo):
    """Um assunto tem no máximo UM cartão aberto: existe cartão não terminado cuja chave começa com `prefixo`?"""
    return any(k.startswith(prefixo) and st not in TERMINAIS for k, st in existentes.items())


def rodada(existentes, base):
    """Próxima rodada livre de `base`, ou None se já há uma aberta ou estourou o limite."""
    for n in range(1, MAX_RODADAS + 1):
        st = existentes.get(f"{base}-r{n}")
        if st is None:
            return f"{base}-r{n}"
        if st not in TERMINAIS:
            return None
    return None


def esgotada(existentes, base):
    """Todas as rodadas de `base` foram gastas e nenhuma está aberta."""
    return all(existentes.get(f"{base}-r{n}") in TERMINAIS for n in range(1, MAX_RODADAS + 1))


CORPO = """{alvo}

Faça o ciclo do seu papel (SOUL.md) SÓ para este alvo. Não pegue outra tarefa.
Comece com o clone limpo: `git checkout main && git reset --hard origin/main && git pull` (o clone é só seu; nada
fica guardado entre ciclos fora do GitHub).
Ao terminar: kanban_complete com um resumo curto (issue/PR, o que fez, links).
Falta acesso ou algo quebrou fora do seu alcance? kanban_block com o motivo.
"""


def criar(chave, titulo, papel, alvo, prioridade=0):
    """Um cartão. Contrato local-only em todos: o contrato de PR só deixa fechar com o PR verde, e revisão que
    REPROVA nunca fecharia (30/09: cartão do #56 travou). A trava de verdade é a proteção da main no GitHub."""
    skills = ["--skill", "opencode"] if papel in ("qa", "dev") else []
    subprocess.run(
        [HERMES, "kanban", "create", f"[{chave}] {titulo}", "--assignee", papel, "--workspace", f"dir:/opt/data/cb/{papel}",
         *skills, "--idempotency-key", chave, "--max-runtime", "2h", "--priority", str(prioridade),
         "--created-by", "sincronizador", "--completion-contract", "local-only", "--body-file", "-"],
        input=CORPO.format(alvo=alvo), capture_output=True, text=True, timeout=60, check=True)
    print(f"cartão criado: [{chave}] -> {papel}")


def motivo_bloqueio(cid):
    """O motivo que o agente (ou o Hermes) deu ao bloquear, para ficar no resumo do cartão."""
    try:
        r = subprocess.run([HERMES, "kanban", "show", cid, "--json"], capture_output=True, text=True, timeout=60)
        eventos = json.loads(r.stdout)["events"]
        return next(e["payload"]["reason"] for e in reversed(eventos) if e["kind"] == "blocked")[:300]
    except Exception:
        return "(motivo não registrado)"


def zelar(lista):
    """Cartão bloqueado é fechado na hora para liberar a próxima rodada da issue.

    O dono não atende bloqueio (29/09: "não quero fazer mais nada"); sem isto um cartão travado segurava a issue
    para sempre. O motivo do bloqueio vai no resumo do cartão. Devolve quantos fechou. Se o Hermes recusar o
    complete, arquiva (a chave continua contando como rodada gasta: ver `chaves`).
    """
    n = 0
    for c in lista:
        if c.get("status") != "blocked":
            continue
        resumo = ("Zelador: bloqueado sem ninguém para destravar; fechado para liberar a próxima rodada. "
                  f"Motivo: {motivo_bloqueio(c['id'])}")
        r = subprocess.run([HERMES, "kanban", "complete", c["id"], "--summary", resumo],
                           capture_output=True, text=True, timeout=60)
        if r.returncode != 0 or "cannot complete" in (r.stdout + r.stderr):
            subprocess.run([HERMES, "kanban", "archive", c["id"]], capture_output=True, timeout=60)
            print(f"zelador arquivou {c['id']}: {(r.stdout + r.stderr).strip()[:100]}")
        else:
            print(f"zelador fechou {c['id']}: {(c.get('title') or '')[:60]}")
        n += 1
    return n


def main_vermelha(existentes):
    """CI da main vermelho trava todo merge: vira cartão do Dev na frente de tudo, um conserto por vez.

    30/09: a main ficou vermelha e o loop parou; o revisor reprovava tudo com razão e ninguém tinha a tarefa de
    consertá-la. Cartão de commit velho não é arquivado: o cartão manda o Dev conferir se a main já está verde.
    """
    sha = json.loads(gh("api", f"repos/{REPO}/commits/main"))["sha"]
    runs = json.loads(gh("api", f"repos/{REPO}/commits/{sha}/check-runs"))["check_runs"]
    falhas = [r for r in runs if r.get("conclusion") == "failure" and r["name"] != "testes de aceitação protegidos"]
    if not falhas or aberto(existentes, "main-vermelha-"):
        return
    chave = rodada(existentes, f"main-vermelha-{sha[:7]}")
    if chave:
        criar(chave, f"Consertar a main: CI vermelho em {sha[:7]}", "dev",
              f"O CI da main está VERMELHO no commit {sha[:7]} e isso trava todo merge:\n"
              + "\n".join(f"- {r['name']}: {r['html_url']}" for r in falhas)
              + "\nSe a main JÁ estiver verde quando você começar (outro PR consertou), kanban_complete dizendo isso e pare.\n"
              "Senão, leia o log (`gh run view <id> --log-failed`), reproduza local (o seu Node é o mesmo do CI) e conserte a "
              "CAUSA num PR `fix/main-<assunto>` a partir da main, etiqueta em-revisão. Não apague nem afrouxe teste "
              "pra ficar verde: se o teste estiver errado, explique no PR com número.", prioridade=40)


def revisoes(prs, existentes, esperando_qa=frozenset()):
    """PR em revisão -> cartão do revisor (1 aberto por PR, 1 por commit). Sem etiqueta -> o Dev ajusta (até 3)."""
    for pr in prs:
        n, sha = pr["number"], pr["headRefOid"][:7]
        if any(lb["name"] == "em-revisão" for lb in pr["labels"]):
            chave = f"revisar-pr-{n}-{sha}"
            # Commit novo com a revisão anterior ainda na fila: não cria outra, a que está aberta olha o PR como está.
            if chave not in existentes and not aberto(existentes, f"revisar-pr-{n}-"):
                criar(chave, f"Revisar PR #{n}: {pr['title']}", "revisor",
                      f"Revise o PR #{n} ({pr['url']}). Aprovou e o CI está verde? Faça o merge.", prioridade=30)
        elif pr["headRefName"].startswith(("dev/", "fix/main-")):
            # Issue de volta no QA (teste errado: o Dev não pode corrigir, o CI barra): o ajuste espera o QA (branch dev/N = issue N).
            if re.fullmatch(r"dev/(\d+)", pr["headRefName"]) and int(pr["headRefName"][4:]) in esperando_qa:
                continue
            # PR do Dev fora de revisão = a revisão pediu mudanças (tirou a etiqueta). Uma rodada por commit, no máximo 3.
            base = f"dev-ajuste-pr-{n}-"
            if (sum(k.startswith(base) for k in existentes) < MAX_RODADAS and base + sha not in existentes
                    and not aberto(existentes, base)):
                criar(base + sha, f"Ajustar PR #{n} pedido na revisão: {pr['title']}", "dev",
                      f"A revisão pediu mudanças no PR #{n} ({pr['url']}). Leia o último comentário de revisão "
                      f"(`gh pr view {n} --comments`), ajuste no MESMO branch {pr['headRefName']} (conflito com a main: "
                      "`git merge origin/main` e resolva), deixe `npm run check` verde, dê push e recoloque a etiqueta (o QA corrigiu o teste? traga com `git merge origin/qa/<issue>`): "
                      f"`gh pr edit {n} --add-label em-revisão`.", prioridade=25)


def fechar_prs_qa(prs, abertas):
    """PR rascunho do QA (qa/N) de tarefa já entregue fica aberto e vermelho para sempre (30/09: #44). A regra do
    repo é fechá-lo quando o do Dev entra; os agentes não cumpriam. O comentário no PR é o rastro."""
    for pr in prs:
        m = re.fullmatch(r"qa/(\d+)", pr["headRefName"])
        if m and int(m.group(1)) not in abertas:
            gh_escrever("pr", "close", str(pr["number"]), "-R", REPO, "--comment",
                        f"Fechado pelo sincronizador: a tarefa #{m.group(1)} já foi entregue (issue fechada). "
                        "O teste deste PR entrou na main junto com o PR do Dev.")
            print(f"PR do QA fechado: #{pr['number']}")


def fechar_tarefas_entregues(mesclados, todas, agora=None):
    """PR `dev/N` mesclado e a tarefa N segue aberta: o GitHub não a fechou (30/09: o #68 dizia "Closes #39" e o GitHub
    devolveu closingIssuesReferences vazio; a #39 ganharia outra rodada de dev inútil). O comentário na issue é o rastro.
    Só PR mesclado nas últimas 48 h, para não fechar de novo tarefa que alguém reabriu de propósito."""
    agora = agora or dt.datetime.now(dt.timezone.utc)
    tarefas_abertas = {i["number"] for i in todas if any(lb["name"] == "tarefa" for lb in i["labels"])}
    fechadas = set()
    for pr in mesclados:
        m = re.fullmatch(r"dev/(\d+)", pr["headRefName"])
        recente = agora - dt.datetime.fromisoformat(pr["mergedAt"].replace("Z", "+00:00")) < dt.timedelta(hours=48)
        if m and int(m.group(1)) in tarefas_abertas and recente:
            n = m.group(1)
            gh_escrever("issue", "close", n, "-R", REPO, "--comment",
                        f"Fechada pelo sincronizador: o PR #{pr['number']} (`dev/{n}`) foi mesclado, mas o GitHub não fechou a "
                        "issue. Sem isto ela ganharia outra rodada de dev.")
            print(f"tarefa entregue fechada: #{n} (PR #{pr['number']})")
            fechadas.add(int(n))
    return fechadas


def tarefas(todas, prs, existentes):
    """Issue pronta -> cartão do Dev/QA. Três rodadas sem entrega -> o Arquiteto quebra a tarefa."""
    abertas = {i["number"] for i in todas}
    # Issue com PR do DEV aberto que a fecha já está com alguém (29/09: a #38 seguia 'pronto-pra-dev' com o PR #43 em
    # revisão). O rascunho do QA (qa/N) também diz "Closes #N" e NÃO conta: em 30/09 ele escondeu a #49 do dev por 2 h.
    com_pr = {int(n) for pr in prs if not pr["headRefName"].startswith("qa/") for n in FECHA.findall(pr["body"] or "")}
    bugs = {i["number"] for i in todas if any(lb["name"] == "bug" for lb in i["labels"])}  # PLANO 12.2: bug passa na frente
    for etiqueta, papel, prio in (("pronto-pra-dev", "dev", 20), ("pronto-pra-teste", "qa", 10)):
        lista = json.loads(gh("issue", "list", "-R", REPO, "--state", "open", "--label", etiqueta,
                              "--json", "number,title,body,labels", "--limit", "30"))
        # Só TAREFA vira cartão: em 30/09 o arquiteto pôs `pronto-pra-teste` no ITEM #21 e nasceu cartão de QA para o item inteiro.
        lista = [i for i in lista if any(lb["name"] == "tarefa" for lb in i["labels"])]
        ativos, ocupados = set(), set()
        if papel == "dev":
            # Dois devs no mesmo arquivo = conflito garantido e uma rodada de revisão a mais (29/09: #36, #37 e #48 em
            # trafficSystem.ts). A tarefa espera o PR da outra entrar; dev parado é barato, revisão não é.
            corpos = {i["number"]: i["body"] for i in lista}
            ativos = com_pr | {int(k.split("-")[2]) for k, st in existentes.items()
                               if k.startswith("dev-issue-") and st in ("ready", "running")}
            ocupados = set().union(*(arquivos(corpos.get(n)) for n in ativos)) if ativos else set()
        for iss in sorted(lista, key=lambda i: i["number"]):  # menor número primeiro = ordem do Arquiteto
            n = iss["number"]
            if papel == "dev" and n in com_pr:
                continue
            if papel == "dev" and n not in ativos and arquivos(iss["body"]) & ocupados:
                continue
            if dependencias(iss["body"]) & abertas:
                continue  # espera as dependências fecharem (29/09: #39 dependia de #36-#38)
            base = f"{papel}-issue-{n}"
            chave = rodada(existentes, base)
            if chave:
                item = ITEM.search(iss["body"] or "")
                eh_bug = n in bugs or (item and int(item.group(1)) in bugs)
                if papel == "dev":
                    ocupados |= arquivos(iss["body"])
                criar(chave, f"Issue #{n}: {iss['title']}", papel,
                      f"Sua tarefa: issue #{n} (https://github.com/{REPO}/issues/{n}).", prioridade=prio + (5 if eh_bug else 0))
            elif esgotada(existentes, base) and f"arquiteto-quebrar-{n}" not in existentes:
                criar(f"arquiteto-quebrar-{n}", f"Quebrar a tarefa #{n} ({MAX_RODADAS} rodadas sem entrega)", "arquiteto",
                      f"A tarefa #{n} gastou {MAX_RODADAS} rodadas de {papel} sem entregar. Não repita: leia o que cada "
                      "rodada fez (`hermes kanban list`, PRs e comentários) e ache o porquê. Se for tamanho, quebre em "
                      "Tarefas menores (máx. ~3 arquivos cada, `Depende de #N` quando precisar) e etiquete a primeira. "
                      "Se a definição estiver errada, corrija-a. Comente na issue o que decidiu e feche-a se foi toda "
                      "substituída.", prioridade=15)
                gh_escrever("issue", "comment", str(n), "-R", REPO, "--body-file", "-",
                            texto=f"Sincronizador: {MAX_RODADAS} rodadas de {papel} sem entregar esta tarefa. Chamei o "
                                  f"Arquiteto para quebrá-la (cartão arquiteto-quebrar-{n}).")


def diarios(todas, existentes, dia, corpos_tarefa):
    """Planejar por EVENTO (a fila de tarefas prontas está acabando), não por relógio: a chave muda quando muda o conjunto
    de tarefas/itens abertos, então não replaneja o nada. Tarefa que espera outra (`Depende de #N` aberta) NÃO conta como
    fila: em 30/09 três tarefas do mesmo item, duas esperando a primeira, enchiam a fila e seguravam bugs urgentes
    independentes. Os dois ciclos diários são decisão de produto."""
    def tem(i, nome):
        return any(lb["name"] == nome for lb in i["labels"])

    tarefas_abertas = sorted(i["number"] for i in todas if tem(i, "tarefa"))
    itens = sorted(i["number"] for i in todas if tem(i, "roadmap"))
    fixos = []
    abertas = {i["number"] for i in todas}
    prontas = [t["number"] for t in corpos_tarefa if not dependencias(t["body"]) & abertas]
    if len(prontas) < FILA_MINIMA:
        estado = hashlib.sha1(json.dumps([tarefas_abertas, itens]).encode()).hexdigest()[:8]
        fixos.append((f"arquiteto-plano-{estado}", "Planejar o próximo item do ROADMAP", "arquiteto",
                      "Sua tarefa: passo 3 do seu ciclo (planejar o primeiro item de Agora sem tarefas). Sem item? Pare.\n"
                      "A ordem OFICIAL é a publicada na issue #2 (`gh issue view 2`), que o workflow atualiza; o "
                      "ROADMAP.md commitado na main fica velho (em 29/09 ele fez o #4 passar na frente dos bugs 🚨).\n"
                      "Item que já tem issue Tarefa apontando pra ele, ABERTA OU FECHADA (`gh issue list --label tarefa --state all`), conta como "
                      "planejado: leia o que as fechadas entregaram e planeje só o que FALTA (em 30/09 o item #21 foi replanejado por cima do "
                      "que as #48 e #49 já tinham feito).\n"
                      "Tarefa que precisa de outra antes: escreva no corpo uma linha própria `Depende de #N, #M` com os "
                      "NÚMEROS das issues (o sincronizador lê essa linha e só libera a tarefa quando elas fecharem; "
                      "\"rode as anteriores antes\" sem número não é lido)."))
    fixos.append((f"designer-{dia}", "Ciclo diário do Designer", "designer",
                  "Sua tarefa: um ciclo completo do Designer (um item só)."))
    if not any(tem(i, "pronto-pra-teste") for i in todas):  # tarefa de verdade vem antes; caça só ocupa o QA sem fila
        fixos.append((f"qa-caca-{dia}", "Caçar bug no que entrou", "qa",
                      "Sua tarefa: passo 5 do seu ciclo (tentar quebrar o que entrou). No máximo UM bug por ciclo.\n"
                      "Achou? 1) o teste/replay que reproduz vai num commit no branch `qa/bug-<assunto>` com push; "
                      "2) issue Bug citando o branch e o comando exato; 3) kanban_complete na hora.\n"
                      "A API do GitHub NÃO anexa arquivo em issue: nunca escreva 'anexado', nunca use base64."))
    for chave, titulo, papel, alvo in fixos:
        if chave not in existentes:
            criar(chave, titulo, papel, alvo)


def main():
    tk = token()
    if not tk:
        return
    os.environ["GH_TOKEN"] = tk
    lista = cartoes()
    if zelar(lista):
        lista = cartoes()  # cartão fechado libera a rodada já neste ciclo
    existentes = chaves(lista)
    dia = dt.datetime.now(BRT).strftime("%Y%m%d")
    main_vermelha(existentes)
    prs = json.loads(gh("pr", "list", "-R", REPO, "--state", "open", "--json",
                        "number,title,body,labels,headRefName,headRefOid,url", "--limit", "50"))
    todas = json.loads(gh("issue", "list", "-R", REPO, "--state", "open", "--json", "number,labels", "--limit", "300"))
    mesclados = json.loads(gh("pr", "list", "-R", REPO, "--state", "merged", "--limit", "20",
                              "--json", "number,headRefName,mergedAt"))
    fechadas = fechar_tarefas_entregues(mesclados, todas)
    todas = [i for i in todas if i["number"] not in fechadas]
    esperando_qa = {i["number"] for i in todas if any(lb["name"] == "pronto-pra-teste" for lb in i["labels"])}
    revisoes(prs, existentes, esperando_qa)
    fechar_prs_qa(prs, {i["number"] for i in todas})
    tarefas(todas, prs, existentes)
    corpos_tarefa = json.loads(gh("issue", "list", "-R", REPO, "--state", "open", "--label", "tarefa",
                                  "--json", "number,body", "--limit", "100"))
    diarios(todas, existentes, dia, corpos_tarefa)


if __name__ == "__main__":
    try:
        main()
    except Exception as e:  # o cron entrega stdout; erro vira uma linha legível
        print(f"sincronizador falhou: {e}")
        sys.exit(1)
