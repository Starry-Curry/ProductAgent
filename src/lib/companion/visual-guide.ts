export type GuideStep = { id: string; text: string };
export type GuideMarker = {
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  confidence: number;
  visible: boolean;
};
export type GuideAnalysis = {
  instruction: string;
  target: GuideMarker | null;
  source: "vision-model" | "demonstration";
  model?: string;
  message?: string;
};
export const washerGuide: GuideStep[] = [
  { id: "wash-1", text: "按一下“电源”键，开启洗衣机。" },
  { id: "wash-2", text: "把衣物放入滚筒，再关好机门。" },
  { id: "wash-3", text: "打开洗涤剂盒，按洗涤剂包装说明加入洗衣液。" },
  { id: "wash-4", text: "转动程序旋钮，选择适合衣物的日常洗涤程序。" },
  { id: "wash-5", text: "确认机门关好后，按“启动 / 暂停”键开始洗涤。" },
];
export function diagramMarker(step: string): GuideMarker {
  const [x, y, width, height, label] = /洗衣液|洗涤剂|洗滌劑|抽屉/.test(step)
    ? [0.242, 0.277, 0.22, 0.1, "洗涤剂盒"]
    : /衣物|机门|滾筒|滚筒/.test(step) && !/启动|開始|开始/.test(step)
      ? [0.5, 0.67, 0.41, 0.36, "机门 / 滚筒"]
      : /程序|模式|旋钮|温度|亮度/.test(step)
        ? [0.48, 0.27, 0.13, 0.14, "程序 / 调节旋钮"]
        : /启动|开始|暂停/.test(step)
          ? [0.81, 0.35, 0.14, 0.08, "启动 / 暂停"]
          : /电源|开机|开启设备/.test(step)
            ? [0.81, 0.19, 0.12, 0.08, "电源键"]
            : [0.5, 0.67, 0.35, 0.25, "当前操作区域"];
  return {
    x: x as number,
    y: y as number,
    width: width as number,
    height: height as number,
    label: label as string,
    confidence: 1,
    visible: true,
  };
}
const escape = (s: string) =>
  s.replace(
    /[<>&"']/g,
    (c) =>
      ({
        "<": "&lt;",
        ">": "&gt;",
        "&": "&amp;",
        '"': "&quot;",
        "'": "&apos;",
      })[c]!,
  );
export function guideSketch(name = "洗衣机", step?: string) {
  const text = escape(name);
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="760" viewBox="0 0 1000 760"><rect width="1000" height="760" rx="26" fill="#f5f4f0"/><text x="46" y="57" font-size="25" fill="#5d7379" font-family="sans-serif">${text} · 操作示意图</text><rect x="100" y="110" width="800" height="605" rx="40" fill="#fff" stroke="#c4cfd0" stroke-width="4"/><rect x="125" y="154" width="750" height="155" rx="18" fill="#e9eeed"/><rect x="132" y="175" width="220" height="72" rx="10" fill="#fff" stroke="#aebfc0" stroke-width="3"/><text x="179" y="220" font-size="23" fill="#647579" font-family="sans-serif">洗涤剂盒</text><circle cx="480" cy="205" r="56" fill="#fff" stroke="#97acb0" stroke-width="5"/><path d="M480 164 L480 177" stroke="#537381" stroke-width="6" stroke-linecap="round"/><text x="427" y="290" font-size="19" fill="#647579" font-family="sans-serif">程序 / 模式</text><rect x="750" y="118" width="120" height="58" rx="28" fill="#dde8eb" stroke="#9cb3b9" stroke-width="2"/><text x="784" y="155" font-size="24" fill="#405c65" font-family="sans-serif">电源</text><rect x="740" y="232" width="140" height="59" rx="27" fill="#dce5df" stroke="#a6b8ae" stroke-width="2"/><text x="757" y="269" font-size="21" fill="#4f6860" font-family="sans-serif">启动 / 暂停</text><circle cx="500" cy="508" r="172" fill="#ecf0ef" stroke="#bccccc" stroke-width="13"/><circle cx="500" cy="508" r="135" fill="#b5c8ce"/><path d="M377 529 Q480 450 623 532 L623 563 Q500 656 377 563Z" fill="#d5e0e0"/><path d="M630 473 Q662 509 630 545" fill="none" stroke="#788e95" stroke-width="15" stroke-linecap="round"/><text x="382" y="510" font-size="23" fill="#f8faf9" font-family="sans-serif">机门 / 滚筒</text><text x="42" y="740" font-size="15" fill="#88938e" font-family="sans-serif">演示位置；实际产品可上传近照或使用摄像头识别</text></svg>`;
  if (!/洗衣/.test(name)) {
    svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="760" viewBox="0 0 1000 760"><rect width="1000" height="760" rx="26" fill="#f5f4f0"/><text x="46" y="57" font-size="25" fill="#5d7379" font-family="sans-serif">${text} · 操作位置示意</text><rect x="100" y="105" width="800" height="610" rx="42" fill="#fff" stroke="#c4cfd0" stroke-width="4"/><rect x="125" y="120" width="750" height="215" rx="22" fill="#e9eeed"/><rect x="750" y="118" width="120" height="58" rx="28" fill="#dde8eb" stroke="#9cb3b9"/><text x="784" y="155" font-size="24" fill="#405c65" font-family="sans-serif">电源</text><circle cx="480" cy="205" r="56" fill="#fff" stroke="#97acb0" stroke-width="5"/><text x="434" y="213" font-size="23" fill="#647579" font-family="sans-serif">调节</text><rect x="740" y="232" width="140" height="59" rx="27" fill="#dce5df"/><text x="765" y="269" font-size="21" fill="#4f6860" font-family="sans-serif">操作键</text><rect x="300" y="410" width="400" height="200" rx="28" fill="#edf0ed" stroke="#c4cfd0" stroke-dasharray="9 8"/><text x="408" y="515" font-size="27" fill="#647579" font-family="sans-serif">当前操作区域</text><text x="42" y="740" font-size="16" fill="#88938e" font-family="sans-serif">布局示意，非该型号真实面板；上传近照可定位实际位置</text></svg>`;
  }
  const marker = step ? diagramMarker(step) : null;
  const marked = marker
    ? svg.replace(
        "</svg>",
        `<ellipse cx="${marker.x * 1000}" cy="${marker.y * 760}" rx="${marker.width * 500}" ry="${marker.height * 380}" fill="none" stroke="#e34e42" stroke-width="7"/><path d="M ${marker.x * 1000 - 160} ${marker.y * 760 + 120} L ${marker.x * 1000} ${marker.y * 760}" fill="none" stroke="#e34e42" stroke-width="9"/><circle cx="${marker.x * 1000}" cy="${marker.y * 760}" r="10" fill="#e34e42"/></svg>`,
      )
    : svg;
  return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(marked);
}
