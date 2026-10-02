"""Gabarito do sincronizador. Uso: python3 testar_sinc.py [caminho do sincronizar_github.py]

Parte 1: cenários com dados falsos (sem rede, sem kanban). Parte 2: fumaça com o GitHub e o kanban REAIS, só leitura
(toda escrita é simulada). Publicar só se imprimir `TESTE OK`.
"""
import importlib.util
import json
import sys
import types

CAMINHO = sys.argv[1] if len(sys.argv) > 1 else "/opt/data/scripts/sincronizar_github.py"
spec = importlib.util.spec_from_file_location("s", CAMINHO)
s = importlib.util.module_from_spec(spec)
spec.loader.exec_module(s)

CRIADOS, ESCRITOS = [], []
ALVOS = {}
LIMITES = {}


def criar_simulado(chave, titulo, papel, alvo, prioridade=0, **limites):
    CRIADOS.append((chave, papel, prioridade))
    ALVOS[chave] = alvo
    LIMITES[chave] = limites


s.criar = criar_simulado
s.gh_escrever = lambda *a, texto=None: ESCRITOS.append(a) or True


def cria(*chaves_esperadas):
    obtidas = [c[0] for c in CRIADOS]
    assert obtidas == list(chaves_esperadas), f"esperava {list(chaves_esperadas)}, criou {obtidas}"
    CRIADOS.clear()


def card(chave, status, cid="t_x"):
    return {"id": cid, "title": f"[{chave}] x", "status": status}


def pr(n, sha, ramo, etiquetas=(), corpo=""):
    return {"number": n, "title": "t", "body": corpo, "headRefName": ramo, "headRefOid": sha + "0" * (40 - len(sha)),
            "url": f"u{n}", "labels": [{"name": e} for e in etiquetas]}


# ---- chaves / rodadas -------------------------------------------------------------------------------------------
assert s.chaves([card("A", "archived"), card("B", "done")]) == {"A": "archived", "B": "done"}, "arquivado tem que contar"
assert s.chaves([card("A", "archived"), card("A", "ready")]) == {"A": "ready"}, "chave repetida: vale o aberto"
assert s.chaves([card("A", "ready"), card("A", "archived")]) == {"A": "ready"}, "chave repetida (outra ordem)"
assert s.rodada({}, "dev-issue-1") == "dev-issue-1-r1"
assert s.rodada({"dev-issue-1-r1": "archived"}, "dev-issue-1") == "dev-issue-1-r2", "arquivada = rodada gasta"
assert s.rodada({"dev-issue-1-r1": "running"}, "dev-issue-1") is None
assert s.rodada({f"b-r{n}": "done" for n in (1, 2, 3)}, "b") is None
assert s.esgotada({f"b-r{n}": "done" for n in (1, 2, 3)}, "b")
assert not s.esgotada({"b-r1": "done", "b-r2": "done"}, "b")
assert not s.esgotada({"b-r1": "done", "b-r2": "done", "b-r3": "running"}, "b")
assert s.aberto({"revisar-pr-5-aaa": "ready"}, "revisar-pr-5-") and not s.aberto({"revisar-pr-5-aaa": "done"}, "revisar-pr-5-")
print("chaves/rodadas: ok")

