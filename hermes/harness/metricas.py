"""Métricas do experimento Hermes + kanban + LLM grátis no CityBuilder. Sem LLM, só leitura.

Uso (no container): python3 metricas.py [--json saida.json]
Fontes: /opt/data/kanban.db (cartões e execuções), state.db de cada perfil (tokens e tempo do
modelo), GitHub via gh (issues Tarefa e PRs). Nada é escrito fora do --json.
"""

import collections
import datetime as dt
import glob
import json

import re
import sqlite3
import statistics as st
import subprocess
import sys

REPO = "Marlohn/CityBuilder"
GH = "/opt/data/.local/bin/gh"
INICIO = dt.datetime(2026, 9, 29, 18, 30, tzinfo=dt.timezone.utc).timestamp()  # 1º cartão real
TIPO = re.compile(r"^\[(qa-issue|dev-issue|dev-ajuste-pr|revisar-pr|arquiteto-plano|designer|qa-caca)")


def gh(*a):
    return json.loads(subprocess.run([GH, *a], capture_output=True, text=True, check=True).stdout or "[]")


def iso(s):
    return dt.datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp() if s else None


def med(xs):
    xs = [x for x in xs if x is not None]
    return round(st.median(xs), 1) if xs else None


def horas(seg):
    return round(seg / 3600, 2)


CACHE = "/opt/data/avaliacao/jev-cache.json"
MOTIVOS = {
    "desempenho": "regressão de performance, teste lento, orçamento de busca estourado",
    "conflito": "conflito de merge com a main, branch desatualizado",
    "ci_no_pr": "o PR de tarefa mexe em arquivos de CI (.github/workflows)",
    "teste": "teste de aceitação falhando ou alterado",
    "escopo": "mexeu em arquivos fora da tarefa ou fez mais do que pedido",
    "regra": "violou regra do projeto (fonte, config, Math.random, camadas)",
}


def motivos_reprovacao(numeros):
    """Conta revisões aprovadas/reprovadas e o motivo, lendo os comentários de revisão com o jev.

    Gabarito em 30/set: 9 de 9 certas (4 motivos + 5 aprova/reprova) nas revisões dos PRs #43/#46/#52/#54.
    Cache por id de comentário: cada comentário é classificado uma vez só.
    """
    import urllib.request
    try:
        cache = json.load(open(CACHE))
    except (OSError, ValueError):
        cache = {}
    perguntas = {"aprovou": {"type": "noul", "instructions": "Esta revisão APROVA o PR (pode fazer merge)?"},
                 "motivo": {"type": "choice", "criteria": MOTIVOS,
                            "instructions": "Se reprova, qual é o MOTIVO PRINCIPAL?"}}
    cont = collections.Counter()
    for n in numeros:
        for c in gh("api", f"repos/{REPO}/issues/{n}/comments", "--paginate"):
            b = c["body"]
            if not re.search(r"(?i)revis[aã]o|aprovad|reprovad", b[:400]):
                continue
            k = str(c["id"])
            if k not in cache:
                req = urllib.request.Request("https://opencode.ai/zen/v1/systemone", method="POST",
                    data=json.dumps({"model": "jev-1.13-free", "state": b[:6000], "questions": perguntas}).encode(),
                    headers={"Authorization": "Bearer public", "Content-Type": "application/json",
                             "User-Agent": "citybuilder-metricas/1.0"})
                try:
                    a = json.load(urllib.request.urlopen(req, timeout=30))["answers"]
                except Exception:
                    continue
                cache[k] = {"aprovou": a["aprovou"]["noul"] >= 0.5, "motivo": a["motivo"]["choice"]}
            v = cache[k]
            cont["aprovadas" if v["aprovou"] else "reprovadas:" + v["motivo"]] += 1
    json.dump(cache, open(CACHE, "w"))
    return dict(cont)


