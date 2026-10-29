/** Remove only explicitly forbidden action verbs, never the remainder of a sentence. */
export function withoutProhibitedActions(text: string) {
  return text
    .replace(
      /(?:不要|无需|禁止|避免|不)(?:再|额外|进行|使用)?(?:粘贴|粘到|粘在|贴到|贴在|固定|裁剪|剪下|剪成|书写|写字|折叠|计时)/g,
      "",
    )
    .replace(
      /(?:不|勿|禁止|避免)(?:触碰|操作)(?:发热|高温|带电)(?:[、/和及](?:发热|高温|带电))*设备/g,
      "",
    )
    .replace(
      /(?:不要|不可|不应|禁止|避免|无需|不想|不使用|不进行|不)(?:自行|尝试|进行|使用|自动|额外|再)?(?:带电拆卸|加热电池|拆机|拆卸|短接|带电改装|明火|油炸|微波|服药|长按|按住|购买|采购|去买|添置|下单|出门|外出|拍照|拍摄|摄影|播放音乐|打开音箱)/g,
      "",
    );
}

/** Ordinary file-selection gestures are not model-specific device button sequences. */
export function withoutFileSelectionGestures(text: string) {
  return text
    .split(/([。；;\n])/)
    .map((clause) => {
      if (/秒|复位|重置|配对|电源|开机|关机|维修/.test(clause)) return clause;
      return clause
        .replace(
          /((?:鼠标)?左键(?:点住|按下))[（(]按住不放[）)](?=.{0,40}(?:拖动|拖到|拖进|拖入))/g,
          "$1（保持）",
        )
        .replace(
          /按住\s*(?:键盘上(?:的)?)?\s*(?:Ctrl|Control|Shift|Alt|Command|⌘)\s*(?:键)?/gi,
          "",
        )
        .replace(
          /按住\s*(?:鼠标)?左键(?:不放)?(?=.{0,40}(?:拖动|拖到|拖进|拖入))/g,
          "",
        );
    })
    .join("");
}