# ---- revisões e ajustes -----------------------------------------------------------------------------------------
real_preparar = s.preparar_revisao
s.preparar_revisao = lambda pr: True  # roteamento puro; o gate real é verificado abaixo
s.revisoes([pr(10, "aaaaaaa", "dev/1", ["em-revisão"])], {}); cria("revisar-pr-10-aaaaaaa")
s.revisoes([pr(10, "aaaaaaa", "dev/1", ["em-revisão"])], {"revisar-pr-10-aaaaaaa": "done"}); cria("revisar-pr-10-aaaaaaa-retomar-r1")
_retomadas = {"revisar-pr-10-aaaaaaa": "done", **{f"revisar-pr-10-aaaaaaa-retomar-r{n}": "done" for n in (1, 2, 3)}}
s.revisoes([pr(10, "aaaaaaa", "dev/1", ["em-revisão"])], _retomadas); cria("arquiteto-destravar-pr-10-aaaaaaa")
s.revisoes([pr(10, "aaaaaaa", "dev/1", ["em-revisão"])], {**_retomadas, "arquiteto-destravar-pr-10-aaaaaaa": "done"}); cria("arquiteto-destravar-pr-10-aaaaaaa-retomar-r1")
s.revisoes([pr(10, "aaaaaaa", "dev/1", ["em-revisão"])], {"revisar-pr-10-bbbbbbb": "ready"}); cria()  # 1 aberto por PR
s.revisoes([pr(10, "aaaaaaa", "dev/1", ["em-revisão"])], {"revisar-pr-10-bbbbbbb": "done"}); cria("revisar-pr-10-aaaaaaa")
s.revisoes([pr(10, "aaaaaaa", "dev/1")], {}); cria("dev-ajuste-pr-10-aaaaaaa")
s.revisoes([pr(10, "aaaaaaa", "fix/main-x")], {}); cria("dev-ajuste-pr-10-aaaaaaa")
s.revisoes([pr(10, "aaaaaaa", "qa/1")], {}); cria()  # PR do QA sem etiqueta não vai pro dev
s.revisoes([pr(10, "aaaaaaa", "dev/1")], {"dev-ajuste-pr-10-bbbbbbb": "ready"}); cria()  # já tem um aberto
s.revisoes([pr(10, "ccccccc", "dev/1")], {f"dev-ajuste-pr-10-{c}": "done" for c in "xyz"}); cria("arquiteto-destravar-pr-10-ccccccc")
_ajustes = {f"dev-ajuste-pr-10-{c}": "done" for c in "xyz"}
s.revisoes([pr(10, "ccccccc", "dev/1")], {**_ajustes, "arquiteto-destravar-pr-10-bbbbbbb": "running"}); cria()
s.revisoes([pr(10, "ccccccc", "dev/1")], {**_ajustes, "arquiteto-destravar-pr-10-bbbbbbb": "ready"}); cria()
s.revisoes([pr(10, "ccccccc", "dev/1")], {**_ajustes, "arquiteto-destravar-pr-100-bbbbbbb": "running"}); cria("arquiteto-destravar-pr-10-ccccccc")
s.revisoes([pr(10, "aaaaaaa", "dev/1")], {"dev-ajuste-pr-10-aaaaaaa": "done"}); cria("dev-ajuste-pr-10-aaaaaaa-retomar-r1")
for _status in ("ready", "running"):
    s.revisoes([pr(10, "aaaaaaa", "dev/1")], {"dev-ajuste-pr-10-aaaaaaa": "done",
                "arquiteto-destravar-pr-10-aaaaaaa": _status}); cria()
s.revisoes([pr(10, "aaaaaaa", "dev/1")], {"dev-ajuste-pr-10-aaaaaaa": "done",
            "arquiteto-destravar-pr-10-aaaaaaa": "done"}); cria("dev-ajuste-pr-10-aaaaaaa-retomar-r1")
s.revisoes([pr(10, "aaaaaaa", "dev/10", ["em-revisão"])], {}, {10}); cria()  # em revisão, mas a issue espera o QA: sem revisão repetida
s.revisoes([pr(10, "aaaaaaa", "dev/10", ["em-revisão"])], {}, {11}); cria("revisar-pr-10-aaaaaaa")  # outra issue esperando: revisa normal
s.revisoes([pr(10, "aaaaaaa", "dev/10")], {}, {10}); cria()  # issue 10 esperando o QA corrigir o teste: sem ajuste do dev
s.revisoes([pr(10, "aaaaaaa", "dev/10")], {}, {11}); cria("dev-ajuste-pr-10-aaaaaaa")  # outra issue esperando: não afeta

# Diagnóstico não reinicia orçamento: autorização explícita + decisão do SHA atual, uma tentativa por PR.
_decisao = {**_ajustes, "arquiteto-destravar-pr-10-ccccccc": "done"}
_pdiag = pr(10, "ccccccc", "dev/10", ["pronto-pra-dev"])
s.revisoes([_pdiag], _ajustes); cria("arquiteto-destravar-pr-10-ccccccc")  # etiqueta sozinha não basta
s.revisoes([pr(10, "ccccccc", "dev/10")], _decisao); cria("arquiteto-destravar-pr-10-ccccccc-retomar-r1")
s.revisoes([_pdiag], _decisao); cria("dev-diagnostico-pr-10")
assert any(a[:3] == ("pr", "edit", "10") and "pronto-pra-dev" in a for a in ESCRITOS)
ESCRITOS.clear()
s.revisoes([_pdiag], {**_decisao, "arquiteto-destravar-pr-10-ccccccc-retomar-r1": "running"}); cria()
s.revisoes([_pdiag], {**_decisao, "dev-diagnostico-pr-10": "running"}); cria()
for _fim in s.TERMINAIS:
    s.revisoes([_pdiag], {**_decisao, "dev-diagnostico-pr-10": _fim}); cria("arquiteto-destravar-pr-10-ccccccc-retomar-r1")