def main():
    agora = dt.datetime.now(dt.timezone.utc).timestamp()
    k = sqlite3.connect("/opt/data/kanban.db")
    tarefas = {r[0]: r for r in k.execute(
        "select id,title,status,created_at,started_at,completed_at,assignee from tasks where created_at>=?", (INICIO,))}
    runs = [r for r in k.execute(
        "select task_id,profile,started_at,ended_at,outcome from task_runs where started_at>=?", (INICIO,))
        if r[0] in tarefas]

    # --- cartões e execuções -------------------------------------------------------------
    por_tipo = collections.defaultdict(lambda: {"cartoes": 0, "execucoes": 0, "min": [], "fila_min": [],
                                                 "desfechos": collections.Counter()})
    for tid, title, status, criado, ini, fim, _ in tarefas.values():
        m = TIPO.match(title or "")
        if not m:
            continue
        t = por_tipo[m.group(1)]
        t["cartoes"] += 1
        if ini:
            t["fila_min"].append((ini - criado) / 60)
    for tid, prof, ini, fim, outcome in runs:
        m = TIPO.match(tarefas[tid][1] or "")
        if not m:
            continue
        t = por_tipo[m.group(1)]
        t["execucoes"] += 1
        t["desfechos"][outcome or "rodando"] += 1
        if fim:
            t["min"].append((fim - ini) / 60)
    cartoes = {tp: {"cartoes": v["cartoes"], "execucoes": v["execucoes"], "min_mediana": med(v["min"]),
                    "min_total": round(sum(v["min"])), "fila_min_mediana": med(v["fila_min"]),
                    "desfechos": dict(v["desfechos"])} for tp, v in sorted(por_tipo.items())}

    # --- ocupação: quanto do relógio teve agente trabalhando -----------------------------
    fim_janela = agora
    ocup = collections.Counter()
    passo = 60
    for s in range(int(INICIO), int(fim_janela), passo):
        n = sum(1 for _, _, ini, fim, _ in runs if ini <= s < (fim or agora))
        ocup[n] += 1
    total_min = sum(ocup.values())
    ocupacao = {f"{n}_agentes": round(100 * c / total_min, 1) for n, c in sorted(ocup.items())}

    # --- modelo: tokens e tempo pensando x ferramentas -----------------------------------
    modelo = {}
    for db in glob.glob("/opt/data/profiles/*/state.db"):
        p = db.split("/")[4]
        c = sqlite3.connect(db)
        ses = list(c.execute("select id,api_call_count,tool_call_count,input_tokens,output_tokens,"
                             "reasoning_tokens from sessions where started_at>=? and message_count>3", (INICIO,)))
        llm = ferr = 0.0
        for sid, *_ in ses:
            prev = None
            for role, ts in c.execute("select role,timestamp from messages where session_id=? order by id", (sid,)):
                if prev is not None:
                    if role == "assistant":
                        llm += ts - prev
                    elif role == "tool":
                        ferr += ts - prev
                prev = ts
        modelo[p] = {"sessoes": len(ses), "chamadas_api": sum(s[1] or 0 for s in ses),
                     "ferramentas": sum(s[2] or 0 for s in ses),
                     "tokens_entrada_k": sum(s[3] or 0 for s in ses) // 1000,
                     "tokens_saida_k": sum(s[4] or 0 for s in ses) // 1000,
                     "tokens_raciocinio_k": sum(s[5] or 0 for s in ses) // 1000,
                     "horas_modelo": horas(llm), "horas_ferramentas": horas(ferr)}

    # --- provedor: chamadas de cada papel por modelo (o Kilo fica no principal; caiu pra reserva do Zen?) ---
    # Só leitura: o Kilo não informa consumo (nem cabeçalho, nem endpoint); o efeito é o que importa, e o Hermes o grava
    # exato em session_model_usage. Papel do Kilo com chamadas no Zen DEPOIS da troca = o Kilo recusou (limite ~200/h).
    provedor = {}
    for db in glob.glob("/opt/data/profiles/*/state.db"):
        p = db.split("/")[4]
        try:
            c = sqlite3.connect(f"file:{db}?mode=ro", uri=True, timeout=5)
            linhas = c.execute("select model, billing_base_url, count(distinct session_id), sum(api_call_count) "
                               "from session_model_usage where last_seen>=? group by model, billing_base_url", (INICIO,)).fetchall()
        except sqlite3.Error:
            continue
        for m, u, sess, n in linhas:
            nome = f"{m.split('/')[-1]} @ {'kilo' if 'kilo.ai' in (u or '') else 'zen' if 'opencode.ai' in (u or '') else u}"
            acc = provedor.setdefault(p, {}).setdefault(nome, {"sessoes": 0, "chamadas": 0})
            acc["sessoes"] += sess
            acc["chamadas"] += n or 0

    # --- GitHub: entregas ----------------------------------------------------------------
    issues = gh("issue", "list", "-R", REPO, "--label", "tarefa", "--state", "all", "--limit", "200",
                "--json", "number,createdAt,closedAt,state")
    issues = [i for i in issues if iso(i["createdAt"]) >= INICIO - 86400]
    fechadas = [i for i in issues if i["closedAt"]]
    lead = [(iso(i["closedAt"]) - iso(i["createdAt"])) / 3600 for i in fechadas]
    prs = gh("pr", "list", "-R", REPO, "--state", "all", "--limit", "200",
             "--json", "number,headRefName,createdAt,mergedAt,state,additions,deletions")
    prs = [p for p in prs if iso(p["createdAt"]) >= INICIO and p["headRefName"].startswith("dev/")
           and not p["headRefName"].startswith("dev/999")]
    mesclados = [p for p in prs if p["mergedAt"]]
    revisoes = collections.Counter()
    for tid, title, *_ in tarefas.values():
        m = re.match(r"^\[revisar-pr-(\d+)-", title or "")
        if m:
            revisoes[int(m.group(1))] += 1
    janela_h = (agora - INICIO) / 3600
    entregas = {
        "janela_horas": round(janela_h, 1),
        "tarefas_criadas": len(issues), "tarefas_fechadas": len(fechadas),
        "lead_time_h_mediana": med(lead),
        "prs_dev": len(prs), "prs_mesclados": len(mesclados),
        "tarefas_por_dia": round(len(fechadas) / janela_h * 24, 1) if janela_h else None,
        "linhas_mescladas": sum(p["additions"] + p["deletions"] for p in mesclados),
        "revisoes_por_pr": dict(sorted(revisoes.items())),
        "rodadas_de_revisao_mediana": med(list(revisoes.values())),
    }
    entregas["reprovacoes"] = motivos_reprovacao([p["number"] for p in prs])
    saida = {"coletado": dt.datetime.now(dt.timezone.utc).isoformat(timespec="minutes"),
             "entregas": entregas, "cartoes": cartoes, "ocupacao_pct_do_tempo": ocupacao, "modelo": modelo,
             "chamadas_por_modelo": provedor}
    if "--json" in sys.argv:
        json.dump(saida, open(sys.argv[sys.argv.index("--json") + 1], "w"), ensure_ascii=False, indent=1)
    print(json.dumps(saida, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
