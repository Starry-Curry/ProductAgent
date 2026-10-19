import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { canRead, type State, type Person } from "../domain.ts";
import { AgentError } from "../agent/contracts.ts";
import { clearOwnerContext } from "../memory/store.ts";

export const fragmentInput = z.object({
  text: z.string().trim().min(1).max(3000),
  itemIds: z.array(z.string().min(1).max(100)).max(20).default([]),
  mediaId: z.string().uuid().nullable().optional(),
  id: z.string().uuid().optional(),
  revision: z.number().int().positive().optional(),
}).strict();
type Row = {id:string;owner:Person;text:string;media_id:string|null;revision:number;created_at:string;updated_at:string;demo:number};
function links(db: DatabaseSync,id:string) {
  return (db.prepare("SELECT item_id FROM life_fragment_items WHERE fragment_id=?").all(id) as {item_id:string}[]).map(x=>x.item_id);
}
export function listFragments(db:DatabaseSync,state:State,actor:Person,itemId?:string) {
  if(itemId && !state.items.some(i=>i.id===itemId&&canRead(i,actor))) throw new AgentError("物品未获授权",403);
  return (db.prepare("SELECT * FROM life_fragments WHERE owner=? ORDER BY updated_at DESC LIMIT 200").all(actor) as Row[])
    .map(r=>({id:r.id,author:r.owner,text:r.text,mediaId:r.media_id,revision:r.revision,createdAt:r.created_at,updatedAt:r.updated_at,demo:!!r.demo,itemIds:links(db,r.id)}))
    .filter(r=>!itemId||r.itemIds.includes(itemId));
}
export function saveFragment(db:DatabaseSync,read:()=>State,actor:Person,input:unknown) {
  const value=fragmentInput.parse(input);
  db.exec("BEGIN IMMEDIATE");
  try {
    const old=value.id ? db.prepare("SELECT * FROM life_fragments WHERE id=? AND owner=?").get(value.id,actor) as Row|undefined : undefined;
    if(value.id && !old) throw new AgentError("生活片段不存在或未获授权",403);
    if(old && old.revision!==value.revision) throw new AgentError("生活片段已更新，请刷新后再修改",409);
    const state=read();
    const previous=old ? links(db,old.id) : [];
    const ids=[...new Set(value.itemIds)];
    // An author keeps their record after an item is gifted, but cannot add inaccessible links.
    for(const id of ids) if(!previous.includes(id)&&!state.items.some(i=>i.id===id&&canRead(i,actor))) throw new AgentError("关联物品未获授权",403);
    const media=value.mediaId===undefined ? old?.media_id||null : value.mediaId;
    if(media&&!db.prepare("SELECT 1 FROM life_media WHERE id=? AND owner=?").get(media,actor)) throw new AgentError("照片未获授权",403);
    const id=old?.id||crypto.randomUUID(), at=new Date().toISOString();
    if(old) db.prepare("UPDATE life_fragments SET text=?,media_id=?,revision=revision+1,updated_at=? WHERE id=?").run(value.text,media,at,id);
    else db.prepare("INSERT INTO life_fragments VALUES(?,?,?,?,1,?,?,0)").run(id,actor,value.text,media,at,at);
    db.prepare("DELETE FROM life_fragment_items WHERE fragment_id=?").run(id);
    for(const itemId of ids) db.prepare("INSERT INTO life_fragment_items VALUES(?,?)").run(id,itemId);
    clearOwnerContext(db,actor,!!old);
    if(old?.media_id && old.media_id!==media) removeUnusedMedia(db,state,actor,old.media_id);
    db.exec("COMMIT");
    return listFragments(db,state,actor).find(f=>f.id===id)!;
  } catch(e) {db.exec("ROLLBACK");throw e;}
}
export function deleteFragment(db:DatabaseSync,state:State,actor:Person,id:string,revision:number) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const r=db.prepare("SELECT * FROM life_fragments WHERE id=? AND owner=?").get(id,actor) as Row|undefined;
    if(!r) throw new AgentError("生活片段不存在或未获授权",403);
    if(r.revision!==revision) throw new AgentError("片段已更新",409);
    db.prepare("DELETE FROM life_fragments WHERE id=?").run(id);
    if(r.media_id) removeUnusedMedia(db,state,actor,r.media_id);
    clearOwnerContext(db,actor,true);
    db.exec("COMMIT");
  } catch(e) {db.exec("ROLLBACK");throw e;}
}
export function removeUnusedMedia(db:DatabaseSync,state:State,actor:Person,id:string) {
  if(db.prepare("SELECT 1 FROM life_fragments WHERE media_id=?").get(id)||state.items.some(i=>i.photo?.includes(`/media/${id}`))) return;
  db.prepare("DELETE FROM life_media WHERE id=? AND owner=?").run(id,actor);
}
export function readMedia(db:DatabaseSync,state:State,actor:Person,id:string) {
  const r=db.prepare("SELECT owner,mime,body FROM life_media WHERE id=?").get(id) as {owner:string;mime:string;body:Uint8Array}|undefined;
  if(!r || (r.owner!==actor&&!state.items.some(i=>i.photo?.includes(`/media/${id}`)&&canRead(i,actor)))) throw new AgentError("照片不存在或未获授权",403);
  return r;
}