s.revisoes([_pdiag], _decisao, {10}); cria()  # nunca contorna retorno ao QA
s.revisoes([pr(10, "ddddddd", "dev/10", ["pronto-pra-dev"])], _decisao); cria("arquiteto-destravar-pr-10-ddddddd")
s.revisoes([_pdiag], {**_decisao, "dev-diagnostico-pr-10": "done",
                     **{f"arquiteto-destravar-pr-10-ccccccc-retomar-r{n}": "done" for n in (1, 2, 3)}})
cria("arquiteto-destravar-pr-10-final")
assert LIMITES["arquiteto-destravar-pr-10-final"] == {
    "max_runtime": "15m", "max_retries": 1, "goal_max_turns": 2}
assert "Não clone a mesma tarefa" in ALVOS["arquiteto-destravar-pr-10-final"]
for _st in ("ready", "running", "blocked"):
    s.revisoes([_pdiag], {**_decisao, "dev-diagnostico-pr-10": "done",
                         "arquiteto-destravar-pr-10-final": _st}); cria()
_final = {**_decisao, "dev-diagnostico-pr-10": "done", "arquiteto-destravar-pr-10-final": "done"}
s.revisoes([_pdiag], _final); cria("arquiteto-destravar-pr-10-esgotado")
assert LIMITES["arquiteto-destravar-pr-10-esgotado"] == {"bloqueado": True}
for _sha in ("ccccccc", "eeeeeee"):
    s.revisoes([pr(10, _sha, "dev/10", ["pronto-pra-dev"])], {
        **_final, "arquiteto-destravar-pr-10-esgotado": "blocked"}); cria()
print("revisões/ajustes: ok")
s.preparar_revisao = real_preparar

# O Arquiteto deve receber o orçamento real, não decidir por um comentário antigo do PR.
s.escalar_pr(_pdiag, _decisao, "sem encaminhamento"); cria("arquiteto-destravar-pr-10-ccccccc-retomar-r1")
_alvo = ALVOS["arquiteto-destravar-pr-10-ccccccc-retomar-r1"]
assert "dev-diagnostico-pr-10" in _alvo and "ainda não utilizada" in _alvo
for _fim in s.TERMINAIS:
    s.escalar_pr(_pdiag, {**_decisao, "dev-diagnostico-pr-10": _fim}, "sem encaminhamento")
    cria("arquiteto-destravar-pr-10-ccccccc-retomar-r1")
    _alvo = ALVOS["arquiteto-destravar-pr-10-ccccccc-retomar-r1"]
    assert f"[dev-diagnostico-pr-10], status={_fim}" in _alvo
    assert "já utilizada" in _alvo and "Não adicione pronto-pra-dev" in _alvo
    assert "adicione pronto-pra-dev NO PR para autorizar" not in _alvo
print("orçamento no diagnóstico: ok")

# CI ausente, parcial, vermelho ou branch atrasada nunca gasta uma vaga de revisão.
_p = pr(10, "aaaaaaa", "dev/1", ["em-revisão"])
assert s.estado_ci(_p) == "aguardando"
_p["statusCheckRollup"] = [{"name": n, "status": "COMPLETED", "conclusion": "SUCCESS"}
                         for n in s.CHECKS_CI | {"testes de aceitação protegidos"}]
