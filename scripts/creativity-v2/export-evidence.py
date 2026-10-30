from pathlib import Path
import json,hashlib,statistics,shutil,csv
root=Path('artifacts/creativity-v2');dest=Path('docs/engineering/creativity-v2-2026-10-30/evidence');dest.mkdir(parents=True,exist_ok=True)
for name in ['comparison.json','open-comparison.json','model-variants.json','browser.json','browser-first-failure.json','browser-resume.json','browser-resume-harness-failure.json']:
 shutil.copyfile(root/name,dest/name)
for name in ['explore-desktop.png','explore-mobile.png','conditions-desktop.png','continued-desktop.png','continued-mobile.png']:
 if (root/name).exists():shutil.copyfile(root/name,dest/name)
for name in ['rea-pin.json','read-receipts.json']:
 shutil.copyfile(root/'research'/name,dest/name)
ledger=json.loads(Path('../creativity-v2-evidence/model-calls.json').read_text(encoding='utf-8'))
shutil.copyfile('../creativity-v2-evidence/model-calls.json',dest/'model-calls.json')
shutil.copyfile('../creativity-v2-evidence/model-availability.json',dest/'model-availability.json')
for source,name in [('.runtime/final-offline.log','offline.txt'),('.runtime/typecheck.log','typecheck.txt'),('.runtime/final-build.log','build.txt'),('.runtime/integration.log','integration.txt'),('.runtime/benchmark.log','benchmark.txt')]:
 shutil.copyfile(source,dest/name)
main=json.loads((root/'open-comparison.json').read_text(encoding='utf-8'))
variants=json.loads((root/'model-variants.json').read_text(encoding='utf-8'))
summary={'requests':len(ledger['attempts']),'returned':sum(a['status']=='returned' for a in ledger['attempts']),'failedOrInterrupted':sum(a['status']!='returned' for a in ledger['attempts']),'estimatedOrReservedCny':sum(a.get('estimatedCny',a['reservedCny']) for a in ledger['attempts']),'inputTokens':sum(a.get('tokens',{}).get('prompt_tokens',0) for a in ledger['attempts']),'outputTokens':sum(a.get('tokens',{}).get('completion_tokens',0) for a in ledger['attempts']),'arms':{},'variants':{}}
for arm in ['free','retrieval','hybrid']:
 rs=[r for r in main['records'] if r['arm']==arm];summary['arms'][arm]={'returned':sum(r['status']=='returned' for r in rs),'failed':sum(r['status']!='returned' for r in rs),'medianMs':int(statistics.median(r['elapsedMs'] for r in rs))}
for v in sorted(set(r['variant'] for r in variants['records'])):
 rs=[r for r in variants['records'] if r['variant']==v];summary['variants'][v]={'returned':sum(r.get('status')=='returned' for r in rs),'medianMs':int(statistics.median(r['elapsedMs'] for r in rs))}
(dest/'summary.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
blind=dest/'blind';blind.mkdir(exist_ok=True);keys=[]
for caseId in sorted(set(r['caseId'] for r in main['records'])):
 rs=[*filter(lambda r:r['caseId']==caseId,main['records']),*filter(lambda r:r['caseId']==caseId,variants['records'])]
 rs.sort(key=lambda r:hashlib.sha256(('wujian-blind-v2-'+caseId+str(r.get('variant',r.get('arm')))).encode()).hexdigest())
 common=rs[0]['input'];lines=['# 匿名任务 '+caseId,'','问题：'+common['goal'],'','用户条件：'+common['preferences'][0]['text'],'','所有持有、状态与私人条件均为合成测试。样本隐藏模型/策略名；格式本身无法完全盲化。请在看对照键之前独立判断，不用模型自评分。','']
 lines+=['已提供的物品事实（登记资料不是实物检测）：','', '``````json',json.dumps(common['physicalFacts'],ensure_ascii=False,indent=2),'``````','']
 for index,r in enumerate(rs):
  label=caseId+'-'+chr(65+index);keys.append({'label':label,'arm':r.get('arm'),'variant':r.get('variant'),'model':r['model']})
  result=r.get('result',{});text=result.get('result',result).get('text',r.get('error','没有输出'))
  lines+=['## 样本 '+label,'','状态：'+r.get('status','unknown'),'','``````text',str(text),'``````','']
 lines+=['评审维度：实际价值、不同于原用途、关键机制、资源/限制、个人适配、表达质量。允许判定无合格方案；没有实物验证。','']
 (blind/(caseId+'.md')).write_text('\n'.join(lines),encoding='utf-8')
(dest/'blind-key.json').write_text(json.dumps(keys,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
with (dest/'human-review.csv').open('w',encoding='utf-8-sig',newline='') as f:
 w=csv.writer(f);w.writerow(['sample','reviewer','life_value','new_function','mechanism','resources_constraints','personal_fit','natural_expression','would_try','notes']);w.writerows([[k['label']]+['']*9 for k in keys])
print(json.dumps(summary,ensure_ascii=False,indent=2))

# Presentation/log whitespace only; verbatim model text remains in the JSON.
for p in [*dest.glob("blind/*.md"),*dest.glob("*.txt")]:
 p.write_text("\n".join(line.rstrip() for line in p.read_text(encoding="utf-8").splitlines()).rstrip()+"\n",encoding="utf-8")
