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
s.criar = lambda chave, titulo, papel, alvo, prioridade=0: CRIADOS.append((chave, papel, prioridade))
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
s.revisoes([pr(10, "aaaaaaa", "dev/1", ["em-revisão"])], {}); cria("revisar-pr-10-aaaaaaa")
s.revisoes([pr(10, "aaaaaaa", "dev/1", ["em-revisão"])], {"revisar-pr-10-aaaaaaa": "done"}); cria()
s.revisoes([pr(10, "aaaaaaa", "dev/1", ["em-revisão"])], {"revisar-pr-10-bbbbbbb": "ready"}); cria()  # 1 aberto por PR
s.revisoes([pr(10, "aaaaaaa", "dev/1", ["em-revisão"])], {"revisar-pr-10-bbbbbbb": "done"}); cria("revisar-pr-10-aaaaaaa")
s.revisoes([pr(10, "aaaaaaa", "dev/1")], {}); cria("dev-ajuste-pr-10-aaaaaaa")
s.revisoes([pr(10, "aaaaaaa", "fix/main-x")], {}); cria("dev-ajuste-pr-10-aaaaaaa")
s.revisoes([pr(10, "aaaaaaa", "qa/1")], {}); cria()  # PR do QA sem etiqueta não vai pro dev
s.revisoes([pr(10, "aaaaaaa", "dev/1")], {"dev-ajuste-pr-10-bbbbbbb": "ready"}); cria()  # já tem um aberto
s.revisoes([pr(10, "ccccccc", "dev/1")], {f"dev-ajuste-pr-10-{c}": "done" for c in "xyz"}); cria()  # 3 ajustes: acabou
print("revisões/ajustes: ok")

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


def iss(n, corpo="", titulo="t"):
    return {"number": n, "title": titulo, "body": corpo}


ARQ = "1. `packages/sim/src/a.ts`\n"
todas = [{"number": n, "labels": []} for n in (1, 2, 3, 4)]
s.gh = gh_issues(dev=[iss(1, ARQ), iss(2, ARQ), iss(3, "Depende de #4\n"), iss(4)])
s.tarefas(todas, [], {}); cria("dev-issue-1-r1", "dev-issue-4-r1")  # #2 espera o arquivo, #3 espera a #4
s.gh = gh_issues(dev=[iss(1, ARQ)])
s.tarefas(todas, [pr(9, "aaaaaaa", "dev/1", corpo="Closes #1")], {}); cria()  # PR aberto já fecha a #1
s.tarefas(todas, [pr(9, "aaaaaaa", "qa/1", corpo="Closes #1 (rascunho)")], {}); cria("dev-issue-1-r1")  # rascunho do QA não segura o dev
esg = {f"dev-issue-1-r{n}": "done" for n in (1, 2, 3)}
s.tarefas(todas, [], esg); cria("arquiteto-quebrar-1")
assert any(a[:2] == ("issue", "comment") for a in ESCRITOS), "tem que comentar na issue (rastro)"; ESCRITOS.clear()
s.tarefas(todas, [], {**esg, "arquiteto-quebrar-1": "done"}); cria()  # só uma vez
s.tarefas(todas, [], {**esg, "dev-issue-1-r3": "running"}); cria()  # rodada aberta: não quebra ainda
s.gh = gh_issues(qa=[iss(1)])
s.tarefas(todas, [], {f"qa-issue-1-r{n}": "archived" for n in (1, 2, 3)}); cria("arquiteto-quebrar-1")  # arquivado também gasta rodada
s.gh = real_gh; ESCRITOS.clear()
print("tarefas: ok")

# ---- diários / planejamento -------------------------------------------------------------------------------------
sem_fila = [{"number": 1, "labels": [{"name": "roadmap"}]}]
s.diarios(sem_fila, {}, "20260930")
assert [c[0][:15] for c in CRIADOS] == ["arquiteto-plano", "designer-202609", "qa-caca-2026093"], CRIADOS; CRIADOS.clear()
cheia = [{"number": n, "labels": [{"name": "tarefa"}, {"name": "pronto-pra-teste"}]} for n in (1, 2, 3)]
s.diarios(cheia, {}, "20260930"); cria("designer-20260930")  # fila cheia: não planeja; QA com fila: não caça
print("diários: ok")

# ---- PR do QA de tarefa entregue --------------------------------------------------------------------------------
ESCRITOS.clear()
s.fechar_prs_qa([pr(5, "a", "qa/5"), pr(6, "b", "qa/6"), pr(7, "c", "qa/bug-41"), pr(8, "d", "dev/5")], {6})
assert [a[2] for a in ESCRITOS if a[0] == "pr"] == ["5"], ESCRITOS; ESCRITOS.clear()
print("PR do QA: ok")

# ---- zelador ----------------------------------------------------------------------------------------------------
CHAMADAS = []


def fake_run(args, **k):
    CHAMADAS.append(args[1:3] if args[0] == s.HERMES else args)
    if args[2:3] == ["show"] or (len(args) > 2 and args[2] == "show"):
        ev = [{"kind": "created", "payload": {}}, {"kind": "blocked", "payload": {"reason": "sem acesso ao repo X"}}]
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
s.subprocess.run = real_run
print("zelador: ok")

# ---- fumaça com o mundo real (só leitura) -----------------------------------------------------------------------
if "--sem-rede" not in sys.argv:
    tk = s.token()
    if tk:
        s.os.environ["GH_TOKEN"] = tk
        s.zelar = lambda lista: 0  # nunca fecha cartão de verdade no teste
        s.main()
        print("fumaça com GitHub e kanban reais: ok; criaria:", [c[0] for c in CRIADOS])
    else:
        print("fumaça: sem GH_TOKEN aqui, pulada")
print("TESTE OK")
