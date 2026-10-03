"""Provas de integridade do ciclo novo; sem rede e sem LLM."""
import json
import hashlib
import tempfile
import unittest
from pathlib import Path

from factory import check_changes, parse_model_result, validate_discovery, validate_evaluation, checks_green, Controller, command
from unittest.mock import patch


def observation(root, identifier, actions):
    png = b'proof-image-' + identifier.encode()
    (root / (identifier+'.png')).write_bytes(png)
    (root / (identifier+'.json')).write_text(json.dumps(dict(id=identifier,actions=actions,
        errors=[],browserErrors=[],sha256=hashlib.sha256(png).hexdigest())))


class FactoryTests(unittest.TestCase):
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
        controller.state=dict(id='mission',phase='observe',request_id='request',base_sha='base')
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
        controller.state=dict(id='mission',phase='observe',request_id='request',base_sha='base')
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
