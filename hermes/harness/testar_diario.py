import importlib.util, types, json, datetime as dt, os
spec=importlib.util.spec_from_file_location("s","/tmp/sinc_novo.py"); s=importlib.util.module_from_spec(spec); spec.loader.exec_module(s)
for f in ("/tmp/d-acoes.jsonl","/tmp/d-estado.json"):
    if os.path.exists(f): os.remove(f)
s.ACOES="/tmp/d-acoes.jsonl"; s.DIARIO_ESTADO="/tmp/d-estado.json"
chamadas=[]
def fake(args, **k):
    chamadas.append((args[1:3], k.get("input","")))
    if args[1:3]==["issue","create"]: return types.SimpleNamespace(returncode=0, stdout="https://github.com/x/y/issues/999\n", stderr="")
    return types.SimpleNamespace(returncode=0, stdout="", stderr="")
s.subprocess.run=fake
def posts(): return [c for c in chamadas if c[0]==["issue","comment"]]
s.diario_github()
assert [c[0] for c in chamadas]==[["label","create"],["issue","create"]] and not posts(), chamadas
print("1) cria a issue, nao posta: ok")
est=json.load(open(s.DIARIO_ESTADO)); ontem=(dt.datetime.now(s.BRT)-dt.timedelta(days=1)).strftime("%Y-%m-%d")
est["dia"]=ontem; json.dump(est,open(s.DIARIO_ESTADO,"w"))
s.registrar("cartao_criado","[dev-issue-1-r1] -> dev","x")
s.registrar("freio_memoria","3 sessões","2700/3072 MB",impacto=True)
with open(s.ACOES,"a") as f:
    f.write(json.dumps({"quando":ontem+"T10:00:00-03:00","acao":"zelador_liberou","alvo":"t_x","motivo":"travou por transitorio","impacto":False})+"\n")
chamadas.clear(); s.diario_github()
p=posts(); assert len(p)==2, p
assert "freio de memória" in p[0][1] and "Resumo de "+ontem in p[1][1] and "cartões travados liberados: 1" in p[1][1], p
print("2) posta impacto + resumo de ontem: ok")
chamadas.clear(); s.diario_github(); assert not posts(), posts(); print("3) nao repete: ok")
print(p[0][1]); print("---"); print(p[1][1])
