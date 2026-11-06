import { useEffect, useRef, useState } from "react";
import { App as AntApp, Modal } from "antd";
import {
  Camera,
  Check,
  ImagePlus,
  LockKeyhole,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import {
  request,
  upload,
  type Experience,
  type Item,
  type Memory,
  type Preferences,
  type User,
  type Workspace,
} from "../api";
import { presentation, safeDate } from "./shared";
import { ObjectCompanion } from "./ObjectCompanion";
import CommunityConnection from "./CommunityConnection";
import { PhotoMatchFinder, PhotoMatchReview, type PhotoMatchResult } from "./PhotoMatchReview";

export type Editor = {
  kind:
    | "item"
    | "persona"
    | "presentation"
    | "experience"
    | "gift"
    | "reminder"
    | "friend"
    | "household"
    | "wish"
    | "task"
    | "settings"
    | "sharing"
    | "experience-share";
  item?: Item;
  experience?: Experience;
};
type Props = {
  editor: Editor;
  workspace: Workspace;
  user: User;
  onClose: () => void;
  onDone: () => Promise<unknown>;
  onItem: (item: Item) => void;
  onTask: (id: string) => void;
};
const today = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};
const titles: Record<Editor["kind"], string> = {
  item: "记一件物品",
  persona: "认识它的另一面",
  presentation: "位置与当前状态",
  experience: "留住这一刻",
  gift: "一份有来处的心意",
  reminder: "记录一件需要处理的事",
  friend: "认识一位朋友",
  household: "一起照看这个家",
  wish: "记下一个想要",
  task: "整理正在做的事",
  settings: "我的物间",
  sharing: "共享使用与照顾",
  "experience-share": "分享这一段回忆",
};

