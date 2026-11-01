import fs from 'node:fs';import {createHash} from 'node:crypto';
const root='docs/engineering/outcome-qwen-2026-11-02',target=root+'/acceptance-frozen.json';if(fs.existsSync(target))throw Error('frozen_set_exists');
const item=(id,name,facts)=>({id,name,facts,basis:'synthetic_user_report_not_manufacturer_or_physical_verification',synthetic:true});
const cases=[
 ['O01','编织','旧滤水篮还能怎样帮我在沙发上织围巾？毛线总滚到地上。不买、不剪、不粘，请看看我其他东西能否一起用。','basket',[item('basket','退役塑料滤水篮','圆形有孔；无尖边为用户报告；干燥清洁；不再接触食品'),item('yarn','毛线团','直径8cm，线径2mm'),item('tray','旧托盘','平底30×20cm，篮外径18cm；有低边；无承重认证')]],
 ['O02','静音娱乐','想和爸爸在桌边玩一个不用屏幕、不发出碰撞声、十分钟能变化规则的游戏。不买材料，也不写字贴标签。请用已有东西创造玩法。',null,[item('carton','空鸡蛋盒','12格，凹格直径45mm；纸浆干燥'),item('balls','6枚软布球','直径35mm，不含电子元件'),item('towel','小毛巾','柔软干燥，可铺桌面')]],
 ['O03','纪念与赠礼','想把朋友寄来的车票和明信片变成可以反复换内容的桌边纪念展示，不打孔、不粘墙、不损坏纸件；从这个空饼干盒出发找其他可用物品。','tin',[item('tin','空金属饼干盒','内底22×16cm，无透明盖，无磁性验证'),item('postcard','朋友明信片','15×10cm，私人寄语仅本人可读'),item('tickets','旧车票','两张，8×5cm'),item('stand','现有木质卡片座','开槽宽2mm、深10mm，能否稳放本纸件未实测')]],
 ['O04','旅行与收纳','行李里细线总缠成团，如何把已有的旧眼镜盒用出新价值？不要买、剪、粘，不能折坏线或声称充电功能。','case',[item('case','退役硬壳眼镜盒','净空间15×5×3cm；铰链闭合'),item('cable','USB数据线','长1m，最小弯曲半径未确认'),item('ties','两根原包装魔术扎带','可反复开合，不是电气绝缘认证')]],
 ['O05','桌面与尺寸','我想给租房桌面做一个可随手拆的充电线引导，避免线掉地。不粘、不打孔、不另买。不能夹伤桌边。','clips',[item('clips','长尾夹','开口最大19mm；夹口无软垫'),item('desk','已有书桌','桌边厚25mm，木饰面不许压伤'),item('pouch','有拉链的网布袋','宽18cm，可装线但没有固定挂点'),item('charger','现有充电线','接头宽12mm，弯曲半径未知')]],
 ['O06','家居与任务替代','出门两天，希望窗边植物别干死。只用登记物品，不添棉绳、水泵或软管，不许把普通瓶子说成自动滴灌装置。能否给有价值的替代安排？',null,[item('plant','盆栽绿萝','有排水孔，干湿与盆底直径未知'),item('bottle','普通密封水瓶','750mL，无阀门/孔/软管'),item('saucer','花盆托盘','内径18cm，耐长期泡水及盆适配未知')]],
 ['O07','衣物与生活习惯','我喜欢安静，晚归后围巾总堆椅子。想让退役酒架变成更顺手的玄关用途，只用已登记物品，不挂墙、不用火、不靠承重猜测。','rack',[item('rack','木质桌面酒架','6个横向孔格，净宽10cm，高9cm，深20cm；完好为报告'),item('scarves','两条薄围巾','卷后直径7cm，干燥'),item('entry','玄关台','净空宽40深25高35cm；台面水平为报告')]],
 ['O08','兴趣与数值','想在桌上展示一幅完整A4练字作品并给爸爸拍照留念，主要先解决可替换展示，不买材料、不裁纸、不贴墙、不让无支架的相框自行站稳。','frame',[item('frame','无支脚相框','可放纸净空间180×130mm，无挂钩，无支架'),item('paper','A4练字纸','210×297mm，不能折裁'),item('easel','已登记桌面画架','托板宽25cm，可调倾角，稳定性需核对'),item('phone','手机','普通拍照可用，未授权远程控制')]],
 ['O09','烘焙与复用','退休后的硅胶冰格还能怎样帮我的水彩兴趣？我想让不同颜色可分区又方便带回桌边，不买、不加盖、不声称密封。','ice',[item('ice','退役硅胶冰格','12个独立凹格；已退出食品用途；耐溶剂性未知'),item('paint','水性水彩颜料','日常水性，不含用户已知强溶剂'),item('tray','小托盘','平底，净空间28×18cm；冰格外尺寸24×12cm')]],
 ['O10','声音与个性化','把这只普通蓝牙音箱变得更适合我睡前生活，但不要改固件、不要声称有未知定时器或联网控制，也不要买新设备。希望有一个值得实际试的方案。','speaker',[item('speaker','普通蓝牙音箱','可由手机蓝牙播放/暂停；无已确认Wi-Fi或远程接口'),item('phone','旧手机','用户已确认本机播放器支持睡眠定时停止；无硬件控制授权'),item('cloth','软布垫','仅防刮，不证明散热、防水或隔音')]],
 ['O11','家庭协作与隐私','想用桌边这件相框帮爸爸记住我们周末共同做的事，先给一个不要求联网硬件的新玩法，再准备可选择分享的摘要；别把我的私人故事都带过去。','frame',[item('frame','普通桌面相框','有原装支架，能换纸；无屏幕、摄像头和扬声器'),item('cards','可擦写便签卡','10×7cm，现有水性笔可用'),item('pen','水性可擦笔','与现有卡匹配为用户报告')]],
 ['O12','陌生结构与开放创造','我想让这段退役手风琴文件夹更有意思，解决手作时小纸片混在一起的问题。只用已有物，不撕剪、不粘贴，不要只说继续装文件。','folder',[item('folder','退役手风琴文件夹','12个可展开纸隔层，开口上方；无已确认承重；净口宽24cm'),item('scraps','手作纸片','不同步骤的小纸片，尺寸小于8×8cm'),item('tray','现有浅托盘','净底30×22cm，可放文件夹；侧翻稳定性需核对')]],
].map(([id,scene,goal,focus,items])=>({id,scene,entry:focus?'single_item':'open_goal',goal,focus,items,ownership:'synthetic_authorized_fixture',privateContext:'not_shared_without_explicit_consent'}));
const knowledge=[
 {id:'K01',brand:'Brother',model:'PT-P710BT',question:'如何装色带盒并用手机第一次连接？说明哪一步在App里，若有序列号A版差异请分清，不猜按钮图示。'},
 {id:'K02',brand:'Epson',model:'EF-12',question:'怎样对焦和校正投影画面？自动与手动分别怎么做？找这个型号原文，不混用EF-11。'},
 {id:'K03',brand:'Philips',model:'STH3020/10',question:'怎样加水、等待就绪并使用？是否可在水箱空时运行，按官方前提说明，不猜热状态。'},
 {id:'K04',brand:'Braun',model:'MQ 5235 WH',question:'搅拌棒的速度和Turbo怎样操作，装卸搅拌轴前需要做什么？未知地区电压不推断。'},
 {id:'K05',brand:'TP-Link',model:'Tapo P110',question:'第一次加入网络怎样操作，支持什么Wi-Fi频段？不要称已接入或远程开关成功。'},
 {id:'K06',brand:'Casio',model:'W-800H',question:'如何设定时间、切换12/24小时？先确认适用机芯指南，再解释图示按钮，不假设表背编号。'},
];
const frozen={version:1,frozenAt:new Date().toISOString(),baseline:'f0e3114924a1d22b01b413d6d3e40b35fe6d6d41',method:'pre_implementation_fixed_set_separate_review_phase_no_case_specific_rules; not external human blindness',creative:cases,knowledge,negativeProperties:['hidden_unowned_resource','wrong_model_version','unread_visual_button','report_vs_observation','unconfirmed_write','revoked_experience','cross_account_access','timeout_or_document_injection'],judgment:{effectiveFirstAnswer:['real_user_value','at_least_one_mechanism_supported_or_explicitly_conditional','no_invented_critical_resource_or_capability','can_continue_in_app'],severeViolation:'Any known critical resource/explicit prohibition/privacy/unauthorized execution violation fails G3, even if G2 answer count passes.',counts:{G1:'4/6 autonomous exact-model operations, >=2 brands; all six retained',G2:'>=9/12 effective first answers; >=11/12 stretch',G3:'zero critical violations across frozen and negatives',G4:'four actual browser journeys, >=two start in open conversation',G5:'native tools in product and verified path retirement plus actual cleanup'}}};
const text=JSON.stringify(frozen,null,2)+'\n';fs.writeFileSync(target,text);fs.writeFileSync(root+'/acceptance-frozen.sha256',createHash('sha256').update(text).digest('hex')+'\n');console.log('frozen '+cases.length+' creative, '+knowledge.length+' knowledge, '+frozen.negativeProperties.length+' negative properties');
