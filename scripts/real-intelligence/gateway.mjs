// The application receives a fake key. Only this local process authenticates to the existing provider.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { assertBudget } from './budget.mjs';
export async function gateway(configPath,options) {
  const limits=options?.limits||{roundId:'real-intelligence-20261031-r1',requests:150,cny:50};
  if (!configPath || path.basename(configPath) !== ".env.local")
    throw Error("existing_local_configuration_required");
  const config = {};
  for (const line of fs.readFileSync(configPath, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m) config[m[1]] = m[2].replace(/^(['"])(.*)\1$/, "$2");
  }
  if (!config.AI_API_KEY || !config.AI_BASE_URL || !config.AI_MODEL)
    throw Error("credential_or_model_missing");
  const remote = new URL(config.AI_BASE_URL);
  if (
    remote.protocol !== "https:" ||
    remote.hostname !== "dashscope.aliyuncs.com" ||
    remote.username ||
    remote.password ||
    remote.search
  )
    throw Error("unexpected_provider_configuration");
  const modelResponse = await fetch(
    config.AI_BASE_URL.replace(/\/$/, "") + "/models",
    {
      headers: { Authorization: "Bearer " + config.AI_API_KEY },
      signal: AbortSignal.timeout(20000),
      redirect: "error",
    },
  );
  const modelData = await modelResponse.json().catch(() => ({}));
  const available = (modelData.data || [])
    .map((m) => m.id)
    .filter((id) => typeof id === "string");
  const root = path.resolve(options?.root||"docs/engineering/real-intelligence-2026-10-31/evidence");
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(
    path.join(root, "model-availability.json"),
    JSON.stringify(
      {
        at: new Date().toISOString(),
        httpStatus: modelResponse.status,
        ids: available,
      },
      null,
      2,
    ),
  );
  fs.mkdirSync('.runtime',{recursive:true});
  const intendedLock=path.resolve(options?.lockFile||'.runtime/real-intelligence-round.lock');
  if(options?.recoverStaleLock&&fs.existsSync(intendedLock)){
    const old=JSON.parse(fs.readFileSync(intendedLock,'utf8'));
    if(!Number.isInteger(old.pid)||old.pid<=0)throw Error('invalid_gateway_lock');
    try{process.kill(old.pid,0);}catch(e){if(e.code==='ESRCH')fs.unlinkSync(intendedLock);else throw e;}
  }
  const file = path.join(root, "model-calls.json"),
    lockFile = path.resolve(options?.lockFile||'.runtime/real-intelligence-round.lock'),
    lock = fs.openSync(lockFile, "wx");
  fs.writeFileSync(
    lock,
    JSON.stringify({ pid: process.pid, at: new Date().toISOString() }),
  );
  const ledger = fs.existsSync(file)
    ? JSON.parse(fs.readFileSync(file, "utf8"))
    : { task: limits.roundId, authorizedLimits:limits, attempts: [] };
  // An interrupted process never makes its reserved upstream charge disappear.
  if(options?.reconcileInterrupted)for(const a of ledger.attempts)if(a.status==='started'){a.status='failed';a.error='previous_process_interrupted_usage_unknown_reserved';}
  // This authorized round has one fixed ledger across all experiment stages.
  // The historical product-foundation ledger is never opened by this gateway.
  const stage = limits.roundId;
  config.AI_MODEL = options?.model || "qwen-plus-2025-12-01"; if (!available.includes(config.AI_MODEL)) throw Error("pinned_model_not_available");
  const clean = (value) =>
    JSON.parse(
      JSON.stringify(value,(key,value)=>key==='reasoning_content'?undefined:value).replaceAll(config.AI_API_KEY, "[removed]"),
    );
  const save = () =>
    fs.writeFileSync(file, JSON.stringify(clean(ledger), null, 2) + "\n");
  save(); // Persist an empty NEW round too; never replace a prior round.
  const server = http.createServer(async (req, res) => {
    let attempt;
    try {
      if (
        req.headers.origin ||
        req.headers.authorization !== "Bearer fixture-only" ||
        req.method !== "POST"
      )
        throw Error("isolated_provider_required");
      let raw = "";
      for await (const c of req) {
        raw += c;
        if (Buffer.byteLength(raw) > (options?.allowBoundedPageImages?700000:180000)) throw Error("input_too_large");
      }
      const body = JSON.parse(raw);
      const nativeSearch=/\/(text|multimodal)-generation\/generation$/.test(req.url);
      const multimodalSearch=req.url.endsWith('/multimodal-generation/generation');
      if(nativeSearch&&(!body.parameters?.enable_search||body.parameters?.search_options?.search_strategy!=='turbo'))throw Error('bounded_search_only');
      const allowedSearch=nativeSearch&&options?.searchModel&&body.model===options.searchModel&&available.includes(body.model);
      const responses=req.url.endsWith('/responses');
      options?.validateRequest?.(body,{nativeSearch,responses});
      if (body.model !== config.AI_MODEL&&!allowedSearch || body.enable_thinking === true&&!options?.allowThinking) throw Error("pinned_model_or_thinking_not_authorized");
      if(responses&&!options?.allowResponses)throw Error('responses_not_authorized');
      if(responses&&((body.stream&&!options?.allowResponsesStream)||!Number.isInteger(body.max_tool_calls)||body.max_tool_calls>4||body.max_tool_calls<1))throw Error('bounded_responses_required');
      if(responses&&options?.allowResponsesStream&&body.store!==false)throw Error('responses_store_false_required');
      const requestedMax=body.max_completion_tokens||body.max_output_tokens||body.max_tokens||body.parameters?.max_tokens||4000;
      const outputCap=options?.allowThinking?8192:4000;
      if(!Number.isInteger(requestedMax)||requestedMax<1||requestedMax>outputCap)throw Error('output_cap_exceeded');
      if(body.enable_thinking&&!responses&&(!Number.isInteger(body.thinking_budget)||body.thinking_budget>(options?.maxThinkingBudget||2048)||body.thinking_budget<1))throw Error('thinking_budget_required');
      const maxTokens=requestedMax;
      const fileInput=(body.messages||[]).some(m=>Array.isArray(m.content)&&m.content.some(c=>c.type==='file'));
      const externalInput=options?.reserveExternalInputs&&(responses||nativeSearch||fileInput);
      // UTF-8 byte count bounds input tokens; highest published Plus tier is
      // reserved until actual usage arrives. An unknown failed charge stays reserved.
      const reserve =
        ((externalInput?Math.max(Buffer.byteLength(raw),1_000_000):Buffer.byteLength(raw)) * Math.max(8, options?.prices?.input || 0) +
          (maxTokens + (body.enable_thinking ? body.thinking_budget : 0)) * Math.max(64, options?.prices?.output || 0)) /
        1e6 + (fileInput?5.12:0)+(nativeSearch||responses?(externalInput?1:5):0);
      assertBudget(ledger,reserve,limits);
      const user = (body.messages||body.input?.messages)?.find((m) => m.role === "user");
      let question = "";
      try {
        question =
          JSON.parse(user.content).question ||
          JSON.parse(user.content).goal ||
          "";
      } catch {
        question = String(user?.content || "").slice(0, 2000);
      }
      attempt = {
        number: ledger.attempts.length + 1, evaluation: options?.recordContent === false ? 'private-preview' : String(req.headers["x-wujian-evaluation"] || "unlabeled"),
        stage,
        kind:responses?'responses_search':nativeSearch?'official_search':'inference',
        reservedCny: reserve,
        priceSource: "https://help.aliyun.com/zh/model-studio/model-pricing",
        startedAt: new Date().toISOString(),
        model: body.model,
        enableThinking: body.enable_thinking === true,
        status: "started",
        question: options?.recordContent === false ? '[preview content not recorded]' : question,
        contentRecorded: options?.recordContent !== false,
        inputSha256: options?.recordContent === false ? undefined : createHash("sha256").update(raw).digest("hex"),
        inputBytes: Buffer.byteLength(raw),
        input: options?.recordContent === false ? undefined : clean(body.messages||body.input?.messages||body.input),
        tools: (body.tools || []).map((t) => t.function?.name||t.type),
      };
      ledger.attempts.push(attempt);
      save();
      const controller = new AbortController();
      res.on("close", () => {
        if (!res.writableEnded) controller.abort();
      });
      const response = await fetch(
        nativeSearch?new URL('/api/v1/services/aigc/'+(multimodalSearch?'multimodal':'text')+'-generation/generation',config.AI_BASE_URL):config.AI_BASE_URL.replace(/\/$/, "") + (responses?'/responses':"/chat/completions"),
        {
          method: "POST",
          redirect: "error",
          headers: {
            Authorization: "Bearer " + config.AI_API_KEY,
            "Content-Type": "application/json",
            ...(multimodalSearch?{'X-DashScope-SSE':'enable'}:{}),
          },
          body: JSON.stringify(responses?body:nativeSearch?{...body,parameters:{...body.parameters,max_tokens:maxTokens,enable_thinking:false}}:{
            ...body,
            max_tokens: maxTokens,
            enable_thinking: body.enable_thinking === true,
            ...(body.enable_thinking === true
              ? {
                  stream: true,
                  stream_options: { include_usage: true },
                  thinking_budget: Math.min(body.thinking_budget,options?.maxThinkingBudget||2048),
                }
              : {}),
          }),
          signal: AbortSignal.any([
            AbortSignal.timeout(Math.min(180000,options?.requestTimeoutMs||95000)),
            controller.signal,
          ]),
        },
      );
      attempt.httpStatus = response.status;
      attempt.connectedMs = Date.now()-Date.parse(attempt.startedAt);
      let result;
      if(responses&&body.stream&&response.ok&&/text\/event-stream/.test(response.headers.get('content-type')||'')){
        let pending='',bytes=0;const decoder=new TextDecoder();attempt.events=[];
        const consume=line=>{if(!line.startsWith('data:'))return;const data=line.slice(5).trim();if(!data||data==='[DONE]')return;const event=JSON.parse(data);
          attempt.events.push({type:event.type,elapsedMs:Date.now()-Date.parse(attempt.startedAt),itemType:event.item?.type,status:event.response?.status});
          if(event.type==='response.completed'||event.type==='response.incomplete')result=event.response;
          if(event.type==='response.failed'||event.type==='error')throw Error('responses_stream_'+(event.error?.code||event.response?.error?.code||'failed'));
          if(!res.headersSent)res.writeHead(200,{'content-type':'text/event-stream'});
          res.write('event: '+event.type+'\ndata: '+JSON.stringify(event)+'\n\n');
        };
        for await(const chunk of response.body){bytes+=chunk.length;if(bytes>4_000_000)throw Error('responses_stream_too_large');pending+=decoder.decode(chunk,{stream:true});const lines=pending.split(/\r?\n/);pending=lines.pop()||'';for(const line of lines)consume(line);}pending+=decoder.decode();consume(pending);
        if(!result)throw Error('responses_terminal_event_missing');
      } else if (nativeSearch && /text\/event-stream/.test(response.headers.get('content-type')||'') && response.ok) {
        let pending='',size=0;const decoder=new TextDecoder();result={output:{search_info:{search_results:[]}}};
        const consume=line=>{if(!line.startsWith('data:'))return;const raw=line.slice(5).trim();if(!raw||raw==='[DONE]')return;const event=JSON.parse(raw);if(options?.recordContent!==false){attempt.nativeEvents=attempt.nativeEvents||[];if(attempt.nativeEvents.length<1000)attempt.nativeEvents.push(clean(event));}if(event.code)throw Error('provider_code_'+event.code);if(event.usage)result.usage=event.usage;result.output.search_info.search_results.push(...(event.output?.search_info?.search_results||event.search_info?.search_results||[]));if(event.output?.choices)result.output.choices=event.output.choices;};
        for await(const chunk of response.body){size+=chunk.length;if(size>1000000)throw Error('search_response_too_large');pending+=decoder.decode(chunk,{stream:true});const lines=pending.split(/\r?\n/);pending=lines.pop()||'';for(const line of lines)consume(line);}pending+=decoder.decode();consume(pending);
      } else if (!responses && (
        (body.enable_thinking === true || body.stream === true) &&
        response.ok
      )) {
        const toolCalls=[];
        let text = "", reasoning = "",
          usage,
          finishReason,
          buffer = "", upstreamModel;
        const decoder = new TextDecoder();
        for await (const chunk of response.body) {
          buffer += decoder.decode(chunk, { stream: true });
          let end;
          while ((end = buffer.indexOf("\n")) >= 0) {
            const line = buffer.slice(0, end).trim();
            buffer = buffer.slice(end + 1);
            if (!line.startsWith("data: ") || line === "data: [DONE]") continue;
            const event = JSON.parse(line.slice(6));
            if (event.model) upstreamModel = event.model;
            if (event.usage) usage = event.usage;
            const delta = event.choices?.[0]?.delta?.content || "";
            const thinking=event.choices?.[0]?.delta?.reasoning_content||'';reasoning+=thinking;
            for(const part of event.choices?.[0]?.delta?.tool_calls||[]){const t=toolCalls[part.index]||{id:'',type:'function',function:{name:'',arguments:''}};if(part.id)t.id=part.id;if(part.function?.name)t.function.name+=part.function.name;if(part.function?.arguments)t.function.arguments+=part.function.arguments;toolCalls[part.index]=t;}
            if (delta && attempt.firstTokenMs === undefined)
              attempt.firstTokenMs = Date.now() - Date.parse(attempt.startedAt);
            text += delta;
            if (body.stream === true) {
              if (!res.headersSent)
                res.writeHead(200, { "content-type": "text/event-stream" });
              // Never relay reasoning, credentials or provider internals.
              res.write(
                `data: ${JSON.stringify({id:event.id||'evaluation',object:'chat.completion.chunk',model:body.model,created:event.created||0,choices:[{index:0,delta:{...(delta?{content:delta}:{}),...(thinking?{reasoning_content:thinking}:{}),...(event.choices?.[0]?.delta?.role?{role:'assistant'}:{}),...(event.choices?.[0]?.delta?.tool_calls?{tool_calls:event.choices[0].delta.tool_calls}:{})},finish_reason:event.choices?.[0]?.finish_reason||null}],...(event.usage?{usage:event.usage}:{})})}\n\n`,
              );
            }
            if (event.choices?.[0]?.finish_reason)
              finishReason = event.choices[0].finish_reason;
          }
        }
        result = {
          choices: [
            {
              message: { role: "assistant", content: text, ...(reasoning?{reasoning_content:reasoning}:{}), ...(toolCalls.length?{tool_calls:toolCalls}: {}) },
              finish_reason: finishReason,
            },
          ],
          usage,
          model: upstreamModel || body.model,
        };
      } else result = await response.json();
      if (!response.ok) {attempt.providerError={code:result.code||result.error?.code,message:options?.recordContent===false?undefined:clean(String(result.message||result.error?.message||'').slice(0,300))};throw Error("provider_http_" + response.status);}
      if(result.code)throw Error('provider_code_'+result.code);
      attempt.status = "returned";
      const usage=result.usage;const billedUsage=usage&&{...usage,prompt_tokens:usage.prompt_tokens??usage.input_tokens,completion_tokens:usage.completion_tokens??usage.output_tokens};
      attempt.tokens = billedUsage;
      if(nativeSearch)attempt.searchSources=options?.recordContent===false?undefined:result.output?.search_info;
      attempt.returnedModel = result.model;
      if (
        Number.isFinite(billedUsage?.prompt_tokens) &&
        Number.isFinite(billedUsage?.completion_tokens)
      ) {
        const input = billedUsage.prompt_tokens,
          output = billedUsage.completion_tokens;
        const [inputRate, outputRate] = options?.prices ? [options.prices.input,options.prices.output] :
          body.model === "qwen3.7-plus"
            ? [2, 8]
            : body.model === "qwen-max"
              ? [2.4, 9.6]
              : input <= 128000
                ? [0.8, body.enable_thinking ? 8 : 2]
                : input <= 256000
                  ? [2.4, 20]
                  : [4.8, 48];
        const pdfPages=billedUsage.x_tools?.pdf_page_parser?.count;
        // File parsing has its own charge. Missing page usage never silently
        // turns into a zero-fee PDF request; retain the conservative reservation.
        if(!fileInput||Number.isFinite(pdfPages))attempt.estimatedCny = (input * inputRate + output * outputRate) / 1e6+(nativeSearch?0.003:0)+(responses?0.01*(billedUsage.x_tools?.web_search?.count||0)+0.01*(billedUsage.x_tools?.web_extractor?.count||0):0)+(fileInput?pdfPages*0.02:0);
      }
      attempt.finishReason = (result.choices||result.output?.choices)?.[0]?.finish_reason;
      if (options?.recordContent !== false) attempt.output = clean(responses?result.output?.filter(i=>i.type!=='reasoning'):(result.choices||result.output?.choices)?.[0]?.message || {});
      attempt.elapsedMs = Date.now() - Date.parse(attempt.startedAt);
      save();
      if (body.stream === true) {
        if(responses){res.end();return;}
        if (!res.headersSent)
          res.writeHead(200, { "content-type": "text/event-stream" });
        res.end(
          `data: ${JSON.stringify({id:'evaluation-final',object:'chat.completion.chunk',model:body.model,created:0,choices:[{index:0,delta:{},finish_reason:attempt.finishReason}],usage:result.usage})}\n\ndata: [DONE]\n\n`,
        );
      } else {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(result));
      }
    } catch (e) {
      if (attempt) {
        attempt.status = "failed";
        attempt.transportCode = e.cause?.code || e.name;
        attempt.error = String(e.message).replaceAll(
          config.AI_API_KEY,
          "[removed]",
        );
        attempt.elapsedMs = Date.now() - Date.parse(attempt.startedAt);
        save();
      }
      if (!res.headersSent)
        res.writeHead(attempt?.httpStatus >= 400 ? attempt.httpStatus : 503, {
          "content-type": "application/json",
        });
      res.end(
        JSON.stringify({
          error: { message: attempt?.error || "isolated_gateway_rejected" },
        }),
      );
    }
  });
  await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    model: config.AI_MODEL,
    available,
    close: () =>
      new Promise((ok) =>
        server.close(() => {
          for(const a of ledger.attempts)if(a.status==='started'){a.status='failed';a.error='gateway_closed_usage_unknown_reserved';}save();
          fs.closeSync(lock);
          fs.unlinkSync(lockFile);
          ok();
        }),
      ),
  };
}

