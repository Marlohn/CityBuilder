"""Ciclo de produto: controlador no Hermes; sessões diretas e navegador no GitHub.

tick não espera LLM/CI. worker executa uma etapa com evidência e orçamento.
Somente biblioteca padrão; nenhum segredo em argumentos, contexto ou artefatos.
"""
import argparse
import datetime as dt
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time
import urllib.request
import uuid

REPO = "Marlohn/CityBuilder"
REQUIRED = {"npm run check", "teste de tela (Playwright)", "testes de aceitação protegidos",
            "testes lentos (coorte IBGE e cidade de 50 mil)"}
MODEL = "opencode/space-bunny-free"
WORKFLOW = "factory.yml"
HERMES = "/opt/hermes/.venv/bin/hermes"
GH = os.environ.get("FACTORY_GH", "/opt/data/.local/bin/gh" if Path('/opt/data').exists() else "gh")


class ProviderFailure(RuntimeError):
    kind='provider'


def command(args, cwd=None, timeout=90, env=None, input=None):
    result = subprocess.run(list(map(str, args)), cwd=cwd, env=env, input=input,
                            capture_output=True, text=True, timeout=timeout)
    if result.returncode:
        raise RuntimeError(f"{args[0]} {args[1] if len(args)>1 else ''}: exit {result.returncode}: {result.stderr[-1200:]}")
    return result.stdout.strip()


def gh(*args, input=None):
    return command([GH, *args], input=input)


def write_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + '.new')
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding='utf-8')
    temporary.replace(path)


def parse_model_result(log):
    events = []
    for line in log.splitlines():
        try:
            event = json.loads(line)
            if isinstance(event, dict): events.append(event)
        except ValueError: pass
    if any(e.get('type') == 'error' for e in events):
        raise ValueError('Erro estruturado do provedor; não é resultado da etapa.')
    endings = [e for e in events if e.get('type') == 'step_finish']
    if not endings or endings[-1].get('part', {}).get('reason') != 'stop':
        raise ValueError('Sessão sem resposta final; exit 0 não comprova conclusão.')
    texts = [e.get('part', {}).get('text', '') for e in events if e.get('type') == 'text']
    decoder = json.JSONDecoder()
    for text in reversed(texts):
        for match in re.finditer(r'\{', text):
            try:
                value, _ = decoder.raw_decode(text[match.start():])
                if isinstance(value, dict): return value
            except ValueError: pass
    raise ValueError('Resposta final sem objeto JSON.')


def evidence(ids, directory, interaction=True):
    if not isinstance(ids, list) or not ids: raise ValueError('Evidência ausente.')
    records = []
    for identifier in ids:
        if not isinstance(identifier, str) or not re.fullmatch(r'\d{4}', identifier):
            raise ValueError('Identificador de observação inválido.')
        path = Path(directory) / (identifier + '.json')
        if not path.is_file(): raise ValueError('Observação citada não existe.')
        record = json.loads(path.read_text())
        if record.get('errors') or record.get('browserErrors'): raise ValueError('Observação citada contém falha.')
        screenshot = Path(directory) / (identifier + '.png')
        if not screenshot.is_file(): raise ValueError('Imagem da observação ausente.')
        import hashlib
        if hashlib.sha256(screenshot.read_bytes()).hexdigest() != record.get('sha256'):
            raise ValueError('Imagem diferente da observação registrada.')
        records.append(record)
    if interaction and not any(a.get('type') in ['click','point','drag','key']
                               for r in records for a in r.get('actions',[])):
        raise ValueError('Uma imagem inicial não comprova uma jornada.')
    return records


def validate_discovery(value, directory):
    if value.get('decision') == 'no_opportunity':
        if not value.get('reason'): raise ValueError('Ausência de oportunidade sem motivo.')
        evidence(value.get('evidence'), directory)
        return value
    if value.get('decision') != 'mission': raise ValueError('Decisão de descoberta inválida.')
    for key in ['title', 'problem', 'hypothesis', 'player_benefit', 'category']:
        if not isinstance(value.get(key), str) or not value[key].strip(): raise ValueError(f'Falta {key}.')
    criteria = value.get('acceptance')
    if not isinstance(criteria, list) or not 1 <= len(criteria) <= 4: raise ValueError('Use 1 a 4 critérios.')
    identifiers = []
    for criterion in criteria:
        if not re.fullmatch(r'[a-z][a-z0-9_-]{0,30}', str(criterion.get('id', ''))): raise ValueError('ID de critério inválido.')
        if not criterion.get('behavior'): raise ValueError('Critério sem comportamento.')
        identifiers.append(criterion['id'])
    if len(set(identifiers)) != len(identifiers): raise ValueError('Critérios duplicados.')
    if re.search(r'[\u3000-\u9fff]', json.dumps(value, ensure_ascii=False)):
        raise ValueError('Texto fora do idioma do projeto.')
    evidence(value.get('evidence'), directory)
    return value


