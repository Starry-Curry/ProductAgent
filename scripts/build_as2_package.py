"""Author a reviewed exterior schematic and data-driven AS2 procedure."""
from pathlib import Path
import json,math
folder=Path(__file__).resolve().parents[1]/'fixtures/teaching';folder.mkdir(parents=True,exist_ok=True)
parts=[]
def box(identity,name,size,pos,color,material='soft',rot=None):
    parts.append(dict(id=identity,name=name,shape='box',size=size,pos=pos,rot=rot or [0,0,0],material=material,color=color))
def button(identity,name,x,z=80,size=14,color='#f5f0e7'):
    parts.append(dict(id=identity,name=name,shape='cyl',size=[size,4,size],pos=[x,300,z],rot=[0,0,0],material='plastic',color=color))
box('base','底座',[430,60,410],[0,30,0],'#d8d8d3')
box('rear','后方支撑机身',[270,192,115],[0,169,-148],'#ece6da')
box('drawer','抽拉熨烫板',[375,28,360],[0,91,12],'#545958')
box('mat','熨烫垫',[355,18,340],[0,114,12],'#696d67')
box('pull_tab','抽屉前方拉手',[58,8,26],[0,100,200],'#eeeae0')
box('upper_plate','上方发热板',[390,35,360],[0,180,0],'#dcd7cd')
box('hot_underside','发热板底面',[350,8,330],[0,159,0],'#444b4b','metal')
box('hood','白色主机外壳',[255,80,280],[0,239,-30],'#eee8dc')
box('panel_surround','操作面板外框',[222,18,210],[0,280,0],'#9eaaa9')
box('panel','控制面板',[205,12,196],[0,290,0],'#eee9dd')
box('display','显示屏',[182,8,85],[0,300,-30],'#263b3e','glass')
button('power','电源键（⏻）',-86,66,19)
button('temperature','温度键（温度计）',-48,50)
button('time','时间键（时钟）',-66,72)
button('pressure','压力键',-48,91)
button('mode','模式键（循环箭头）',-24,70)
button('custom','自定义键（齿轮）',19,70)
button('plus','增加（＋）',43,49)
button('minus','减少（－）',43,91)
button('auto','自动熨压键（A）',66,70)
button('start','启动键（品牌图标）',91,70,19,'#c3d6b9')
(folder/'loklik-as2-model.json').write_text(json.dumps({'schema':'reviewed-exterior/1','author':'Codex','basis':'User AS2 photos 1/2/5 and official mainland manual, visually checked','parts':parts},ensure_ascii=False,indent=2),encoding='utf-8')
steps=[]
def step(identity,title,instruction,signal,target,focus,explanation,reviewed,action='observe',kind='operate',movement=None,page=4):
    value={'id':identity,'title':title,'instruction':instruction,'success_signal':signal,'target_label':target,'focus_ids':focus,
        'explanation':explanation,'reviewed_instruction':reviewed,'manual_pdf_page':page,'action':action,'kind':kind,
        'visual_explanation':title+'；高亮处为本步相关部位。'}
    if movement:value['movement']=movement
    steps.append(value);return value
step('power','打开电源','机器放稳、压板间隙清空后，接好配套电源，短按控制区最左侧带 ⏻ 图标的圆形电源键一次。',
    '看到屏幕点亮就先停在这里。','操作面板按键区最左侧带电源符号 ⏻ 的圆形电源键，不是最右侧的品牌启动键',['power'],
    '先找到屏幕下方那排实体按键。最左边单独的圆键上是电源符号 ⏻；用手指点按后松开即可，不需要长按。视频中的机器没有开机，画面只帮你找位置；开机结果以你现场看到的屏幕为准。',
    'LOKLiK AS2 的电源开关为面板左侧圆键。接电后点按并松开可切换开关机；开机后设备可能开始加热，手应避开发热板。',action='press',page=3)
