import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { mkdtempSync } from "node:fs";
import {
  login,
  readAccount,
  logout,
  assertAccountOrigin,
} from "../src/lib/accounts.ts";
import { validationFixture } from "../scripts/life-validation-fixture.ts";
import { collaborate } from "../src/lib/collaboration.ts";
import { canRead, mutate, visible } from "../src/lib/domain.ts";
test("独立账号、会话、家庭邀请、状态、赠礼与双向隐私", () => {
  const directory = mkdtempSync(
    path.join(process.cwd(), ".runtime", "accounts-test-"),
  );
  process.env.PRODUCT_AGENT_DATA_DIR = directory;
  const a = login("test_alice", "synthetic-test-password-alice", true),
    b = login("test_bob", "synthetic-test-password-bob", true),
    outsider = login("test_outside", "synthetic-outside-password", true);
  const request = new Request("http://127.0.0.1:3210/api/life", {
    headers: { cookie: a.cookie.split(";")[0], "x-demo-actor": "dad" },
  });
  assert.equal(readAccount(request).id, a.account.id);
  assert.throws(() =>
    assertAccountOrigin(
      new Request(request.url, {
        headers: { host: "127.0.0.1:3210", origin: "https://example.com" },
      }),
    ),
  );
  assert.doesNotThrow(() =>
    assertAccountOrigin(
      new Request("http://localhost:3210/api/life", {
        headers: {
          host: "127.0.0.1:3210",
          "x-forwarded-host": "127.0.0.1:3210",
          origin: "http://127.0.0.1:3210",
        },
      }),
    ),
  );
  assert.throws(() =>
    assertAccountOrigin(
      new Request(request.url, {
        headers: { host: "127.0.0.1:3210", "x-forwarded-host": "example.com" },
      }),
    ),
  );
  const f = validationFixture(directory);
  try {
    let state = mutate(f.read(), a.account.id, "createItem", {
      name: "合成赠画",
      category: "其他",
      model: "无品牌",
    });
    f.write(state);
    const item = state.items.at(-1)!;
    const aid = a.account.id,
      bid = b.account.id;
    const act = (actor: typeof aid, input: any) =>
      collaborate(f.db, f.read, actor, {
        requestId: crypto.randomUUID(),
        ...input,
      });
    assert.equal(canRead(item, bid), false);
    const invite = act(aid, { action: "invite", confirmed: true });
    act(bid, { action: "join", token: invite.invite, confirmed: true });
    assert.equal(canRead(item, bid), false); // joining isn't sharing
    assert.throws(() =>
      act(aid, {
        action: "share",
        itemId: item.id,
        memberId: outsider.account.id,
        enabled: true,
      }),
    );
    act(aid, {
      action: "share",
      itemId: item.id,
      memberId: bid,
      enabled: true,
    });
    assert.equal(canRead(f.read().items.at(-1)!, bid), true);
    assert.equal(canRead(f.read().items.at(-1)!, outsider.account.id), false);
    const task = act(aid, {
      action: "task",
      itemId: item.id,
      memberId: bid,
      title: "帮忙检查画框支撑",
      summary: "还不知道能否站稳，先不要放到桌沿",
      confirmed: true,
    });
    assert.throws(() =>
      act(bid, { action: "report_done", taskId: task.taskId, confirmed: true }),
    );
    const seen = {
      action: "seen",
      taskId: task.taskId,
      requestId: crypto.randomUUID(),
    };
    collaborate(f.db, f.read, bid, seen);
    collaborate(f.db, f.read, bid, seen);
    assert.equal(
      f
        .read()
        .tasks.at(-1)!
        .logs.filter((l) => l.text === "seen").length,
      1,
    );
    act(bid, { action: "accept", taskId: task.taskId });
    act(bid, { action: "report_done", taskId: task.taskId, confirmed: true });
    assert.equal(f.read().tasks.at(-1)!.completionBasis, "user_report");
    assert.throws(
      () => act(bid, { action: "accept", taskId: task.taskId }),
      /已报告完成/,
    );
    state = f.read();
    state.memories.push(
      {
        id: "selected",
        itemId: item.id,
        author: aid,
        owner: aid,
        text: "朋友小周赠送（合成）",
        at: "2026-10-30",
        shared: false,
      },
      {
        id: "private",
        itemId: item.id,
        author: aid,
        owner: aid,
        text: "不共享的私事",
        at: "2026-10-30",
        shared: false,
      },
    );
    state = mutate(state, aid, "gift", {
      itemId: item.id,
      message: "让故事继续",
      memoryIds: ["selected"],
    });
    f.write(state);
    const gift = state.gifts.at(-1)!;
    state = mutate(f.read(), bid, "claim", {
      token: gift.token,
      received: true,
    });
    f.write(state);
    const recipientItem = state.items.at(-1)!;
    assert.notEqual(recipientItem.id, item.id);
    assert.equal(recipientItem.owner, bid);
    assert.equal(recipientItem.transferredFrom?.giftId, gift.id);
    assert.throws(()=>mutate(state,aid,"gift",{itemId:item.id,message:"不能再送一次",memoryIds:[]}),/历史档案|不再持有/);
    state.items.find(i=>i.id===item.id)!.availability="available";
    assert.throws(()=>mutate(state,aid,"gift",{itemId:item.id,message:"修改状态也不能重赠",memoryIds:[]}),/历史档案|不再持有/);
    assert.ok(
      visible(state, bid).memories.some(
        (m) => m.text === "朋友小周赠送（合成）" && m.author === aid,
      ),
    );
    assert.ok(
      !visible(state, bid).memories.some((m) => m.text === "不共享的私事"),
    );
    state.memories.push({
      id: "recipient-private",
      itemId: recipientItem.id,
      author: bid,
      owner: bid,
      text: "新主人的私事",
      at: "2026-10-30",
      shared: false,
    });
    assert.ok(
      !visible(state, aid).memories.some((m) => m.text === "新主人的私事"),
    );
    assert.throws(() => mutate(state, aid, "revoke", { giftId: gift.id }));
    logout(request);
    assert.throws(() => readAccount(request));
  } finally {
    f.db.close();
  }
});
