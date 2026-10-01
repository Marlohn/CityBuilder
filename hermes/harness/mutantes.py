"""Reintroduz defeitos no sincronizador e confere que o teste fica vermelho. Uso: py -3 mutantes.py"""
import os
import subprocess
import sys
import tempfile

AQUI = os.path.dirname(os.path.abspath(__file__))
ORIGINAL = open(f"{AQUI}/sincronizar_github.py", encoding="utf-8").read()

MUTANTES = {
    "PR dev sem Closes perde vinculo com tarefa":
        (r'com_pr |= {int(pr["headRefName"][4:]) for pr in prs if re.fullmatch(r"dev/(\d+)", pr["headRefName"])}', 'com_pr |= set()'),
    "diagnostico sem autorizacao libera dev":
        ('if (autorizado and decidiu and diagnostico not in existentes', 'if (decidiu and diagnostico not in existentes'),
    "diagnostico sem decisao libera dev":
        ('if (autorizado and decidiu and diagnostico not in existentes', 'if (autorizado and diagnostico not in existentes'),
    "diagnostico repete tentativa ja gasta":
        ('if (autorizado and decidiu and diagnostico not in existentes', 'if (autorizado and decidiu'),
    "decisao do arquiteto esconde PR sem encaminhamento":
        ('        chave = rodada(existentes, chave + "-retomar")\n        if chave is None:\n            return', '        return'),
    "arquivado deixa de contar como cartão existente":
        ('        k = t[1:t.index("]")]\n', '        k = t[1:t.index("]")]\n        if c.get("status") == "archived":\n            continue\n'),
    "revisão cria 2º cartão aberto pro mesmo PR":
        ('if not aberto(existentes, f"revisar-pr-{n}-") and preparar_revisao(pr):', 'if preparar_revisao(pr):'),
    "cartao concluido esconde PR ainda aberto":
        ('if not aberto(existentes, f"revisar-pr-{n}-") and preparar_revisao(pr):', 'if chave not in existentes and not aberto(existentes, f"revisar-pr-{n}-") and preparar_revisao(pr):'),
    "revisão aceita CI incompleto":
        ('return "verde" if obrigatorios <= verdes else "aguardando"', 'return "verde"'),
    "conflito chega ao revisor":
        ('if pr.get("mergeStateStatus") == "DIRTY":', 'if False:'),
    "3 rodadas gastas não chamam o arquiteto":
        ('elif esgotada(existentes, base) and', 'elif False and esgotada(existentes, base) and'),
    "zelador esquece o motivo do bloqueio":
        ("f\"Motivo: {motivo_bloqueio(c['id'])}\"", '"Motivo: -"'),
    "main vermelha cria conserto novo com outro aberto":
        ('if not falhas or aberto(existentes, "main-vermelha-"):', 'if not falhas:'),
    "rodada arquivada é tratada como aberta":
        ('        if st not in TERMINAIS:\n            return None\n    return None\n\n\ndef esgotada', '        if st != "done":\n            return None\n    return None\n\n\ndef esgotada'),
    "fecha PR do QA de tarefa ainda aberta":
        ('if m and int(m.group(1)) not in abertas:', 'if m and int(m.group(1)) in abertas:'),
    "protegido conta como main vermelha":
        (' and r["name"] != "testes de aceitação protegidos"]', ']'),
    "rascunho do QA esconde a tarefa do dev":
        ('for pr in prs if not pr["headRefName"].startswith("qa/") for n in', 'for pr in prs for n in'),
    "tarefa presa conta como fila cheia":
        ('if len(prontas) < FILA_MINIMA:', 'if len(tarefas_abertas) < FILA_MINIMA:'),
    "fecha tarefa de PR antigo":
        ('< dt.timedelta(hours=48)', '< dt.timedelta(days=9999)'),
    "PR do QA fecha a tarefa":
        ('m = re.fullmatch(r"dev/(\d+)", pr["headRefName"])', 'm = re.fullmatch(r"(?:dev|qa)/(\d+)", pr["headRefName"])'),
    "ajuste vai pro dev com a issue esperando o QA":
        ('if re.fullmatch(r"dev/(\\d+)", pr["headRefName"]) and int(pr["headRefName"][4:]) in esperando_qa:', 'if False:'),
    "item do roadmap vira cartão":
        ('lista = [i for i in lista if any(lb["name"] == "tarefa" for lb in i["labels"])]', 'lista = lista'),
    "revisao repetida com a issue esperando o QA":
        ('if any(lb["name"] == "em-revisão" for lb in pr["labels"]) and no_qa:', 'if False:'),
    "QA que destrava PR pronto nao passa na frente":
        ('(15 if papel == "qa" and n in com_pr else 0)', '0'),
    "dependência não segura a tarefa":
        ('if dependencias(iss["body"]) & abertas:', 'if False:'),
    "mesmo arquivo não serializa dev":
        ('if papel == "dev" and n not in ativos and arquivos(iss["body"]) & ocupados:', 'if False:'),
}

falhou = 0
for nome, (velho, novo) in MUTANTES.items():
    if ORIGINAL.count(velho) != 1:
        print(f"MUTANTE INVÁLIDO (trecho não achado ou repetido): {nome}")
        falhou += 1
        continue
    with tempfile.NamedTemporaryFile("w", suffix=".py", delete=False, encoding="utf-8") as f:
        f.write(ORIGINAL.replace(velho, novo))
    r = subprocess.run([sys.executable, f"{AQUI}/testar_sinc.py", f.name, "--sem-rede"], capture_output=True, text=True,
                       encoding="utf-8", env={**os.environ, "PYTHONIOENCODING": "utf-8"})
    os.unlink(f.name)
    pegou = r.returncode != 0
    print(("PEGOU   " if pegou else "ESCAPOU ") + nome)
    falhou += 0 if pegou else 1
sys.exit(1 if falhou else 0)
