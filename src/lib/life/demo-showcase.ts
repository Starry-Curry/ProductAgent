import type { DatabaseSync } from "node:sqlite";
import type { LifeIdea } from "./ideas.ts";

/** Public, fictional showcase only. Install once; never restore user-deleted content. */
export function installDemoShowcase(db: DatabaseSync) {
  if (db.prepare("SELECT 1 FROM life_installations WHERE version='final-showcase-v1'").get()) return;
  db.exec("BEGIN IMMEDIATE");
  try {
    const state = JSON.parse((db.prepare("SELECT body FROM workspace WHERE id=1").get() as {body:string}).body);
    const ids = new Set(state.items.filter((i:any)=>i.owner==="lin" && i.synthetic).map((i:any)=>i.id));
    const examples = [
      {title:"三张照片，收集今天的颜色",itemIds:["life-sample-13","life-sample-15"],minutes:20,direction:"创作",
        steps:["在速写本写下三种想寻找的颜色。","停稳后用相机各拍一张对应颜色的景物，不边走边看取景框。","在本子记录照片编号和发现地点，再用相机回放核对，完成一页色彩小记。"],
        missing:["相机电量、可存储空间与可进入的安全场地需本人确认。"],limits:["不要求打印、电脑或特殊拍摄模式；不拍摄他人隐私。"]},
      {title:"一条围巾，两种明日搭配",itemIds:["life-sample-10","life-sample-11"],minutes:10,direction:"生活改善",
        steps:["将衬衫和围巾平放，观察两者的色彩与质感。","试一试围巾自然垂下与松松折搭两种方式，确认不勒颈、不妨碍活动。","选择更舒服的一种，记住搭配；实际出门前再按天气调整。"],
        missing:["天气、洗护标签和围巾实际长度未确认。"],limits:["不是保暖或材质性能保证，不依赖镜子、别针等额外工具。"]},
      {title:"在窗边画一页叶片地图",itemIds:["life-sample-14","life-sample-15"],minutes:15,direction:"创作",
        steps:["不触碰叶片，在速写本画三个小框。","分别观察一片叶子的外形、边缘与可见纹理，在三个框里画下不同细节。","给这页画取一个虚构标题，留作今天的观察；看不清的细节保留空白。"],
        missing:["现场光照、可安全观察的位置需确认。"],limits:["不摘叶、不拓印、不浇水，不推断品种或健康。"]},
      {title:"背包里的轻量阅读角",itemIds:["life-sample-12","life-sample-15","life-sample-19"],minutes:25,direction:"娱乐",
        steps:["确认野餐垫干净、地面干燥且允许停留；不具备条件就留在家中可坐的位置。","把速写本和垫子装入背包，试背后调整到舒服的状态；放不下就选择在家完成。","坐稳后，在本子写三个日常词，用它们编四句明确虚构的小故事。","换一个词重写结尾，比较两个版本，收好物品后结束。"],
        missing:["垫子尺寸、背包容量、场地与天气需现场核对。"],limits:["不用计时设备，以四句故事和重写一次作为结束条件；不冒充真实经历。"]},
    ];
    for(const e of examples) {
      if(!e.itemIds.every(id=>ids.has(id))) continue;
      const idea:LifeIdea={...e,direction:e.direction as LifeIdea["direction"],id:crypto.randomUUID(),demo:true,source:"local-candidate",evidence:[],tested:false,goal:"预置演示方案；未实物验证，不是在线模型生成"};
      db.prepare("INSERT INTO life_ideas VALUES(?,?,?,?)").run(idea.id,"lin",JSON.stringify(idea),new Date().toISOString());
    }
    if(ids.has("life-sample-15")) {
      const id=crypto.randomUUID(),at=new Date().toISOString();
      db.prepare("INSERT INTO life_fragments VALUES(?,?,?,?,1,?,?,1)").run(id,"lin","睡前翻到下午留下的几行字，又添上一个很小的愿望：明天也给自己留一点慢慢来的时间。",null,at,at);
      db.prepare("INSERT INTO life_fragment_details VALUES(?,?,?,?,?,?)").run(id,"2026-10-19","[]",0,0,"fiction");
      db.prepare("INSERT INTO life_fragment_items VALUES(?,?)").run(id,"life-sample-15");
    }
    const fragments=db.prepare("SELECT id FROM life_fragments WHERE owner='lin' AND demo=1 ORDER BY created_at,id").all() as {id:string}[];
    for(const [name,anchor] of [["演示｜走慢一点的周末","life-sample-12"],["演示｜窗边留白","life-sample-15"]]) {
      const related=fragments.filter(f=>db.prepare("SELECT 1 FROM life_fragment_items WHERE fragment_id=? AND item_id=?").get(f.id,anchor)).map(f=>f.id);
      if(related.length) {
        const id=crypto.randomUUID();
        db.prepare("INSERT INTO life_chapters VALUES(?,?,?)").run(id,"lin",JSON.stringify({id,name,fragmentIds:related,revision:1,status:"confirmed",updatedAt:new Date().toISOString()}));
      }
    }
    db.prepare("INSERT INTO life_installations VALUES('final-showcase-v1')").run();
    db.exec("COMMIT");
  } catch(e) { db.exec("ROLLBACK"); throw e; }
}
