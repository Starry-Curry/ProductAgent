import { z } from "zod";
import type { DatabaseSync } from "node:sqlite";
import { mutate, type State, type Person, type Item } from "../domain.ts";
import { AgentError } from "../agent/contracts.ts";
import {fingerprint} from '../foundation/legacy.ts';

/** A write precondition over the existing item, not another item/Reality store. */
export function itemManagementSnapshot(item:Item){
 return {version:'item-management/1' as const,itemId:item.id,revision:fingerprint(item),fields:{brand:item.brand||'',model:item.model,region:item.region||'',lifecycle:item.lifecycle,attributes:structuredClone(item.attributes||{})}};
}
export type ItemManagementSnapshot=ReturnType<typeof itemManagementSnapshot>;
/** Call inside the same existing workspace transaction as the mutation. */
export function assertItemManagementRevision(state:State,actor:Person,itemId:unknown,expected:unknown){
 const item=state.items.find(i=>i.id===itemId&&i.owner===actor);if(!item)throw new AgentError('物品不存在或未获修改授权',403);
 if(typeof expected!=='string'||!(/^[a-f0-9]{64}$/).test(expected))throw new AgentError('物品资料版本无效，请重新打开资料',400);
 if(fingerprint(item)!==expected)throw new AgentError('物品资料已在别处更新；本次修改未保存，请重新打开资料并核对后再提交。',409);
}
/** One transaction for the instance and replay receipt; sources can retry separately. */
export function createLifeItem(
  db: DatabaseSync,
  read: () => State,
  a: Person,
  input: unknown,
) {
  const v = z
    .object({
      name: z.string().trim().min(1).max(80),
      requestId: z.string().uuid().optional(),
      brand: z.string().max(80).default(""),
      region: z.string().max(20).optional(),
      model: z.string().max(100).default("待确认"),
      category: z.string().max(40),
      lifecycle: z.enum([
        "一次性",
        "消耗型",
        "可重复使用",
        "长期耐用",
        "持续养护",
      ]),
      availability: z.enum(["unknown", "available"]),
      attributes: z.record(z.string(), z.unknown()).optional(),
      mediaId: z.string().uuid().optional(),
      packId: z.string().optional(),
      confirmed: z.boolean().default(false),
      ownsConfirmed: z.boolean().optional(),
      synthetic: z.boolean().default(false),
      location: z.string().trim().max(80).optional(),
      note: z.string().trim().max(1500).optional(),
    })
    .strict()
    .parse(input);
  if ((v.packId || a.startsWith("u_")) && v.ownsConfirmed !== true)
    throw new AgentError("请明确确认拥有这件商品，再建立个人物品记录");
  db.exec("BEGIN IMMEDIATE");
  try {
    const payload = JSON.stringify(v);
    const prior = v.requestId
      ? (db
          .prepare(
            "SELECT payload,item_id FROM life_requests WHERE owner=? AND request_id=?",
          )
          .get(a, v.requestId) as
          { payload: string; item_id: string } | undefined)
      : undefined;
    if (prior) {
      if (prior.payload !== payload)
        throw new AgentError("同一录入请求内容已变化，请恢复原内容后重试", 409);
      const item = read().items.find(
        (i) => i.id === prior.item_id && i.owner === a,
      );
      if (!item) throw new AgentError("原录入记录已变化，请在展柜核对", 409);
      db.exec("COMMIT");
      return { item, replayed: true };
    }
    let state = mutate(read(), a, "createItem", v);
    const item = state.items.at(-1)!;
    state = mutate(state, a, "updateItem", { itemId: item.id, ...v });
    item.synthetic = v.synthetic;
    if (v.synthetic) item.source = "合成持有测试；非真实用户物品";
    if (v.mediaId) {
      if (
        !db
          .prepare("SELECT 1 FROM life_media WHERE id=? AND owner=?")
          .get(v.mediaId, a)
      )
        throw new AgentError("照片未获授权", 403);
      item.photo = `/api/life/media/${v.mediaId}?actor=${a}`;
    }
    if (v.packId)
      state = mutate(state, a, "bindProduct", {
        itemId: item.id,
        packId: v.packId,
        confirmed: v.confirmed,
      });
    db.prepare("UPDATE workspace SET body=? WHERE id=1").run(
      JSON.stringify(state),
    );
    if (v.requestId)
      db.prepare("INSERT INTO life_requests VALUES(?,?,?,?)").run(
        a,
        v.requestId,
        payload,
        item.id,
      );
    db.exec("COMMIT");
    return { item };
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