assert s.estado_ci(_p) == "verde"
_p["statusCheckRollup"][0]["conclusion"] = "FAILURE"
assert s.estado_ci(_p) == "falhou"
_p["statusCheckRollup"][0]["conclusion"] = "SKIPPED"
assert s.estado_ci(_p) == "aguardando"
_p["statusCheckRollup"][0]["conclusion"] = "SUCCESS"
_gh_gate = s.gh
s.gh = lambda *a: "0"
assert s.preparar_revisao(_p)
_p["statusCheckRollup"][0]["conclusion"] = "FAILURE"
s.revisoes([_p], {"revisar-pr-10-aaaaaaa": "done"}); cria()
assert any(a[:2] == ("pr", "edit") for a in ESCRITOS), "CI vermelho precisa voltar ao Dev mesmo após cartão concluído"
ESCRITOS.clear()
_p["statusCheckRollup"][0]["conclusion"] = "SUCCESS"
_p["mergeStateStatus"] = "UNKNOWN"
assert not s.preparar_revisao(_p)
_p["mergeStateStatus"] = "DIRTY"
assert not s.preparar_revisao(_p)
assert any(a[:2] == ("pr", "comment") for a in ESCRITOS)
assert any(a[:2] == ("pr", "edit") for a in ESCRITOS)
ESCRITOS.clear()
_p["mergeStateStatus"] = "CLEAN"
s.gh = lambda *a: "1"
assert not s.preparar_revisao(_p)
assert ESCRITOS[0][0] == "api" and "update-branch" in ESCRITOS[0][1]
assert any("expected_head_sha=" in a for a in ESCRITOS[0])
s.gh = _gh_gate
ESCRITOS.clear()
print("gate de CI/main: ok")

# ---- main vermelha ----------------------------------------------------------------------------------------------
SHA = "1234567" + "0" * 33


def gh_main(conclusoes):
    def _gh(*a):
        if a[-1].endswith("commits/main"):
            return json.dumps({"sha": SHA})
        return json.dumps({"check_runs": [{"name": n, "conclusion": c, "html_url": "http://x"} for n, c in conclusoes.items()]})
    return _gh


real_gh = s.gh
s.gh = gh_main({"npm run check": "success", "teste de tela (Playwright)": "failure"})
s.main_vermelha({}); cria("main-vermelha-1234567-r1")
s.main_vermelha({"main-vermelha-abcdef0-r1": "ready"}); cria()  # já há conserto em andamento (de outro commit)
s.main_vermelha({"main-vermelha-1234567-r1": "done"}); cria("main-vermelha-1234567-r2")  # concluiu e segue vermelha
s.main_vermelha({f"main-vermelha-1234567-r{n}": "done" for n in (1, 2, 3)}); cria()  # 3 tentativas: para
s.gh = gh_main({"npm run check": "success", "testes de aceitação protegidos": "failure"}); s.main_vermelha({}); cria()  # protegido não conta
s.gh = gh_main({"npm run check": "success", "teste de tela (Playwright)": None}); s.main_vermelha({}); cria()  # ainda rodando
s.gh = real_gh
print("main vermelha: ok")


# ---- tarefas: rodadas, dependências, mesmo arquivo, esgotada -----------------------------------------------------
def gh_issues(dev=(), qa=()):
    def _gh(*a):
        return json.dumps(list(dev) if "pronto-pra-dev" in a else list(qa))
    return _gh


def iss(n, corpo="", titulo="t", etiquetas=("tarefa",)):
    return {"number": n, "title": titulo, "body": corpo, "labels": [{"name": e} for e in etiquetas]}


