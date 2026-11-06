export function validTaskDate(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    !Number.isFinite(Date.parse(value + "T00:00:00Z")) ||
    new Date(value + "T00:00:00Z").toISOString().slice(0, 10) !== value
  )
    throw Error("请选择有效的待办日期");
  return value;
}
export function calendarToday(now = new Date()) {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Shanghai" }).format(
    now,
  );
}
export function dueDateLabel(
  value?: string,
  complete = false,
  now = new Date(),
) {
  if (!value) return { text: "未设日期", tone: "none" };
  const today = calendarToday(now),
    days = Math.round(
      (Date.parse(value + "T00:00:00Z") - Date.parse(today + "T00:00:00Z")) /
        86400000,
    );
  const text = value.replace(/-/g, "/");
  return {
    text: complete
      ? text
      : days < 0
        ? `${text} · 已逾期 ${-days} 天`
        : days === 0
          ? `${text} · 今天`
          : days === 1
            ? `${text} · 明天`
            : `${text} · 待到期`,
    tone: complete
      ? "done"
      : days < 0
        ? "overdue"
        : days === 0
          ? "today"
          : "future",
  };
}
