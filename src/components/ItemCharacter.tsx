"use client";
import { type CSSProperties } from "react";
import type { Item } from "@/lib/domain";
export type CharacterMood = "idle" | "thinking" | "replying" | "attention";
const palette = [
  "#dfb58f",
  "#a6bdb0",
  "#b3b7ce",
  "#d6ad9f",
  "#c0bf8f",
  "#9bbcca",
];
export function ItemCharacter({
  item,
  mood = "idle",
  animated = true,
  size = 100,
}: {
  item?: Item;
  mood?: CharacterMood;
  animated?: boolean;
  size?: number;
}) {
  const key = item?.id || "wujian-home";
  const hash = Array.from(key).reduce(
    (n, c) => (n * 31 + c.charCodeAt(0)) >>> 0,
    7,
  );
  const color = palette[hash % palette.length];
  const noun = item ? item.name + item.category : "";
  const inferred = /沙发/.test(noun)
    ? "sofa"
    : /椅|凳/.test(noun)
      ? "chair"
      : /床/.test(noun)
        ? "bed"
        : /冰箱/.test(noun)
          ? "fridge"
          : /洗衣机/.test(noun)
            ? "washer"
            : /书架|搁架|收纳架|柜/.test(noun)
              ? "shelf"
              : /桌|茶几/.test(noun)
                ? "table"
                : /灯/.test(noun)
                  ? "lamp"
                  : /空气炸锅/.test(noun)
                    ? "fryer"
                    : /净化器/.test(noun)
                      ? "purifier"
                      : /吸尘器/.test(noun)
                        ? "vacuum"
                        : /水壶/.test(noun)
                          ? "kettle"
                          : /杯/.test(noun)
                            ? "cup"
                            : /相框/.test(noun)
                              ? "frame"
                              : "box";
  const icon = !item ? "home" : item.icon === "box" ? inferred : item.icon;
  const faceY = ["lamp", "shelf", "trolley"].includes(icon) ? 50 : 58;
  let shape;
  switch (icon) {
    case "sofa":
      shape = (
        <>
          <rect x="23" y="38" width="74" height="45" rx="15" fill={color} />
          <rect x="16" y="57" width="20" height="32" rx="8" fill={color} />
          <rect x="84" y="57" width="20" height="32" rx="8" fill={color} />
          <path d="M35 77h50M59 43v25" stroke="#fff7e6" strokeWidth="3" />
          <path
            d="M30 89v10m60-10v10"
            stroke="#86775f"
            strokeWidth="6"
            strokeLinecap="round"
          />
        </>
      );
      break;
    case "chair":
      shape = (
        <>
          <rect x="33" y="18" width="54" height="58" rx="13" fill={color} />
          <rect x="27" y="73" width="66" height="13" rx="5" fill={color} />
          <path
            d="m36 86-6 17m54-17 6 17M42 85v17m36-17v17"
            stroke="#8b8068"
            strokeWidth="5"
            strokeLinecap="round"
          />
        </>
      );
      break;
    case "bed":
      shape = (
        <>
          <rect x="16" y="26" width="88" height="72" rx="9" fill={color} />
          <rect x="24" y="32" width="33" height="18" rx="7" fill="#faf3df" />
          <rect x="63" y="32" width="33" height="18" rx="7" fill="#faf3df" />
          <path d="M18 54h84v35H18Z" fill={color} />
          <path
            d="M27 99v5m66-5v5"
            stroke="#8e826a"
            strokeWidth="5"
            strokeLinecap="round"
          />
          <path d="M20 83h80" stroke="#f8efd9" strokeWidth="3" />
        </>
      );
      break;
    case "fridge":
      shape = (
        <>
          <rect x="28" y="13" width="64" height="91" rx="9" fill={color} />
          <path d="M30 44h60" stroke="#fbf0db" strokeWidth="3" />
          <path
            d="M37 25v10m0 20v14"
            stroke="#798d7b"
            strokeWidth="4"
            strokeLinecap="round"
          />
        </>
      );
      break;
    case "washer":
      shape = (
        <>
          <rect x="21" y="22" width="78" height="80" rx="12" fill={color} />
          <circle cx="60" cy="65" r="27" fill="#e9eee2" />
          <circle cx="60" cy="65" r="21" fill="#b8d0c8" />
          <path
            d="M42 75q18-12 36 0"
            stroke="#d8e7dc"
            strokeWidth="4"
            fill="none"
          />
          <circle cx="83" cy="33" r="5" fill="#6d8675" />
        </>
      );
      break;
    case "home":
      shape = (
        <>
          <path d="M22 51 60 20l38 31v45H22Z" fill={color} />
          <path
            d="m16 52 44-37 44 37"
            fill="none"
            stroke="#617965"
            strokeWidth="7"
            strokeLinecap="round"
          />
          <rect x="48" y="78" width="24" height="21" rx="7" fill="#fff8e9" />
          <path d="M87 20v21" stroke="#617965" strokeWidth="8" />
        </>
      );
      break;
    case "shelf":
      shape = (
        <>
          <rect x="24" y="17" width="72" height="84" rx="6" fill={color} />
          <rect x="30" y="24" width="60" height="70" rx="3" fill="#fbf4e7" />
          <path
            d="M29 46h62M29 72h62M60 23v72"
            stroke={color}
            strokeWidth="6"
          />
          <path
            d="M36 40V29m8 11V27m25 11V28m8 12V28m6 12V31M37 88V77m8 11V78m25 10V78m10 10V76"
            stroke="#839b84"
            strokeWidth="5"
            strokeLinecap="round"
          />
        </>
      );
      break;
    case "table":
      shape = (
        <>
          <path
            d="M26 55v40m68-40v40M35 60v33m49-33v33"
            stroke="#8f7660"
            strokeWidth="7"
            strokeLinecap="round"
          />
          <rect x="16" y="39" width="88" height="27" rx="9" fill={color} />
          <path d="M24 43h70" stroke="#fff5df" strokeWidth="3" opacity=".7" />
        </>
      );
      break;
    case "lamp":
      shape = (
        <>
          <ellipse cx="60" cy="96" rx="29" ry="6" fill={color} />
          <path d="M60 91V52" stroke="#7d8d78" strokeWidth="7" />
          <path d="m38 21-14 36q36 12 72 0L82 21Z" fill={color} />
          <path d="M32 66q28 12 56 0l9 22H23Z" fill="#f6e9aa" opacity=".3" />
        </>
      );
      break;
    case "kettle":
      shape = (
        <>
          <path
            d="M83 39q29 0 19 28L86 79"
            fill="none"
            stroke={color}
            strokeWidth="9"
          />
          <path d="m28 48-13-7 11 22" fill={color} />
          <path d="M34 32h43l10 48q1 13-16 13H40q-16 0-15-13Z" fill={color} />
          <rect x="36" y="25" width="39" height="10" rx="5" fill="#748d7c" />
          <path
            d="M40 15q-6-7 0-12m16 12q-6-7 0-12"
            className="character-steam"
            fill="none"
            stroke="#c6d7c9"
            strokeWidth="3"
            strokeLinecap="round"
          />
        </>
      );
      break;
    case "cup":
    case "filter":
      shape = (
        <>
          <path
            d="M85 40q29-3 17 24L85 73"
            fill="none"
            stroke={color}
            strokeWidth="8"
          />
          <path d="m28 28 7 58q2 12 25 12t25-12l7-58Z" fill={color} />
          <ellipse cx="60" cy="28" rx="32" ry="8" fill="#f9eee0" />
          <ellipse cx="60" cy="29" rx="25" ry="4" fill="#ba9270" />
        </>
      );
      break;
    case "purifier":
      shape = (
        <>
          <rect x="28" y="20" width="64" height="81" rx="12" fill={color} />
          <ellipse cx="60" cy="23" rx="25" ry="5" fill="#edf2e8" />
          <path
            d="M37 74h46m-46 6h46m-46 6h46m-46 6h46"
            stroke="#7e9588"
            strokeWidth="2"
            opacity=".6"
          />
          <circle cx="60" cy="39" r="5" fill="#eef6e8" />
        </>
      );
      break;
    case "fryer":
      shape = (
        <>
          <rect x="26" y="20" width="68" height="80" rx="19" fill={color} />
          <rect x="36" y="27" width="48" height="17" rx="7" fill="#5e776b" />
          <circle cx="60" cy="35" r="4" fill="#d0dfc6" />
          <path d="M31 76h58" stroke="#8d806e" strokeWidth="2" />
          <rect x="51" y="71" width="18" height="19" rx="5" fill="#eee1c9" />
        </>
      );
      break;
    case "vacuum":
      shape = (
        <>
          <path
            d="m64 20 17 17-22 50"
            stroke="#788e83"
            strokeWidth="9"
            fill="none"
            strokeLinecap="round"
          />
          <rect x="55" y="17" width="25" height="40" rx="10" fill={color} />
          <path d="M37 90h47q10 0 10 9H27q0-9 10-9" fill={color} />
          <circle cx="61" cy="63" r="20" fill={color} />
        </>
      );
      break;
    case "trolley":
      shape = (
        <>
          <path d="M30 19v78m60-78v78" stroke="#84947d" strokeWidth="5" />
          <rect x="25" y="23" width="70" height="23" rx="7" fill={color} />
          <rect x="25" y="50" width="70" height="20" rx="7" fill={color} />
          <rect x="25" y="76" width="70" height="16" rx="6" fill={color} />
          <circle cx="33" cy="101" r="6" fill="#657a6c" />
          <circle cx="87" cy="101" r="6" fill="#657a6c" />
        </>
      );
      break;
    case "frame":
      shape = (
        <>
          <rect x="20" y="19" width="80" height="82" rx="8" fill={color} />
          <rect x="29" y="28" width="62" height="63" rx="3" fill="#f6eedf" />
          <path d="m31 81 18-18 13 12 12-14 16 20" fill="#b2c5a6" />
          <circle cx="76" cy="42" r="8" fill="#e7cb8a" />
        </>
      );
      break;
    case "beads":
      shape = (
        <>
          <rect x="23" y="24" width="74" height="72" rx="15" fill={color} />
          {Array.from({ length: 12 }, (_, n) => (
            <circle
              key={n}
              cx={34 + (n % 4) * 17}
              cy={35 + Math.floor(n / 4) * 23}
              r="5"
              fill={n % 3 ? "#fff0d8" : "#869d85"}
            />
          ))}
        </>
      );
      break;
    default:
      shape = (
        <>
          <rect x="23" y="27" width="74" height="70" rx="19" fill={color} />
          <path d="M25 44h70M60 28v16" stroke="#f8efdc" strokeWidth="5" />
          <path
            d="M35 27q1-17 25 0 24-17 25 0"
            fill="none"
            stroke="#8b9e87"
            strokeWidth="5"
          />
        </>
      );
  }
  return (
    <svg
      viewBox="0 0 120 120"
      width={size}
      height={size}
      role="img"
      aria-label={item ? item.name + "的二维角色" : "物间全屋角色"}
      className={`item-character mood-${mood} ${animated ? "is-animated" : "is-still"}`}
      style={{ "--character-delay": `${-(hash % 60) / 10}s` } as CSSProperties}
    >
      <title>{item ? item.name + "的二维角色" : "物间全屋角色"}</title>
      <ellipse
        className="character-shadow"
        cx="60"
        cy="108"
        rx="32"
        ry="5"
        fill="#688b6d"
        opacity=".13"
      />
      <g className="character-body">
        {shape}
        <g className="character-face" transform={`translate(0 ${faceY - 58})`}>
          <g className="character-eyes">
            <ellipse cx="49" cy="56" rx="2.9" ry="4" fill="#344f43" />
            <ellipse cx="71" cy="56" rx="2.9" ry="4" fill="#344f43" />
          </g>
          <ellipse
            cx="41"
            cy="64"
            rx="5"
            ry="2.5"
            fill="#d58f83"
            opacity=".55"
          />
          <ellipse
            cx="79"
            cy="64"
            rx="5"
            ry="2.5"
            fill="#d58f83"
            opacity=".55"
          />
          <path
            className="character-mouth"
            d="M55 65q5 5 10 0"
            stroke="#475f4e"
            strokeWidth="2"
            strokeLinecap="round"
            fill="none"
          />
        </g>
        <path
          d={
            hash % 2
              ? "m90 30 3-6 3 6 6 2-6 2-3 6-3-6-6-2Z"
              : "M90 28q-9-9-10-2-1 6 10 12 11-6 10-12-1-7-10 2"
          }
          fill={hash % 2 ? "#d6bc72" : "#c98d83"}
          opacity=".85"
        />
      </g>
      {mood === "thinking" && (
        <g className="character-thinking">
          <circle cx="95" cy="13" r="3" fill="#819e89" />
          <circle cx="105" cy="13" r="3" fill="#a9bc9d" />
          <circle cx="115" cy="13" r="3" fill="#d0d8bc" />
        </g>
      )}
    </svg>
  );
}
