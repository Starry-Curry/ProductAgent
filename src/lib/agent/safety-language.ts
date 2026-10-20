/** Remove only explicitly forbidden action verbs, never the remainder of a sentence. */
export function withoutProhibitedActions(text: string) {
  return text.replace(/(?:不|勿|禁止|避免)(?:触碰|操作)(?:发热|高温|带电)(?:[、/和及](?:发热|高温|带电))*设备/g, "").replace(
    /(?:不要|不可|不应|禁止|避免|无需|不想|不使用|不进行|不)(?:自行|尝试|进行|使用|自动|额外|再)?(?:带电拆卸|加热电池|拆机|拆卸|短接|带电改装|明火|油炸|微波|服药|长按|按住|购买|采购|去买|添置|下单|出门|外出|拍照|拍摄|摄影|播放音乐|打开音箱)/g,
    "",
  );
}
