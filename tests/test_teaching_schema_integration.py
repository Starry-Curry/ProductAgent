import unittest
from wujian.turns import TurnResult
class TeachingSchemaIntegration(unittest.TestCase):
    def test_native_final_schema_resolves_nested_step_evidence(self):
        schema=TurnResult.model_json_schema()
        self.assertIn('GuidanceDetails',str(schema))
        self.assertIn('source_id',str(schema))
