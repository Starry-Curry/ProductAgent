import {
  BaseCheckpointSaver,
  WRITES_IDX_MAP,
  compareWritesSortKeys,
  writesSortKey,
  type Checkpoint,
  type CheckpointMetadata,
  type CheckpointTuple,
  type CheckpointListOptions,
  type PendingWrite,
} from "@langchain/langgraph-checkpoint";
import type { RunnableConfig } from "@langchain/core/runnables";
import type { DatabaseSync } from "node:sqlite";
type Row = {
  thread_id: string;
  ns: string;
  id: string;
  parent: string | null;
  cp_type: string;
  cp: Uint8Array;
  meta_type: string;
  meta: Uint8Array;
};
/** Uses the public LangGraph saver/serializer contract and Node 24's existing SQLite driver. */
export class SqliteCheckpointer extends BaseCheckpointSaver {
  db: DatabaseSync;
  guard: () => void;
  constructor(db: DatabaseSync, guard: () => void = () => {}) {
    super();
    this.db = db;
    this.guard = guard;
  }
  private scope(config: RunnableConfig) {
    const id = config.configurable?.thread_id;
    if (typeof id !== "string" || !/^[a-zA-Z0-9:_-]{1,150}$/.test(id))
      throw Error("Invalid thread scope");
    return { id, ns: String(config.configurable?.checkpoint_ns ?? "") };
  }
  private async tuple(row: Row): Promise<CheckpointTuple> {
    const writes = this.db
      .prepare(
        "SELECT task_id,idx,channel,type,body,path FROM graph_writes WHERE thread_id=? AND ns=? AND checkpoint_id=?",
      )
      .all(row.thread_id, row.ns, row.id) as {
      task_id: string;
      idx: number;
      channel: string;
      type: string;
      body: Uint8Array;
      path: string;
    }[];
    writes.sort((a, b) =>
      compareWritesSortKeys(
        writesSortKey(a.path, a.task_id, a.idx),
        writesSortKey(b.path, b.task_id, b.idx),
      ),
    );
    return {
      config: {
        configurable: {
          thread_id: row.thread_id,
          checkpoint_ns: row.ns,
          checkpoint_id: row.id,
        },
      },
      checkpoint: await this.serde.loadsTyped(row.cp_type, row.cp),
      metadata: await this.serde.loadsTyped(row.meta_type, row.meta),
      parentConfig: row.parent
        ? {
            configurable: {
              thread_id: row.thread_id,
              checkpoint_ns: row.ns,
              checkpoint_id: row.parent,
            },
          }
        : undefined,
      pendingWrites: await Promise.all(
        writes.map(
          async (w) =>
            [
              w.task_id,
              w.channel,
              await this.serde.loadsTyped(w.type, w.body),
            ] as [string, string, unknown],
        ),
      ),
    };
  }
  async getTuple(config: RunnableConfig) {
    const { id, ns } = this.scope(config);
    const cp = config.configurable?.checkpoint_id;
    const row = cp
      ? this.db
          .prepare(
            "SELECT * FROM graph_checkpoints WHERE thread_id=? AND ns=? AND id=?",
          )
          .get(id, ns, String(cp))
      : this.db
          .prepare(
            "SELECT * FROM graph_checkpoints WHERE thread_id=? AND ns=? ORDER BY id DESC LIMIT 1",
          )
          .get(id, ns);
    return row ? this.tuple(row as Row) : undefined;
  }
  async *list(config: RunnableConfig, options?: CheckpointListOptions) {
    const { id, ns } = this.scope(config);
    const rows = this.db
      .prepare(
        "SELECT * FROM graph_checkpoints WHERE thread_id=? AND ns=? ORDER BY id DESC",
      )
      .all(id, ns) as Row[];
    let emitted = 0;
    for (const row of rows) {
      if (
        options?.before?.configurable?.checkpoint_id &&
        row.id >= String(options.before.configurable.checkpoint_id)
      )
        continue;
      const tuple = await this.tuple(row);
      if (
        options?.filter &&
        !Object.entries(options.filter).every(
          ([k, v]) =>
            JSON.stringify((tuple.metadata as Record<string, unknown>)?.[k]) ===
            JSON.stringify(v),
        )
      )
        continue;
      if (options?.limit !== undefined && emitted >= options.limit) break;
      emitted++;
      yield tuple;
    }
  }
  async put(
    config: RunnableConfig,
    checkpoint: Checkpoint,
    metadata: CheckpointMetadata,
  ) {
    const { id, ns } = this.scope(config);
    const [ct, cp] = await this.serde.dumpsTyped(checkpoint);
    const [mt, meta] = await this.serde.dumpsTyped(metadata);
    this.guard();
    this.db
      .prepare(
        "INSERT OR REPLACE INTO graph_checkpoints VALUES (?,?,?,?,?,?,?,?)",
      )
      .run(
        id,
        ns,
        checkpoint.id,
        config.configurable?.checkpoint_id
          ? String(config.configurable.checkpoint_id)
          : null,
        ct,
        cp,
        mt,
        meta,
      );
    return {
      configurable: {
        thread_id: id,
        checkpoint_ns: ns,
        checkpoint_id: checkpoint.id,
      },
    };
  }
  async putWrites(
    config: RunnableConfig,
    writes: PendingWrite[],
    taskId: string,
    taskPath = "",
  ) {
    const { id, ns } = this.scope(config);
    const cp = String(config.configurable?.checkpoint_id);
    for (let index = 0; index < writes.length; index++) {
      const [channel, value] = writes[index];
      const idx = WRITES_IDX_MAP[channel] ?? index;
      const [type, body] = await this.serde.dumpsTyped(value);
      this.guard();
      const verb = idx < 0 ? "INSERT OR REPLACE" : "INSERT OR IGNORE";
      this.db
        .prepare(`${verb} INTO graph_writes VALUES (?,?,?,?,?,?,?,?,?)`)
        .run(id, ns, cp, taskId, idx, channel, type, body, taskPath);
    }
  }
  async deleteThread(id: string) {
    this.db.prepare("DELETE FROM graph_writes WHERE thread_id=?").run(id);
    this.db.prepare("DELETE FROM graph_checkpoints WHERE thread_id=?").run(id);
  }
}