function Photos({
  ids,
  onChange,
  onBusy,
}: {
  ids: string[];
  onChange: (value: string[] | ((previous: string[]) => string[])) => void;
  onBusy: (value: boolean) => void;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function add(file?: File) {
    if (!file) return;
    setBusy(true);
    onBusy(true);
    setError("");
    try {
      const asset = await upload(file);
      onChange((previous) => [...previous, asset.id].slice(-8));
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
      onBusy(false);
    }
  }
  return (
    <div>
      <div className="editor-photos">
        {ids.map((id) => (
          <div key={id}>
            <img src={`/api/assets/${id}`} alt="已选择的照片" />
            <button
              type="button"
              aria-label="移除照片"
              onClick={() => onChange((previous) => previous.filter((value) => value !== id))}
            >
              <X size={14} />
            </button>
          </div>
        ))}
        <label className="photo-choice">
          <Camera size={23} />
          <span>{busy ? "添加中…" : "拍照"}</span>
          <input
            type="file"
            accept="image/*"
            capture="environment"
            disabled={busy}
            onChange={(event) => {
              void add(event.target.files?.[0]);
              event.target.value = "";
            }}
          />
        </label>
        <label className="photo-choice">
          <ImagePlus size={23} />
          <span>从相册选</span>
          <input
            type="file"
            accept="image/*"
            disabled={busy}
            onChange={(event) => {
              void add(event.target.files?.[0]);
              event.target.value = "";
            }}
          />
        </label>
      </div>
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export default function Editors({
  editor,
  workspace,
  user,
  onClose,
  onDone,
  onItem,
  onTask,
}: Props) {
  const { message, modal } = AntApp.useApp();
  const item = editor.item,
    experience = editor.experience;
  const [name, setName] = useState(experience?.title || (editor.kind === "experience" ? "" : item?.name) || "");
  const [text, setText] = useState(
    experience?.text || (editor.kind === "item" ? item?.description : "") || "",
  );
  const [brand, setBrand] = useState(item?.product.brand || ""),
    [model, setModel] = useState(item?.product.model || "");
  const [kind, setKind] = useState(item?.kind || "standard_product");
  const [photos, setPhotos] = useState(
    experience?.photo_ids || (editor.kind === "item" && item?.photo_id ? [item.photo_id] : []),
  );
  const [photosBusy, setPhotosBusy] = useState(false);
  const [selected, setSelected] = useState<string[]>(
    experience?.item_ids || (item ? [item.id] : []),
  );
  const [date, setDate] = useState(experience ? experience.occurred_on || "" : today());
  const [allowAI, setAllowAI] = useState(experience?.allow_ai || false);
  const [matchPhotos, setMatchPhotos] = useState(true);
  const [enabled, setEnabled] = useState(editor.kind === "persona" || item?.avatar.enabled || false),
    [nickname, setNickname] = useState(item?.avatar.nickname || (editor.kind === "persona" ? item?.name : "") || ""),
    [personality, setPersonality] = useState(item?.avatar.personality || "");
  const [color, setColor] = useState(item?.avatar.color || "#7e9eac");
  const [form, setForm] = useState<Item["avatar"]["form"]>(item?.avatar.form || "auto");
  const [delighted, setDelighted] = useState(false);
  const personaPreview = useRef<HTMLDivElement>(null);
  const info = item
    ? presentation(item)
    : { location: "", attention: "normal", note: "", cherished: false };
  const [location, setLocation] = useState(info.location),
    [attention, setAttention] = useState(info.attention),
    [cherished, setCherished] = useState(info.cherished);
  const [houseId, setHouseId] = useState(""),
    [recipient, setRecipient] = useState("");
  const [stories, setStories] = useState<string[]>([]),
    [carryAvatar, setCarryAvatar] = useState(false),
    [preview, setPreview] = useState(false);
  const [note, setNote] = useState(info.note),
    [due, setDue] = useState(today() + "T18:00");
  const [visible, setVisible] = useState(false),
    [url, setUrl] = useState("");
  const [taskKind, setTaskKind] = useState("checklist"),
    [lines, setLines] = useState("");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [sharedIds, setSharedIds] = useState<string[]>([]),
    [memories, setMemories] = useState<Memory[]>([]);
  const [prefs, setPrefs] = useState<Preferences>(workspace.preferences);
  const friends = workspace.friends.filter((friend) => friend.accepted);
  const houses = workspace.households.filter(
    (house) => house.membership === "active",
  );
  const [createdItem, setCreatedItem] = useState<Item>();
  const [memoryDrafts, setMemoryDrafts] = useState<Record<string, string>>({});
  const [memoriesLoading, setMemoriesLoading] = useState(editor.kind === "settings"),
    [memoriesError, setMemoriesError] = useState("");
  useEffect(() => {
    if (editor.kind === "sharing" && item)
      void request<User[]>(`/items/${item.id}/shares`)
        .then((rows) => setSharedIds(rows.map((row) => row.id)))
        .catch((error) => setError(error.message));
    if (editor.kind === "experience-share" && experience)
      void request<User[]>(`/experiences/${experience.id}/shares`)
        .then((rows) => setSharedIds(rows.map((row) => row.id)))
        .catch((error) => setError(error.message));
    if (editor.kind === "settings")
      void request<Memory[]>("/memories")
        .then(setMemories)
        .catch((error) => setMemoriesError(error.message))
        .finally(() => setMemoriesLoading(false));
  }, []);

  async function perform(operation: () => Promise<unknown>) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await operation();
      await onDone();
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    if (photosBusy) return;
    if (editor.kind === "gift" && !preview) {
      if (!recipient) {
        setError("请选择接收这份心意的朋友");
        return;
      }
      setPreview(true);
      return;
    }
    await perform(async () => {
      if (editor.kind === "item") {
        const payload = {
          name: name.trim(),
          kind,
          product: {
            ...item?.product,
            brand,
            model,
            market: item?.product.market || "CN",
          },
          description: text,
          avatar: { enabled, nickname, personality, color, form },
          photo_id: photos[0] || null,
          state: {
            ...item?.state,
            presentation: { ...info, location, cherished },
          },
          ...(item ? { expected_version: item.version } : {}),
        };
        const result =
          createdItem ||
          (await request<Item>(
            item ? `/items/${item.id}` : "/items",
            item ? "PUT" : "POST",
            payload,
          ));
        if (!item) setCreatedItem(result);
        if (houseId)
          await request(`/households/${houseId}/items`, "POST", {
            item_id: result.id,
            shared: true,
          });
        await onDone();
        onItem(result);
      } else if (editor.kind === "persona" && item) {
        await request(`/items/${item.id}`, "PUT", {
          name: item.name,
          kind: item.kind,
          product: item.product,
          description: item.description,
          photo_id: item.photo_id,
          state: item.state,
          avatar: { enabled, nickname: nickname.trim(), personality: personality.trim(), color, form },
          expected_version: item.version,
        });
      } else if (editor.kind === "presentation" && item) {
        await request(`/items/${item.id}/presentation`, "PATCH", {
          expected_version: item.version,
          location,
          attention,
          note,
          cherished,
        });
      } else if (editor.kind === "experience") {
        const recorded = await request<Experience>(
          experience ? `/experiences/${experience.id}` : "/experiences",
          experience ? "PUT" : "POST",
          {
            title: experience ? name : name.trim() || text.trim().split(/[\n。！？!?]/)[0].slice(0, 60) || "生活中的一刻",
            text,
            occurred_on: date || null,
            item_ids: selected,
            photo_ids: photos,
            allow_ai: allowAI,
            ...(experience ? { expected_version: experience.version } : {}),
          },
        );
        const newPhotos = photos.some((id) => !experience?.photo_ids.includes(id));
        if (matchPhotos && newPhotos && !experience?.origin_id) {
          // Save first. Recognition has its own versioned request and cannot
          // delay recording or overwrite a later edit while the model works.
          const key = `photo-match-${recorded.id}`;
          void message.open({ key, type: "loading", content: "回忆已保存，正在认照片里的物品…", duration: 0 });
          void request<PhotoMatchResult>(`/experiences/${recorded.id}/photo-matches`, "POST", {
            expected_version: recorded.version, apply_confident: true,
          }).then(async (result) => {
            const active = await request<User>("/me").catch(() => undefined);
            if (active?.id !== user.id) {
              message.destroy(key);
              return;
            }
            await onDone();
            const count = result.candidates.filter((value) => value.auto_linked).length;
            if (result.candidates.length || result.remaining_items) {
              void message.open({ key, type: "info", duration: 10, content: <span>
                {count ? `已认出并关联${count}件物品。` : result.remaining_items
                  ? `已比较${result.examined_items}件，还可继续其余${result.remaining_items}件。` : "照片里可能有这些物品。"}
                <button type="button" className="quiet-button" onClick={() => modal.info({
                  title: "照片中的已有物品", width: 520,
                  content: result.remaining_items
                    ? <PhotoMatchFinder initialResult={result} experience={result.experience} items={workspace.items} onDone={onDone} />
                    : <PhotoMatchReview result={result} items={workspace.items} onDone={onDone} />,
                })}>查看与调整</button>
              </span> });
            } else {
              void message.open({ key, type: "info", content: "回忆已保存，暂未认出可关联的已有物品，可手动选择。", duration: 5 });
            }
          }).catch((cause) => {
            void message.open({ key, type: "info", content: `回忆已保存。${(cause as Error).message}`, duration: 6 });
          });
        }
      } else if (editor.kind === "gift" && item) {
        await request("/gifts", "POST", {
          item_id: item.id,
          recipient_id: recipient,
          message: text,
          experience_ids: stories,
          avatar: carryAvatar
            ? {
                enabled: true,
                nickname: nickname || item.name,
                personality,
                color,
                form,
              }
            : { enabled: false, form },
        });
      } else if (editor.kind === "reminder") {
        await request("/reminders", "POST", {
          title: name,
          due_at: new Date(due).toISOString(),
          assignee_id: recipient || null,
          item_id: selected[0] || null,
          household_id: houseId || null,
        });
      } else if (editor.kind === "friend")
        await request("/friends", "POST", { username: name.trim() });
      else if (editor.kind === "wish")
        await request("/wishes", "POST", {
          title: name,
          note: text,
          url,
          visible_to_friends: visible,
        });
      else if (editor.kind === "settings")
        await request("/preferences", "PUT", prefs);
      else if (editor.kind === "task") {
        const entries = [
          ...selected.map((id) => ({
            id: crypto.randomUUID(),
            title: workspace.items.find((item) => item.id === id)!.name,
            item_id: id,
            group: "owned",
          })),
          ...lines
            .split("\n")
            .map((title) => title.trim())
            .filter(Boolean)
            .map((title) => ({
              id: crypto.randomUUID(),
              title,
              group: taskKind === "guidance" ? "step" : "confirm",
            })),
        ];
        const result = await request<{ task: { id: string } }>(
          "/task-boards",
          "POST",
          {
            goal: name,
            kind: taskKind,
            item_ids: selected,
            entries,
            constraints: {},
          },
        );
        onTask(result.task.id);
      }
      onClose();
      message.success(
        editor.kind === "gift" ? "心意已送出，等待对方选择接收" : "已经保存",
      );
    });
  }

  const itemSelection = (
    <div className="selection-list">
      {workspace.items.map((value) => (
        <label className="check-label" key={value.id}>
          <input
            type="checkbox"
            checked={selected.includes(value.id)}
            onChange={(event) =>
              setSelected(
                event.target.checked
                  ? [...selected, value.id]
                  : selected.filter((id) => id !== value.id),
              )
            }
          />
          {value.name}
        </label>
      ))}
      {experience?.item_ids
        .filter((id) => !workspace.items.some((item) => item.id === id))
        .map((id) => (
          <label className="check-label" key={id}>
            <input
              type="checkbox"
              checked={selected.includes(id)}
              onChange={(event) =>
                setSelected(
                  event.target.checked
                    ? [...selected, id]
                    : selected.filter((value) => value !== id),
                )
              }
            />
            {experience.item_labels[id] || "曾经关联的物品"}（历史关联）
          </label>
        ))}
    </div>
  );
  const familyChoice = (
    <label>
      放进家庭用品
      <select
        value={houseId}
        onChange={(event) => setHouseId(event.target.value)}
      >
        <option value="">先仅自己可见</option>
        {houses.map((house) => (
          <option key={house.id} value={house.id}>
            {house.name}
          </option>
        ))}
      </select>
      <small>
        选择后，已接受邀请的家庭成员可以看到照片、型号和共同状态；私人回忆另行分享。
      </small>
    </label>
  );
  const friendsChoice = (
    <label>
      交给谁
      <select
        value={recipient}
        onChange={(event) => setRecipient(event.target.value)}
      >
        <option value="">
          {editor.kind === "reminder" ? "我自己" : "选择一位朋友"}
        </option>
        {friends.map((friend) => (
          <option key={friend.id} value={friend.id}>
            {friend.display_name}
          </option>
        ))}
      </select>
    </label>
  );
  const simpleFooter = ["household", "sharing", "experience-share"].includes(
    editor.kind,
  );
  return (
    <Modal
      open
      title={titles[editor.kind]}
      onCancel={onClose}
      width={620}
      footer={
        simpleFooter ? (
          <button className="soft-button" onClick={onClose}>
            完成
          </button>
        ) : (
          <div className="dialog-footer">
            {preview && (
              <button
                className="quiet-button"
                onClick={() => setPreview(false)}
              >
                返回调整
              </button>
            )}
            <button className="soft-button" onClick={onClose}>
              取消
            </button>
            <button
              className="primary-button"
              disabled={busy || photosBusy}
              type="submit"
              form="interaction-editor"
            >
              {photosBusy ? "照片上传中…" : busy
                ? "保存中…"
                : editor.kind === "gift"
                  ? preview
                    ? "确认送出心意"
                    : "预览这份心意"
                  : "保存"}
            </button>
          </div>
        )
      }
    >
      <form
        id="interaction-editor"
        className="editor-form"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        {error && (
          <p className="inline-error" role="alert">
            {error}
          </p>
        )}
        {editor.kind === "persona" && item && (
          <>
            <div className="persona-preview" ref={personaPreview}>
              <button type="button" className="persona-preview-touch" aria-label="和分身打个招呼" onClick={() => setDelighted(!delighted)}>
                <ObjectCompanion item={{ ...item, avatar: { ...item.avatar, enabled: true, nickname, personality, color, form } }} className="object-companion-alive" size={190} expression={delighted ? "happy" : "calm"} />
              </button>
              <strong>{nickname || item.name}</strong>
              <p>{delighted ? "在呢。今天也一起过吧。" : "轻轻点一下，和它打个招呼。"}</p>
              <small>形象与招呼预览 · 对话会使用这件物品的身份与获准回忆</small>
            </div>
            <fieldset>
              <legend>想让它是什么模样？</legend>
              <div className="persona-forms">
                {([ ["auto", "随物品"], ["keepsake", "纪念物"], ["cup", "杯子"], ["stone", "石头"], ["flower", "花"], ["cat", "小猫"] ] as const).map(([value, label]) => (
                  <button key={value} type="button" aria-pressed={form === value} onClick={() => setForm(value)}>{label}</button>
                ))}
              </div>
              <small>由你选择，也可以随时换个样子。</small>
            </fieldset>
            <label>它的名字<input value={nickname} maxLength={40} onChange={(event) => setNickname(event.target.value)} placeholder={item.name} /></label>
            <fieldset className="persona-colors">
              <legend>喜欢的颜色</legend>
              {[ ["雾蓝", "#7e9eac"], ["陶杏", "#c49c7b"], ["豆绿", "#97a48c"], ["暖粉", "#c39897"] ].map(([label, value]) => (
                <button type="button" key={value} aria-label={label} aria-pressed={color === value} style={{ background: value }} onClick={() => setColor(value)} />
              ))}
              <input type="color" aria-label="自选分身颜色" value={color} onChange={(event) => setColor(event.target.value)} />
            </fieldset>
            <fieldset>
              <legend>相处时，想要什么样的语气？</legend>
              <div className="persona-temperaments">
                {["温柔耐心", "活泼好奇", "简洁安静"].map((value) => <button key={value} type="button" className={personality === value ? "active" : ""} onClick={() => setPersonality(value)}>{value}</button>)}
              </div>
              <textarea aria-label="分身的性格与说话习惯" rows={2} maxLength={500} value={personality} onChange={(event) => setPersonality(event.target.value)} placeholder="也可以自己写：温柔一点，少说大道理，陪我慢慢聊。" />
            </fieldset>
            <label className="check-label"><input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />开启这件物品的分身</label>
            <p className="form-note">这是{item.name}的可选分身。物品照片与已有故事会继续保留；回忆是否用于对话，可以在每段回忆里单独选择。</p>
            <button type="button" className="quiet-button" onClick={() => {
              const svg = personaPreview.current?.querySelector("svg");
              if (!svg) return;
              const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(svg)], { type: "image/svg+xml;charset=utf-8" }));
              const link = document.createElement("a");
              link.href = url;
              link.download = "物间-物品分身.svg";
              link.click();
              setTimeout(() => URL.revokeObjectURL(url), 1000);
            }}>保存这张形象</button>
          </>
        )}
        {editor.kind === "item" && (
          <>
            <Photos ids={photos} onChange={setPhotos} onBusy={setPhotosBusy} />
            <label>
              物品名称
              <input
                required
                maxLength={120}
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="你习惯怎样称呼它"
              />
            </label>
            <label>
              这是一件
              <select
                value={kind}
                onChange={(event) =>
                  setKind(event.target.value as Item["kind"])
                }
              >
                <option value="standard_product">有品牌型号的商品</option>
                <option value="nonstandard_object">
                  手作、礼物或独特的纪念物
                </option>
              </select>
            </label>
            {kind === "standard_product" && (
              <div className="form-row">
                <label>
                  品牌
                  <input
                    value={brand}
                    onChange={(event) => setBrand(event.target.value)}
                    placeholder="可以稍后补充"
                  />
                </label>
                <label>
                  准确型号
                  <input
                    value={model}
                    onChange={(event) => setModel(event.target.value)}
                    placeholder="未知时留空"
                  />
                </label>
              </div>
            )}
            <label>
              它与你的关系
              <textarea
                rows={2}
                value={text}
                onChange={(event) => setText(event.target.value)}
                placeholder="从哪里来，有什么意义……"
              />
            </label>
            <label>
              常放在哪里
              <input
                value={location}
                onChange={(event) => setLocation(event.target.value)}
                placeholder="如：书房的靠窗书架"
              />
            </label>
            <label className="check-label">
              <input
                type="checkbox"
                checked={cherished}
                onChange={(event) => setCherished(event.target.checked)}
              />
              放进我的珍藏
            </label>
            {!item && familyChoice}
            <details className="editor-details">
              <summary>可选：让它有自己的分身</summary>
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={enabled}
                  onChange={(event) => setEnabled(event.target.checked)}
                />
                开启这个物品的分身
              </label>
              {enabled && (
                <>
                  <label>
                    它的名字
                    <input
                      value={nickname}
                      onChange={(event) => setNickname(event.target.value)}
                    />
                  </label>
                  <label>
                    相处时的性格
                    <textarea
                      rows={2}
                      value={personality}
                      onChange={(event) => setPersonality(event.target.value)}
                    />
                  </label>
                  <label>
                    它的颜色
                    <input
                      type="color"
                      value={color}
                      onChange={(event) => setColor(event.target.value)}
                    />
                  </label>
                </>
              )}
            </details>
          </>
        )}
        {editor.kind === "presentation" && (
          <>
            <label>
              常放在哪里
              <input
                value={location}
                onChange={(event) => setLocation(event.target.value)}
              />
            </label>
            <label>
              当前状态
              <select
                value={attention}
                onChange={(event) => setAttention(event.target.value)}
              >
                {Object.entries({
                  normal: "正常",
                  needs_check: "待检查",
                  paused: "暂停使用",
                  needs_restock: "待补充",
                  lost: "实物已遗失",
                  lent: "已借出",
                }).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              需要留意的话
              <textarea
                rows={3}
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="写下实际情况，不必猜原因"
              />
            </label>
            <label className="check-label">
              <input
                type="checkbox"
                checked={cherished}
                onChange={(event) => setCherished(event.target.checked)}
              />
              放进我的珍藏
            </label>
            <p className="form-note">
              位置与状态来自这次报告，不代表实时测量。已读提醒不会自动把物品改回正常。
            </p>
          </>
        )}
        {editor.kind === "experience" && (
          <>
            <Photos ids={photos} onChange={setPhotos} onBusy={setPhotosBusy} />
            {!experience?.origin_id && <label className="check-label">
              <input type="checkbox" checked={matchPhotos} onChange={(event) => setMatchPhotos(event.target.checked)} />
              识别照片里的已有物品并关联，拿不准的由我选择
            </label>}
            <label>
              给这一刻一个名字
              <input
                required={Boolean(experience)}
                value={name}
                readOnly={Boolean(experience?.origin_id)}
                onChange={(event) => setName(event.target.value)}
                placeholder={experience ? undefined : "可留空，保存时用正文开头作标题"}
              />
            </label>
            <label>
              想留下的话
              <textarea
                rows={5}
                required={photos.length === 0}
                value={text}
                readOnly={Boolean(experience?.origin_id)}
                onChange={(event) => setText(event.target.value)}
                placeholder="发生了什么，那时的你有什么感受……"
              />
            </label>
            <label>
              发生的日子
              <input
                type="date"
                value={date}
                onChange={(event) => setDate(event.target.value)}
              />
              <small>不记得具体哪天，可以留空。</small>
            </label>
            <fieldset>
              <legend>一起出现在这段经历里的物</legend>
              {itemSelection}
            </fieldset>
            <label className="check-label">
              <input
                type="checkbox"
                checked={allowAI}
                onChange={(event) => setAllowAI(event.target.checked)}
              />
              允许物伴在相关对话中参考这段回忆
            </label>
            <p className="form-note">
              <LockKeyhole size={14} />
              默认仅自己可见。关联家庭用品，不会自动把回忆分享给家人。
            </p>
            {experience?.origin_id && (
              <p className="form-note">
                这段原文随礼物收到，保留原作者；新的感受可以另记一段。
              </p>
            )}
          </>
        )}
        {editor.kind === "gift" &&
          item &&
          (!preview ? (
            <>
              {friendsChoice}
              <label>
                想对他说的话
                <textarea
                  rows={3}
                  value={text}
                  onChange={(event) => setText(event.target.value)}
                />
              </label>
              <fieldset>
                <legend>随礼物送出的故事</legend>
                {workspace.experiences
                  .filter(
                    (value) =>
                      value.creator_id === user.id &&
                      value.item_ids.includes(item.id),
                  )
                  .map((value) => (
                    <label className="check-label" key={value.id}>
                      <input
                        type="checkbox"
                        checked={stories.includes(value.id)}
                        onChange={(event) =>
                          setStories(
                            event.target.checked
                              ? [...stories, value.id]
                              : stories.filter((id) => id !== value.id),
                          )
                        }
                      />
                      {value.title}
                    </label>
                  ))}
              </fieldset>
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={carryAvatar}
                  onChange={(event) => setCarryAvatar(event.target.checked)}
                />
                附上我选择的分身设定
              </label>
              {carryAvatar && (
                <>
                  <label>
                    分身名字
                    <input
                      value={nickname}
                      onChange={(event) => setNickname(event.target.value)}
                    />
                  </label>
                  <label>
                    相处时的性格
                    <textarea
                      value={personality}
                      onChange={(event) => setPersonality(event.target.value)}
                    />
                  </label>
                </>
              )}
            </>
          ) : (
            <div className="gift-preview">
              <h2>{item.name}</h2>
              {carryAvatar && <div className="persona-gift-preview"><ObjectCompanion item={{ ...item, avatar: { ...item.avatar, enabled: true, form, nickname: nickname || item.name, personality, color } }} size={140} /></div>}
              <p>
                送给{" "}
                {
                  friends.find((friend) => friend.id === recipient)
                    ?.display_name
                }
              </p>
              <blockquote>{text || "一份带着心意的礼物"}</blockquote>
              {workspace.experiences
                .filter((value) => stories.includes(value.id))
                .map((value) => (
                  <article key={value.id}>
                    <h4>{value.title}</h4>
                    <p>{value.text}</p>
                  </article>
                ))}
              <p className="form-note">
                对方将看到上面的寄语、选定故事和
                {carryAvatar ? "分身设定" : "物品资料"}
                ；私人聊天与其他回忆不随礼物转移。数字接受和实物交接分别确认。
              </p>
            </div>
          ))}
        {editor.kind === "reminder" && (
          <>
            <label>
              需要处理的小事
              <input
                required
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="例如：检查保温壶"
              />
            </label>
            <label>
              何时提醒
              <input
                required
                type="datetime-local"
                value={due}
                onChange={(event) => setDue(event.target.value)}
              />
            </label>
            {friendsChoice}
            <label>
              相关物品
              <select
                value={selected[0] || ""}
                onChange={(event) =>
                  setSelected(event.target.value ? [event.target.value] : [])
                }
              >
                <option value="">不关联物品</option>
                {workspace.items.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              在家庭用品中共同查看
              <select
                value={houseId}
                onChange={(event) => setHouseId(event.target.value)}
              >
                <option value="">仅发起者与接收者可见</option>
                {houses.map((house) => (
                  <option key={house.id} value={house.id}>
                    {house.name}
                  </option>
                ))}
              </select>
            </label>
            <p className="form-note">
              这是应用内事项；“知道了”“接手”和“已经完成”分别记录。
            </p>
          </>
        )}
        {editor.kind === "friend" && (
          <>
            <p>通过用户名发送邀请，等对方接受后再共享或赠礼。</p>
            <label>
              对方的用户名
              <input
                required
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="例如 xiaoxia"
              />
            </label>
          </>
        )}
        {editor.kind === "wish" && (
          <>
            <label>
              想要什么
              <input
                required
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <label>
              为什么想要
              <textarea
                rows={3}
                value={text}
                onChange={(event) => setText(event.target.value)}
              />
            </label>
            <label>
              商品链接（可选）
              <input
                type="url"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder="https://"
              />
            </label>
            <label className="check-label">
              <input
                type="checkbox"
                checked={visible}
                onChange={(event) => setVisible(event.target.checked)}
              />
              让已接受的好友看到这个心愿
            </label>
            <p className="form-note">想要的东西不会被当作你已经拥有的物品。</p>
          </>
        )}
        {editor.kind === "task" && (
          <>
            <label>
              正在做什么
              <input
                required
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="如：周六四个人去公园野餐"
              />
            </label>
            <label>
              整理为
              <select
                value={taskKind}
                onChange={(event) => setTaskKind(event.target.value)}
              >
                <option value="checklist">准备清单</option>
                <option value="guidance">逐步处理</option>
                <option value="idea">一个新想法</option>
              </select>
            </label>
            <fieldset>
              <legend>用到的已有物品</legend>
              {itemSelection}
            </fieldset>
            <label>
              还需准备或核对什么
              <textarea
                rows={5}
                value={lines}
                onChange={(event) => setLines(event.target.value)}
                placeholder="每行写一项，例如：饮用水、确认人数、问问能否借桌子"
              />
            </label>
            <p className="form-note">
              新增项目先待处理。准备就绪与现实目标完成分别记录，不把需求变成已拥有物品。
            </p>
          </>
        )}
        {editor.kind === "sharing" && item && (
          <>
            <p className="form-note">
              共享「{item.name}
              」的照片、型号与共同状态。你的私人介绍、回忆和理解另行管理。
            </p>
            {friends.map((friend) => (
              <label className="check-label" key={friend.id}>
                <input
                  type="checkbox"
                  disabled={busy}
                  checked={sharedIds.includes(friend.id)}
                  onChange={(event) => {
                    const checked = event.target.checked;
                    void perform(async () => {
                      await request(
                        `/items/${item.id}/shares${checked ? "" : "/" + friend.id}`,
                        checked ? "POST" : "DELETE",
                        checked ? { user_id: friend.id } : undefined,
                      );
                      setSharedIds((previous) =>
                        checked
                          ? [...previous, friend.id]
                          : previous.filter((id) => id !== friend.id),
                      );
                    });
                  }}
                />
                {friend.display_name}
              </label>
            ))}
            {!friends.length && <p>先在朋友页添加一位朋友。</p>}
            <h4>家庭用品</h4>
            {houses.map((house) => (
              <label className="check-label" key={house.id}>
                <input
                  type="checkbox"
                  disabled={busy}
                  checked={house.item_ids.includes(item.id)}
                  onChange={(event) => {
                    void perform(() =>
                      request(`/households/${house.id}/items`, "POST", {
                        item_id: item.id,
                        shared: event.target.checked,
                      }),
                    );
                  }}
                />
                {house.name}
              </label>
            ))}
          </>
        )}
        {editor.kind === "experience-share" && experience && (
          <>
            <p>
              你选择分享《{experience.title}
              》的文字与照片。未共享的物品标签会隐藏，物伴的使用许可不随之开放。
            </p>
            <blockquote>{experience.text}</blockquote>
            {friends.map((friend) => (
              <label className="check-label" key={friend.id}>
                <input
                  type="checkbox"
                  checked={sharedIds.includes(friend.id)}
                  disabled={busy}
                  onChange={(event) => {
                    const checked = event.target.checked;
                    void perform(async () => {
                      await request(
                        `/experiences/${experience.id}/shares${checked ? "" : "/" + friend.id}`,
                        checked ? "POST" : "DELETE",
                        checked ? { user_id: friend.id } : undefined,
                      );
                      setSharedIds((previous) =>
                        checked
                          ? [...previous, friend.id]
                          : previous.filter((id) => id !== friend.id),
                      );
                    });
                  }}
                />
                {friend.display_name}
              </label>
            ))}
            <p className="form-note">
              撤回后停止未来访问，不能收回别人已经看到或复制的内容。
            </p>
          </>
        )}
        {editor.kind === "household" && (
          <>
            <div className="inline-form">
              <label>
                家庭名称
                <input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="如：我们的小家"
                />
              </label>
              <button
                type="button"
                className="primary-button"
                disabled={busy || !name.trim()}
                onClick={() =>
                  void perform(async () => {
                    await request("/households", "POST", { name });
                    setName("");
                  })
                }
              >
                <Plus size={16} />
                创建
              </button>
            </div>
            {workspace.households.map((house) => (
              <section className="house-manager" key={house.id}>
                <h3>{house.name}</h3>
                {house.membership === "invited" ? (
                  <button
                    type="button"
                    className="primary-button"
                    onClick={() =>
                      void perform(() =>
                        request(`/households/${house.id}/accept`, "POST"),
                      )
                    }
                  >
                    接受家庭邀请
                  </button>
                ) : (
                  <>
                    {house.members.map((member) => (
                      <div className="member-row" key={member.id}>
                        <span className="person-avatar">
                          {member.display_name.slice(-1)}
                        </span>
                        <strong>{member.display_name}</strong>
                        <small>
                          {member.status === "active"
                            ? member.role === "owner"
                              ? "创建者"
                              : "已加入"
                            : "等待接受"}
                        </small>
                        {member.role !== "owner" &&
                          (house.creator_id === user.id ||
                            member.id === user.id) && (
                            <button
                              type="button"
                              className="quiet-button"
                              onClick={() =>
                                void perform(() =>
                                  request(
                                    `/households/${house.id}/members/${member.id}`,
                                    "DELETE",
                                  ),
                                )
                              }
                            >
                              移出
                            </button>
                          )}
                      </div>
                    ))}
                    {house.creator_id === user.id && (
                      <div className="inline-form">
                        <select
                          aria-label={`邀请加入${house.name}`}
                          value={recipient}
                          onChange={(event) => setRecipient(event.target.value)}
                        >
                          <option value="">选择已接受的好友</option>
                          {friends
                            .filter(
                              (friend) =>
                                !house.members.some(
                                  (member) => member.id === friend.id,
                                ),
                            )
                            .map((friend) => (
                              <option key={friend.id} value={friend.id}>
                                {friend.display_name}
                              </option>
                            ))}
                        </select>
                        <button
                          type="button"
                          className="soft-button"
                          disabled={!recipient || busy}
                          onClick={() =>
                            void perform(() =>
                              request(
                                `/households/${house.id}/invitations`,
                                "POST",
                                { user_id: recipient },
                              ),
                            )
                          }
                        >
                          发送邀请
                        </button>
                      </div>
                    )}
                  </>
                )}
              </section>
            ))}
          </>
        )}
        {editor.kind === "settings" && (
          <>
            <CommunityConnection />
            <label>
              全局物伴的名字
              <input
                required
                maxLength={20}
                value={prefs.companion_name}
                onChange={(event) =>
                  setPrefs({ ...prefs, companion_name: event.target.value })
                }
              />
            </label>
            <label>
              显示方式
              <select
                value={prefs.display_mode}
                onChange={(event) =>
                  setPrefs({
                    ...prefs,
                    display_mode: event.target
                      .value as Preferences["display_mode"],
                  })
                }
              >
                <option value="normal">普通版</option>
                <option value="large">大字简洁版</option>
              </select>
            </label>
            <div className="form-divider">物间对我的理解</div>
            <p className="form-note">
              有用的理解会在相处中安静积累；回忆墙保存你主动留下的记录。当前要求优先，你可以随时纠正或移除理解，不会因共享物品自动分享给朋友。
            </p>
            {memoriesLoading && <p className="muted" role="status">正在读取对你的理解…</p>}
            {memoriesError && <p className="inline-error" role="alert">暂时未能读取已有理解：{memoriesError}。关闭后重新打开可重试。</p>}
            {memories.map((memory) => (
              <div className="memory-setting" key={memory.id}>
                <div className="memory-setting-copy">
                <textarea
                  aria-label="更正理解"
                  value={memoryDrafts[memory.id] ?? memory.content}
                  onChange={(event) =>
                    setMemoryDrafts((previous) => ({
                      ...previous,
                      [memory.id]: event.target.value,
                    }))
                  }
                />
                <div className="understanding-meta">
                  <span>{memory.basis === "inference" ? "待确认的推测" : "来自你的表达"}</span>
                  {memory.item_id && <span>关于：{workspace.items.find((item) => item.id === memory.item_id)?.name || "曾经关联的物品"}</span>}
                  {typeof memory.attributes?.context === "string" && memory.attributes.context && <span>适用情境：{memory.attributes.context}</span>}
                  {memory.expires_at && <span>有效至：{safeDate(memory.expires_at)}</span>}
                  {typeof memory.attributes?.source_quote === "string" && memory.attributes.source_quote && <details><summary>当时的话</summary><p>{memory.attributes.source_quote}</p></details>}
                </div>
                </div>
                <button
                  type="button"
                  className="quiet-button"
                  disabled={
                    busy ||
                    !memoryDrafts[memory.id]?.trim() ||
                    memoryDrafts[memory.id]?.trim() === memory.content
                  }
                  onClick={() => {
                    const content = memoryDrafts[memory.id]?.trim();
                    if (content && content !== memory.content)
                      void perform(async () => {
                        const next = await request<Memory>(
                          `/memories/${memory.id}/correction`,
                          "POST",
                          { content },
                        );
                        setMemories((previous) =>
                          previous.map((value) =>
                            value.id === memory.id ? next : value,
                          ),
                        );
                      });
                  }}
                >
                  保存更正
                </button>
                <button
                  type="button"
                  aria-label="移除这条理解"
                  className="quiet-button"
                  disabled={busy}
                  onClick={() =>
                    void perform(async () => {
                      await request(`/memories/${memory.id}`, "DELETE");
                      setMemories((previous) =>
                        previous.filter((value) => value.id !== memory.id),
                      );
                    })
                  }
                >
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
            {!memoriesLoading && !memoriesError && !memories.length && (
              <p className="muted">这里还没有积累的理解。</p>
            )}
          </>
        )}
      </form>
    </Modal>
  );
}
