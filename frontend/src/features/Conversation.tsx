import { useEffect, useRef, useState } from "react";
import { Camera, Check, Mic, Send, Square, X } from "lucide-react";
import { Input } from "antd";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { type ChatMessage, type Run } from "../api";
import { Companion } from "./shared";

export type Draft = { text: string; photos: string[] };
type Recognition = {
  lang: string;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  onresult:
    | ((event: {
        results: { [key: number]: { [key: number]: { transcript: string } } };
      }) => void)
    | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
};
const toolLabels: Record<string, string> = {
  find_items: "寻找相关物品",
  read_item: "核对这件物品",
  view_item_photo: "看看这件物品的照片",
  view_source_image: "核对原文配图",
  sample_video_frames: "提取视频关键画面",
  search_public_web: "查找公开资料",
  fetch_document: "阅读原始资料",
  read_source: "核对资料细节",
  view_source_page: "查看说明书图示",
  recall_memories: "回看获准经历",
  record_experience: "记下你想留下的这件事",
  evolve_avatar: "整理相处的默契",
  search_world: "寻找相关的物与经历",
  read_task: "接续正在做的事",
  GenerateStructuredOutput: "整理回答与后续安排",
};

export default function Conversation({
  messages,
  run,
  draft,
  draftIdentity,
  setDraft,
  onSend,
  onPhoto,
  uploading,
  assistantAvatar,
  blocked = false,
  onStop,
  companionName,
  contextLabel,
  onCameraRef,
  children,
  afterMessages,
}: {
  messages: ChatMessage[];
  run: Run | null;
  draft: Draft;
  draftIdentity: string;
  setDraft: (draft: Draft | ((previous: Draft) => Draft)) => void;
  onSend: () => Promise<void>;
  onPhoto: (photo?: File) => Promise<void>;
  uploading: boolean;
  assistantAvatar?: React.ReactNode;
  blocked?: boolean;
  onStop: () => void;
  companionName: string;
  contextLabel?: string;
  onCameraRef: (callback: () => void) => void;
  children?: React.ReactNode;
  afterMessages?: React.ReactNode;
}) {
  const bottom = useRef<HTMLDivElement>(null),
    file = useRef<HTMLInputElement>(null),
    recognition = useRef<Recognition | null>(null);
  const [listening, setListening] = useState(false),
    [voiceError, setVoiceError] = useState("");
  const busy = run?.status === "queued" || run?.status === "running";
  useEffect(() => {
    onCameraRef(() => file.current?.click());
  }, []);
  useEffect(() => {
    setListening(false);
    setVoiceError("");
    return () => {
      const previous = recognition.current;
      recognition.current = null;
      if (previous) {
        previous.onresult = previous.onerror = previous.onend = null;
        previous.stop();
      }
    };
  }, [draftIdentity, blocked]);
  useEffect(() => {
    if (messages.length)
      bottom.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [messages.length, run?.status]);
  function voice() {
    if (listening) {
      recognition.current?.stop();
      setListening(false);
      return;
    }
    const constructors = window as unknown as {
      SpeechRecognition?: new () => Recognition;
      webkitSpeechRecognition?: new () => Recognition;
    };
    const Constructor =
      constructors.SpeechRecognition || constructors.webkitSpeechRecognition;
    if (!Constructor) {
      setVoiceError("当前浏览器不支持语音识别，仍可输入文字或拍照。");
      return;
    }
    const current = new Constructor();
    recognition.current = current;
    current.lang = "zh-CN";
    current.interimResults = false;
    current.onresult = (event) => {
      if (recognition.current !== current) return;
      const transcript = event.results[0]?.[0]?.transcript || "";
      setDraft((previous) => ({
        ...previous,
        text: [previous.text, transcript].filter(Boolean).join(" "),
      }));
    };
    current.onerror = () => {
      if (recognition.current !== current) return;
      setListening(false);
      setVoiceError("这次没有听清，可以再试或输入文字。");
    };
    current.onend = () => {
      if (recognition.current === current) setListening(false);
    };
    try {
      current.start();
      setListening(true);
      setVoiceError("");
    } catch {
      setVoiceError("暂时无法使用麦克风，请检查浏览器权限。");
    }
  }
  const latest = run?.events
    .filter((event) => event.type === "tool_start")
    .at(-1);
  return (
    <section className="conversation">
      <div className="conversation-scroll">
        {children}
        {contextLabel && (
          <div className="conversation-context">此刻围绕：{contextLabel}</div>
        )}
        {messages.map((value) => (
          <div className={`chat-message ${value.role}`} key={value.id}>
            {value.role === "assistant" && (assistantAvatar || <Companion small />)}
            <div className="chat-bubble">
              {value.photo_ids.length > 0 && (
                <div className="message-photos">
                  {value.photo_ids.map((id) => (
                    <img
                      key={id}
                      src={`/api/assets/${id}`}
                      alt="这段对话中的照片"
                    />
                  ))}
                </div>
              )}
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  a: (props) => (
                    <a {...props} target="_blank" rel="noopener noreferrer" />
                  ),
                }}
              >
                {value.text}
              </ReactMarkdown>
            </div>
          </div>
        ))}
        {afterMessages}
        {busy && (
          <div className="chat-message assistant">
            {assistantAvatar || <Companion small />}
            <div className="chat-bubble">
              <span className="thinking-dots">
                <i />
                <i />
                <i />
              </span>
              <span>
                {latest
                  ? toolLabels[String(latest.name)] || "继续处理当前问题"
                  : "正在理解你的这次需要"}
                …
              </span>
            </div>
          </div>
        )}
        {run && ["failed", "interrupted"].includes(run.status) && (
          <p className="inline-error" role="status">
            {run.error || "当前处理暂时停在这里，可以继续这个话题。"}
          </p>
        )}
        <div ref={bottom} />
      </div>
      <footer className="composer-wrap">
        {draft.photos.length > 0 && (
          <div className="attached-photos">
            {draft.photos.map((id) => (
              <div key={id}>
                <img src={`/api/assets/${id}`} alt="待发送照片" />
                <button
                  aria-label="移除待发送照片"
                  onClick={() =>
                    setDraft({
                      ...draft,
                      photos: draft.photos.filter((value) => value !== id),
                    })
                  }
                >
                  <X size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
        <form
          className="composer"
          onSubmit={(event) => {
            event.preventDefault();
            if (!uploading && !blocked) void onSend();
          }}
        >
          <button
            type="button"
            className="icon-button composer-camera"
            title="拍照或添加照片"
            disabled={uploading || draft.photos.length >= 4}
            onClick={() => file.current?.click()}
          >
            <Camera size={23} />
          </button>
          <Input.TextArea
            aria-label="对物伴说"
            value={draft.text}
            onChange={(event) =>
              setDraft({ ...draft, text: event.target.value })
            }
            placeholder={`想问什么，或和${companionName}聊聊今天…`}
            rows={1}
            variant="borderless"
            autoSize={{ minRows: 1, maxRows: 5 }}
            onKeyDown={(event) => {
              if (
                event.key === "Enter" &&
                !event.shiftKey &&
                !event.nativeEvent.isComposing
              ) {
                event.preventDefault();
                if (!uploading && !blocked) void onSend();
              }
            }}
          />
          <button
            className={`icon-button microphone ${listening ? "active" : ""}`}
            type="button"
            title={listening ? "停止语音识别" : "语音输入"}
            onClick={voice}
          >
            <Mic size={23} />
          </button>
          <span className="input-kind">{listening ? "正在听" : "文字"}</span>
          {busy ? (
            <button
              type="button"
              className="send-button stop"
              title="停止生成"
              onClick={onStop}
            >
              <Square size={17} />
            </button>
          ) : (
            <button
              type="submit"
              className="send-button"
              title="发送"
              disabled={
                uploading || blocked || (!draft.text.trim() && !draft.photos.length)
              }
            >
              <Send size={21} />
            </button>
          )}
        </form>
        <div className="composer-caption">
          <span>
            {uploading
              ? "正在添加照片…"
              : voiceError || "Enter 发送 · Shift + Enter 换行"}
          </span>
          {listening && (
            <button
              className="quiet-button"
              onClick={() => {
                recognition.current?.stop();
                setListening(false);
              }}
            >
              完成语音输入
              <Check size={14} />
            </button>
          )}
        </div>
        <input
          ref={file}
          hidden
          type="file"
          accept="image/*"
          capture="environment"
          onChange={(event) => {
            void onPhoto(event.target.files?.[0]);
            event.target.value = "";
          }}
        />
      </footer>
    </section>
  );
}