def validate_evaluation(value, mission, directory):
    if value.get('verdict') not in ['accept', 'reject'] or not value.get('summary'):
        raise ValueError('Avaliação sem veredito ou motivo.')
    criteria = value.get('criteria', [])
    expected = {c['id'] for c in mission['acceptance']}
    if len(criteria) != len(expected) or {c.get('id') for c in criteria} != expected:
        raise ValueError('A avaliação alterou ou omitiu critérios fixados.')
    for criterion in criteria:
        if not isinstance(criterion.get('passed'), bool) or not criterion.get('reason'):
            raise ValueError('Critério sem resultado fundamentado.')
        evidence(criterion.get('baseline'), Path(directory) / 'baseline')
        evidence(criterion.get('candidate'), Path(directory) / 'candidate')
    if value['verdict'] == 'accept' and (not all(c['passed'] for c in criteria) or value.get('regressions')):
        raise ValueError('Aprovação com falha ou regressão declarada.')
    return value


def check_changes(paths):
    if not paths: raise ValueError('Nenhuma mudança implementada.')
    for path in paths:
        if path.startswith(('.github/', 'hermes/', 'tools/', '.opencode/', 'tests/acceptance/')) or \
                path.endswith('/AGENTS.md') or path in ['AGENTS.md','package.json','package-lock.json','biome.json',
                                                       'tsconfig.json','vitest.config.ts','playwright.config.ts',
                                                       'ROADMAP.md','roadmap/signals.json'] or path.endswith('.env'):
            raise ValueError('Executor alterou proteção ou infraestrutura: ' + path)
        if not path.startswith(('packages/', 'config/', 'data/', 'tests/unit/', 'tests/e2e/', 'docs/', 'scenarios/')):
            raise ValueError('Caminho fora da missão: ' + path)


def checks_green(checks):
    found = {c.get('name', c.get('context')): c for c in checks}
    return all(name in found and (found[name].get('conclusion') == 'SUCCESS' or
                                  found[name].get('state') == 'SUCCESS') for name in REQUIRED)


def ask_model(root, prompt, name, image=None, build=False):
    env = os.environ.copy()
    for key in ['GH_TOKEN','GITHUB_TOKEN','FACTORY_GITHUB_TOKEN']:
        env.pop(key,None)
    bash = {'*':'deny', 'npm run factory:browser -- act *':'allow'}
    if build:
        bash.update({'npm run check*':'allow','npm run format*':'allow','npm test*':'allow',
                     'npm run test:e2e*':'allow','npx vitest *':'allow','npx biome *':'allow',
                     'npx tsc *':'allow','npx playwright test *':'allow','git diff*':'allow','git status*':'allow',
                     'rg *':'allow','ls *':'allow'})
    read_permissions = {'*':'allow' if build else 'deny','*/out/factory/*':'allow',
                        '*/docs/VISAO.md':'allow','*.env':'deny','*/.git/*':'deny'}
    config = {'autoupdate':False, 'permission':{'*':'deny', 'read':read_permissions, 'glob':'allow', 'grep':'allow' if build else 'deny',
              'edit':'allow' if build else 'deny', 'bash':bash, 'task':'deny', 'webfetch':'allow' if build else 'deny'},
              'agent':{'build':{'steps':60 if build else 22}}}
    env['OPENCODE_CONFIG_CONTENT'] = json.dumps(config)
    args = ['opencode','run','--format','json','--agent','build','--model',MODEL,'--title','factory-'+name]
    if image: args.extend(['--file',str(image)])
    args.extend(['--',prompt])
    output = Path(env['FACTORY_OUTPUT'])
    try:
        result = subprocess.run(args,cwd=root,env=env,capture_output=True,text=True,timeout=1800 if build else 900)
    except subprocess.TimeoutExpired as error:
        for suffix, data in [('jsonl',error.stdout),('stderr',error.stderr)]:
            (output/(name+'.'+suffix)).write_text(data.decode('utf-8',errors='replace') if isinstance(data,bytes) else data or '',encoding='utf-8')
        raise RuntimeError('Sessão atingiu o limite; saída parcial preservada.') from error
    (output / (name+'.jsonl')).write_text(result.stdout,encoding='utf-8')
    (output / (name+'.stderr')).write_text(result.stderr,encoding='utf-8')
    errors=[]
    for line in result.stdout.splitlines():
        try:
            event=json.loads(line)
            if event.get('type')=='error': errors.append(event.get('error',{}))
        except ValueError: pass
    if errors:
        messages=[e.get('data',{}).get('message',e.get('name','erro de API')) for e in errors]
        raise ProviderFailure('Provedor: '+'; '.join(messages)[:800])
    if result.returncode:
        raise RuntimeError(f'OpenCode exit {result.returncode}; confira {name}.jsonl.')
    return parse_model_result(result.stdout)


