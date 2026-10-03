"""Bootstrap real no container CI: Git, build, navegador e ação pública; sem LLM.

A resposta de descoberta é uma fixture. Isto não é uma missão de produto nem
prova capacidade de um modelo; cobre a preparação que falhou no piloto real.
"""
import json
import os
from pathlib import Path
import subprocess
from unittest.mock import patch

from factory import command, worker, clone_candidate, snapshot_candidate


def main():
    root=Path.cwd().resolve()
    # O runner monta um clone com outro UID. O teste deve usar o mesmo bootstrap
    # do worker: esta exceção só consulta o SHA necessário ao contexto da fixture.
    sha=command(['git','-c','safe.directory='+str(root),'rev-parse','HEAD'])
    context=dict(id='bootstrap-test',request_id='bootstrap-request',base_sha=sha,seed='factory-bootstrap')
    calls=[]

    def observe(directory,prompt,name,image=None,build=False):
        assert name=='observe' and not build and image.is_file()
        record=json.loads(command(['npm','run','--silent','factory:browser','--','act',
                                  '[{"type":"key","key":"Escape"}]','baseline'],cwd=directory))
        assert not record['errors'] and not record['browserErrors']
        assert Path(record['screenshot']).is_file()
        calls.append(record['id'])
        return dict(decision='no_opportunity',reason='Fixture de teste, nenhum modelo chamado.',evidence=[record['id']])

    with patch('factory.ask_model',side_effect=observe):
        status=worker('observe',context)
    result=json.loads((root/'out/factory/result.json').read_text())
    assert status==0 and result['status']=='success',result
    assert len(calls)==1 and result['discovery']['evidence']==calls
    # Prova de que o processo de preview foi encerrado, evitando conflito no
    # próximo teste ou etapa. A execução real usa a mesma limpeza do worker.
    probe=subprocess.run(['node','-e',
        "fetch('http://127.0.0.1:4173/').then(()=>process.exit(1)).catch(()=>process.exit(0))"],capture_output=True)
    assert probe.returncode==0,'Preview continuou ativo depois da etapa.'
    # Mesmo checkout montado com outro UID; não pode voltar a falhar só no build.
    candidate=root/'out/bootstrap-candidate'
    clone_candidate(root,candidate,sha,'dev/bootstrap')
    assert (candidate/'.git').is_dir(),'Candidata compartilha a raiz Git com o runner.'
    (candidate/'packages/bootstrap-proof.txt').write_text('código parcial da fixture')
    command(['git','config','user.name','Factory bootstrap'],cwd=candidate)
    command(['git','config','user.email','factory@example.invalid'],cwd=candidate)
    snapshot=snapshot_candidate(candidate,sha,root/'out/factory','checkpoint fixture')
    assert snapshot!=sha and (root/'out/factory/candidate.bundle').is_file()
    assert not (root/'packages/bootstrap-proof.txt').exists(),'Executor escreveu no checkout principal.'
    print('BOOTSTRAP REAL OK: cópia Git, imagem e ação pública; nenhum LLM chamado.')


if __name__=='__main__':
    if os.name!='posix': raise SystemExit('Este teste roda no container Linux do CI.')
    main()
