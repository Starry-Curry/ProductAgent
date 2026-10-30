import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { validationFixture } from "../scripts/life-validation-fixture.ts";
import { mutate, type Person } from "../src/lib/domain.ts";
import { saveFragment } from "../src/lib/life/stories.ts";
import {
  savePersona,
  saveMemory,
  forgetMemory,
  epoch,
} from "../src/lib/memory/store.ts";
import { buildContext } from "../src/lib/context/builder.ts";
for (const [name, model, category, nickname] of [
  ["合成电子物品", "TEST-ELECTRONIC", "电子设备", "暖光"],
  ["合成日用品", "TEST-BOWL", "其他", "小碗"],
  ["合成纪念画", "TEST-PAINTING", "其他", "旅途"],
]) {
  test(`独立用户的${category}分身：身份、获准关系、纠正遗忘、他人隔离（非真实模型）`, () => {
    const f = validationFixture(
      fs.mkdtempSync(
        path.join(process.cwd(), ".runtime", "persona-foundation-"),
      ),
    );
    const actor: Person = `u_${crypto.randomUUID()}`,
      peer: Person = `u_${crypto.randomUUID()}`;
    try {
      let state = mutate(f.read(), actor, "createItem", {
        name,
        model,
        category,
      });
      const itemId = state.items.at(-1)!.id;
      state.items.at(-1)!.shared = true;
      state.items.at(-1)!.sharedWith = [peer];
      f.write(state);
      savePersona(f.db, f.read(), actor, {
        itemId,
        enabled: true,
        nickname,
        avatar: "photo",
        style: "warm",
        memoryUse: "relevant",
      });
      const story = saveFragment(f.db, f.read, actor, {
        text: "合成经历：朋友小周赠送，未记录日期。",
        itemIds: [itemId],
        allowRecall: true,
        allowCloud: false,
      });
      const memory = saveMemory(
        f.db,
        f.read,
        actor,
        { itemId, kind: "relationship", text: story.text, allowCloud: false },
        undefined,
        crypto.randomUUID(),
        { id: story.id, revision: story.revision },
      );
      const input = {
        itemId,
        mode: "service",
        question: "朋友送的这件物品如何摆放？",
        includeItemRelationships: true,
        taskMemoryOnly: true,
        companion: true,
      };
      let context = buildContext(f.db, f.read(), actor, input);
      assert.equal(context.persona.nickname, nickname);
      assert.equal(context.memories[0].text, story.text);
      assert.equal(context.cloudMemories.length, 0);
      let other = buildContext(f.db, f.read(), peer, input);
      assert.equal(other.memories.length, 0);
      assert.equal(other.persona.enabled, false);
      saveMemory(
        f.db,
        f.read,
        actor,
        {
          itemId,
          kind: "relationship",
          text: "合成纠正：是同事小叶赠送，不是朋友小周。",
          allowCloud: false,
        },
        memory.id,
      );
      context = buildContext(f.db, f.read(), actor, input);
      assert.match(context.memories[0].text, /同事小叶/);
      assert.equal(context.cloudFragments.length, 0);
      const before = epoch(f.db, actor);
      forgetMemory(f.db, actor, memory.id);
      context = buildContext(f.db, f.read(), actor, input);
      assert.equal(context.memories.length, 0);
      assert.equal(context.cloudFragments.length, 0);
      assert.ok(epoch(f.db, actor) > before);
    } finally {
      f.db.close();
    }
  });
}
