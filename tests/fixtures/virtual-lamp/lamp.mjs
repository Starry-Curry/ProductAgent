// An owned software target, not firmware or a real device. REA receives this artifact.
import http from "node:http";
import fs from "node:fs";
export function startLamp(port = 0) {
  let state = { power: false, brightness: 40, revision: 0 };
  const server = http.createServer(async (req, res) => {
    res.setHeader("Content-Type", "application/json");
    if (req.method === "GET" && req.url === "/client.mjs") {
      res.setHeader("Content-Type", "text/javascript");
      res.end(fs.readFileSync(new URL("./client.mjs", import.meta.url))); return;
    }
    if (req.method === "GET" && req.url === "/") {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end('<h1>物间自有软件灯（模拟）</h1><input id="level" type="range" min="0" max="100"><output></output><script type="module">import {readLamp,adjustLamp} from "/client.mjs";const o=document.querySelector("output"),s=document.querySelector("input");s.onchange=async()=>{await adjustLamp(Number(s.value));o.textContent=JSON.stringify(await readLamp())};o.textContent=JSON.stringify(await readLamp());</script>'); return;
    }
    if (req.method === "GET" && req.url === "/api/lamp/status") {
      res.end(JSON.stringify({ ...state, simulated: true })); return;
    }
    if (req.method === "POST" && req.url === "/api/lamp/brightness") {
      let text = "";
      for await (const part of req) {
        text += part; if (text.length > 1024) { res.writeHead(413); res.end("{}"); return; }
      }
      let value;
      try { value = JSON.parse(text).brightness; } catch { /* rejected below */ }
      if (!Number.isInteger(value) || value < 0 || value > 100) {
        res.writeHead(400); res.end(JSON.stringify({ error: "brightness must be integer 0..100" })); return;
      }
      state = { power: value > 0, brightness: value, revision: state.revision + 1 };
      res.end(JSON.stringify({ accepted: true, revision: state.revision })); return;
    }
    res.writeHead(404); res.end(JSON.stringify({ error: "unknown_interface" }));
  });
  return new Promise(resolve => server.listen(port, "127.0.0.1", () => resolve({
    url: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise(done => server.close(done)),
  })));
}
