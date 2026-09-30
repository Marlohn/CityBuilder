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
    print(f"novo cartão: [{chave}] -> {papel}")


REPROVOU = ("Reprovou (ou o PR tem conflito com a main)? Comente o que mudar (`gh pr comment N --body-file`) e TIRE "
            "a etiqueta: `gh pr edit N --remove-label em-revisão`. NÃO feche o PR: o sincronizador manda o Dev "
            "ajustar (até 3 rodadas; depois quebre a tarefa em partes menores).\n")
ZELADOR = "/opt/data/scripts/zelador.json"
ZELADOR_MIN = 0  # 29/set: ninguém destrava cartão; esperar 1 h era só atraso (pedido do dono: nada de espera sem motivo)
FILA_MINIMA = 3  # o Arquiteto planeja quando há menos que isso de tarefas abertas


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
            subprocess.run([HERMES, "kanban", "complete", cid, "--summary",
                            "Zelador: bloqueado há mais de 1 h sem ninguém para destravar; fechado para liberar a "
                            "próxima rodada (o motivo está nos eventos/diagnóstico deste cartão)."],
                           capture_output=True, text=True, timeout=60)
            print(f"zelador: liberei {cid}")
            visto.pop(cid, None)
    visto = {k: v for k, v in visto.items() if k in bloqueados}
    json.dump(visto, open(ZELADOR, "w"))


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


def main():
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
                    print(f"revisão obsoleta arquivada: {t[:40]}")
            if chave not in existentes:
                criar(chave, f"Revisar PR #{pr['number']}: {pr['title']}", "revisor",
                      f"Revise o PR #{pr['number']} ({pr['url']}). Aprovou e o CI está verde? Faça o merge.\n"
                      + aviso_ci(pr) + REPROVOU,
                      contrato=pr["url"] if protegida else "local-only", prioridade=30)
        if not em_revisao and pr["headRefName"].startswith("dev/"):
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


if __name__ == "__main__":
    try:
        main()
    except Exception as e:  # o cron entrega stdout; erro vira uma linha legível
        print(f"sincronizador falhou: {e}")
        sys.exit(1)
