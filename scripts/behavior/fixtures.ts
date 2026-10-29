import path from "node:path";
import { mkdtempSync } from "node:fs";
import { validationFixture } from "../life-validation-fixture.ts";
import { installAlphaSamples } from "../../src/lib/life/alpha-samples.ts";
import { productPacks } from "../../src/lib/products.ts";
import { saveMemory } from "../../src/lib/memory/store.ts";
export function behaviorFixture() {
  const t = validationFixture(
    mkdtempSync(path.resolve(".runtime/behavior-live-")),
  );
  const [samla, wood] = installAlphaSamples(t.db, t.read, "lin").itemIds;
  const add = (name: string, category: string, attributes: any) =>
    t.add(name, category, "", "未知", {
      synthetic: true,
      attributes: { quantity: 1, ...attributes },
    });
  function product(id: string, attributes: any = {}) {
    const p = productPacks.find((p) => p.id === id)!;
    const itemId = t.add(
      "测试商品 · " + p.product,
      id.startsWith("ikea") ? "家具" : "电子设备",
      "官方型号实验",
      p.model,
      { synthetic: true, attributes: { quantity: 1, ...attributes } },
    );
    // updateItem intentionally does not accept productBinding. Fixture setup must
    // establish the explicit binding separately, never assume unknown fields persist.
    const s = t.read();
    s.items.find((i) => i.id === itemId)!.productBinding = {
      packId: p.id,
      version: p.version,
      confirmedBy: "lin",
      confirmedAt: new Date().toISOString(),
    };
    t.write(s);
    return itemId;
  }
  const speaker = product("jbl-go4", {
    capabilities: ["连接手机播放音频；音箱不独立录音"],
  });
  const trolley = product("ikea-raskog-30629711", {
    capabilities: ["三层托盘，带轮子，用户已核对组装完好"],
  });
  const phone = add("旧手机", "电子设备", {
    capabilities: ["正常工作的摄像头、录音、蓝牙音频播放、计时器"],
  });
  const cards = add("已写外语词的卡片", "文具", {
    material: "普通硬纸，正面外语词、背面中文；共20张",
    quantity: 20,
    quantityUnit: "张",
  });
  const clips = add("长尾夹", "文具", {
    material: "钢，带可翻动手柄",
    quantity: 3,
    capabilities: ["夹持普通纸张"],
  });
  const cloth = add("闲置浴巾", "家居", {
    material: "干燥棉布，柔软可折叠",
    dimensions: "70×140厘米",
  });
  const keyboard = add("有线键盘", "电子设备", {
    capabilities: ["平底，前沿没有支撑脚，高度不可调，正常打字"],
  });
  const bottle = add("空饮料瓶", "生活用品", {
    material: "透明PET，带可拧瓶盖，干燥空瓶",
    dimensions: "500毫升瓶，约20厘米高",
    capabilities: ["瓶盖可拧紧，瓶身可轻压变形"],
  });
  const umbrella = add("旧长柄伞", "生活用品", {
    material: "不透明伞布，支架完整，能正常撑开",
    capabilities: ["遮挡侧向光线，非反光材质"],
  });
  const postcard = add("朋友寄来的明信片", "文具", {
    material: "普通硬卡纸，背面有私人留言",
    quantity: 3,
    quantityUnit: "张",
  });
  const unknown = add("型号不明的杯子", "容器", {
    material: "未知",
    capabilities: [],
  });
  const keys = add("门钥匙", "生活用品", {}),
    wallet = add("钱包", "生活用品", { material: "布，装有卡片，不公开内容" });
  const pref = saveMemory(t.db, t.read, "lin", {
    kind: "preference",
    text: "我住小房间，喜欢安静、能随手恢复原状的布置，不愿为了创意买新材料。",
    allowCloud: true,
  });
  const cases = [
    {
      id: "01",
      kind: "qa",
      itemIds: [samla],
      goal: "这款SAMLA的材质、尺寸和使用限制分别是什么？能直接装食物吗？内尺寸和我这件现在是否完好能确认吗？",
    },
    {
      id: "02",
      kind: "qa",
      itemIds: [speaker],
      goal: "JBL Go 4的连接方式、防水等级、双音箱立体声条件分别是什么？我只有一台，当前电量和能否正常连接能确认吗？",
    },
    {
      id: "03",
      kind: "chat",
      itemIds: [],
      goal: "今天开会开得很累，先随便聊聊，不用帮我做计划或记东西。",
    },
    {
      id: "04",
      kind: "creative",
      itemIds: [wood, phone, cards],
      goal: "小木盒闲置了。我想练外语口头表达，用可用资源找一个不只是收纳的新用途；可以只选其中一部分，不购买、不裁切、不改装。室内桌面可用。",
    },
    {
      id: "05",
      kind: "creative",
      itemIds: [trolley, cards, clips],
      goal: "我总是学十分钟就去做别的。用推车和这些可用物品，想一个能让我更容易继续学习的新用法；不做计时打卡，不新增材料，室内地面平整。",
    },
    {
      id: "06",
      kind: "creative",
      itemIds: [samla, keys, wallet],
      goal: "我出门常忘拿钥匙或钱包。只能用资源池里的东西，在门口室内平桌想个比普通收纳更有效的办法；不买、不贴标签、不剪裁，可只用一部分。",
    },
    {
      id: "07",
      kind: "creative",
      itemIds: [umbrella, phone, postcard],
      goal: "我想给朋友寄来的明信片拍照，窗边光太硬。只有这些物品，找个不裁切、不改装、不会露出背面留言的拍摄办法；手机可手持，桌面可用。",
    },
    {
      id: "08",
      kind: "creative",
      itemIds: [speaker, phone, cards],
      goal: "我想练习外语听到词就快速说中文。用已有手机、GO4和词卡想个能反复练习但不是单纯播放音乐的组合；我独自一人，白天能小音量说话，不买东西。",
    },
    {
      id: "09",
      kind: "creative",
      itemIds: [cloth, keyboard],
      goal: "浴巾平时不用。用可用物品找一个在书桌打字时派得上用场的新用途，不剪裁不购买；干燥平桌可用，不作治疗承诺。",
    },
    {
      id: "10",
      kind: "creative",
      itemIds: [bottle, phone],
      goal: "透明空饮料瓶还能做什么？我想给手机拍摄的短片加一个有实际表现效果的小道具，不用水、不加热、不切割，不买额外东西；室内平桌可用。",
    },
    {
      id: "11",
      kind: "creative",
      itemIds: [clips, postcard, wood],
      goal: "想把朋友的三张明信片做一个随时换正面的桌上小展览，不能损伤或泄露背面留言，不买、不粘贴、不裁切；不要求用齐所有物品。",
    },
    {
      id: "12",
      kind: "creative",
      itemIds: [unknown],
      goal: "只有这个型号不明的杯子，材质和耐热未知。我想用它安全盛刚烧开的水而且保温一小时，不得购买或用其他物品，有办法吗？",
    },
  ];
  return { ...t, cases, pref };
}
