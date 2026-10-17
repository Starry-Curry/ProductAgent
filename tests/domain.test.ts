import test from "node:test";
import assert from "node:assert/strict";
import { seed, mutate, visible, careMessage } from "../src/lib/domain.ts";
test("私人档案不可被家庭成员读取或通过操作接口修改", () => {
  const s = seed();
  assert.equal(
    visible(s, "dad").items.some((i) => i.id === "frame"),
    false,
  );
  assert.throws(
    () => mutate(s, "dad", "updateItem", { itemId: "frame", shared: true }),
    /授权/,
  );
});
test("共享物品不授予成员重新分享的权限", () => {
  assert.throws(
    () =>
      mutate(seed(), "dad", "updateItem", { itemId: "lamp", shared: false }),
    /所有者/,
  );
});
test("任务必须由负责人更新，失败不算完成", () => {
  const s = seed();
  assert.throws(
    () =>
      mutate(s, "dad", "task", {
        taskId: "task-filter",
        status: "用户确认完成",
      }),
    /负责人/,
  );
  mutate(s, "lin", "task", {
    taskId: "task-filter",
    status: "未解决",
    text: "型号尚未核实",
  });
  assert.equal(s.tasks[0].status, "未解决");
  assert.equal(s.tasks[0].logs.at(-1)?.text, "型号尚未核实");
});
test("未授权、暂停、外出、离线优先阻断关怀推断", () => {
  const s = seed();
  s.care.signal = "missing";
  assert.match(careMessage(s.care), /尚未授权/);
  mutate(s, "dad", "care", { consent: true, paused: true });
  assert.match(careMessage(s.care), /暂停/);
  mutate(s, "dad", "care", { paused: false, away: true });
  assert.match(careMessage(s.care), /外出/);
  mutate(s, "dad", "care", { away: false, offline: true });
  assert.match(careMessage(s.care), /离线/);
  assert.throws(() => mutate(s, "lin", "care", { consent: true }), /本人/);
});
test("赠送仅复制选中的本人记忆，查看不改变归属", () => {
  const s = seed();
  mutate(s, "lin", "memory", { itemId: "frame", text: "不传递的故事" });
  mutate(s, "lin", "gift", {
    itemId: "frame",
    message: "送给你",
    memoryIds: ["memory-frame"],
  });
  assert.equal(s.gifts[0].stories.length, 1);
  assert.equal(s.items.find((i) => i.id === "frame")?.owner, "lin");
  assert.throws(() => mutate(s, "lin", "gift", { itemId: "frame" }), /待认领/);
});
test("认领必须确认取得，且只能成功一次；接收者记忆不回流", () => {
  const s = seed();
  mutate(s, "lin", "gift", { itemId: "frame", memoryIds: ["memory-frame"] });
  const token = s.gifts[0].token;
  assert.throws(() => mutate(s, "friend", "claim", { token }), /实际取得/);
  mutate(s, "friend", "claim", { token, received: true });
  assert.equal(s.items.find((i) => i.id === "frame")?.owner, "friend");
  assert.throws(
    () => mutate(s, "dad", "claim", { token, received: true }),
    /认领/,
  );
  mutate(s, "friend", "memory", { itemId: "frame", text: "接收者自己的秘密" });
  assert.equal(
    visible(s, "lin").memories.some((m) => m.text === "接收者自己的秘密"),
    false,
  );
});
test("撤销的礼物不能被认领", () => {
  const s = seed();
  mutate(s, "lin", "gift", { itemId: "frame" });
  mutate(s, "lin", "revoke", { giftId: s.gifts[0].id });
  assert.throws(
    () =>
      mutate(s, "friend", "claim", { token: s.gifts[0].token, received: true }),
    /失效/,
  );
});
test("认领后不继承旧家庭处理记录和未选中的共享记忆", () => {
  const s = seed();
  mutate(s, "lin", "maintain", { itemId: "filter" });
  mutate(s, "lin", "task", { taskId: "task-filter", status: "用户确认完成" });
  mutate(s, "dad", "gift", { itemId: "filter", memoryIds: [] });
  mutate(s, "friend", "claim", { token: s.gifts[0].token, received: true });
  assert.equal(visible(s, "friend").tasks.length, 0);
  assert.equal(visible(s, "friend").memories.length, 0);
});
test("非家庭角色不能操作家庭事项", () => {
  const s = seed();
  assert.throws(() =>
    mutate(s, "friend", "createTask", {
      itemId: "filter",
      title: "测试",
      assignee: "lin",
    }),
  );
});
test("计划只能引用当前角色有权使用的物品，并对其他成员保密", () => {
  const s = seed();
  assert.throws(
    () => mutate(s, "dad", "savePlan", { goal: "拍照", itemIds: ["frame"] }),
    /授权/,
  );
  mutate(s, "lin", "savePlan", { goal: "拍照", itemIds: ["frame", "lamp"] });
  assert.equal(visible(s, "lin").plans.length, 1);
  assert.equal(visible(s, "dad").plans.length, 0);
});
test("交接之后原负责人不能继续修改，新负责人能接手", () => {
  const s = seed();
  mutate(s, "lin", "task", {
    taskId: "task-filter",
    status: "进行中",
    assignee: "dad",
    text: "请爸爸确认铭牌",
  });
  assert.throws(
    () =>
      mutate(s, "lin", "task", {
        taskId: "task-filter",
        status: "用户确认完成",
      }),
    /负责人/,
  );
  mutate(s, "dad", "task", {
    taskId: "task-filter",
    status: "未解决",
    text: "铭牌模糊，等待核实",
  });
  assert.equal(s.tasks[0].logs.length, 3);
});
