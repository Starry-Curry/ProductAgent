import { useId } from "react";
import type { CSSProperties } from "react";
import type { Item } from "../api";

export type ObjectExpression = "calm" | "happy" | "sleepy";
export type ObjectShape = "cup" | "stone" | "flower" | "keepsake" | "cat";
type CompanionItem = Pick<Item, "name" | "kind" | "avatar" | "photo_id">;

function shapeFor(name: string): ObjectShape {
  if (/向日葵|花束|鲜花|花朵|植物|盆栽|玫瑰|郁金香|雏菊/.test(name)) return "flower";
  if (/石头|卵石|鹅卵石|石子|纪念石/.test(name)) return "stone";
  if (/杯|马克/.test(name)) return "cup";
  if (/猫咪|小猫|陶猫|猫摆件|猫公仔|招财猫/.test(name)) return "cat";
  return "keepsake";
}

function tint(hex: string, amount: number) {
  const value = hex.replace("#", "");
  const full = value.length === 3 ? value.split("").map((part) => part + part).join("") : value;
  return "#" + [0, 2, 4].map((offset) => {
    const channel = parseInt(full.slice(offset, offset + 2), 16);
    return Math.round(channel + (255 - channel) * amount).toString(16).padStart(2, "0");
  }).join("");
}

/** An optional illustration controlled by the person's explicit form setting.
 * Auto uses a conservative name hint; neither form nor expression is evidence
 * about the physical object, the person's mood, or learned personality.
 */
