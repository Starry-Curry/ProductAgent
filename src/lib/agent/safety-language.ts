/** Remove only explicitly forbidden action verbs, never the remainder of a sentence. */
export function withoutProhibitedActions(text: string) {
  return text.replace(
    /(?:不要|不可|不应|禁止|避免|无需|不想|不使用|不进行|不)(?:自行|尝试|进行|使用)?(?:带电拆卸|加热电池|拆机|拆卸|短接|带电改装|明火|油炸|微波|服药|长按|按住)/g,
    "",
  );
}
