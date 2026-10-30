// Real browser client of this owned simulator. These are requests, not discovery fixtures.
export async function readLamp() {
  const r = await fetch("/api/lamp/status");
  if (!r.ok) throw Error("read failed");
  return r.json();
}
export async function adjustLamp(brightness) {
  const r = await fetch("/api/lamp/brightness", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ brightness }),
  });
  if (!r.ok) throw Error("adjust failed");
  return r.json();
}