ARQ = "1. `packages/sim/src/a.ts`\n"
todas = [{"number": n, "labels": []} for n in (1, 2, 3, 4)]
s.gh = gh_issues(dev=[iss(1, ARQ), iss(2, ARQ), iss(3, "Depende de #4\n"), iss(4)])
s.tarefas(todas, [], {}); cria("dev-issue-1-r1", "dev-issue-4-r1")  # #2 espera o arquivo, #3 espera a #4
s.gh = gh_issues(dev=[iss(1, ARQ)])
s.tarefas(todas, [pr(9, "aaaaaaa", "dev/1", corpo="Closes #1")], {}); cria()  # PR aberto já fecha a #1
s.tarefas(todas, [pr(9, "aaaaaaa", "dev/1", corpo="Descrição atualizada sem fechamento")], {"dev-issue-1-r1": "done"}); cria()  # #180 perdeu Closes ao editar: ajuste do PR, não outra tarefa
s.tarefas(todas, [pr(9, "aaaaaaa", "dev/1-extra", corpo="")], {}); cria("dev-issue-1-r1")  # nome parecido não reserva a issue
s.tarefas(todas, [pr(9, "aaaaaaa", "qa/1", corpo="Closes #1 (rascunho)")], {}); cria("dev-issue-1-r1")  # rascunho do QA não segura o dev
esg = {f"dev-issue-1-r{n}": "done" for n in (1, 2, 3)}
s.tarefas(todas, [], esg); cria("arquiteto-quebrar-1")
assert any(a[:2] == ("issue", "comment") for a in ESCRITOS), "tem que comentar na issue (rastro)"; ESCRITOS.clear()
s.tarefas(todas, [], {**esg, "arquiteto-quebrar-1": "done"}); cria("arquiteto-quebrar-1-retomar-r1")
s.tarefas(todas, [], {**esg, "arquiteto-quebrar-1": "running"}); cria()
s.tarefas(todas, [], {**esg, "arquiteto-quebrar-1": "done", "arquiteto-quebrar-1-retomar-r1": "ready"}); cria()
s.tarefas(todas, [], {**esg, "arquiteto-quebrar-1": "done", **{f"arquiteto-quebrar-1-retomar-r{n}": "done" for n in (1, 2, 3)}}); cria()
s.tarefas(todas, [], {**esg, "dev-issue-1-r3": "running"}); cria()  # rodada aberta: não quebra ainda
s.gh = gh_issues(dev=[iss(30, etiquetas=("roadmap", "pronto-pra-dev"))])
s.tarefas(todas, [], {}); cria()  # item do roadmap com a etiqueta errada: nunca vira cartão
s.gh = gh_issues(qa=[iss(1), iss(2)])
s.tarefas(todas, [pr(9, "aaaaaaa", "dev/2", corpo="Closes #2")], {})
assert [(c[0], c[2]) for c in CRIADOS] == [("qa-issue-1-r1", 10), ("qa-issue-2-r1", 25)], CRIADOS; CRIADOS.clear()  # QA que destrava PR pronto passa na frente
s.tarefas(todas, [pr(9, "aaaaaaa", "dev/2", corpo="")], {})
assert [(c[0], c[2]) for c in CRIADOS] == [("qa-issue-1-r1", 10), ("qa-issue-2-r1", 25)], CRIADOS; CRIADOS.clear()  # branch conserva prioridade mesmo sem Closes
s.gh = gh_issues(qa=[iss(1)])
s.tarefas(todas, [], {f"qa-issue-1-r{n}": "archived" for n in (1, 2, 3)}); cria("arquiteto-quebrar-1")  # arquivado também gasta rodada
s.gh = real_gh; ESCRITOS.clear()
print("tarefas: ok")

# ---- diários / planejamento -------------------------------------------------------------------------------------
sem_fila = [{"number": 1, "labels": [{"name": "roadmap"}]}]
s.diarios(sem_fila, {}, "20260930", [])
assert LIMITES[CRIADOS[0][0]] == {}, "planejamento sem impedimento conserva os limites anteriores"
assert [c[0][:15] for c in CRIADOS] == ["arquiteto-plano", "designer-202609", "qa-caca-2026093"], CRIADOS; CRIADOS.clear()
cheia = [{"number": n, "labels": [{"name": "tarefa"}, {"name": "pronto-pra-teste"}]} for n in (1, 2, 3)]
livres = [{"number": n, "body": ""} for n in (1, 2, 3)]
s.diarios(cheia, {}, "20260930", livres); cria("designer-20260930")  # fila cheia: não planeja; QA com fila: não caça
presas = [{"number": 1, "body": ""}, {"number": 2, "body": "Depende de #1"}, {"number": 3, "body": "Depende de #1, #2"}]
s.diarios(cheia, {}, "20260930", presas)  # 3 abertas, mas só 1 pode começar: planeja outro item
assert [c[0][:15] for c in CRIADOS] == ["arquiteto-plano", "designer-202609"], CRIADOS; CRIADOS.clear()
_bloqueios = {"arquiteto-destravar-pr-10-final": "blocked", "designer-20260930": "done",
              "qa-caca-20260930": "done"}