material=step('mode','核对材料并选择模式','按耗材包装选择匹配的模式；没有核对前先不开始压烫。',
    '选好模式并核对屏幕的温度、时间与压力后告诉我。','操作面板中间偏左带圆形循环箭头的模式键，不是右侧带字母 A 的自动熨压键',['mode','display'],
    '温度、时间和压力取决于耗材及基材，不能给所有材料套同一套参数。模式键位于电源键右边、温度/时间/压力三键旁，图标是循环箭头；右边带 A 的按钮会开启自动熨压，新手先不要把它当模式键。',
    'AS2 有四组固定预置以及四组自定义参数。普通热转印刻字膜对应的预置一为 145℃、15秒、80kg；必须先核对实际耗材和基材的适用要求。',action='press',page=3)
material.update(requires_input='material_parameters',input_question='这次要烫什么耗材和布料？请告诉我包装建议的温度、时间、压力。比如普通刻字膜是否适用 145℃、15秒、80kg；不确定可以拍包装，我们先不开始压烫。',resolved_instruction='{profile_instruction}')
step('preheat','等预热完成','先等最右侧“启动”键的绿灯从闪烁变为常亮，这时不要开始压烫。',
    '你看到启动键绿灯常亮后再告诉我。','操作面板最右侧带品牌图标的启动键及其指示灯，不是最左侧电源键',['start','display'],
    '预热过程中启动键的绿灯闪烁，达到设置温度后才常亮。只靠等待了多久或视频里的外观，不能判断已经预热完成。请看你面前这台机器；如果一直不常亮，告诉我屏幕显示的温度或错误码。',
    'AS2 达到设定温度时，启动按键的绿色指示由闪烁转为常亮；该信号用来核对预热就绪。',kind='verify')
step('drawer_out','拉出熨烫板','握住底部抽屉前缘的拉手，把熨烫板拉出来；手不要伸到上方发热板下面。',
    '抽屉拉出、熨烫垫露出后告诉我。','机器下方抽拉熨烫板前缘中央的浅色拉手，不是最底部底座标志',['drawer','mat','pull_tab'],
    '从机身正前方看，拉手在黑色熨烫垫的前缘中央。抓前缘向自己这边拉，移动的是下方抽屉，白色上部发热板不要碰。',
    'AS2 的下方熨烫板可向前抽出，用于在远离上方热板的位置摆放材料。',movement=[0,0,-110])
step('fabric','放好布料','把已去皱的布料平铺在抽出的熨烫垫上，保持待烫区域平整。',
    '布料平整、待烫处没有折叠或厚接缝后告诉我。','抽出的下方熨烫板上的深灰色熨烫垫表面',['mat','drawer'],
    '把这次要烫的区域放在垫子中央，先把褶皱理平。不要把纽扣、拉链或厚接缝直接堆在图案下方，避免局部受力不均。',
    '材料在 AS2 的熨烫垫上应平整摆放；褶皱会影响接触。先完成材料准备，再推回熨烫板。')
step('design','定位图案','按照耗材包装标明的转印面朝向，把准备好的图案定位在布料上。',
    '图案方向与位置确认后告诉我。','下方熨烫垫与布料放置区域',['mat'],
    '不同耗材的膜层与面向不完全一样，先看包装示意；不要凭透明面或图案正反自行猜。看不懂可以把包装和图案一起拍给我，我们留在这一阶段。',
    'AS2 的材料准备阶段需要在熨烫垫上平放待压材料；具体图案朝向与撕膜方式遵循该耗材说明。')
step('cover','覆盖高温布','在待烫区域上方铺好配套高温布，避免手接触上方热板。',
    '高温布已覆盖、材料仍平整后告诉我。','下方熨烫垫上的待烫区域',['mat','upper_plate'],
    '使用随机器提供的高温布覆盖作品；它不是普通湿毛巾。覆盖时从已经拉出的抽屉前方操作，不伸进上方热板与材料之间。',
    'AS2 手册的材料准备示意要求覆盖高温布后再把熨烫板推回机内。')