export function ObjectCompanion({
  item,
  size = 112,
  expression = "calm",
  shape,
  showPhoto = false,
  className = "",
}: {
  item: CompanionItem;
  size?: number;
  expression?: ObjectExpression;
  shape?: ObjectShape;
  showPhoto?: boolean;
  className?: string;
}) {
  const identity = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  if (!item.avatar.enabled) return null;
  const form = item.avatar.form && item.avatar.form !== "auto" ? item.avatar.form : shape || shapeFor(item.name);
  const color = /^#(?:[a-f\d]{3}|[a-f\d]{6})$/i.test(item.avatar.color || "")
    ? item.avatar.color : "#7e9eac";
  const name = item.avatar.nickname || item.name;
  const body = `${identity}-body`;
  const glaze = `${identity}-glaze`;
  const faceY = form === "flower" ? 100 : form === "stone" ? 132 : form === "cat" ? 115 : 130;
  const faceX = form === "flower" ? 120 : form === "cup" ? 110 : 120;
  const style: CSSProperties = {
    position: "relative", display: "inline-block", width: size, height: size,
    maxWidth: "100%", flexShrink: 0, verticalAlign: "middle", lineHeight: 0,
  };

  return (
    <span className={`object-companion ${className}`} style={style} data-form={form}>
      <svg viewBox="0 0 240 240" width="100%" height="100%" role="img"
        aria-labelledby={`${identity}-title ${identity}-description`}>
        <title id={`${identity}-title`}>{`${name}的物品分身`}</title>
        <desc id={`${identity}-description`}>{item.avatar.form && item.avatar.form !== "auto" ? "由你选择的" : `以${item.name}为灵感的`}插画形象；表情用于展示，不代表真实情绪。</desc>
        <defs>
          <linearGradient id={body} x1="0" y1="0" x2=".8" y2="1">
            <stop offset="0" stopColor="#fffcf5" />
            <stop offset=".55" stopColor={tint(color, .78)} />
            <stop offset="1" stopColor={tint(color, .52)} />
          </linearGradient>
          <radialGradient id={glaze} cx=".4" cy=".25" r=".8">
            <stop offset="0" stopColor="#fffdf7" />
            <stop offset="1" stopColor="#e3d7bc" />
          </radialGradient>
        </defs>
        <ellipse cx="120" cy="213" rx="71" ry="11" fill="#e5ddd2" opacity=".54" />
        <ellipse cx="120" cy="211" rx="47" ry="5" fill="#a99e8d" opacity=".14" />

        {form === "cup" && <>
          <path d="M165 92C218 82 218 158 165 153L165 134C190 140 195 105 165 111Z"
            fill={`url(#${body})`} stroke="#cbbda8" strokeWidth="3" />
          <path d="M54 89Q58 79 69 85Q80 90 92 85Q105 78 118 85Q134 91 148 84Q162 79 168 89L160 180Q158 195 141 198L79 198Q61 195 60 179Z"
            fill={`url(#${body})`} stroke="#cbbda8" strokeWidth="2" />
          <path d="M58 91Q78 103 109 97Q144 104 164 91" fill="none" stroke="#b2a28c" strokeWidth="3" opacity=".65" />
          <path d="M69 105L73 173" stroke="#fffdf7" strokeWidth="7" strokeLinecap="round" opacity=".6" />
          <path d="M89 188Q95 174 104 186Q111 167 118 184Q131 171 136 189" fill="none"
            stroke={color} strokeWidth="3" strokeLinecap="round" opacity=".6" />
          <ellipse cx="75" cy="165" rx="2" ry="1.6" fill="#c5b9a4" />
          <ellipse cx="144" cy="111" rx="1.5" ry="1.5" fill="#c5b9a4" />
        </>}

        {form === "stone" && <>
          <path d="M46 161C38 126 67 78 103 71C139 62 173 92 190 121C209 153 194 185 161 195C130 204 64 203 46 177Z"
            fill={`url(#${glaze})`} stroke="#cec3ae" strokeWidth="2" />
          <path d="M65 118Q83 86 110 84" fill="none" stroke="#fffdf6" strokeWidth="7" strokeLinecap="round" opacity=".65" />
          <path d="M53 168Q119 192 185 164L183 180Q119 210 53 184Z" fill={color} opacity=".8" />
          <path d="M79 185L77 212L94 214L98 189" fill={color} />
          <path d="M83 204L90 205M83 209L90 210" stroke={tint(color, .5)} strokeWidth="2" />
          <circle cx="67" cy="146" r="1.4" fill="#c7bca7" />
          <circle cx="173" cy="148" r="1.8" fill="#c7bca7" />
          <circle cx="161" cy="95" r="1.2" fill="#c7bca7" />
        </>}

        {form === "flower" && <>
          <path d="M119 135Q111 160 120 181" fill="none" stroke="#879a75" strokeWidth="7" strokeLinecap="round" />
          <path d="M117 166Q79 164 82 142Q109 138 117 166Z" fill="#b4c3a0" />
          <path d="M120 157Q144 130 160 143Q153 166 120 169Z" fill="#9db38b" />
          {Array.from({ length: 10 }, (_, index) => <ellipse key={index} cx="120" cy="57" rx="13" ry="24"
            transform={`rotate(${index * 36} 120 100)`} fill={index % 2 ? "#ead393" : "#f3dfa5"}
            stroke="#d8bd7c" strokeWidth="1" />)}
          <circle cx="120" cy="100" r="34" fill="#d6b888" stroke="#c7a779" strokeWidth="2" />
          <path d="M99 82Q112 73 125 78" fill="none" stroke="#ecd9b7" strokeWidth="5" strokeLinecap="round" opacity=".75" />
          <path d="M91 180L98 207Q120 215 143 207L150 180Z" fill={`url(#${body})`} stroke="#cbbda8" strokeWidth="2" />
          <ellipse cx="120" cy="180" rx="30" ry="7" fill={tint(color, .65)} stroke="#cbbda8" strokeWidth="2" />
          <path d="M120 175L120 184" stroke="#879a75" strokeWidth="6" strokeLinecap="round" />
        </>}

        {form === "keepsake" && <>
          <path d="M52 168C45 141 55 97 79 84Q120 61 161 84C187 99 199 145 188 171Q176 199 120 200Q66 200 52 168Z"
            fill={`url(#${body})`} stroke="#c9c1b2" strokeWidth="2" />
          <path d="M69 111Q80 90 104 86" fill="none" stroke="#fffdf7" strokeWidth="8" strokeLinecap="round" opacity=".7" />
          <path d="M53 170Q123 188 187 168L185 181Q119 209 56 185Z" fill={color} opacity=".8" />
          <path d="M149 185L147 211L164 209L166 181" fill={color} />
          <path d="M151 201L161 199M151 206L160 204" stroke={tint(color, .5)} strokeWidth="2" />
          <path d="M111 80Q119 70 127 79" fill="none" stroke="#c9c1b2" strokeWidth="3" strokeLinecap="round" />
        </>}

        {form === "cat" && <>
          <path d="M159 177C198 191 211 166 196 151C188 143 179 148 181 156C183 163 192 163 190 169C185 181 170 172 164 165Z"
            fill={`url(#${body})`} stroke="#cbbfac" strokeWidth="2" />
          <path d="M82 145Q68 162 74 192Q84 208 120 208Q157 208 167 191Q172 165 158 145Z"
            fill={`url(#${body})`} stroke="#cbbfac" strokeWidth="2" />
          <ellipse cx="120" cy="177" rx="25" ry="25" fill="#fffaf1" opacity=".8" />
          <path d="M72 98L70 59Q70 49 80 55L101 74Q120 68 140 74L162 55Q172 49 171 61L168 98Q180 111 173 134Q162 153 120 154Q78 153 67 135Q59 112 72 98Z"
            fill={`url(#${body})`} stroke="#cbbfac" strokeWidth="2" />
          <path d="M77 65L79 91L94 79Z" fill="#e7c8be" opacity=".75" />
          <path d="M163 65L161 91L146 79Z" fill="#e7c8be" opacity=".75" />
          <path d="M83 102Q92 86 106 84" stroke="#fffdf7" strokeWidth="6" fill="none" strokeLinecap="round" opacity=".65" />
          <path d="M77 145Q120 162 164 145L162 156Q120 176 79 157Z" fill={color} opacity=".82" />
          <path d="M145 158L143 184L157 186L160 154" fill={color} />
          <path d="M146 177L155 179M146 181L154 183" stroke={tint(color, .55)} strokeWidth="1.8" />
          <ellipse cx="95" cy="202" rx="17" ry="8" fill={tint(color, .8)} stroke="#cbbfac" strokeWidth="1.5" />
          <ellipse cx="145" cy="202" rx="17" ry="8" fill={tint(color, .8)} stroke="#cbbfac" strokeWidth="1.5" />
          <path d="M90 202L90 206M96 203L96 207M140 203L140 207M146 202L146 206" stroke="#c3b7a5" strokeWidth="1.4" strokeLinecap="round" />
          <path d="M79 117L91 119M78 125L91 124M149 119L161 117M149 124L162 125" stroke="#c0ae9c" strokeWidth="1.8" strokeLinecap="round" />
          <path d="M116 120Q120 118 124 120L120 124Z" fill="#c59e92" />
        </>}

        <g transform={`translate(${faceX} ${faceY})`}>
          <ellipse cx="-26" cy="9" rx="8" ry="4.5" fill="#d8a49a" opacity=".48" />
          <ellipse cx="26" cy="9" rx="8" ry="4.5" fill="#d8a49a" opacity=".48" />
          {expression === "sleepy" ? <>
            <path d="M-21-2Q-15 3-9-2M9-2Q15 3 21-2" fill="none" stroke="#554f49" strokeWidth="3" strokeLinecap="round" />
          </> : expression === "happy" ? <>
            <path d="M-21 0Q-15-8-9 0M9 0Q15-8 21 0" fill="none" stroke="#554f49" strokeWidth="3" strokeLinecap="round" />
          </> : <>
            <ellipse cx="-15" cy="-1" rx="3" ry="4" fill="#554f49" />
            <ellipse cx="15" cy="-1" rx="3" ry="4" fill="#554f49" />
            <circle cx="-14.2" cy="-2.2" r=".8" fill="#fffdf7" />
            <circle cx="15.8" cy="-2.2" r=".8" fill="#fffdf7" />
          </>}
          <path d={expression === "happy" ? "M-5 11Q0 17 5 11" : "M-4 12Q0 15 4 12"}
            fill="none" stroke="#776053" strokeWidth="2" strokeLinecap="round" />
        </g>
      </svg>
      {showPhoto && item.photo_id && <img src={`/api/assets/${encodeURIComponent(item.photo_id)}`}
        alt={`${item.name}的实物照片`} loading="lazy" style={{
          position: "absolute", right: 0, bottom: 0, width: "25%", height: "25%",
          borderRadius: "30%", objectFit: "cover", border: "2px solid #fffaf3",
          boxShadow: "0 2px 8px #534b4220",
        }} />}
    </span>
  );
}