s.diarios(sem_fila, _bloqueios, "20260930", [])
assert len(CRIADOS) == 2 and CRIADOS[0][0].startswith("arquiteto-plano-"), CRIADOS
_plano = CRIADOS[0][0]; CRIADOS.clear()
assert LIMITES[_plano] == {"max_runtime": "15m", "max_retries": 1, "goal_max_turns": 2}
_reposicao = _plano.replace("arquiteto-plano-", "designer-fila-")
assert LIMITES[_reposicao] == {"max_runtime": "15m", "max_retries": 1, "goal_max_turns": 3}
for _st in ("ready", "running", "blocked", "done", "archived"):
    s.diarios(sem_fila, {**_bloqueios, _plano: _st}, "20260930", []); cria(_reposicao)
for _st in ("ready", "running", "blocked", "done", "archived"):
    s.diarios(sem_fila, {**_bloqueios, _plano: "done", _reposicao: _st}, "20260930", []); cria()
s.diarios(cheia, _bloqueios, "20260930", livres); cria()  # fila reposta: não chama reposição
print("diários: ok")

# ---- PR do QA de tarefa entregue --------------------------------------------------------------------------------
ESCRITOS.clear()
s.fechar_prs_qa([pr(5, "a", "qa/5"), pr(6, "b", "qa/6"), pr(7, "c", "qa/bug-41"), pr(8, "d", "dev/5")], {6})
assert [a[2] for a in ESCRITOS if a[0] == "pr"] == ["5"], ESCRITOS; ESCRITOS.clear()
print("PR do QA: ok")

# ---- tarefa entregue que o GitHub não fechou -----------------------------------------------------------------------
import datetime as _dt
_agora = _dt.datetime(2026, 9, 30, 12, 0, tzinfo=_dt.timezone.utc)
_mesclado = lambda ramo, horas: {"number": 68, "headRefName": ramo, "mergedAt": (_agora - _dt.timedelta(hours=horas)).isoformat()}
_todas = [{"number": 5, "labels": [{"name": "tarefa"}]}, {"number": 7, "labels": [{"name": "roadmap"}]}]
ESCRITOS.clear()
assert s.fechar_tarefas_entregues([_mesclado("dev/5", 1)], _todas, _agora) == {5} and ESCRITOS[0][:3] == ("issue", "close", "5")
ESCRITOS.clear()
assert s.fechar_tarefas_entregues([_mesclado("dev/5", 60)], _todas, _agora) == set(), "PR antigo: não reabre decisão"
assert s.fechar_tarefas_entregues([_mesclado("dev/9", 1)], _todas, _agora) == set(), "tarefa já fechada"
assert s.fechar_tarefas_entregues([_mesclado("qa/5", 1)], _todas, _agora) == set(), "PR do QA não entrega"
assert s.fechar_tarefas_entregues([_mesclado("dev/7", 1)], _todas, _agora) == set(), "issue que não é tarefa"
assert not ESCRITOS[1:], ESCRITOS
print("tarefa entregue: ok")

# ---- zelador ----------------------------------------------------------------------------------------------------
CHAMADAS = []
BLOQUEIO = {"reason": "sem acesso ao repo X"}


def fake_run(args, **k):
    CHAMADAS.append(args[1:3] if args[0] == s.HERMES else args)
    if args[2:3] == ["show"] or (len(args) > 2 and args[2] == "show"):
        ev = [{"kind": "created", "payload": {}}, {"kind": "blocked", "payload": BLOQUEIO}]
        return types.SimpleNamespace(returncode=0, stdout=json.dumps({"events": ev}), stderr="")
    if args[2] == "complete":
        CHAMADAS.append(("resumo", args[args.index("--summary") + 1]))
        return types.SimpleNamespace(returncode=FALHA_COMPLETE, stdout="", stderr="cannot complete" if FALHA_COMPLETE else "")
    return types.SimpleNamespace(returncode=0, stdout="", stderr="")