step('drawer_in','推回熨烫板','握住抽屉前缘，把熨烫板平稳推回最里面。',
    '抽屉已完全推到底、双手已离开压板间隙后告诉我。','机器下方抽拉熨烫板前缘中央的浅色拉手',['drawer','mat','pull_tab'],
    '移动下方抽屉，不推白色上机身。确保材料没有卷边、卡住或滑落。没有推到底时先别按启动键；不要为了测试去把手放在压板间。',
    'AS2 在启动熨压前，下方熨烫板需要完全推到机内最里面。',movement=[0,0,110])
step('press','启动这一轮压烫','确认双手与杂物离开压板间隙后，短按最右侧带品牌图标的“启动”键一次。',
    '看到压板下降并开始倒计时后告诉我。','操作面板最右侧带品牌图标的圆形启动键，不是最左侧的电源键',['start','upper_plate'],
    '右端启动键和左端电源键用途不同。先核对抽屉已经推到底、材料参数正确、手已离开，再点按右端启动键。不要反复按 A 自动熨压键；那会改变后续触发方式。',
    'AS2 的启动键位于控制区右端。按下后发热板自动下降并启动倒计时；压板运动时应远离夹压区域。',action='press')
step('release','等压板自动升起','等倒计时结束、上方压板自动升起后再取作品；现在先不要把手伸进去。',
    '现场确认压板已升起、动作停止后告诉我。','机器中间的白色上发热板及它与下方熨烫垫之间的间隙',['upper_plate','hot_underside'],
    '这一步只观察，不用重复按启动。示意动画和视频外观都不能证明现场压板已经完成动作。若卡住、出现异常或错误码，请先描述情况，不要徒手拽热板。',
    'AS2 的倒计时结束后，上方发热板会自动抬升复位；待动作停止后再操作抽屉。',kind='verify',movement=[0,-35,0])
step('remove','取出作品','拉出抽屉后按耗材包装要求取出作品；撕膜要遵循它规定的热撕、温撕或冷撕条件。',
    '作品已按包装要求处理后告诉我，也可以先说是否有翘边等现象。','下方抽拉熨烫板及熨烫垫',['drawer','mat','pull_tab'],
    '机器完成压烫不等于胶膜已经可以随意撕。包装不明时先不强行撕膜，也不要立刻套用某个温度重复压；把耗材名称或包装发来核对。',
    'AS2 负责压烫动作；作品取出及膜层处理仍需遵守实际耗材的撕膜条件，不能用机器预置代替耗材说明。',movement=[0,0,-110])
step('off','关闭电源','短按最左侧带 ⏻ 的电源键关机；收纳或清洁前还要等机器完全冷却。',
    '确认已经关机后告诉我。','操作面板最左侧带电源符号 ⏻ 的圆形电源键',['power'],
    '电源键短按用于关机，不是去长按恢复出厂设置。关机后发热部件仍可能很烫，先不要触摸或立即收纳。',
    'AS2 电源键短按可切换关机；使用结束后的清洁与收纳应在切断电源并充分冷却后进行。',action='press',page=3)
