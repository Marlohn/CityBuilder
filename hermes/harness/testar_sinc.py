import importlib.util, types, sys
spec=importlib.util.spec_from_file_location("s","/tmp/sinc_novo.py"); s=importlib.util.module_from_spec(spec); spec.loader.exec_module(s)
real=s.subprocess.run
EFEITOS=([s.GH,"pr","close"],[s.GH,"issue","edit"],[s.HERMES,"kanban","archive"],[s.HERMES,"kanban","complete"])
def fake(args,**k):
    if args[:3] in EFEITOS:
        print("  (simulado)", " ".join(map(str,args[1:4]))); return types.SimpleNamespace(returncode=0,stdout="",stderr="")
    return real(args,**k)
s.subprocess.run=fake
s.criar=lambda chave,titulo,papel,alvo="",**k: print(f"  CRIARIA [{chave}] -> {papel} prio={k.get('prioridade')}")
s.jev=lambda *a,**k: None   # triagem simulada: nao chama a API no teste
s.TRIAGEM_LOG="/tmp/triagem-teste.jsonl"   # teste nao suja o log real da avaliacao
s.freio_memoria=lambda: None   # teste nunca mata processo de verdade
s.main(); print("TESTE OK")
