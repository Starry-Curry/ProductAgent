import {
  BookOpen,
  Box,
  Coffee,
  Headphones,
  LampDesk,
  MapPin,
  Mountain,
  Printer,
  ShoppingBag,
  WashingMachine,
} from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import type { Item } from "../api";

export const attentionLabels: Record<string, string> = {
  normal: "正常",
  needs_check: "待检查",
  paused: "暂停使用",
  needs_restock: "待补充",
  lost: "实物已遗失",
  lent: "已借出",
};
export function presentation(item: Item) {
  const value = (item.state?.presentation || {}) as Record<string, unknown>;
  return {
    location: String(value.location || item.state?.location || ""),
    attention: String(value.attention || "normal"),
    note: String(value.note || ""),
    cherished: Boolean(value.cherished),
  };
}
export function Companion({ small = false }: { small?: boolean }) {
  return (
    <img
      className={`companion-art ${small ? "small" : ""}`}
      src="/illustrations/companion.png"
      alt="物伴阿圆"
    />
  );
}
export function ObjectVisual({
  item,
  className = "",
}: {
  item: Item;
  className?: string;
}) {
  if (item.photo_id)
    return (
      <img
        className={`object-photo ${className}`}
        src={`/api/assets/${item.photo_id}`}
        alt={item.name}
        loading="lazy"
      />
    );
  const name = item.name;
  const Icon = /耳机/.test(name)
    ? Headphones
    : /灯/.test(name)
      ? LampDesk
      : /打印/.test(name)
        ? Printer
        : /洗衣/.test(name)
          ? WashingMachine
          : /壶|杯|电饭/.test(name)
            ? Coffee
            : /石/.test(name)
              ? Mountain
              : /袋|垫/.test(name)
                ? ShoppingBag
                : /书|卡片/.test(name)
                  ? BookOpen
                  : Box;
  const tone = /壶|杯|饭/.test(name)
    ? "#bfa383"
    : /垫|袋/.test(name)
      ? "#c5af86"
      : /灯|石/.test(name)
        ? "#a7ad96"
        : "#9bafbb";
  return (
    <div
      className={`object-placeholder ${className}`}
      style={{ "--object-tone": tone } as CSSProperties}
      aria-label={`${item.name}，尚未添加实物照片`}
    >
      <span className="object-glow" />
      <Icon strokeWidth={1.05} />
      <span className="object-base" />
    </div>
  );
}
export function ItemCard({
  item,
  selected,
  onSelect,
}: {
  item: Item;
  selected?: boolean;
  onSelect: () => void;
}) {
  const info = presentation(item);
  return (
    <button
      className={`item-card ${selected ? "selected" : ""}`}
      onClick={onSelect}
      aria-pressed={Boolean(selected)}
    >
      <div className="item-card-image">
        <ObjectVisual item={item} />
      </div>
      <div className="item-card-copy">
        <strong>{item.name}</strong>
        <div>
          <span>
            <MapPin size={14} />
            {info.location ||
              (item.kind === "nonstandard_object"
                ? "一份独特的纪念"
                : item.product.model || "位置待补充")}
          </span>
          {info.attention !== "normal" && (
            <em className={`status-tag ${info.attention}`}>
              {attentionLabels[info.attention]}
            </em>
          )}
        </div>
      </div>
    </button>
  );
}
export function EmptyState({
  title,
  children,
  action,
}: {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <span className="empty-symbol">
        <Box size={28} strokeWidth={1.1} />
      </span>
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}
export function Pill({
  children,
  active,
  onClick,
}: {
  children: ReactNode;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className={`filter-pill ${active ? "active" : ""}`}
      onClick={onClick}
      aria-pressed={Boolean(active)}
    >
      {children}
    </button>
  );
}
export function safeDate(value: string | null | undefined) {
  if (!value) return "日期未记";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? value
    : new Intl.DateTimeFormat("zh-CN", {
        year: "numeric",
        month: "long",
        day: "numeric",
      }).format(parsed);
}
export function speak(text: string) {
  if (!("speechSynthesis" in window)) return false;
  speechSynthesis.cancel();
  const value = new SpeechSynthesisUtterance(text);
  value.lang = "zh-CN";
  speechSynthesis.speak(value);
  return true;
}
