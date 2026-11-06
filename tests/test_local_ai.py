"""Offline boundaries; real model/hardware acceptance is scripts/local_ai.py probe."""
import asyncio,tempfile,unittest
from pathlib import Path

from wujian import domain
from wujian.config import Settings
from wujian.database import ChatMessage,Conversation,make_database
from wujian.local_embedding import LocalEmbedding
from wujian.retrieval import Retrieval


class LocalAiBoundaries(unittest.TestCase):
    def test_accelerator_requirement_never_accepts_cpu_or_auto(self):
        for device in ['AUTO','CPU']:
            with self.assertRaises(ValueError):LocalEmbedding('.',device,required=True)

    def test_semantic_candidate_is_rehydrated_after_forgetting_during_inference(self):
        with tempfile.TemporaryDirectory() as folder:
            settings=Settings(data_dir=Path(folder));settings.prepare();engine,sessions=make_database(settings)
            with sessions() as db:
                domain.seed_demo(db);conversation=Conversation(user_id='person_demo_owner');db.add(conversation);db.flush()
                message=ChatMessage(conversation_id=conversation.id,role='user',text='烫印机要轻压操作');db.add(message);db.flush()
                memory=domain.remember(db,'person_demo_owner','我喜欢把烫印图案放在帆布袋中央',message.id)
                identity=memory['id'];db.commit()
            retrieval=Retrieval(settings,sessions)
            class Local:
                def rank(self,query,documents):
                    with sessions() as db:domain.remove_memory(db,'person_demo_owner',identity)
                    return list(documents),dict.fromkeys(documents,.9),{'execution_devices':['NPU'],'test_double':True}
            retrieval.local=Local()
            retrieval.local.folder=Path(folder)
            async def exercise():
                try:
                    value=await retrieval.search('person_demo_owner','转印摆放位置',['memory'])
                    self.assertEqual(value['results'],[])
                    self.assertEqual(value['mode'],'keyword_plus_openvino')
                finally:await retrieval.close()
            asyncio.run(exercise());engine.dispose()
