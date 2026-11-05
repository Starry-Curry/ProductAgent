"""Rendered UI regression: instructions must not become after-sales results.

All API data and the clipboard destination are explicit fixtures. No model,
device, real clipboard or database is used. The domestic Haier model is real;
ownership, reports and task history are synthetic.
"""
import argparse
import asyncio
import json
import re
from pathlib import Path

from playwright.async_api import async_playwright, expect
from creative_memory_ui import fixture

INSTRUCTION = "请检查外部排水管有没有弯折或受压；若有请拉直后再试。"
REPORT = "屏幕没有显示错误代码，程序已经暂停了，水还是排不出去。"


async def main(url, output):
    output.mkdir(parents=True, exist_ok=True)
    person, workspace = fixture()
    for item in workspace['items']:
        item['photo_id'] = None
    workspace['items'][0]['state'] = {'availability':'unavailable', 'presentation':{'attention':'paused'}}
    towel = {**workspace['items'][1], 'id':'towel', 'name':'家里的接水毛巾（合成）',
             'kind':'nonstandard_object', 'description':'隔离测试中的普通毛巾，不设商业型号。',
             'avatar':{**workspace['items'][1]['avatar'], 'enabled':False, 'nickname':''},
             'state':{'availability':'available','presentation':{'attention':'normal','location':'洗衣机旁'}}}
    workspace['items'].append(towel)
    task = {'id':'guidance_summary','goal':'洗衣机的水排不出去，先检查能自己处理的地方',
            'item_ids':['washer','towel'],'constraints':{},'status':'in_progress','version':1,
            'feedback':[{'text':'模型提炼摘要：未显示错误代码，排水仍异常。','source_quote':REPORT,'outcome':'unknown'},
                        {'text':'此前反馈：更换模式后仍未改善。','outcome':'unknown'}],
            'plan':{'schema':'interaction/1','kind':'guidance','entries':[
                {'id':'program','title':'确认程序已暂停','item_id':'washer','group':'step','state':'pending','note':'先确认程序已暂停，再检查外部排水管。'},
                {'id':'hose','title':'检查外部排水管','item_id':'washer','group':'step','state':'pending','note':INSTRUCTION},
                {'id':'towel','title':'准备接水毛巾','item_id':'towel','group':'owned','state':'ready','note':'先把接水毛巾放在旁边，暂不代表已完成排水检查。'}]}}
    workspace['tasks'] = [task]
    workspace['conversations'] = []
    calls, errors, checks = [], [], []
    def board():
        return {'task':task,'kind':task['plan']['kind'],'entries':task['plan']['entries'],
                'completed_count':sum(row['state']=='ready' for row in task['plan']['entries']),
                'total_count':len(task['plan']['entries']),'access':'owner','sources':[],'participants':[],
                'conversation_id':'guidance_thread'}
    async with async_playwright() as p:
        browser = await p.chromium.launch(executable_path='C:/Program Files/Google/Chrome/Application/chrome.exe',headless=True)
        context = await browser.new_context(viewport={'width':390,'height':844})
        await context.add_init_script("Object.defineProperty(navigator,'clipboard',{value:{writeText:async(text)=>{window.__copiedSummary=text}}})")
        page = await context.new_page()
        page.on('pageerror',lambda error:errors.append(str(error)))
        async def api(route):
            request = route.request
            path = request.url.split('/api',1)[1].split('?',1)[0]
            calls.append(request.method+' '+path)
            if path == '/me': value = person
            elif path == '/health': value = {'model_configured':False,'demo_mode':False}
            elif path == '/workspace': value = workspace
            elif path.endswith('/board'): value = board()
            elif path.endswith('/conversation'): value = {'conversation_id':'guidance_thread','entry_context':{'intent':'guidance','task_id':task['id']}}
            elif path == '/conversations/guidance_thread/messages': value = []
            elif '/entries/' in path and request.method == 'PATCH':
                payload = request.post_data_json
                assert payload['expected_version'] == task['version']
                row = next(row for row in task['plan']['entries'] if row['id'] == path.split('/')[-1])
                row.update(state=payload['state'],note=payload['note'],updated_by=person['id'])
                task['version'] += 1
                value = board()
            else: raise AssertionError(request.method+' '+path)
            await route.fulfill(json=value)
        await page.route('**/api/**',api)
        await page.goto(url+'/#companion?task=guidance_summary')
        await page.get_by_role('button',name='做到了',exact=False).click()
        await expect(page.locator('.guidance-card')).to_contain_text('第 2 步')
        await page.locator('.step-track button').first.click()
        await expect(page.locator('.guidance-card')).to_contain_text('用户报告完成步骤')
        await expect(page.locator('.guidance-visual [aria-label]')).to_have_attribute('aria-label','阳台的洗衣机，尚未添加实物照片')
        await page.locator('.step-track button').filter(has_text='准备接水毛巾').click()
        await expect(page.locator('.guidance-card')).to_contain_text('用户报告资源已备妥')
        await expect(page.locator('.guidance-card')).not_to_contain_text('用户报告完成步骤')
        await page.screenshot(path=str(output/'guidance-resource-ready-mobile.png'),full_page=True,animations='disabled')
        visual = await page.locator('.guidance-visual [aria-label]').get_attribute('aria-label')
        observation = {'entry_item_id':'towel','task_item_ids':task['item_ids'], 'towel_kind':towel['kind'],
                       'towel_state':towel['state'],'washer_state':workspace['items'][0]['state'],
                       'actual_visual_label':visual,'expected_visual_label':'家里的接水毛巾（合成），尚未添加实物照片'}
        (output/'binding-observation.json').write_text(json.dumps(observation,ensure_ascii=False,indent=2),encoding='utf-8')
        assert visual == observation['expected_visual_label'], observation
        assert workspace['items'][0]['state']['presentation']['attention']=='paused'
        assert towel['state']['availability']=='available'
        checks.append('mixed guidance distinguishes completed step, ready resource and pending step without changing the paused item')
        await page.get_by_role('button',name='整理售后问题说明',exact=True).click()
        text = page.get_by_role('textbox',name='售后问题说明',exact=True)
        summary = await text.input_value()
        assert INSTRUCTION not in summary and task['plan']['entries'][0]['note'] not in summary
        assert REPORT in summary and 'XQG80-B1286' in summary
        assert '物品：家里的接水毛巾（合成）' in summary
        assert '物品：家里的接水毛巾（合成）；型号' not in summary
        assert '已标记完成或备妥的项目' in summary and '尚待处理的项目' in summary
        assert '确认程序已暂停：用户报告完成步骤' in summary
        assert '准备接水毛巾：用户报告已准备' in summary
        assert '检查外部排水管：尚未报告完成' in summary
        assert '用户原话：'+REPORT in summary and '仍待补充或核实' in summary
        assert '模型提炼摘要：未显示错误代码，排水仍异常。' not in summary
        assert '反馈记录（未保留原话）：此前反馈：更换模式后仍未改善。' in summary
        await text.fill(summary+'\n补充：今晚发现的，还没联系维修。')
        await page.get_by_role('button',name='复制说明',exact=True).click()
        assert await page.evaluate('window.__copiedSummary') == await text.input_value()
        await page.wait_for_timeout(350)
        await page.screenshot(path=str(output/'guidance-after-sales-mobile.png'),full_page=True,animations='disabled')
        checks.append('after-sales draft separates step progress from feedback, prefers differing source_quote over model text, labels legacy text as a record rather than original words; copy preserves edited text')
        await page.locator('.ant-modal-close').click()
        task['plan']['entries'][2]['item_id'] = None
        await page.goto(url+'/#companion?task=guidance_summary')
        await page.reload()
        await page.locator('.step-track button').filter(has_text='准备接水毛巾').click()
        await expect(page.locator('.guidance-visual')).to_have_count(0)
        task['plan']['entries'][2]['item_id'] = 'towel'
        task['feedback'] = []
        await page.goto(url+'/#companion?task=guidance_summary')
        await page.reload()
        await page.get_by_role('button',name='整理售后问题说明',exact=True).click()
        await expect(text).to_have_value(re.compile('尚无单独记录的用户反馈'))
        await page.locator('.ant-modal-close').click()
        checks.append('missing user feedback is stated as missing rather than fabricated from step notes')
        task['plan'] = {'schema':'interaction/1','kind':'checklist','entries':[{'id':'cup','title':'带上杯子','group':'owned','item_id':'cup','state':'ready','note':''}]}
        task['item_ids'] = ['cup']
        await page.set_viewport_size({'width':1440,'height':1000})
        await page.goto(url+'/#companion?task=guidance_summary')
        await page.reload()
        await expect(page.locator('.checklist-entry')).to_contain_text('已准备（用户报告）')
        await expect(page.locator('.checklist-entry')).not_to_contain_text('用户报告完成步骤')
        checks.append('ordinary resource checklist keeps preparation semantics')
        assert not errors and not any('/chat' in call for call in calls)
        result = {'scope':'API and clipboard fixtures; rendered Chrome, not model/device acceptance','checks':checks,'summary':summary,'calls':calls,'page_errors':errors}
        (output/'report.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
        print(json.dumps(result,ensure_ascii=False,indent=2))
        await browser.close()


if __name__ == '__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--url',default='http://127.0.0.1:8002')
    parser.add_argument('--output',type=Path,default=Path('tmp/after-sales-ux/mixed-realistic-fixture/green'))
    args=parser.parse_args()
    asyncio.run(main(args.url.rstrip('/'),args.output))