def worker(phase, context):
    root = Path.cwd().resolve()
    output = root / 'out/factory'
    output.mkdir(parents=True,exist_ok=True)
    os.environ['FACTORY_OUTPUT'] = str(output)
    os.environ['FACTORY_BROWSER_DIR'] = str(output)
    processes = []
    result = {'phase':phase,'mission':context['id'],'request_id':context['request_id'],
              'base_sha':context['base_sha'],'status':'failed'}

    def start(args, cwd, log):
        stream = open(output / (log+'.log'), 'w',encoding='utf-8')
        proc = subprocess.Popen(args,cwd=cwd,stdout=stream,stderr=subprocess.STDOUT,start_new_session=True)
        processes.append((proc,stream))
        return proc

    def game(ref, side, published=False):
        directory = root / 'out' / ('game-'+side)
        if not published:
            command(['git','worktree','add','--detach',directory,ref],cwd=root)
            command(['npm','ci','--no-audit','--no-fund'],cwd=directory,timeout=300)
            command(['npm','run','build'],cwd=directory,timeout=300)
            port = 4173 if side == 'baseline' else 4174
            start(['npx','vite','preview','--config','packages/web/vite.config.ts','--host','127.0.0.1',
                   '--port',str(port),'--strictPort'],directory,side+'-server')
            url = f'http://127.0.0.1:{port}/?seed='+context['seed']
            deadline=time.time()+30
            while time.time()<deadline:
                try:
                    with urllib.request.urlopen(url,timeout=2): break
                except OSError: time.sleep(1)
            else: raise RuntimeError('Servidor do jogo não ficou pronto.')
        else: url = context['published_url']+'?seed='+context['seed']
        env = os.environ.copy()
        env['FACTORY_BROWSER_DIR'] = str(output / side)
        stream = open(output/(side+'-browser.log'),'w',encoding='utf-8')
        proc = subprocess.Popen(['npm','run','factory:browser','--','serve',url],cwd=root,env=env,
                                stdout=stream,stderr=subprocess.STDOUT,start_new_session=True)
        processes.append((proc,stream))
        deadline = time.time()+150
        while time.time()<deadline:
            if (output/side/'address.json').exists(): break
            if proc.poll() is not None:
                raise RuntimeError('Navegador encerrou antes de ficar pronto: '+
                                   (output/(side+'-browser.log')).read_text(encoding='utf-8')[-1500:])
            time.sleep(1)
        else: raise RuntimeError('Navegador não ficou pronto no limite.')
        return directory

    try:
        write_json(output/'context.json',context)
        direction = (root/'hermes/factory/DIRECTION.md').read_text(encoding='utf-8')
        if phase == 'observe':
            game(context['base_sha'],'baseline')
            first = command(['npm','run','--silent','factory:browser','--','act','[]','baseline'],cwd=root)
            prompt = f'''Você está no papel de observador do produto. Direção:\n{direction}
Explore a partida PELA INTERFACE; não leia código nem window.__city. Use:
npm run factory:browser -- act '[ações JSON]' baseline
Ações: click com role/name exatos; point x/y; drag x/y/toX/toY; key key; wait ms<=3000; reset.
Cada resultado informa screenshot: use read para VER a imagem antes de decidir. Há no máximo 22 passos.
Tente uma jornada de construção ou compreensão. Não confunda desafio, bot limitado ou recurso existente com defeito.
Backlog e entregas recentes: {json.dumps(context.get('backlog',[]),ensure_ascii=False)}
Memória dos últimos experimentos (sucessos e falhas): {json.dumps(context.get('recent',[]),ensure_ascii=False)}
Observação inicial: {first}
Escolha uma melhoria pequena que altere o que alguém faz ou entende numa partida e caiba em até 4 horas.
Se não houver oportunidade fundamentada: retorne JSON decision=no_opportunity, reason, evidence=[IDs].
Se houver: JSON decision=mission,title,problem,hypothesis,player_benefit,category,
evidence=[IDs reais de observações com ações bem-sucedidas],acceptance=[{{id,behavior}}] (1 a 4).
Critérios descrevem benefício e comportamento, não arquivos nem solução técnica. Não repita backlog.
Separe fato e hipótese no texto. Português claro. Somente o JSON na resposta final.'''
            value = ask_model(root,prompt,'observe',output/'baseline/0001.png')
            result.update(status='success',discovery=validate_discovery(value,output/'baseline'))
        elif phase == 'build':
            candidate = root/'out/game-candidate'
            ref = context.get('candidate_sha') or context['base_sha']
            command(['git','worktree','add','--detach',candidate,ref],cwd=root)
            command(['git','switch','-c',context['branch']],cwd=candidate)
            command(['npm','ci','--no-audit','--no-fund'],cwd=candidate,timeout=300)
            prompt = f'''Implemente esta missão completa no CityBuilder: {json.dumps(context['discovery'],ensure_ascii=False)}
Feedback independente: {json.dumps(context.get('feedback',{}),ensure_ascii=False)}
Leia AGENTS.md e hermes/FACTORY.md. O fluxo de missão aprovado substitui as passagens QA/Dev e o limite por arquivos.
Escreva teste apropriado que falha antes da correção. Critérios são fixos. Preserve testes de aceitação existentes.
Não altere infraestrutura, ferramentas, AGENTS.md, CI, dependências ou avaliador. Não faça commit, push, merge nem gh.
Regras/dados novos da simulação exigem fonte. Uma melhoria de interface exige prova funcional.
Rode format para os arquivos alterados, check --local e testes afetados. Documente mudanças relevantes.
Há 30 minutos para esta sessão; prefira solução pequena e completa. Resposta final JSON:
{{"summary":"benefício concreto","tests":["caminhos de testes afetados"],"limitations":[]}}.'''
            value = ask_model(candidate,prompt,'build',build=True)
            paths = command(['git','diff','--name-only',context['base_sha']],cwd=candidate).splitlines()
            untracked = command(['git','ls-files','--others','--exclude-standard'],cwd=candidate).splitlines()
            check_changes(paths+untracked)
            tests = value.get('tests',[])
            if not tests: raise ValueError('Executor não indicou testes afetados.')
            for test in tests:
                if not isinstance(test,str) or '..' in test or not re.fullmatch(r'[a-zA-Z0-9_./-]+\.(test|spec)\.tsx?',test):
                    raise ValueError('Caminho de teste inválido.')
                if not (candidate/test).is_file(): raise ValueError('Teste indicado não existe.')
            checks = command(['npm','run','check','--','--local'],cwd=candidate,timeout=300)
            (output/'local-check.log').write_text(checks)
            unit = [t for t in tests if not t.startswith('tests/e2e/')]
            browser = [t for t in tests if t.startswith('tests/e2e/')]
            if unit: (output/'affected-tests.log').write_text(command(['npx','vitest','run',*unit],cwd=candidate,timeout=600))
            if browser: (output/'affected-browser.log').write_text(command(['npx','playwright','test',*browser],cwd=candidate,timeout=600))
            command(['git','add','--',*sorted(set(paths+untracked))],cwd=candidate)
            command(['git','commit','-m','feat: '+context['discovery']['title']],cwd=candidate)
            sha = command(['git','rev-parse','HEAD'],cwd=candidate)
            # O runner não recebe credencial de escrita. O controlador publica este estado exato.
            command(['git','bundle','create',output/'candidate.bundle','HEAD','^'+context['base_sha']],cwd=candidate)
            result.update(status='success',candidate_sha=sha,implementation=value)
        elif phase == 'evaluate':
            game(context['base_sha'],'baseline')
            game(context['candidate_sha'],'candidate')
            diff = command(['git','diff',context['base_sha'],context['candidate_sha']],cwd=root)
            (output/'candidate.diff').write_text(diff,encoding='utf-8')
            prompt = f'''Você é o avaliador independente do CityBuilder. Direção:\n{direction}
Missão e critérios FIXADOS: {json.dumps(context['discovery'],ensure_ascii=False)}
Compare a partida baseline e candidate com os MESMOS objetivos, seed e viewport.
Use npm run factory:browser -- act '[ações JSON]' baseline OU candidate. Veja cada imagem com read.
Não leia window.__city. Não altere arquivos, critérios, testes ou código. A descrição do executor não é prova.
Inspecione out/factory/candidate.diff para revisão, sem confundir código correto com experiência melhor.
Faça ações em AMBAS as versões. Critérios subjetivos precisam de evidência visível; não invente certeza.
Retorne SOMENTE JSON {{verdict:"accept"|"reject",summary,regressions:[],
criteria:[{{id,passed:true|false,reason,baseline:[IDs],candidate:[IDs]}}]}}.
Todo critério original precisa ser avaliado. Aprovar só com benefício observado e sem regressão conhecida.
Se faltar prova, rejeite e explique o que falta. Não acrescentar requisito novo depois da implementação.'''
            value = ask_model(root,prompt,'evaluate',output/'candidate/0001.png')
            result.update(status='success',candidate_sha=context['candidate_sha'],evaluation=validate_evaluation(value,context['discovery'],output))
        elif phase == 'verify':
            game(None,'baseline',published=True)
            record = json.loads(command(['npm','run','--silent','factory:browser','--','act',
                                        '[{"type":"key","key":"i"},{"type":"key","key":"i"}]','baseline'],cwd=root))
            if record['errors'] or record['browserErrors'] or 'CityBuilder' not in record['text']:
                raise ValueError('Versão publicada não passou na conferência de abertura/controle.')
            result.update(status='success',published_sha=context['published_sha'],verification=record['id'])
        else: raise ValueError('Etapa desconhecida.')
    except Exception as error:
        result['error'] = str(error)[-1600:]
        result['failure_kind']=getattr(error,'kind','contract' if isinstance(error,ValueError) else 'execution')
    finally:
        write_json(output/'result.json',result)
        for proc,stream in reversed(processes):
            if proc.poll() is None:
                import signal
                os.killpg(proc.pid,signal.SIGTERM)
            stream.close()
    print(json.dumps({k:v for k,v in result.items() if k not in ['discovery','evaluation']},ensure_ascii=False))
    return 0 if result['status']=='success' else 1


