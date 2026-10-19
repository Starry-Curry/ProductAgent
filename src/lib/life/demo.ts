import type { DatabaseSync } from "node:sqlite";
import { findPack } from "../products.ts";
import type { State, Item } from "../domain.ts";
import { mutate } from "../domain.ts";
import { readFileSync } from "node:fs";
import path from "node:path";
const samples = [
  ["无线鼠标", "电子设备", "logitech-m185-m-r0061", "mouse"],
  ["随身音箱", "电子设备", "jbl-go4", "speaker"],
  ["厨房小推车", "家具", "ikea-raskog-30629711", "furniture"],
  ["电热水壶", "厨房用品", "xiaomi-kettle2-uk", "kitchen"],
  ["空气净化器", "电子设备", "xiaomi-purifier4lite-global", "home"],
  ["空气炸锅", "厨房用品", "xiaomi-airfryer65-uk", "kitchen"],
  ["无线吸尘器", "电子设备", "xiaomi-g20lite-au", "home"],
  ["小边桌", "家具", "ikea-lack-00352988", "furniture"],
  ["收纳搁架", "家具", "ikea-kallax-79384057", "furniture"],
  ["阅读书架", "家具", "ikea-billy-00522047", "books"],
  ["棉质衬衫", "服装", "", "clothes"],
  ["旧围巾", "服装", "", "clothes"],
  ["旅行背包", "出行用品", "", "bag"],
  ["散步相机", "电子设备", "", "camera"],
  ["窗边绿植", "植物", "", "plant"],
  ["速写本与铅笔", "手工材料", "", "books"],
  ["密封餐盒", "厨房用品", "", "kitchen"],
  ["苹果", "食品", "", "food"],
  ["全麦面包", "食品", "", "food"],
  ["野餐垫", "出行用品", "", "bag"],
] as const;
export function installLifeDemo(db: DatabaseSync) {
  if (
    db
      .prepare("SELECT 1 FROM life_installations WHERE version='life-demo-v1'")
      .get()
  ) {
    installLifePhotoStories(db);
    return;
  }
  db.exec("BEGIN IMMEDIATE");
  try {
    const state = JSON.parse(
      (
        db.prepare("SELECT body FROM workspace WHERE id=1").get() as {
          body: string;
        }
      ).body,
    ) as State;
    const at = new Date().toISOString();
    // Existing seed records are also explicitly marked synthetic; none are real inventory.
    for (const i of state.items.filter(
      (i) => !i.demo && i.source === "示例数据",
    )) {
      i.synthetic = true;
      i.availability = i.state === "待确认" ? "unknown" : "available";
    }
    for (const [n, [name, category, packId, photo]] of samples.entries()) {
      const pack = packId ? findPack(packId) : undefined;
      const item: Item = {
        id: `life-sample-${n}`,
        name,
        category,
        model: pack?.model || "用户示例 · 型号未知",
        brand: pack?.product.split(" ")[0] || "",
        owner: "lin",
        shared: n < 10,
        location: "未设置",
        state: "在用",
        availability: "available",
        availabilityAt: at,
        icon: "box",
        note: "合成物品实例；分类照片为示意照，不代表该型号实拍。",
        source: "示例数据",
        synthetic: true,
        lifecycle:
          category === "食品"
            ? "消耗型"
            : category === "植物"
              ? "持续养护"
              : "长期耐用",
        attributes: {
          quantity: 1,
          material: category === "服装" ? "示例材质，请以实物洗护标签为准" : "",
          capabilities: [],
        },
        photo: `/demo/life/${photo}.jpg`,
      };
      if (pack)
        item.productBinding = {
          packId: pack.id,
          version: pack.version,
          confirmedBy: "lin",
          confirmedAt: at,
        };
      if (!state.items.some((i) => i.id === item.id)) state.items.push(item);
    }
    state.tasks.push({
      id: "life-demo-task",
      itemId: "life-sample-3",
      title: "核对水壶清洁要求，再记录处理结果（合成案例）",
      assignee: "lin",
      status: "待处理",
      logs: [{ by: "dad", text: "这是合成家庭案例，不代表已通知真人。", at }],
    });
    db.prepare("UPDATE workspace SET body=? WHERE id=1").run(
      JSON.stringify(state),
    );
    const id = crypto.randomUUID();
    db.prepare("INSERT INTO life_fragments VALUES(?,?,?,?,1,?,?,1)").run(
      id,
      "lin",
      "合成案例：毕业旅行前，把相机和背包一起收进行李。没有推断实际日期、地点或同行人。",
      null,
      at,
      at,
    );
    for (const itemId of ["life-sample-12", "life-sample-13"])
      db.prepare("INSERT INTO life_fragment_items VALUES(?,?)").run(id, itemId);
    db.prepare("INSERT INTO life_installations VALUES('life-demo-v1')").run();
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  installLifePhotoStories(db);
}

function installLifePhotoStories(db: DatabaseSync) {
  if (
    db
      .prepare(
        "SELECT 1 FROM life_installations WHERE version='life-demo-photos-v1'",
      )
      .get()
  )
    return;
  db.exec("BEGIN IMMEDIATE");
  try {
    const state = JSON.parse(
      (
        db.prepare("SELECT body FROM workspace WHERE id=1").get() as {
          body: string;
        }
      ).body,
    ) as State;
    const at = new Date().toISOString();
    for (const [photo, text, itemIds] of [
      [
        "plant",
        "合成图文案例：给窗边绿植留一张观察照。品种、浇水量与健康状态仍待本人核对。",
        ["life-sample-14"],
      ],
      [
        "camera",
        "合成图文案例：出门前整理相机和背包，想用已有的东西记录一天。",
        ["life-sample-12", "life-sample-13"],
      ],
    ] as const) {
      const mediaId = crypto.randomUUID(),
        id = crypto.randomUUID();
      db.prepare("INSERT INTO life_media VALUES(?,?,?,?)").run(
        mediaId,
        "lin",
        "image/jpeg",
        readFileSync(
          path.join(process.cwd(), "public", "demo", "life", photo + ".jpg"),
        ),
      );
      db.prepare("INSERT INTO life_fragments VALUES(?,?,?,?,1,?,?,1)").run(
        id,
        "lin",
        text,
        mediaId,
        at,
        at,
      );
      for (const itemId of itemIds)
        db.prepare("INSERT INTO life_fragment_items VALUES(?,?)").run(
          id,
          itemId,
        );
    }
    for (const n of [2, 3, 4, 5, 6, 7, 8, 9, 16, 18, 19]) {
      const i = state.items.find((i) => i.id === `life-sample-${n}`);
      if (i?.synthetic && i.photo?.startsWith("/demo/life/"))
        i.photo = undefined;
    }
    if (!state.tasks.some((t) => t.id === "life-demo-task-mouse"))
      state.tasks.push({
        id: "life-demo-task-mouse",
        itemId: "life-sample-0",
        title: "合成案例：帮忙核对鼠标原配接收器",
        assignee: "dad",
        status: "待处理",
        logs: [{ by: "lin", text: "本机演示事项，未向真人发送通知。", at }],
      });
    if (!state.gifts.some((g) => g.itemId === "life-sample-11"))
      mutate(state, "lin", "gift", {
        itemId: "life-sample-11",
        message: "合成礼物案例：愿这条旧围巾陪你新的旅程。",
        memoryIds: [],
        includeKnowledge: false,
      });
    db.prepare("UPDATE workspace SET body=? WHERE id=1").run(
      JSON.stringify(state),
    );
    db.prepare(
      "INSERT INTO life_installations VALUES('life-demo-photos-v1')",
    ).run();
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
