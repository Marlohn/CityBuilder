"""Provas de integridade do ciclo novo; sem rede e sem LLM."""
import json
import hashlib
import tempfile
import unittest
from pathlib import Path

from factory import check_changes, parse_model_result, validate_discovery, validate_evaluation, checks_green, Controller, command, SessionIncomplete, snapshot_candidate, clone_candidate, ask_model
from unittest.mock import patch
import os
from types import SimpleNamespace


def observation(root, identifier, actions):
    png = b'proof-image-' + identifier.encode()
    (root / (identifier+'.png')).write_bytes(png)
    (root / (identifier+'.json')).write_text(json.dumps(dict(id=identifier,actions=actions,
        errors=[],browserErrors=[],sha256=hashlib.sha256(png).hexdigest())))


class FactoryTests(unittest.TestCase):
    def test_continuation_keeps_session_directory_and_total_deadline(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            first='\n'.join(map(json.dumps,[dict(type='text',sessionID='ses_same',part=dict(text='Maximum steps reached. Finish tests.')),
                                          dict(type='step_finish',sessionID='ses_same',part=dict(reason='stop'))]))
            last='\n'.join(map(json.dumps,[dict(type='text',sessionID='ses_same',part=dict(text='{"summary":"finished","tests":["tests/unit/x.test.ts"]}')),
                                         dict(type='step_finish',sessionID='ses_same',part=dict(reason='stop'))]))
            responses=[SimpleNamespace(stdout=x,stderr='',returncode=0) for x in [first,last]]
            saved=[]
            with patch.dict(os.environ,{'FACTORY_OUTPUT':str(root),'CI':'true'}),patch('factory.subprocess.run',side_effect=responses) as cli:
                result=ask_model(root,'mission','build',build=True,checkpoint=saved.append,max_seconds=120)
            self.assertEqual(result['summary'],'finished')
            calls=cli.call_args_list
            self.assertEqual(len(calls),2)
            self.assertIn('--session',calls[1].args[0]);self.assertIn('ses_same',calls[1].args[0])
            self.assertEqual(calls[0].kwargs['cwd'],calls[1].kwargs['cwd'])
            self.assertLessEqual(calls[1].kwargs['timeout'],calls[0].kwargs['timeout'])
            permissions=json.loads(calls[0].kwargs['env']['OPENCODE_CONFIG_CONTENT'])['permission']
            self.assertEqual(permissions['edit']['tests/acceptance/*'],'deny')
            self.assertNotIn('CI',calls[0].kwargs['env'])
            bash=permissions['bash']
            self.assertNotIn('npm test*',bash)
            self.assertNotIn('npm run check*',bash)
            self.assertEqual(bash['npm test -- tests/*'],'allow')
            self.assertEqual(len(saved),2)
            self.assertIn('Maximum steps',(root/'build.jsonl').read_text())

    def test_step_limit_is_incomplete_even_if_summary_contains_json(self):
        events=[dict(type='text',part=dict(text='{"summary":"earlier"}')),
                dict(type='text',part=dict(text='Maximum steps reached. Still unfinished.')),
                dict(type='step_finish',part=dict(reason='stop'))]
        with self.assertRaises(SessionIncomplete): parse_model_result('\n'.join(map(json.dumps,events)))

    def test_shallow_checkout_fails_before_creating_candidate(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);repo=root/'source';repo.mkdir()
            command(['git','init',repo]);command(['git','config','user.name','Test'],cwd=repo)
            command(['git','config','user.email','test@example.invalid'],cwd=repo)
            (repo/'file').write_text('base');command(['git','add','.'],cwd=repo)
            command(['git','commit','-m','base'],cwd=repo)
            (repo/'file').write_text('next');command(['git','commit','-am','next'],cwd=repo)
            shallow=root/'shallow';command(['git','clone','--depth','1',repo.as_uri(),shallow])
            candidate=root/'candidate';sha=command(['git','rev-parse','HEAD'],cwd=shallow)
            with self.assertRaisesRegex(ValueError,'fetch-depth: 0'):
                clone_candidate(shallow,candidate,sha,'dev/test')
            self.assertFalse(candidate.exists())
            self.assertFalse(candidate.with_suffix('.source.bundle').exists())

    def test_partial_source_survives_in_bundle_and_is_not_a_completed_feature(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);repo=root/'source';repo.mkdir()
            command(['git','init',repo]);command(['git','config','user.name','Test'],cwd=repo)
            command(['git','config','user.email','test@example.invalid'],cwd=repo)
            (repo/'packages').mkdir();(repo/'packages/file.ts').write_text('before')
            command(['git','add','.'],cwd=repo);command(['git','commit','-m','base'],cwd=repo)
            base=command(['git','rev-parse','HEAD'],cwd=repo)
            candidate=root/'candidate';clone_candidate(repo,candidate,base,'dev/test')
            command(['git','config','user.name','Test'],cwd=candidate)
            command(['git','config','user.email','test@example.invalid'],cwd=candidate)
            (candidate/'packages/file.ts').write_text('unfinished')
            (candidate/'packages/new.ts').write_text('new unfinished file')
            out=root/'proof';out.mkdir()
            sha=snapshot_candidate(candidate,base,out,'checkpoint')
            self.assertEqual(command(['git','status','--porcelain'],cwd=repo),'')
            self.assertTrue((candidate/'.git').is_dir())
            fresh=root/'resumed';command(['git','clone',repo,fresh])
            command(['git','fetch',out/'candidate.bundle','HEAD'],cwd=fresh)
            command(['git','switch','--detach','FETCH_HEAD'],cwd=fresh)
            self.assertEqual(command(['git','rev-parse','HEAD'],cwd=fresh),sha)
            self.assertEqual((fresh/'packages/new.ts').read_text(),'new unfinished file')
            (candidate/'AGENTS.md').write_text('change protections')
            with self.assertRaises(ValueError): snapshot_candidate(candidate,base,out,'invalid')

    def test_checkpoint_resumes_same_issue_without_pr_and_preserves_budget(self):
        controller=Controller.__new__(Controller)
        controller.state=dict(id='mission',phase='build',request_id='r',base_sha='base',issue=260,
                              card='same-card',started_at=__import__('time').time(),build_model_seconds=300)
        controller.note=lambda text:None;controller.save=lambda:None
        controller.publish_candidate=lambda sha,directory:None
        dispatched=[];controller.dispatch=lambda phase:dispatched.append(phase)
        result=dict(mission='mission',phase='build',request_id='r',base_sha='base',status='checkpoint',
                    candidate_sha='partial',build_model_seconds=600,error='unfinished',resume_summary='finish tests')
        with patch('factory.gh') as api: controller.result(result,'run','directory')
        self.assertEqual(controller.state['issue'],260)
        self.assertEqual(controller.state['card'],'same-card')
        self.assertEqual(controller.state['build_model_seconds'],600)
        self.assertEqual(controller.state['candidate_sha'],'partial')
        self.assertEqual(dispatched,['build']);api.assert_not_called()
        self.assertNotIn('pr',controller.state)

    def test_operator_resume_preserves_elapsed_budget_history_and_failure_counter(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);(root/'history').mkdir();checkpoint=root/'partial';checkpoint.mkdir()
            mission='f202610030612-75692d'
            archived=dict(id=mission,phase='build',base_sha='base',card='same-card',issue=260,
                          branch='dev/test',started_at=1000,finished_at=2200,outcome='blocked',
                          discovery={'acceptance':[{'id':'AC1','behavior':'fixed'}]})
            history=root/'history'/(mission+'.json');history.write_text(json.dumps(archived))
            metadata=dict(mission=mission,base_sha='base',candidate_sha='partial',build_model_seconds=435,summary='finish tests')
            (checkpoint/'checkpoint.json').write_text(json.dumps(metadata))
            controller=Controller.__new__(Controller);controller.directory=root
            controller.state=dict(halted_reason='three failures',consecutive_failures=3)
            controller.config=dict(enabled=True,max_mission_seconds=14400)
            controller.save=lambda:None;controller.note=lambda text:None
            controller.publish_candidate=lambda sha,directory:None
            dispatched=[];controller.dispatch=dispatched.append
            with patch('factory.command'),patch('factory.time.time',return_value=10000):
                controller.resume(mission,checkpoint,'User authorized repair')
            self.assertEqual(controller.state['started_at'],8800)
            self.assertEqual(controller.state['consecutive_failures'],3)
            self.assertEqual(controller.state['build_model_seconds'],435)
            self.assertEqual(controller.state['discovery'],archived['discovery'])
            self.assertEqual(controller.state['issue'],260)
            self.assertEqual(json.loads(history.read_text()),archived)
            self.assertEqual(dispatched,['build'])
            controller.state={'consecutive_failures':3}
            metadata['build_model_seconds']=1800;(checkpoint/'checkpoint.json').write_text(json.dumps(metadata))
            with self.assertRaises(ValueError): controller.resume(mission,checkpoint,'No remaining time')

    def test_checkpoint_limit_does_not_create_another_issue_or_renew_budget(self):
        controller=Controller.__new__(Controller)
        controller.state=dict(id='m',phase='build',request_id='r',base_sha='b',checkpoint_resumes=2,build_model_seconds=1700)
        controller.note=lambda text:None;controller.save=lambda:None;controller.publish_candidate=lambda *args:None
        stopped=[];controller.finish=lambda *args:stopped.append(args[0])
        controller.dispatch=lambda phase:self.fail('Must stop after checkpoint limit')
        result=dict(mission='m',phase='build',request_id='r',base_sha='b',status='checkpoint',candidate_sha='partial',build_model_seconds=1750)
        controller.result(result,'run','directory')
        self.assertEqual(stopped,['blocked'])
        result['build_model_seconds']=0
        with self.assertRaises(ValueError): controller.result(result,'run','directory')

    def test_exit_zero_without_final_answer_is_not_success(self):
        with self.assertRaises(ValueError):
            parse_model_result('{"type":"text","part":{"text":"{\"done\":true}"}}\n')

    def test_provider_error_cannot_become_success(self):
        events = [dict(type="text", part=dict(text='{"done":true}')),
                  dict(type="step_finish", part=dict(reason="stop")), dict(type="error", error={})]
        with self.assertRaises(ValueError):
            parse_model_result("\n".join(map(json.dumps, events)))

    def test_discovery_needs_real_interaction_and_evidence(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            observation(root,'0001',[])
            proposal = dict(decision='mission', title='Teste', problem='Problema', hypothesis='Proposta',
                            player_benefit='Benefício', category='usability', evidence=['0001'],
                            acceptance=[dict(id='a',behavior='Comportamento')])
            with self.assertRaises(ValueError):
                validate_discovery(proposal, root)
            observation(root,'0002',[{'type':'key','key':'i'}])
            proposal['evidence'] = ['9999']
            with self.assertRaises(ValueError):
                validate_discovery(proposal, root)
            proposal['evidence'] = ['0002']
            self.assertEqual(validate_discovery(proposal,root)['decision'],'mission')
            proposal['acceptance'][0]['id'] = 'AC1'
            self.assertEqual(validate_discovery(proposal,root)['acceptance'][0]['id'],'AC1')
            proposal['acceptance'][0]['id'] = '../AC1'
            with self.assertRaises(ValueError): validate_discovery(proposal,root)
            proposal['acceptance'][0]['id'] = 'AC1'
            observation(root,'0002',[{'type':'wait','ms':3000},{'type':'reset'}])
            with self.assertRaises(ValueError): validate_discovery(proposal,root)

    def test_evaluation_cannot_change_criteria_or_approve_without_comparison(self):
        mission = dict(acceptance=[dict(id='a',behavior='A')])
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            verdict = dict(verdict='accept', summary='Bom', criteria=[dict(id='inventado',passed=True,
                              baseline=['0001'],candidate=['0001'])])
            with self.assertRaises(ValueError):
                validate_evaluation(verdict, mission, root)

    def test_executor_cannot_edit_its_judge_or_existing_acceptance(self):
        for path in ['.github/workflows/ci.yml','hermes/harness/factory.py','tools/check.ts',
                     'AGENTS.md','packages/ui/AGENTS.md','tests/acceptance/foo.test.ts','package.json']:
            with self.assertRaises(ValueError):
                check_changes([path])
        check_changes(['packages/ui/src/app.tsx','tests/unit/app.test.ts'])

    def test_partial_or_failed_ci_is_not_merge_permission(self):
        checks = [dict(name=name, conclusion='SUCCESS',status='COMPLETED') for name in
                  ['npm run check','teste de tela (Playwright)','testes de aceitação protegidos',
                   'testes lentos (coorte IBGE e cidade de 50 mil)']]
        self.assertTrue(checks_green(checks))
        self.assertFalse(checks_green(checks[:-1]))
        checks[0]['conclusion'] = 'CANCELLED'
        self.assertFalse(checks_green(checks))

    def test_old_stage_result_does_not_start_new_work(self):
        controller=Controller.__new__(Controller)
        controller.state=dict(id='mission',phase='build',base_sha='base',request_id='second-build')
        with self.assertRaises(ValueError):
            controller.result(dict(mission='mission',phase='build',base_sha='base',
                                   request_id='first-build',status='success'),'https://example.org/run')
        self.assertEqual(controller.state['phase'],'build')

    def test_changed_candidate_invalidates_acceptance_before_merge(self):
        controller=Controller.__new__(Controller)
        controller.config=dict(enabled=True)
        controller.state=dict(id='mission',phase='merge',started_at=__import__('time').time(),
                              card='card',pr=1,approved_sha='old',approved_base='base')
        controller.save=lambda:None
        dispatched=[]
        controller.dispatch=lambda phase:dispatched.append(phase)
        checks=[dict(name=name,conclusion='SUCCESS') for name in
                ['npm run check','teste de tela (Playwright)','testes de aceitação protegidos',
                 'testes lentos (coorte IBGE e cidade de 50 mil)']]
        pr=dict(state='OPEN',headRefOid='new',baseRefOid='base',mergeStateStatus='CLEAN',statusCheckRollup=checks)
        with patch('factory.command'),patch('factory.gh',return_value=json.dumps(pr)) as api:
            controller.tick()
        self.assertEqual(dispatched,['evaluate'])
        self.assertFalse(any('merge' in c.args for c in api.call_args_list))

    def test_bundle_is_verified_before_publishing(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            repo=root/'repo';repo.mkdir()
            command(['git','init',repo])
            command(['git','config','user.name','Factory test'],cwd=repo)
            command(['git','config','user.email','factory@example.invalid'],cwd=repo)
            (repo/'packages').mkdir();(repo/'packages/proof.txt').write_text('before')
            command(['git','add','.'],cwd=repo);command(['git','commit','-m','base'],cwd=repo)
            base=command(['git','rev-parse','HEAD'],cwd=repo)
            controller=Controller.__new__(Controller);controller.directory=root
            controller.state=dict(base_sha=base,branch='dev/factory-test')
            bare=root/'integration.git'
            command(['git','clone','--bare',repo,bare])
            # Fetch pode iniciar maintenance em background e disputar a limpeza da fixture.
            command(['git','--git-dir',bare,'config','maintenance.auto','false'])
            command(['git','--git-dir',bare,'remote','set-url','origin',repo])
            (repo/'packages/proof.txt').write_text('after')
            command(['git','add','.'],cwd=repo);command(['git','commit','-m','candidate'],cwd=repo)
            sha=command(['git','rev-parse','HEAD'],cwd=repo)
            command(['git','bundle','create',root/'candidate.bundle','HEAD','^'+base],cwd=repo)
            pushes=[]
            def guarded(args,**kwargs):
                if 'push' in args: pushes.append(args);return ''
                return command(args,**kwargs)
            with patch('factory.command',side_effect=guarded):
                controller.publish_candidate(sha,root)
                self.assertEqual(len(pushes),1)
                with self.assertRaises(ValueError): controller.publish_candidate('0'*40,root)
                (repo/'AGENTS.md').write_text('remove protections')
                command(['git','add','.'],cwd=repo);command(['git','commit','-m','invalid'],cwd=repo)
                invalid=command(['git','rev-parse','HEAD'],cwd=repo)
                command(['git','bundle','create',root/'candidate.bundle','HEAD','^'+base],cwd=repo)
                with self.assertRaises(ValueError): controller.publish_candidate(invalid,root)
                self.assertEqual(len(pushes),1)

    def test_repeated_failures_stop_without_creating_new_missions(self):
        controller=Controller.__new__(Controller)
        controller.config=dict(enabled=True)
        controller.state=dict(halted_reason='Inspect failures')
        controller.start=lambda:self.fail('Must not create another mission')
        controller.tick()

    def test_denied_dispatch_records_access_block_without_blind_retries(self):
        controller=Controller.__new__(Controller)
        controller.config={}
        controller.state=dict(id='mission',phase='observe',request_id='request',base_sha='base',started_at=0)
        controller.save=lambda:None
        finished=[]
        def finish(outcome,reason):
            finished.append(outcome);controller.state={}
        controller.finish=finish
        with patch('factory.gh',side_effect=RuntimeError('HTTP 403: denied')):
            controller.dispatch_saved()
        self.assertEqual(finished,['blocked'])
        self.assertTrue(controller.state['needs_access'])
        self.assertIn('Contents',controller.state['halted_reason'])

    def test_dispatch_uses_existing_repository_permission_and_exact_request(self):
        controller=Controller.__new__(Controller)
        controller.config={}
        controller.state=dict(id='mission',phase='observe',request_id='request',base_sha='base',started_at=0)
        controller.note=lambda text:None
        with patch('factory.gh') as api: controller.dispatch_saved()
        call=api.call_args
        self.assertIn('repos/Marlohn/CityBuilder/dispatches',call.args)
        payload=json.loads(call.kwargs['input'])
        self.assertEqual(payload['event_type'],'factory-stage')
        self.assertEqual(payload['client_payload']['request_id'],'request')
        self.assertEqual(json.loads(payload['client_payload']['context'])['base_sha'],'base')


if __name__ == '__main__':
    unittest.main()
