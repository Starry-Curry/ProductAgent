"""Real HTTP/native SDK/SQL continuation; only the model is simulated."""
import unittest
import test_agent_plan_contract as contracts
from wujian.task_progress import apply_entry_reports

class GuidanceIncrementalIntegration(unittest.TestCase):
    def setUp(self):
        self.case=contracts.AgentPlanContractTests();self.case.setUp()
        self.addCleanup(self.case.tearDown)

    def board(self):
        c=self.case
        return c.ok(c.client.post('/api/task-boards',json={'goal':'继续逐步核对卡片玩法','kind':'guidance',
            'entries':[c.entry('one'),c.entry('two')]}))

    def test_short_native_delta_keeps_unreported_pending_steps_and_order(self):
        c=self.case;board=self.board()
        plan,_=c.run_turn([c.proposal([c.entry('one')],board)],'先只解释第一步，后面的留着。')
        self.assertEqual([e['id'] for e in plan['entries']],['one','two'])
        self.assertTrue(all(e['state']=='pending' for e in plan['entries']))

    def test_delta_appends_new_step_without_erasing_previous_pending_steps(self):
        c=self.case;board=self.board()
        plan,_=c.run_turn([c.proposal([c.entry('three')],board)],'再加一个检查，原来的也留着。')
        self.assertEqual([e['id'] for e in plan['entries']],['one','two','three'])
        self.assertTrue(all(e['state']=='pending' for e in plan['entries']))

    def test_report_on_an_omitted_step_uses_the_same_actual_progress_path(self):
        c=self.case;board=self.board();question='第二步我已经做完了。'
        proposal=c.proposal([c.entry('one')],board)
        proposal['continuation']['progress_reports']=[{'entry_id':'two','action_result':'completed','source_quote':question}]
        plan,_=c.run_turn([proposal],question)
        self.assertEqual([e['id'] for e in plan['entries']],['one','two'])
        self.assertEqual([e['state'] for e in plan['entries']],['pending','ready'])

    def test_idea_omission_keeps_existing_full_plan_semantics(self):
        c=self.case
        previous={'schema':'interaction/1','kind':'idea','entries':[c.entry('one'),c.entry('two')]}
        proposed={**previous,'entries':[c.entry('one')]}
        plan,_=apply_entry_reports(proposed,previous,[],'换一个点子',db=None,user_id=c.user['id'])
        self.assertEqual([e['id'] for e in plan['entries']],['one'])
