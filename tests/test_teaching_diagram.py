import unittest
from pydantic import ValidationError
from wujian.teaching_diagram import DiagramScene,solve_contacts
from wujian.foundation import plan_signature


class DiagramBoundaries(unittest.TestCase):
    def test_contact_solver_moves_cap_to_surface_and_approaches_from_outside(self):
        scene=self.scene()
        scene['parts'].append({'id':'cap','name':'脚垫','shape':'cyl','size':[30,10,30],'pos':[0,0,0], 'attach_to':'leg','face':'+y'})
        scene.update(focus_ids=['cap'],action='insert')
        solved=solve_contacts(DiagramScene.model_validate(scene))
        leg,cap=solved.parts
        self.assertEqual(cap.pos[1]-cap.size[1]/2,leg.pos[1]+leg.size[1]/2)
        self.assertGreater(solved.movement[1],0)
        self.assertGreaterEqual(leg.pos[1]-leg.size[1]/2,0)

    def test_presentation_does_not_relabel_physical_goal_feedback(self):
        plan={'schema':'interaction/1','kind':'guidance','entries':[{'id':'cap','title':'装脚垫'}]}
        signature=plan_signature('装脚垫',[],{},plan)
        self.assertEqual(signature,plan_signature('装脚垫',[],{}, {**plan,'visualizations':{'cap':{'scene':'diagram'}}}))
        self.assertNotEqual(signature,plan_signature('装脚垫',[],{}, {**plan,'entries':[{'id':'cap','title':'改做桌腿'}]}))

    def scene(self):
        return {'title':'脚垫图解','parts':[{'id':'leg','name':'桌腿','size':[40,400,40],'pos':[0,200,0]}],
            'focus_ids':['leg'],'explanation':'先核对实物位置。','uncertainty':'简化形状，非实测尺寸。'}

    def test_reference_and_geometry_limits(self):
        self.assertEqual(DiagramScene.model_validate(self.scene()).focus_ids,['leg'])
        for change in [{'focus_ids':['unknown']},{'parts':[{'id':'leg','name':'桌腿','size':[0,1,1],'pos':[0,0,0]}]},
            {'parts':[{'id':'leg','name':'桌腿','size':[10,10,10],'pos':[float('nan'),0,0]}]},
            {'turns':999}]:
            with self.assertRaises(ValidationError): DiagramScene.model_validate({**self.scene(),**change})