class Controller:
    def __init__(self, directory):
        self.directory = Path(directory)
        self.config = json.loads((self.directory/'config.json').read_text())
        self.path = self.directory/'state.json'
        self.state = json.loads(self.path.read_text()) if self.path.exists() else {'next_at':0}

    def save(self): write_json(self.path,self.state)

    def note(self, text):
        if self.state.get('card'):
            command([HERMES,'kanban','comment',self.state['card'],text])
        if self.state.get('issue'):
            gh('issue','comment',str(self.state['issue']),'-R',REPO,'--body-file','-',input=text)

    def finish(self, outcome, reason):
        self.note(reason)
        if outcome=='discarded' and self.state.get('pr'):
            gh('pr','close',str(self.state['pr']),'-R',REPO)
        card = self.state.get('card')
        if card:
            if outcome in ['published','no_opportunity']:
                command([HERMES,'kanban','complete',card,'--summary',reason])
            else: command([HERMES,'kanban','block',card,reason,'--kind','capability'])
        self.state.update(outcome=outcome,reason=reason,finished_at=time.time())
        write_json(self.directory/'history'/(self.state['id']+'.json'),self.state)
        failures=0 if outcome=='published' else self.state.get('consecutive_failures',0)+(outcome in ['blocked','discarded'])
        self.state={'next_at':time.time()+self.config.get('cooldown_seconds',1800),'consecutive_failures':failures}
        if failures>=self.config.get('max_consecutive_failures',3):
            self.state['halted_reason']='Falhas consecutivas atingiram o limite. Consulte history; corrigir a causa antes de retirar este campo.'
        self.save()

    def dispatch(self, phase):
        self.state.update(phase=phase,dispatch_at=time.time(),request_id=uuid.uuid4().hex[:12],run_id=None)
        self.save()
        self.dispatch_saved()

    def dispatch_saved(self):
        context={k:v for k,v in self.state.items() if k in ['id','seed','base_sha','candidate_sha','branch',
                'discovery','feedback','backlog','recent','published_sha','published_url','request_id']}
        try:
            gh('api',f'repos/{REPO}/dispatches','-X','POST','--input','-',input=json.dumps(
                {'event_type':'factory-stage','client_payload':
                 {'phase':self.state['phase'],'mission':self.state['id'],'request_id':self.state['request_id'],
                  'context':json.dumps(context,ensure_ascii=False)}}))
        except RuntimeError as error:
            if not any(code in str(error) for code in ['HTTP 403','HTTP 401']): raise
            reason='GitHub negou repository_dispatch. Conferir Contents: Read and write na credencial. '+str(error)
            self.finish('blocked',reason)
            self.state.update(halted_reason=reason,needs_access=True);self.save()
            return
        self.note(f"Etapa {self.state['phase']} solicitada. Evidências serão vinculadas à execução GitHub; não é entrega.")

    def start(self):
        cards=json.loads(command([HERMES,'kanban','list','--json']))
        if any(c.get('status')=='running' and c.get('created_by')!='factory' for c in cards):
            return  # Transição só depois de workers antigos liberarem seus workspaces.
        identifier='f'+dt.datetime.now(dt.timezone.utc).strftime('%Y%m%d%H%M')+'-'+uuid.uuid4().hex[:6]
        base=json.loads(gh('api',f'repos/{REPO}/commits/main'))['sha']
        ci=json.loads(gh('run','list','-R',REPO,'--workflow','ci.yml','--commit',base,'--limit','1',
                         '--json','status,conclusion'))
        if not ci or ci[0]['status']!='completed' or ci[0]['conclusion']!='success':
            self.state['waiting_for_main']=base;self.save();return
        issues=json.loads(gh('issue','list','-R',REPO,'--limit','100','--json','number,title,labels'))
        issues=[dict(number=i['number'],title=i['title'],labels=[l['name'] for l in i['labels']]) for i in issues]
        recent=[]
        for path in sorted((self.directory/'history').glob('*.json'),reverse=True)[:8]:
            experiment=json.loads(path.read_text())
            recent.append({k:experiment[k] for k in ['id','discovery','outcome','reason','pr'] if k in experiment})
        self.state={'id':identifier,'seed':identifier,'base_sha':base,'started_at':time.time(),
                    'round':0,'backlog':issues,'recent':recent,'next_at':0,
                    'consecutive_failures':self.state.get('consecutive_failures',0)}
        card=json.loads(command([HERMES,'kanban','create','Explorar e melhorar a partida: '+identifier,
                          '--body-file','-','--created-by','factory','--idempotency-key',identifier,
                          '--completion-contract','local-only','--json'],input='Missão autônoma de produto. '+
                          'Execução externa no GitHub; controlador guarda estado e evidência. Entrega exige versão publicada.'))
        self.state['card']=card['id']
        command([HERMES,'kanban','claim',card['id'],'--ttl','14400'])
        self.save()
        self.dispatch('observe')

    def result(self, result, run_url, directory=None):
        if result.get('mission')!=self.state['id'] or result.get('phase')!=self.state['phase'] or \
                result.get('base_sha')!=self.state['base_sha'] or result.get('request_id')!=self.state['request_id']:
            raise ValueError('Artefato de outra missão, etapa ou base.')
        self.note(f"Resultado da etapa {self.state['phase']}: {run_url}\n"+
                  json.dumps(result,ensure_ascii=False)[:12000])
        if result.get('status')!='success':
            if result.get('failure_kind')=='provider' and self.state.get('provider_retries',0)<2:
                self.state['provider_retries']=self.state.get('provider_retries',0)+1
                self.state['retry_at']=time.time()+300*2**(self.state['provider_retries']-1)
                self.save();return
            self.finish('blocked','Etapa falhou com evidência: '+result.get('error','resultado incompleto')+'\n'+run_url)
            return
        self.state['provider_retries']=0
        phase=self.state['phase']
        if phase=='observe':
            discovery=result['discovery']
            if discovery['decision']=='no_opportunity': self.finish('no_opportunity',discovery['reason']);return
            self.state['discovery']=discovery
            body='## Problema observado\n'+discovery['problem']+'\n\n## Hipótese\n'+discovery['hypothesis']+\
                 '\n\n## Benefício para quem joga\n'+discovery['player_benefit']+'\n\n## Critérios fixados\n'+\
                 '\n'.join('- '+c['id']+': '+c['behavior'] for c in discovery['acceptance'])+\
                 '\n\nEvidência de exploração: '+run_url+'\n\nControlador: factory:'+self.state['id']
            prior=json.loads(gh('issue','list','-R',REPO,'--state','all','--search',
                                  '"factory:'+self.state['id']+'" in:body','--json','number'))
            if prior: issue=prior[0]['number']
            else:
                issue_url=gh('issue','create','-R',REPO,'--title',discovery['title'],'--body-file','-',input=body)
                issue=int(issue_url.rsplit('/',1)[1])
            self.state.update(issue=issue,branch='dev/factory-'+self.state['id'])
            command([HERMES,'kanban','edit',self.state['card'],'--title',discovery['title']])
            self.save();self.dispatch('build')
        elif phase=='build':
            self.publish_candidate(result['candidate_sha'],directory)
            self.state['candidate_sha']=result['candidate_sha']
            if not self.state.get('pr'):
                prior=json.loads(gh('pr','list','-R',REPO,'--head',self.state['branch'],'--json','number'))
                url=gh('pr','create','-R',REPO,'--base','main','--head',self.state['branch'],
                       '--title',self.state['discovery']['title'],'--body-file','-',
                       input='Benefício: '+self.state['discovery']['player_benefit']+'\n\n'+
                       result['implementation']['summary']+'\n\nCritérios e evidência na issue. Avaliação de partida pendente.\n\nCloses #'+str(self.state['issue'])) if not prior else ''
                self.state['pr']=prior[0]['number'] if prior else int(url.rsplit('/',1)[1])
            self.state['phase']='ci';self.save()
        elif phase=='evaluate':
            if result.get('candidate_sha')!=self.state['candidate_sha']: raise ValueError('Avaliação de outro código.')
            if result['evaluation']['verdict']=='reject':
                if self.state['round']>=2: self.finish('discarded','Candidata reprovada após limite de correções. '+run_url);return
                self.state['round']+=1;self.state['feedback']=result['evaluation'];self.save();self.dispatch('build')
            else:
                self.state.update(phase='merge',approved_sha=result['candidate_sha'],approved_base=self.state['base_sha'])
                self.save()
        elif phase=='verify':
            if result.get('published_sha')!=self.state['published_sha']: raise ValueError('Conferência de outra publicação.')
            self.finish('published','Publicado e conferido: '+self.state['published_url']+'\nBenefício: '+
                        self.state['discovery']['player_benefit']+'\nEvidência: '+run_url)

    def publish_candidate(self, sha, directory):
        if not re.fullmatch(r'[0-9a-f]{40}',sha): raise ValueError('SHA de candidata inválido.')
        bundle=Path(directory)/'candidate.bundle'
        if not bundle.is_file(): raise ValueError('Bundle da implementação ausente.')
        bare=self.directory/'integration.git'
        if not bare.exists():
            command(['git','init','--bare',bare])
            command(['git','--git-dir',bare,'remote','add','origin','https://github.com/'+REPO+'.git'])
        command(['git','--git-dir',bare,'fetch','origin',self.state['base_sha']])
        command(['git','--git-dir',bare,'fetch',bundle,'HEAD'])
        if command(['git','--git-dir',bare,'rev-parse','FETCH_HEAD'])!=sha:
            raise ValueError('Bundle não corresponde ao resultado da implementação.')
        command(['git','--git-dir',bare,'merge-base','--is-ancestor',self.state['base_sha'],sha])
        check_changes(command(['git','--git-dir',bare,'diff','--name-only',self.state['base_sha'],sha]).splitlines())
        for entry in command(['git','--git-dir',bare,'ls-tree','-r',sha]).splitlines():
            if entry.split(' ',1)[0] in ['120000','160000']:
                raise ValueError('Candidata introduziu links simbólicos ou submódulos.')
        command(['git','-c','credential.helper=','-c',f'credential.helper=!{GH} auth git-credential',
                 '--git-dir',bare,'push','origin',sha+':refs/heads/'+self.state['branch']])

    def tick(self):
        if not self.config.get('enabled') or self.state.get('halted_reason'): return
        if not self.state.get('id'):
            if time.time()>=self.state.get('next_at',0): self.start()
            return
        if time.time()-self.state['started_at']>self.config.get('max_mission_seconds',14400):
            self.finish('blocked','Limite total atingido; código e evidências preservados.');return
        command([HERMES,'kanban','heartbeat',self.state['card'],'--note','Controlador ativo; estado '+self.state['phase']])
        phase=self.state['phase']
        if self.state.get('retry_at'):
            if time.time()>=self.state['retry_at']:
                del self.state['retry_at'];self.dispatch(phase)
            return
        if phase in ['ci','merge']:
            pr=json.loads(gh('pr','view',str(self.state['pr']),'-R',REPO,'--json',
                              'headRefOid,baseRefOid,mergeStateStatus,statusCheckRollup,state,mergeCommit'))
            if pr['state']=='CLOSED': self.finish('discarded','PR encerrado externamente.');return
            if pr['state']=='MERGED':
                self.state.update(phase='pages',published_sha=pr['mergeCommit']['oid']);self.save();return
            if pr['mergeStateStatus']=='BEHIND':
                gh('api',f"repos/{REPO}/pulls/{self.state['pr']}/update-branch",'-X','PUT',
                   '-f','expected_head_sha='+pr['headRefOid']);return
            if not checks_green(pr['statusCheckRollup']):
                failed=any(c.get('conclusion') in ['FAILURE','TIMED_OUT','ACTION_REQUIRED'] for c in pr['statusCheckRollup'])
                if failed:
                    if self.state['round']>=2: self.finish('blocked','CI falhou após limite; não haverá merge.');return
                    runs=json.loads(gh('run','list','-R',REPO,'--workflow','ci.yml','--commit',pr['headRefOid'],
                                      '--limit','1','--json','databaseId'))
                    logs=gh('run','view',str(runs[0]['databaseId']),'-R',REPO,'--log-failed') if runs else ''
                    relevant=[line for line in logs.splitlines() if re.search(r'fail|error|expected|received|seed|semente|Assertion',line,re.I)]
                    self.state.update(round=self.state['round']+1,candidate_sha=pr['headRefOid'],base_sha=pr['baseRefOid'],
                                      feedback={'reason':'CI obrigatório falhou','pr':self.state['pr'],
                                                'log':'\n'.join(relevant)[:12000]})
                    self.save();self.dispatch('build')
                return
            if pr['mergeStateStatus']!='CLEAN': return
            if phase=='ci' or pr['headRefOid']!=self.state.get('approved_sha') or pr['baseRefOid']!=self.state.get('approved_base'):
                self.state.update(candidate_sha=pr['headRefOid'],base_sha=pr['baseRefOid']);self.save();self.dispatch('evaluate');return
            gh('pr','merge',str(self.state['pr']),'-R',REPO,'--squash','--match-head-commit',pr['headRefOid']);return
        if phase=='pages':
            runs=json.loads(gh('run','list','-R',REPO,'--workflow','pages.yml','--commit',self.state['published_sha'],
                                '--limit','5','--json','conclusion,status,databaseId'))
            if not any(r['conclusion']=='success' for r in runs): return
            url=json.loads(gh('api',f'repos/{REPO}/pages'))['html_url']
            with urllib.request.urlopen(url+'version.json?factory='+self.state['published_sha'],timeout=20) as response:
                version=json.load(response)
            if version.get('commit')!=self.state['published_sha']: return
            self.state['published_url']=url;self.save();self.dispatch('verify');return
        runs=json.loads(gh('run','list','-R',REPO,'--workflow',WORKFLOW,'--limit','30','--json',
                          'databaseId,displayTitle,status,conclusion,url'))
        matching=[r for r in runs if r['displayTitle']==f"Factory {self.state['id']} {phase} {self.state['request_id']}"]
        if not matching:
            if time.time()-self.state['dispatch_at']>600: self.finish('blocked','Disparo não localizado; sem repetir às cegas.')
            return
        run=matching[0]
        if run['status']!='completed': return
        target=self.directory/'results'/str(run['databaseId'])
        if not (target/'result.json').exists():
            target.mkdir(parents=True,exist_ok=True)
            gh('run','download',str(run['databaseId']),'-R',REPO,'--name','factory-result','--dir',str(target))
        result=json.loads((target/'result.json').read_text())
        self.result(result,run['url'],target)


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('mode',choices=['tick','worker'])
    parser.add_argument('--directory',default='/opt/data/factory')
    args=parser.parse_args()
    if args.mode=='worker': return worker(os.environ['FACTORY_PHASE'],json.loads(os.environ['FACTORY_CONTEXT']))
    for file in ['/opt/data/profiles/arquiteto/.env','/opt/data/.env']:
        if Path(file).exists():
            for line in Path(file).read_text().splitlines():
                if line.startswith('GH_TOKEN=') and line.partition('=')[2].strip():
                    os.environ['GH_TOKEN']=line.partition('=')[2].strip().strip('"\'')
    import fcntl
    directory=Path(args.directory);directory.mkdir(parents=True,exist_ok=True)
    with (directory/'controller.lock').open('w') as lock:
        try: fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError: return 0
        Controller(directory).tick()
    return 0


if __name__=='__main__':
    sys.exit(main())
