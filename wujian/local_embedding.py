"""Optional Intel OpenVINO semantic retrieval. No remote code or CPU fallback.

Weights/tokenizer are the author's multilingual MiniLM (Apache-2.0).
Static [1,128] inputs suit NPU deployment; masked mean pooling and normalization
follow the model card. SQL visibility is checked by the caller after inference.
"""
import hashlib
import json
import threading
import time
from pathlib import Path


class LocalEmbedding:
    def __init__(self,folder,device='NPU',required=False):
        if device not in {'NPU','GPU','CPU'}:raise ValueError('Choose NPU, GPU or explicitly CPU; AUTO fallback is not accepted')
        if required and device=='CPU':raise ValueError('Competition requires GPU/NPU, not CPU')
        self.folder=Path(folder);self.device=device;self.required=required
        self.lock=threading.RLock();self.model=None;self.cache={};self.last={}

    def load(self):
        with self.lock:
            if self.model is not None:return
            import openvino as ov
            from tokenizers import Tokenizer
            self.core=ov.Core()
            if not any(value==self.device or value.startswith(self.device+'.') for value in self.core.available_devices):
                raise RuntimeError(f'{self.device} unavailable; available={self.core.available_devices}; no CPU fallback')
            manifest=json.loads((self.folder/'manifest.json').read_text(encoding='utf-8'))
            for name,digest in manifest['files'].items():
                if name not in {'openvino_model.xml','openvino_model.bin','tokenizer.json'}:raise ValueError('Unexpected model manifest entry')
                if hashlib.sha256((self.folder/name).read_bytes()).hexdigest()!=digest:raise ValueError('Local model checksum differs: '+name)
            model=self.core.read_model(self.folder/'openvino_model.xml')
            model.reshape({port.get_any_name():[1,128] for port in model.inputs})
            self.folder.joinpath('cache').mkdir(exist_ok=True)
            self.model=self.core.compile_model(model,self.device,{'CACHE_DIR':str(self.folder/'cache'),'PERFORMANCE_HINT':'LATENCY'})
            # NPU returns a scalar string, GPU returns a list; normalize before the check.
            executed=self.model.get_property('EXECUTION_DEVICES')
            self.execution_devices=[executed] if isinstance(executed,str) else [str(value) for value in executed]
            if not self.execution_devices or any(not value.startswith(self.device) for value in self.execution_devices):raise RuntimeError('Execution device differs from requested device')
            self.tokenizer=Tokenizer.from_file(str(self.folder/'tokenizer.json'))
            self.tokenizer.enable_truncation(max_length=128);self.tokenizer.enable_padding(length=128,pad_id=0,pad_token='[PAD]')
            self.revision=manifest['revision'];self.model_id=manifest['model_id'];self.calls=0
            self.device_names={value:self.core.get_property(value,'FULL_DEVICE_NAME') for value in self.execution_devices}

    def encode(self,text):
        import numpy as np
        self.load()
        tokens=self.tokenizer.encode(text)
        values={'input_ids':np.asarray([tokens.ids],dtype=np.int64),
            'attention_mask':np.asarray([tokens.attention_mask],dtype=np.int64),'token_type_ids':np.asarray([tokens.type_ids],dtype=np.int64)}
        result=self.model({port.get_any_name():values[port.get_any_name()] for port in self.model.inputs})[self.model.output(0)]
        mask=values['attention_mask'][...,None]
        vector=(result*mask).sum(axis=1)/max(1,mask.sum()) if result.ndim==3 else result
        vector=vector[0].astype(np.float32);vector/=max(float(np.linalg.norm(vector)),1e-9);self.calls+=1
        return vector

    def rank(self,query,documents):
        with self.lock:
            started=time.monotonic();self.load();before=self.calls
            alive={hashlib.sha256(text.encode()).hexdigest() for text in documents.values()}
            self.cache={key:value for key,value in self.cache.items() if key in alive}
            q=self.encode(query);scores={}
            for key,text in documents.items():
                digest=hashlib.sha256(text.encode()).hexdigest()
                if digest not in self.cache:self.cache[digest]=self.encode(text)
                scores[key]=float(q@self.cache[digest])
            ranked=sorted(scores,key=lambda key:scores[key],reverse=True)
            self.last={'backend':'openvino','model':self.model_id,'revision':self.revision,'requested_device':self.device,
                'execution_devices':self.execution_devices,'inferences':self.calls-before,'seconds':round(time.monotonic()-started,4),
                'device_names':self.device_names,
                'ranked_ids':ranked,'used_for':'semantic_document_ranking_in_agent_context',
                'accelerator_executed':any(value.startswith(('GPU','NPU')) for value in self.execution_devices)}
            return ranked,scores,dict(self.last)

    def status(self):
        return {'enabled':True,'requested_device':self.device,'loaded':self.model is not None,'required':self.required,'last_inference':self.last}
