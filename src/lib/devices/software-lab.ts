import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { createTask, beginRun, finishRun } from "../foundation/tasks.ts";
import type { DatabaseSync } from "node:sqlite";
import { canRead, type Person, type State } from "../domain.ts";
import { AgentError } from "../agent/contracts.ts";
const run = promisify(execFile);
type SoftwareRuntime=Promise<{url:string;close:()=>Promise<void>}>;
let simulators=new WeakMap<DatabaseSync,Map<string,SoftwareRuntime>>();
const activeSimulators=new Set<SoftwareRuntime>();
const target = () => path.resolve("tests/fixtures/virtual-lamp");
function targetHash() {
  return createHash("sha256")
    .update(
      ["package.json", "client.mjs", "lamp.mjs"]
        .map((f) => fs.readFileSync(path.join(target(), f)))
        .join("\n"),
    )
    .digest("hex");
}
function schema(db: DatabaseSync) {
  db.exec(`CREATE TABLE IF NOT EXISTS software_adapters(owner TEXT NOT NULL,item_id TEXT NOT NULL,body TEXT NOT NULL,granted INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(owner,item_id));
    CREATE TABLE IF NOT EXISTS software_operations(owner TEXT NOT NULL,request_id TEXT NOT NULL,payload TEXT NOT NULL,result TEXT NOT NULL,PRIMARY KEY(owner,request_id));`);
}
function owned(state: State, actor: Person, itemId: string) {
  if (process.env.WUJIAN_ENABLE_DEVICE_LAB !== "true")
    throw new AgentError("授权软件实验未启用", 403);
  const item = state.items.find(
    (i) => i.id === itemId && i.owner === actor && canRead(i, actor),
  );
  if (!item?.synthetic || item.model !== "WUJIAN-SOFTWARE-LAMP-1")
    throw new AgentError("仅允许明确标记为测试物品的自有软件模拟灯", 403);
  if(["gifted","loaned","lost","consumed"].includes(item.availability||"")||state.gifts.some(g=>g.itemId===item.id&&g.claimedBy))
    throw new AgentError("物品已流转或不再持有，旧软件授权不可继续执行",403);
}
async function lamp(db:DatabaseSync,actor:Person,itemId:string) {
  let scope=simulators.get(db);if(!scope){scope=new Map();simulators.set(db,scope);}
  const key=JSON.stringify([actor,itemId]);let simulator=scope.get(key);
  if (!simulator){
    if(activeSimulators.size>=64)throw new AgentError("软件实验运行实例达到上限，请结束旧实验后重试",429);
    simulator = import(
      /* webpackIgnore: true */ pathToFileURL(path.join(target(), "lamp.mjs"))
        .href
    ).then((m) => m.startLamp());
    scope.set(key,simulator);activeSimulators.add(simulator);
  }
  return simulator!;
}
export async function analyzeOwnedLamp(
  db: DatabaseSync,
  read: () => State,
  actor: Person,
  itemId: string,
) {
  owned(read(), actor, itemId);
  const analyzedHash=targetHash();
  schema(db);
  const cli = path.resolve(
    ".runtime/rea-tools/node_modules/rea-agents/scripts/rea.mjs",
  );
  if (!fs.existsSync(cli))
    throw new AgentError("本工作区尚未安装固定版REA，未伪造分析结果", 503);
  const pkg = JSON.parse(
    fs.readFileSync(
      path.resolve(".runtime/rea-tools/node_modules/rea-agents/package.json"),
      "utf8",
    ),
  );
  if (pkg.version !== "6.8.0")
    throw new AgentError("REA版本变化，请先重新验证", 409);
  const temp = path.resolve(".runtime/rea-temp");
  fs.mkdirSync(temp, { recursive: true });
  const { stdout } = await run(
    process.execPath,
    [
      cli,
      "analyze-javascript-application",
      target(),
      "--format",
      "json",
      "--analysis-timeout-ms",
      "15000",
    ],
    {
      windowsHide: true,
      timeout: 45000,
      maxBuffer: 8_000_000,
      env: {
        NODE_ENV: "test",
        PATH: path.dirname(process.execPath),
        SystemRoot: process.env.SystemRoot,
        TEMP: temp,
        TMP: temp,
      },
    },
  );
  const evidence = JSON.parse(stdout);
  const candidates = (evidence.normalized_result?.graph?.nodes || []).flatMap(
    (node: any) =>
      (node.observations || [])
        .filter(
          (o: any) =>
            o.evidence?.authority === "ast-static-analysis" &&
            o.properties?.mechanism === "call:fetch" &&
            /^\/api\/lamp\/[a-z]+$/.test(o.properties?.value || ""),
        )
        .map((o: any) => ({ nodeId: node.node_id, path: o.properties.value })),
  );
  const paths: string[] = [
    ...new Set<string>(candidates.map((c: any) => c.path)),
  ];
  if (!paths.length)
    throw new AgentError("REA没有取得网络接口候选，未创建适配器", 422);
  const runtime = await lamp(db,actor,itemId);
  owned(read(),actor,itemId);
  let readPath: string | undefined;
  // Probe only read-only GETs on the fixed owned loopback target. Never arbitrary URLs.
  for (const p of paths) {
    const r = await fetch(runtime.url + p, {
      signal: AbortSignal.timeout(3000),
    });
    const result = await r.json().catch(() => null);
    if (
      r.ok &&
      result?.simulated === true &&
      Number.isInteger(result.brightness)
    )
      readPath = p;
  }
  const writePath = paths.find(
    (p) => p !== readPath && p.endsWith("/brightness"),
  );
  if (!readPath || !writePath)
    throw new AgentError(
      "发现的候选未通过模拟器只读验证，未假设存在控制能力",
      422,
    );
  owned(read(), actor, itemId);
  if(targetHash()!==analyzedHash)throw new AgentError("分析期间软件版本变化，请重新分析",409);
  const body = {
    version: "software-lamp-v1",
    targetHash: analyzedHash,
    grantEpoch:1,
    reaVersion: pkg.version,
    evidenceId: evidence.evidence_id,
    artifactHash: evidence.subject.digest.sha256,
    candidates,
    readPath,
    writePath,
    discovery: "static-observation-and-read-probe",
    control: "candidate-until-authorized-write-and-readback",
    simulated: true,
  };
  fs.writeFileSync(
    path.join(temp, "latest-lamp-evidence.json"),
    JSON.stringify(evidence),
  );
  db.prepare(
    "INSERT INTO software_adapters VALUES(?,?,?,0) ON CONFLICT(owner,item_id) DO UPDATE SET body=json_set(excluded.body,'$.grantEpoch',coalesce(json_extract(software_adapters.body,'$.grantEpoch'),0)+1),granted=0",
  ).run(actor, itemId, JSON.stringify(body));
  return adapterState(db,actor,itemId)!;
}
export function adapterState(db: DatabaseSync, actor: Person, itemId: string) {
  schema(db);
  const row = db
    .prepare(
      "SELECT body,granted FROM software_adapters WHERE owner=? AND item_id=?",
    )
    .get(actor, itemId) as { body: string; granted: number } | undefined;
  return row ? { grantEpoch:0, ...JSON.parse(row.body), granted: !!row.granted } : null;
}
export function grantSoftware(
  db: DatabaseSync,
  read: () => State,
  actor: Person,
  itemId: string,
  enabled: boolean,
) {
  owned(read(), actor, itemId);
  schema(db);
  if (!adapterState(db, actor, itemId))
    throw new AgentError("请先完成能力分析", 409);
  db.prepare(
    "UPDATE software_adapters SET granted=?,body=json_set(body,'$.grantEpoch',coalesce(json_extract(body,'$.grantEpoch'),0)+1) WHERE owner=? AND item_id=?",
  ).run(enabled ? 1 : 0, actor, itemId);
  return { granted: enabled, simulated: true };
}
export async function readSoftware(
  db: DatabaseSync,
  read: () => State,
  actor: Person,
  itemId: string,
) {
  owned(read(), actor, itemId);
  const a = adapterState(db, actor, itemId);
  if (!a?.granted) throw new AgentError("读取模拟设备状态也需要有效授权", 403);
  const runtime = await lamp(db,actor,itemId);
  owned(read(),actor,itemId);
  if(!adapterState(db,actor,itemId)?.granted||adapterState(db,actor,itemId)?.grantEpoch!==a.grantEpoch)throw new AgentError("授权已变化，未读取软件状态",403);
  const response = await fetch(runtime.url + a.readPath, {
    signal: AbortSignal.timeout(3000),
  });
  const observed = await response.json();
  owned(read(), actor, itemId);
  if (!adapterState(db, actor, itemId)?.granted || adapterState(db,actor,itemId)?.grantEpoch!==a.grantEpoch)
    throw new AgentError("授权已撤销", 403);
  return {
    observed,
    simulated: true,
    completionBasis: "software-simulator-readback",
  };
}
export async function closeSoftwareLab() {
  await Promise.allSettled([...activeSimulators].map(async p=>(await p).close()));
  activeSimulators.clear();simulators=new WeakMap();
}
export async function executeSoftware(
  db: DatabaseSync,
  read: () => State,
  actor: Person,
  input: {
    itemId: string;
    requestId: string;
    brightness: number;
    confirmed: boolean;
  },
) {
  owned(read(), actor, input.itemId);
  const a = adapterState(db, actor, input.itemId);
  if (!a?.granted || !input.confirmed)
    throw new AgentError("请先授权并明确确认本次模拟操作", 403);
  if (a.targetHash !== targetHash())
    throw new AgentError("软件目标已变化，需重新分析与授权", 409);
  if (
    !Number.isInteger(input.brightness) ||
    input.brightness < 0 ||
    input.brightness > 100
  )
    throw new AgentError("亮度必须为0—100整数");
  const payload = JSON.stringify(input);
  const prior = db
    .prepare(
      "SELECT payload,result FROM software_operations WHERE owner=? AND request_id=?",
    )
    .get(actor, input.requestId) as
    { payload: string; result: string } | undefined;
  if (prior) {
    if (prior.payload !== payload)
      throw new AgentError("同一请求内容变化", 409);
    return { ...JSON.parse(prior.result), replayed: true };
  }
  const runtime = await lamp(db,actor,input.itemId);
  owned(read(),actor,input.itemId);
  const latest=adapterState(db,actor,input.itemId);
  if(!latest?.granted||latest.grantEpoch!==a.grantEpoch||latest.targetHash!==a.targetHash)throw new AgentError("授权或软件版本已变化，未发送操作",409);
  const task=createTask(db,read,actor,{requestId:input.requestId,goal:"明确授权后调整自有软件灯",intent:"control",itemInstanceIds:[input.itemId]});
  const taskRun=beginRun(db,read,actor,{requestId:input.requestId,taskId:task.taskId,itemIds:[input.itemId],entryPoint:"software_lab",executor:"fixed-owned-software-lamp/1",input});
  // Durable intent precedes execution. Unfinished records cannot be silently repeated.
  db.prepare("INSERT INTO software_operations VALUES(?,?,?,?)").run(
    actor,
    input.requestId,
    payload,
    JSON.stringify({ status: "pending-verification", simulated: true }),
  );
  try {
    const response = await fetch(runtime.url + a.writePath, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ brightness: input.brightness }),
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) throw new AgentError("模拟器拒绝执行，未声称成功", 502);
    const current = adapterState(db, actor, input.itemId);
    owned(read(), actor, input.itemId);
    if (!current?.granted || current.grantEpoch!==a.grantEpoch)
      throw new AgentError("授权已撤销，本次结果须重新读取后人工核对", 409);
    const observed = await (
      await fetch(runtime.url + a.readPath, {
        signal: AbortSignal.timeout(3000),
      })
    ).json();
    owned(read(), actor, input.itemId);
    if (!adapterState(db, actor, input.itemId)?.granted || adapterState(db,actor,input.itemId)?.grantEpoch!==a.grantEpoch)
      throw new AgentError("读取期间授权已撤销，结果未展示", 409);
    const result = {
      adapterTargetHash:a.targetHash,
      adapterVersion:a.version,
      status:
        observed.simulated === true && observed.brightness === input.brightness
          ? "verified"
          : "readback-mismatch",
      completionBasis: "software-simulator-readback",
      observed,
      simulated: true,
    };
    db.prepare(
      "UPDATE software_operations SET result=? WHERE owner=? AND request_id=?",
    ).run(JSON.stringify(result), actor, input.requestId);
    finishRun(db,read,taskRun,result.status==="verified"?"waiting_user":"partial");
    if(result.status==="verified"){
      const outcome={version:"outcome/1",outcomeId:crypto.randomUUID(),taskId:task.taskId,runId:taskRun.runId,goalStatus:"achieved",basis:"software_simulator_readback",evidenceRefs:[a.evidenceId],reporterId:actor,itemInstanceIds:[input.itemId],occurredAt:new Date().toISOString(),notes:"自有软件灯回读已匹配；不是实体台灯",canReuseForFutureTasks:false};
      db.prepare("INSERT OR IGNORE INTO foundation_outcomes VALUES(?,?,?,?,?,?)").run(outcome.outcomeId,task.taskId,actor,input.requestId,payload,JSON.stringify(outcome));
    }
    return result;
  } catch (e) {
    finishRun(db,read,taskRun,"blocked");
    db.prepare(
      "UPDATE software_operations SET result=? WHERE owner=? AND request_id=?",
    ).run(
      JSON.stringify({
        status: "failed-or-uncertain",
        error: e instanceof AgentError ? e.message : "模拟通信失败",
        simulated: true,
      }),
      actor,
      input.requestId,
    );
    throw e;
  }
}