for value in steps:
    identity=value['id']
    value['control_closeup']=identity in {'power','mode','preheat','off'}
    def plane(name,title,size,pos,color):return {'id':name,'name':title,'shape':'box','size':size,'pos':pos,'rot':[0,0,0],'material':'soft','color':color}
    if identity in {'fabric','design','cover','drawer_in','press','release','remove'}:
        z=122 if identity in {'fabric','design','cover','remove'} else 12
        value['extra_parts']=[plane('fabric','布料',[280,2,280],[0,125,z],'#d5b990')]
        if identity in {'design','remove'}:value['extra_parts'].append(plane('transfer','图案位置',[100,1,80],[0,127,z],'#7ca6ae'))
        if identity in {'cover','drawer_in','press','release'}:value['extra_parts'].append(plane('covering','高温布',[300,1,290],[0,129,z],'#e8dfcd'))
        if identity=='fabric':value['focus_ids']=['fabric','mat'];value['part_movements']={'fabric':[0,65,0]}
        if identity=='design':value['focus_ids']=['transfer','fabric'];value['part_movements']={'transfer':[0,50,0]}
        if identity=='cover':value['focus_ids']=['covering','fabric'];value['part_movements']={'covering':[0,60,0]}
    if identity=='press':
        value['part_offsets']={'upper_plate':[0,-30,0],'hot_underside':[0,-30,0]}
        value['part_movements']={'upper_plate':[0,30,0],'hot_underside':[0,30,0],'start':[0,2,0],'action_pointer':[0,8,0]}
    if identity=='drawer_in':
        value['part_movements']={key:[0,0,110] for key in ['drawer','mat','pull_tab','fabric','covering']}
    if identity in {'power','off','mode','preheat','press'}:
        point={'power':[167,400],'off':[167,400],'mode':[460,400],'preheat':[880,400],'press':[880,400]}[identity]
        value['picture']={'asset_key':'panel_detail','point':point,'label':{'power':'短按左端 ⏻ 电源键','off':'短按左端 ⏻ 电源键','mode':'循环箭头模式键','preheat':'右端品牌启动键','press':'右端品牌启动键'}[identity]}
    else:
        value['picture']={'asset_key':'front_detail','point':[500,720] if identity!='release' else [500,140],
            'label':'下方抽屉式熨烫板前缘' if identity in {'drawer_out','drawer_in','remove'} else '下方熨烫垫放料区域' if identity!='release' else '观察上方压板与下方垫子的间隙'}
    if identity in {'drawer_out','fabric','design','cover','remove'}:
        value['part_offsets']={part:[0,0,110] for part in ['drawer','mat','pull_tab']}
    if identity=='drawer_out' or identity=='remove':value['movement']=[0,0,-110]
package={'id':'loklik-as2','revision':'2026-11-06.4','goal':'学会用 AS2 完成一次烫印','product_match':{'brand':'LOKLiK','model':'AS2'},
    'manual':{'index_url':'https://www.loklik.cn/files-download/','url':'https://video.loklik.cn/wp-content/uploads/2026/06/多功能自动衣服印画机AS2-说明书.pdf',
        'identity':'大陆 220V HPA01 实体按键版；不是 HPA01-2 Smart 触屏版'},'model_file':'loklik-as2-model.json',
    'profiles':[{'id':'plain-htv-mode1','name':'普通刻字膜 / 模式①','required_report':['普通','刻字膜','145','15','80'],
        'instruction':'已记录你报告的材料包装条件。短按左半边循环箭头的“模式”键，切换到①；核对屏幕为145℃、15秒、80kg，不一致先告诉我。'}],
    'steps':steps,'authoring':'Codex authored, checked against supplied photos and mainland official PDF; instruction text is a paraphrase, not a verbatim manual transcript.'}
package['controls']=[
    {'id':'power','name':'电源键（⏻）','location':'面板最左侧','purpose':'开关机','question_aliases':['⏻'],'answer_terms':['电源','开关机','开机','关机']},
    {'id':'mode','name':'模式键（循环箭头）','location':'面板左半区、三枚参数键右边','purpose':'选择预置模式','question_aliases':['循环箭头'],'answer_terms':['模式','预置']},
    {'id':'auto','name':'自动熨压键（A）','location':'右半区、品牌启动键左边','purpose':'自动熨压模式','question_aliases':['A键','A 键','带 A','带A'],'answer_terms':['自动熨压','自动压烫','自动烫印']},
    {'id':'start','name':'启动键（品牌图标）','location':'面板最右侧','purpose':'预热/开始当前压烫','question_aliases':['品牌图标'],'answer_terms':['启动','压烫','烫印','预热']}
]
(folder/'loklik-as2.json').write_text(json.dumps(package,ensure_ascii=False,indent=2),encoding='utf-8')
print('Authored',len(parts),'exterior parts and',len(steps),'sequential steps')
