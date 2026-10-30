import type { DatabaseSync } from "node:sqlite";
import type { State,Person } from "../domain.ts";
import { authorize } from "./policy.ts";
import { adapterState } from "../devices/software-lab.ts";
/** A scoped projection over the existing real software receipts, never a hardware claim. */
export function registeredCapabilities(db:DatabaseSync,state:State,actor:Person,itemId:string){
 if(!authorize(db,state,actor,itemId).allowed)return [];
 const item=state.items.find(i=>i.id===itemId)!;
 if(item.owner!==actor||item.model!=="WUJIAN-SOFTWARE-LAMP-1"||["gifted","loaned","lost","consumed"].includes(item.availability||"")||state.gifts.some(g=>g.itemId===itemId&&g.claimedBy)||process.env.WUJIAN_ENABLE_DEVICE_LAB!=="true")return [];
 const a=adapterState(db,actor,itemId);if(!a)return [];
 const verified=(db.prepare("SELECT payload,result FROM software_operations WHERE owner=? ORDER BY rowid DESC LIMIT 100").all(actor) as {payload:string;result:string}[]).filter(r=>JSON.parse(r.payload).itemId===itemId).map(r=>JSON.parse(r.result)).some(r=>r.status==="verified"&&r.observed?.simulated===true&&r.adapterTargetHash===a.targetHash);
 return [{version:"capability/1",capabilityId:"software-lamp:"+itemId,targetType:"software_simulator",targetId:itemId,operation:"brightness",sourceState:verified?"software_verified":"read_observed",evidenceRefs:[a.evidenceId],adapterId:"fixed-owned-software-lamp",adapterVersion:a.version,targetHash:a.targetHash,risk:"local_write",requiredGrantActions:["explicit_software_grant","per_action_confirmation"],canReadback:true,failurePolicy:"unknown_and_reconcile",simulated:true,currentlyGranted:a.granted}];
}
