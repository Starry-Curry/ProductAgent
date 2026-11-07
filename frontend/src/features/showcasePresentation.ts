// Curated historical demo attempts only. Raw chats, runs and evidence stay intact.
// Never filter by words such as "failed" or "unknown": successful iterations use them too.
const hiddenThreads = new Set([
  "9a83a49b677b4c5989c36bc34ccbb0e9",
  "452db0f9d82c426b9f045c969f4a27ff",
  "e9b5c5cc5dcc43439cf6cf23c920bd8f",
  "cde2936a95f04d2c8ead72c75ce0653c",
  "160bae0a212540ffa2ecdd00b8324138",
  "5519db30525b4923ba0e51d3b46fc3e9",
]);
const hiddenMessages = new Set([
  "0967bbeb2ee144d3a673cf7a12836a35",
  "782c3642517d46128325846050b8ffac",
  "4d20f4a0ef1344bb82b5c905baa61b64",
  "3c435a95ae4e47688aa16402cdcaeebe",
  "f8c2f7c653e041e1bdb60c679017b460",
  "10803da9aadc42638339ee861982c1b6",
]);
export function showcaseThreads<T extends { id: string }>(rows: T[]): T[] {
  return rows.filter((row) => !hiddenThreads.has(row.id));
}
export function showcaseMessages<T extends { id: string }>(rows: T[]): T[] {
  return rows.filter((row) => !hiddenMessages.has(row.id));
}
