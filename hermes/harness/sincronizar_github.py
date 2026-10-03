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
  cartão bloqueado                            -> motivo/destino registrados; decisão espera, falha gasta a rodada
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
Falta acesso ou algo quebrou fora do seu alcance? kanban_block com motivo, responsável e condição para continuar.
Use kind=dependency só com dependência real; needs_input para decisão, capability para acesso/ferramenta ausente,
transient para falha técnica temporária comprovada. Não chame erro de teste de falha do provedor.
"""


def criar(chave, titulo, papel, alvo, prioridade=0, max_runtime="2h", max_retries=None,
          goal_max_turns=None, bloqueado=False):
    """Um cartão. Contrato local-only em todos: o contrato de PR só deixa fechar com o PR verde, e revisão que
    REPROVA nunca fecharia (30/09: cartão do #56 travou). A trava de verdade é a proteção da main no GitHub."""
    skills = ["--skill", "opencode"] if papel in ("qa", "dev") else []
    limites = (["--max-retries", str(max_retries)] if max_retries is not None else [])
    limites += (["--goal", "--goal-max-turns", str(goal_max_turns)] if goal_max_turns else [])
    limites += (["--initial-status", "blocked"] if bloqueado else [])
    subprocess.run(
        [HERMES, "kanban", "create", f"[{chave}] {titulo}", "--assignee", papel, "--workspace", f"dir:/opt/data/cb/{papel}",
         *skills, *limites, "--idempotency-key", chave, "--max-runtime", max_runtime, "--priority", str(prioridade),
         "--created-by", "sincronizador", "--completion-contract", "local-only", "--body-file", "-"],
        input=CORPO.format(alvo=alvo), capture_output=True, text=True, timeout=60, check=True)
    print(f"cartão criado: [{chave}] -> {papel}")


def bloqueio(cid):
    """Última falha nativa, inclusive timeout sem evento blocked. Não interpreta texto para inventar causa."""
    try:
        r = subprocess.run([HERMES, "kanban", "show", cid, "--json"], capture_output=True, text=True, timeout=60)
        if r.returncode:
            return {}
        detalhe = json.loads(r.stdout)
        atual = detalhe.get("task", {})
        if atual.get("status") != "blocked" or atual.get("worker_pid") or atual.get("claim_lock"):
            return {}  # snapshot antigo não autoriza encaminhar/arquivar um worker que voltou a trabalhar
        eventos = detalhe["events"]
        for i in range(len(eventos) - 1, -1, -1):
            e = eventos[i]
            if e["kind"] not in ("blocked", "gave_up", "timed_out"):
                continue
            dados = dict(e["payload"])
            dados["reason"] = dados.get("reason") or dados.get("error") or "motivo não registrado"
            dados["evento"] = e["kind"]
            marca = f"[encaminhamento:{cid}:{i}:{e.get('created_at', '')}]"
            dados["marca"] = marca
            dados["registrado"] = any(marca in c.get("body", "") for c in detalhe.get("comments", []))
            return dados
    except Exception:
        pass
    return {}


def zelar(lista, prs=()):
    """Encaminha pela causa estruturada; nunca declara entrega para limpar a fila.

    Dependência fica no mecanismo nativo. Decisão/acesso/causa desconhecida tem um atendimento limitado;
    falha técnica de uma tentativa comum é arquivada como falha e continua contando no orçamento existente.
    Recuperação/abastecimento bloqueados persistem, sem atendimento de atendimento nem unblock automático.
    Devolve mudanças para main reler o quadro. Falha de leitura/escrita preserva o bloqueio.
    """
    n = 0
    existentes = chaves(lista)
    por_numero = {pr["number"]: pr for pr in prs}
    decididos = set()
    for c in lista:
        if c.get("status") != "blocked":
            continue
        chave = (c.get("title") or "").split("]", 1)[0].lstrip("[")
        dados = bloqueio(c["id"])
        if not dados:
            continue
        motivo = str(dados.get("reason") or "(motivo não registrado)")[:300]
        kind = dados.get("kind")
        persistente = (re.fullmatch(r"arquiteto-destravar-pr-\d+-(?:final|esgotado)", chave)
                       or chave.startswith(("designer-fila-", "arquiteto-plano-", "arquiteto-bloqueio-")))
        tecnica = kind == "transient" or dados.get("evento") == "timed_out" or (
            dados.get("evento") == "gave_up" and dados.get("trigger_outcome") == "timed_out")
        responsavel = c.get("assignee") or "arquiteto"
        condicao = "aguardar a dependência real; o kanban nativo libera quando os pais terminarem"
        destino = "espera de dependência, sem nova tentativa"
        ajuste = re.fullmatch(r"dev-ajuste-pr-(\d+)-([0-9a-f]{7})(?:-retomar-r[1-3])?", chave)
        pr = por_numero.get(int(ajuste[1])) if ajuste else None
        delegado = (c.get("assignee") == "dev" and dados.get("kind") == "needs_input"
                    and pr and pr["headRefOid"][:7] == ajuste[2])
        if delegado and pr["number"] not in decididos:
            # Criar a decisão antes de fechar: se a escrita falhar, o bloqueio fica para o próximo ciclo.
            escalar_pr(pr, existentes, f"o Dev pediu uma decisão no cartão {c['id']}: {motivo}")
            decididos.add(pr["number"])
        if kind != "dependency":
            condicao = "corrigir a causa e conferir encaminhamento executável no GitHub; comentário não é solução"
            destino = "impedimento preservado; outros trabalhos independentes continuam"
            if not persistente and tecnica:
                destino = "arquivar tentativa FALHA; próxima rodada só dentro do orçamento já existente"
                condicao = "orçamento disponível e condições atuais conferidas pelo próximo agente; não reiniciar contadores"
            elif not persistente and delegado:
                responsavel = "arquiteto"
                destino = f"tentativa não entregue delegada à decisão do PR #{pr['number']}; Dev espera essa decisão"
            elif not persistente and not ajuste and c.get("assignee") != "arquiteto":
                responsavel = "arquiteto"
                decisao = f"arquiteto-bloqueio-{c['id']}"
                destino = f"atendimento único [{decisao}]"
                if decisao not in existentes:
                    criar(decisao, f"Encaminhar bloqueio de {c['id']}", "arquiteto",
                          f"Cartão de origem {c['id']}: {c.get('title', '')}. Tipo: {kind or 'não classificado'}. "
                          f"Motivo: {motivo}. Confira kanban show, evidências e alvo originais. Não repita o ciclo "
                          "inteiro do agente. Decisão: execute a divisão ou passagem no GitHub; acesso/ferramenta: "
                          "confira a capacidade faltante e use somente alternativas gratuitas já disponíveis. "
                          "Causa desconhecida: diagnostique antes de classificar. Não implemente a feature, altere "
                          "proteções nem reinicie orçamento Dev. Depois de executar e verificar a condição, comente "
                          f"a evidência no cartão {c['id']} e arquive a tentativa original como não entregue; isso "
                          "permite apenas as rodadas que ainda restam. Sem solução executável, mantenha a origem "
                          "bloqueada, registre responsável/condição e bloqueie este atendimento. Não crie outro "
                          "atendimento de recuperação. Trabalho independente pode continuar.",
                          prioridade=25, max_runtime="15m", max_retries=1, goal_max_turns=2)
                    existentes[decisao] = "ready"
                    n += 1
        if not dados.get("registrado"):
            resumo = (f"{dados['marca']} Não entregue. " + f"Motivo: {motivo}"
                      + f". Responsável: {responsavel}. Destino: {destino}. Para continuar: {condicao}.")
            r = subprocess.run([HERMES, "kanban", "comment", c["id"], resumo, "--author", "sincronizador"],
                               capture_output=True, text=True, timeout=60)
            if r.returncode:
                continue  # nunca arquivar sem preservar motivo/destino; tentar a escrita no próximo ciclo
            n += 1
        if not persistente and (tecnica or delegado) and kind != "dependency":
            atual = bloqueio(c["id"])
            if not atual or atual.get("marca") != dados["marca"]:
                continue  # conferir novamente estado/falha depois de criar destino e preservar evidência
            r = subprocess.run([HERMES, "kanban", "archive", c["id"]], capture_output=True, text=True, timeout=60)
            if not r.returncode:
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


CHECKS_CI = {"npm run check", "testes lentos (coorte IBGE e cidade de 50 mil)", "teste de tela (Playwright)"}


def estado_ci(pr):
    """Só libera a revisão com todos os checks do CI concluídos no HEAD consultado."""
    checks = pr.get("statusCheckRollup") or []
    obrigatorios = CHECKS_CI | ({"testes de aceitação protegidos"} if pr["headRefName"].startswith("dev/") else set())
    if any(c.get("conclusion") in ("FAILURE", "TIMED_OUT", "ACTION_REQUIRED", "CANCELLED") for c in checks):
        return "falhou"
    verdes = {c.get("name") for c in checks if c.get("status") == "COMPLETED" and c.get("conclusion") == "SUCCESS"}
    return "verde" if obrigatorios <= verdes else "aguardando"


def preparar_revisao(pr):
    """CI/atualização de branch são trabalho do script; nunca ocupam uma vaga de LLM."""
    n = str(pr["number"])
    if pr.get("isDraft") or pr.get("mergeStateStatus") == "UNKNOWN":
        return False
    motivo = None
    if pr.get("mergeStateStatus") == "DIRTY":
        motivo = "A branch tem conflito com a main. Resolva no mesmo branch, sem force-push, e publique novamente."
    else:
        atras = int(gh("api", f"repos/{REPO}/compare/main...{pr['headRefOid']}", "--jq", ".behind_by"))
        if atras:
            # O SHA esperado impede atualizar uma revisão que mudou durante a consulta.
            gh_escrever("api", f"repos/{REPO}/pulls/{n}/update-branch", "-X", "PUT",
                        "-f", f"expected_head_sha={pr['headRefOid']}")
            return False
        if estado_ci(pr) == "falhou":
            motivo = "O CI deste commit falhou. Leia os logs, corrija só a causa e publique novamente; não repita a suíte completa no mini PC."
    if motivo:
        # Comentário primeiro: nunca encaminhar o Dev sem a evidência da devolução.
        if gh_escrever("pr", "comment", n, "-R", REPO, "--body-file", "-", texto=f"Sincronizador: {motivo}"):
            gh_escrever("pr", "edit", n, "-R", REPO, "--remove-label", "em-revisão")
        return False
    return estado_ci(pr) == "verde"


def escalar_pr(pr, existentes, motivo):
    """Rodadas gastas exigem uma decisão registrada, não um PR esquecido."""
    if aberto(existentes, f"arquiteto-destravar-pr-{pr['number']}-"):
        return
    n = pr['number']
    final = f"arquiteto-destravar-pr-{n}-final"
    if final in existentes:
        impedido = f"arquiteto-destravar-pr-{n}-esgotado"
        if impedido not in existentes:
            criar(impedido, f"Encaminhamento do PR #{n} ainda não executável", "arquiteto",
                  f"O atendimento final [{final}] terminou, mas o PR #{n} ({pr['url']}) continua "
                  f"sem encaminhamento executável: {motivo}. Não é entrega nem autorização para outro Dev. "
                  "Bloqueio persistente; o planejamento deve procurar trabalho independente. "
                  "Confira o GitHub antes de resolver este impedimento.", bloqueado=True)
        return
    chave = f"arquiteto-destravar-pr-{pr['number']}-{pr['headRefOid'][:7]}"
    if chave in existentes and esgotada(existentes, chave + "-retomar"):
        diagnostico = f"dev-diagnostico-pr-{n}"
        criar(final, f"Executar decisão final para o PR #{n}, sem repetir diagnóstico", "arquiteto",
              f"O PR #{n} ({pr['url']}, branch {pr['headRefName']}, HEAD {pr['headRefOid']}) "
              f"esgotou os atendimentos de recuperação. Motivo atual: {motivo}. "
              f"Tentativa extra [{diagnostico}]: {existentes.get(diagnostico, 'ainda não utilizada')}. "
              "Leia as evidências já registradas e EXECUTE o destino: se o orçamento Dev foi gasto, "
              "substitua o trabalho por partes menores reais, feche a tarefa e o PR substituídos com links "
              "e deixe a primeira parte pronta para o QA. Não clone a mesma tarefa para renovar tentativas. "
              "Se há outro encaminhamento válido, execute e confira que as regras do sincronizador "
              "permitem continuar. Não implemente a feature, não faça merge vermelho e não reinicie "
              "o orçamento Dev. Comentário ou promessa não conclui este alvo. Sem decisão executável, "
              "kanban_block com motivo e kind=needs_input; o impedimento fica visível e o planejamento "
              "busca trabalho independente. Este atendimento é único por PR, mesmo se o HEAD mudar.",
              prioridade=25, max_runtime="15m", max_retries=1, goal_max_turns=2)
        return
    if chave in existentes:
        chave = rodada(existentes, chave + "-retomar")
        if chave is None:
            return
    if chave:
        diagnostico = f"dev-diagnostico-pr-{pr['number']}"
        if diagnostico in existentes:
            orcamento = (
                f"Orçamento apurado no kanban: [{diagnostico}], status={existentes[diagnostico]}; "
                "tentativa adicional já utilizada. Não adicione pronto-pra-dev no PR: essa etiqueta não libera "
                "outra tentativa. Mesmo um novo commit do QA não reinicia esse orçamento. "
                "Se a tentativa não resolveu, crie tarefas menores com a evidência e feche o PR antigo com o motivo; "
                "não conclua dizendo apenas que o Dev deve fazer merge ou aguardar.")
        else:
            orcamento = (
                f"Orçamento apurado no kanban: [{diagnostico}] ausente; tentativa adicional ainda não utilizada. "
                "Causa no código comprovada e correção específica? Registre a evidência e "
                "adicione pronto-pra-dev NO PR para autorizar uma única tentativa após diagnóstico.")
        criar(chave, f"Destravar PR #{pr['number']}: {pr['title']}", "arquiteto",
              f"O PR {pr['url']} continua aberto: {motivo}. Leia cartões e comentários, ache a causa e "
              "registre a decisão no PR. Não implemente a feature. Se a tarefa precisa ser quebrada, crie "
              "tarefas menores e feche o PR antigo com o motivo; se o teste está errado, encaminhe ao QA "
              "pela etiqueta da issue. " + orcamento + " "
              "Não conclua com comentário sem encaminhamento. Não repita rodadas sem mudar a causa.", prioridade=25)


def revisoes(prs, existentes, esperando_qa=frozenset()):
    """PR em revisão -> um cartão aberto por PR. Encerrar cartão sem decidir não encerra o PR."""
    for pr in prs:
        n, sha = pr["number"], pr["headRefOid"][:7]
        # Issue de volta no QA (teste errado): o Dev recoloca `em-revisão` no PR, mas revisar de novo só repete a devolução
        # (30/09: #49 e #40, ~15 min de revisor cada). O PR volta à fila quando a tarefa voltar a `pronto-pra-dev`.
        no_qa = re.fullmatch(r"dev/(\d+)", pr["headRefName"]) and int(pr["headRefName"][4:]) in esperando_qa
        if any(lb["name"] == "em-revisão" for lb in pr["labels"]) and no_qa:
            continue
        if any(lb["name"] == "em-revisão" for lb in pr["labels"]):
            chave = f"revisar-pr-{n}-{sha}"
            # Commit novo com a revisão anterior ainda na fila: não cria outra, a que está aberta olha o PR como está.
            if not aberto(existentes, f"revisar-pr-{n}-") and preparar_revisao(pr):
                if chave in existentes:
                    chave = rodada(existentes, chave + "-retomar")
                    if chave is None:
                        escalar_pr(pr, existentes, "três retomadas de revisão terminaram sem decisão")
                        continue
                criar(chave, f"Revisar PR #{n}: {pr['title']}", "revisor",
                      f"Revise o PR #{n} ({pr['url']}). O sincronizador já conferiu CI e main. Leia o diff, "
                      "não rode npm/check/testes e não espere CI. Se o HEAD/main mudou, conclua o cartão sem merge: "
                      "o sincronizador atualizará e chamará novamente. Aprovou? Confira checks e faça merge "
                      "com --match-head-commit no SHA revisado.", prioridade=30)
        elif pr["headRefName"].startswith(("dev/", "fix/main-")):
            if aberto(existentes, f"arquiteto-destravar-pr-{n}-"):
                continue  # decisão pendente não ocupa outro Dev para repetir o mesmo diagnóstico
            # Issue de volta no QA (teste errado: o Dev não pode corrigir, o CI barra): o ajuste espera o QA (branch dev/N = issue N).
            if re.fullmatch(r"dev/(\d+)", pr["headRefName"]) and int(pr["headRefName"][4:]) in esperando_qa:
                continue
            # PR do Dev fora de revisão = a revisão pediu mudanças (tirou a etiqueta). Uma rodada por commit, no máximo 3.
            base = f"dev-ajuste-pr-{n}-"
            if sum(k.startswith(base) for k in existentes) < MAX_RODADAS and not aberto(existentes, base):
                chave = base + sha
                if chave in existentes:
                    chave = rodada(existentes, chave + "-retomar")
                criar(chave, f"Ajustar PR #{n} pedido na revisão: {pr['title']}", "dev",
                      f"A revisão pediu mudanças no PR #{n} ({pr['url']}). Leia o último comentário de revisão "
                      f"(`gh pr view {n} --comments`), ajuste no MESMO branch {pr['headRefName']} (conflito com a main: "
                      "`git merge origin/main` e resolva), rode validação LOCAL e o teste afetado, dê push e recoloque a etiqueta (o QA corrigiu o teste? traga com `git merge origin/qa/<issue>`): "
                      f"`gh pr edit {n} --add-label em-revisão`.", prioridade=25)
            elif sum(k.startswith(base) for k in existentes) >= MAX_RODADAS and not aberto(existentes, base):
                # Uma autorização explícita do Arquiteto não reinicia as três tentativas normais.
                diagnostico = f"dev-diagnostico-pr-{n}"
                if diagnostico in existentes and existentes[diagnostico] not in TERMINAIS:
                    continue
                autorizado = any(lb["name"] == "pronto-pra-dev" for lb in pr["labels"])
                decidiu = existentes.get(f"arquiteto-destravar-pr-{n}-{sha}") == "done" or any(
                    k.startswith(f"arquiteto-destravar-pr-{n}-{sha}-retomar-") and st == "done"
                    for k, st in existentes.items())
                if (autorizado and decidiu and diagnostico not in existentes
                        and not aberto(existentes, f"arquiteto-destravar-pr-{n}-")):
                    criar(diagnostico, f"Aplicar diagnóstico no PR #{n}: {pr['title']}", "dev",
                          f"O Arquiteto diagnosticou o PR #{n} ({pr['url']}) e autorizou UMA tentativa adicional. "
                          f"Leia a evidência e ajuste somente a causa no branch {pr['headRefName']}. "
                          "Preserve o teste do QA; teste afetado + check LOCAL, push e em-revisão. "
                          "Não espere CI. Se não resolver, registre o resultado; o Arquiteto deve quebrar a tarefa.",
                          prioridade=25)
                    gh_escrever("pr", "edit", str(n), "-R", REPO, "--remove-label", "pronto-pra-dev")
                else:
                    escalar_pr(pr, existentes, "tentativas esgotadas; encaminhamento após diagnóstico ainda pendente")


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


def issues_com_pr(prs):
    # Issue com PR do DEV aberto que a fecha já está com alguém (29/09: a #38 seguia 'pronto-pra-dev' com o PR #43 em
    # revisão). O rascunho do QA (qa/N) também diz "Closes #N" e NÃO conta: em 30/09 ele escondeu a #49 do dev por 2 h.
    com_pr = {int(n) for pr in prs if not pr["headRefName"].startswith("qa/") for n in FECHA.findall(pr["body"] or "")}
    # #180 perdeu Closes ao editar a descrição: dev/N continua sendo o trabalho da issue N.
    com_pr |= {int(pr["headRefName"][4:]) for pr in prs if re.fullmatch(r"dev/(\d+)", pr["headRefName"])}
    return com_pr


def reserva_pr_ativa(pr, existentes):
    """PR parado no limite não reserva arquivos de outras issues; sua própria issue continua com PR."""
    n = pr["number"]
    base = f"arquiteto-destravar-pr-{n}-"
    if not re.fullmatch(r"dev/(\d+)", pr["headRefName"]):
        return True
    if any(lb["name"] == "em-revisão" for lb in pr["labels"]):
        return True
    if not any(existentes.get(base + fim) == "blocked" for fim in ("final", "esgotado")):
        return True
    if not esgotada(existentes, base + pr["headRefOid"][:7] + "-retomar"):
        return True  # outro HEAD ou rodadas ainda disponíveis não são uma reserva parada confirmada
    prefixos = (base, f"dev-ajuste-pr-{n}-", f"revisar-pr-{n}-")
    if any(st in ("todo", "ready", "running", "review")
           and (k.startswith(prefixos) or k == f"dev-diagnostico-pr-{n}")
           for k, st in existentes.items()):
        return True
    return False


def tarefas(todas, prs, existentes):
    """Issue pronta -> cartão do Dev/QA. Três rodadas sem entrega -> o Arquiteto quebra a tarefa."""
    abertas = {i["number"] for i in todas}
    com_pr = issues_com_pr(prs)
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
            devs_abertos = {int(k.split("-")[2]) for k, st in existentes.items()
                            if k.startswith("dev-issue-") and st in ("ready", "running")}
            ativos = com_pr | devs_abertos
            reservados = issues_com_pr([pr for pr in prs if reserva_pr_ativa(pr, existentes)]) | devs_abertos
            ocupados = set().union(*(arquivos(corpos.get(n)) for n in reservados)) if reservados else set()
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
                      f"Sua tarefa: issue #{n} (https://github.com/{REPO}/issues/{n}).",
                      # Terminar antes de começar: QA de tarefa que já tem PR do dev pronto destrava esse PR (30/09: o #79 esperava
                      # atrás de 3 tarefas novas, com o QA serializado). Passa na frente até de bug.
                      prioridade=prio + (5 if eh_bug else 0) + (15 if papel == "qa" and n in com_pr else 0))
            elif esgotada(existentes, base) and existentes.get(f"arquiteto-quebrar-{n}", "done") in TERMINAIS:
                if aberto(existentes, f"arquiteto-quebrar-{n}-retomar-"):
                    continue
                chave = f"arquiteto-quebrar-{n}"
                if chave in existentes:
                    chave = rodada(existentes, chave + "-retomar")
                    if chave is None:
                        continue
                criar(chave, f"Destravar a tarefa #{n} ({MAX_RODADAS} rodadas sem entrega)", "arquiteto",
                      f"A tarefa #{n} gastou {MAX_RODADAS} rodadas de {papel} sem entregar. Não repita: leia o que cada "
                      "rodada fez (`hermes kanban list`, PRs e comentários) e ache o porquê. Se for tamanho, quebre em "
                      "Tarefas menores (máx. ~3 arquivos cada, `Depende de #N` quando precisar) e etiquete a primeira. "
                      "Se a definição estiver errada, corrija-a. Comente na issue o que decidiu e feche-a se foi toda "
                      "substituída. Comentário sozinho não encaminha tarefa: execute e confira as etiquetas. "
                      "QA já corrigiu o teste e fez push? Remova pronto-pra-teste e adicione pronto-pra-dev. "
                      "PR precisa de ajuste? Registre o motivo nele e remova em-revisão. Não conclua o cartão "
                      "apenas dizendo que outro papel deve agir.", prioridade=15)
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
    bloqueadas = {int(m[2]) for k, st in existentes.items() if st == "blocked"
                  and (m := re.fullmatch(r"(dev|qa)-issue-(\d+)-r[1-3]", k))}
    prontas = [t["number"] for t in corpos_tarefa
               if t["number"] not in bloqueadas and not dependencias(t["body"]) & abertas]
    impedimentos = sorted(k for k, st in existentes.items() if st == "blocked"
                          and (re.fullmatch(r"arquiteto-destravar-pr-\d+-(?:final|esgotado)", k)
                               or re.fullmatch(r"(?:dev|qa)-issue-\d+-r[1-3]", k)))
    # Só origens reais entram no evento; blocked de plano/Designer/atendimento não cria outra busca de busca.
    if len(prontas) < FILA_MINIMA:
        contexto = [tarefas_abertas, itens] + ([impedimentos] if impedimentos else [])
        estado = hashlib.sha1(json.dumps(contexto).encode()).hexdigest()[:8]
        fixos.append((f"arquiteto-plano-{estado}", "Planejar o próximo item do ROADMAP", "arquiteto",
                      "Sua tarefa: passo 3 do seu ciclo: percorra Agora até comprovar trabalho faltante em um item "
                      "SEM tarefa ABERTA. Planeje no máximo um item; sem lacuna comprovada, pare.\n"
                      "A ordem OFICIAL é a publicada na issue #2 (`gh issue view 2`), que o workflow atualiza; o "
                      "ROADMAP.md commitado na main fica velho (em 29/09 ele fez o #4 passar na frente dos bugs 🚨).\n"
                      "Consulte tarefas ABERTAS E FECHADAS (`gh issue list --label tarefa --state all`). Tarefa aberta "
                      "impede planejar aquele item; tarefa fechada exige conferir critérios e PRs entregues, não excluir "
                      "o item por associação. Leia o que já foi entregue e planeje só o que FALTA, sem duplicar "
                      "trabalho concluído. Se aquele item está coberto, siga para o próximo candidato. Não use "
                      "planejamento para retomar tarefa aberta ou reiniciar orçamento de recuperação esgotado.\n"
                      "Tarefa que precisa de outra antes: escreva no corpo uma linha própria `Depende de #N, #M` com os "
                      "NÚMEROS das issues (o sincronizador lê essa linha e só libera a tarefa quando elas fecharem; "
                      "\"rode as anteriores antes\" sem número não é lido)."))
        if impedimentos:
            fixos.append((f"designer-fila-{estado}", "Encontrar trabalho independente para a fila bloqueada", "designer",
                          "A fila está insuficiente e há impedimentos persistentes: "
                          + ", ".join(impedimentos) + ". Encontre UMA oportunidade real independente deles e "
                          "registre um item de roadmap com benefício, critérios, fonte e métrica para o Arquiteto. "
                          "O Arquiteto também confere os itens existentes; não espere ele terminar. Antes de criar, "
                          "confira novamente issues abertas para não duplicar trabalho que outro agente acabou de publicar. "
                          "Leia a ordem oficial e entregas existentes; não duplique feature, não crie trabalho vazio "
                          "nem reabra orçamento gasto. Apenas fechar um item antigo ou prometer outra pesquisa não "
                          "repõe a fila. Use as ferramentas do seu papel, sem assumir Dev/QA. Se faltar condição "
                          "externa necessária, registre-a honestamente: não declare que abasteceu a fábrica."))
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
            if chave.startswith("designer-fila-"):
                criar(chave, titulo, papel, alvo, max_runtime="15m", max_retries=1, goal_max_turns=3)
            elif impedimentos and chave.startswith("arquiteto-plano-"):
                criar(chave, titulo, papel, alvo, max_runtime="15m", max_retries=1, goal_max_turns=2)
            else:
                criar(chave, titulo, papel, alvo)


def main():
    # Transição explícita: o cron continua, mas apenas um despachante fica ativo.
    if os.path.isfile("/opt/data/factory/config.json"):
        subprocess.run([sys.executable, os.path.join(os.path.dirname(__file__), "factory.py"), "tick"],
                       check=True, timeout=90)
        return
    tk = token()
    if not tk:
        return
    os.environ["GH_TOKEN"] = tk
    lista = cartoes()
    prs = json.loads(gh("pr", "list", "-R", REPO, "--state", "open", "--json",
                        "number,title,body,labels,headRefName,headRefOid,url,isDraft,mergeStateStatus,statusCheckRollup", "--limit", "50"))
    if zelar(lista, prs):
        lista = cartoes()  # inclui também a decisão criada antes de fechar o bloqueio
    existentes = chaves(lista)
    dia = dt.datetime.now(BRT).strftime("%Y%m%d")
    main_vermelha(existentes)
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