real_run = s.subprocess.run
s.subprocess.run = fake_run
FALHA_COMPLETE = 0
assert s.zelar([card("A", "blocked", "t_1"), card("B", "ready", "t_2")]) == 1
resumo = next(c[1] for c in CHAMADAS if c[0] == "resumo")
assert "sem acesso ao repo X" in resumo, "o motivo do bloqueio tem que ir pro resumo do cartão"
assert not any(c[:2] == ["kanban", "archive"] for c in CHAMADAS)
CHAMADAS.clear(); FALHA_COMPLETE = 1
assert s.zelar([card("A", "blocked", "t_1")]) == 1
assert ["kanban", "archive"] in [list(c) if isinstance(c, (list, tuple)) else c for c in CHAMADAS], "recusou o complete: arquiva"
CHAMADAS.clear(); FALHA_COMPLETE = 0
BLOQUEIO = {"reason": "decisão sobre teste protegido; evidência no PR", "kind": "needs_input"}
_bloqueado = {**card("dev-ajuste-pr-208-3cc5697", "blocked", "t_decisao"), "assignee": "dev"}
_pr_bloqueado = pr(208, "3cc5697", "dev/203")
assert s.zelar([_bloqueado, {**_bloqueado, "id": "t_repetido"}], [_pr_bloqueado]) == 2
cria("arquiteto-destravar-pr-208-3cc5697")
assert "t_decisao" in ALVOS["arquiteto-destravar-pr-208-3cc5697"]
assert BLOQUEIO["reason"] in ALVOS["arquiteto-destravar-pr-208-3cc5697"]
_arq = card("arquiteto-destravar-pr-208-3cc5697", "running", "t_arq")
assert s.zelar([_bloqueado, _arq], [_pr_bloqueado]) == 1
cria()  # decisão já aberta: não duplica nem reinicia orçamento
_esgotados = [card("arquiteto-destravar-pr-208-3cc5697" + _sufixo, "done", "t_gasto")
              for _sufixo in ("", "-retomar-r1", "-retomar-r2", "-retomar-r3")]
assert s.zelar([_bloqueado, *_esgotados], [_pr_bloqueado]) == 1
cria("arquiteto-destravar-pr-208-final")  # decisão final limitada, sem reiniciar Dev
CHAMADAS.clear()
_persistentes = [card("arquiteto-destravar-pr-208-final", "blocked", "t_final"),
                card("arquiteto-destravar-pr-208-esgotado", "blocked", "t_limite"),
                card("arquiteto-plano-evento", "blocked", "t_plano"),
                card("designer-fila-evento", "blocked", "t_ideia")]
assert s.zelar(_persistentes, [_pr_bloqueado]) == 0
assert not CHAMADAS, "impedimento persistente não pode ser fechado pelo zelador"
cria()
for _cards, _prs in [([_bloqueado], []), ([_bloqueado], [pr(208, "bbbbbbb", "dev/203")]),
                      ([{**_bloqueado, "assignee": "qa"}], [_pr_bloqueado]),
                      ([{**_bloqueado, "status": "ready"}], [_pr_bloqueado]),
                      ([{**_bloqueado, "title": "[dev-issue-203-r1] x"}], [_pr_bloqueado])]:
    s.zelar(_cards, _prs); cria()
for _kind in ("error", None):
    BLOQUEIO = {"reason": "erro sem pedido de decisão", "kind": _kind}
    s.zelar([_bloqueado], [_pr_bloqueado]); cria()
BLOQUEIO = {"reason": "decisão necessária", "kind": "needs_input"}
CHAMADAS.clear()
real_criar = s.criar
def falha_criar(*args, **kwargs):
    raise RuntimeError("kanban indisponível")
s.criar = falha_criar
try:
    s.zelar([_bloqueado], [_pr_bloqueado])
except RuntimeError:
    pass
else:
    raise AssertionError("falha de encaminhamento precisa preservar bloqueio")
assert not any(c[:2] == ["kanban", "complete"] for c in CHAMADAS)
assert not any(c[:2] == ["kanban", "archive"] for c in CHAMADAS)
s.criar = real_criar
s.subprocess.run = real_run
print("zelador: ok")

# ---- fumaça com o mundo real (só leitura) -----------------------------------------------------------------------
if "--sem-rede" not in sys.argv:
    tk = s.token()
    if tk:
        s.os.environ["GH_TOKEN"] = tk
        s.zelar = lambda lista, prs=(): 0  # nunca fecha cartão de verdade no teste
        s.main()
        print("fumaça com GitHub e kanban reais: ok; criaria:", [c[0] for c in CRIADOS])
    else:
        print("fumaça: sem GH_TOKEN aqui, pulada")
print("TESTE OK")
