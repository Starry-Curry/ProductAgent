import { Agent } from '@agentscope-ai/agentscope/agent';
import { ChatModelBase, type ChatResponse } from '@agentscope-ai/agentscope/model';
import { OpenAIChatFormatter } from '@agentscope-ai/agentscope/formatter';
import { Toolkit } from '@agentscope-ai/agentscope/tool';
import { createMsg, getTextContent, type Msg, type ContentBlock } from '@agentscope-ai/agentscope/message';
import { z } from 'zod';
import type { ModelMessage, ModelResponse } from '../ai/provider.ts';
import { AgentError } from './contracts.ts';

export type ToolAgentOptions = {
  system: string;
  /** Turn-local user inputs. Authorized history belongs in the caller's Context. */
  messages: ModelMessage[];
  tools: { name: string; description: string; schema: z.ZodType; execute: (input: unknown) => Promise<unknown> }[];
  /** The caller owns the hard request/time/Token/cost budget, including summaries. */
  generate: (messages: ModelMessage[]) => Promise<ModelResponse>;
  guard: () => void;
  onEvent: (type: string, detail: string) => void;
  stopAfterTool?: () => boolean;
};

/** AgentScope 0.0.15 merges successive model/tool blocks into one assistant Msg.
 * Restore model-turn boundaries before reusing its OpenAI formatter. Qwen's
 * ephemeral reasoning must accompany that exact assistant tool-call turn. */
class QwenTurnFormatter extends OpenAIChatFormatter {
  override async format({ msgs }: { msgs: Msg[] }): Promise<Record<string, unknown>[]> {
    const turns: Msg[] = [];
    for (const msg of msgs) {
      if (msg.role !== 'assistant') { turns.push(msg); continue; }
      let blocks: ContentBlock[] = [], afterResult = false;
      for (const block of msg.content) {
        if (afterResult && block.type !== 'tool_result') {
          turns.push({ ...msg, content: blocks }); blocks = []; afterResult = false;
        }
        blocks.push(block);
        if (block.type === 'tool_result') afterResult = true;
      }
      if (blocks.length) turns.push({ ...msg, content: blocks });
    }
    const assistantTurns = turns.filter(m => m.role === 'assistant' && m.content.some(b => b.type === 'text' || b.type === 'tool_call'));
    const formatted = await super.format({ msgs: turns });
    let index = 0;
    for (const message of formatted) if (message.role === 'assistant') {
      const turn = assistantTurns[index++];
      const reasoning = turn?.content.flatMap(b => b.type === 'thinking' ? [b.thinking] : []).join('');
      if (reasoning) message.reasoning_content = reasoning;
    }
    return formatted;
  }
}

function providerMessages(messages: unknown[]): ModelMessage[] {
  return messages.map(raw => {
    const m = raw as Record<string, unknown>;
    if (!['system', 'user', 'assistant', 'tool'].includes(String(m.role))) throw new AgentError('不支持的模型消息角色', 502);
    let content = m.content;
    if (Array.isArray(content)) {
      if (content.some(b => !b || b.type !== 'text' || typeof b.text !== 'string')) throw new AgentError('当前工具运行器只接收文本语义 Context', 502);
      content = content.map(b => b.text).join('\n');
    }
    if (content !== null && typeof content !== 'string') throw new AgentError('模型消息内容格式不支持', 502);
    return {
      role: m.role as ModelMessage['role'], content,
      ...(typeof m.tool_call_id === 'string' ? { tool_call_id: m.tool_call_id } : {}),
      ...(Array.isArray(m.tool_calls) ? { tool_calls: m.tool_calls as ModelMessage['tool_calls'] } : {}),
      ...(typeof m.reasoning_content === 'string' ? { reasoning_content: m.reasoning_content } : {}),
    };
  });
}

/** AgentScope owns the generic tool loop; existing Provider and domain services
 * own transport, knowledge, grants and writes. No framework storage/compression,
 * structuredModel, retries, secondary reviewer or private long-term memory. */
export async function runToolAgent(options: ToolAgentOptions): Promise<{ text: string; finish: 'completed' | 'pending_confirmation' }> {
  if (options.messages.some(m => m.role !== 'user' || typeof m.content !== 'string' || m.tool_calls || m.reasoning_content))
    throw new AgentError('工具运行器初始输入只接受本轮用户语义 Context', 400);
  if (new Set(options.tools.map(t => t.name)).size !== options.tools.length) throw new AgentError('工具名称重复', 400);
  let fatal: unknown;
  const guard = () => { try { options.guard(); } catch (error) { fatal = error; throw error; } };
  guard();
  const toolkit = new Toolkit({ builtInSkillTool: false });
  for (const tool of options.tools) toolkit.registerToolFunction({
    name: tool.name, description: tool.description,
    // ToolInputSchema's published type only describes object roots, while its
    // validator also supports valid union JSON Schemas. Input mode preserves
    // omitted defaults; output mode incorrectly marks them as required.
    inputSchema: z.toJSONSchema(tool.schema, { io: 'input' }) as unknown as Parameters<Toolkit['registerToolFunction']>[0]['inputSchema'],
    call: async input => {
      guard();
      try {
        const result = await tool.execute(tool.schema.parse(input));
        guard();
        return JSON.stringify(result ?? null);
      } catch (error) {
        // Toolkit converts normal failures into error tool_result. Permission or
        // lifecycle failures are also latched outside Toolkit and stop the run.
        if (error instanceof AgentError && [403, 409].includes(error.status)) fatal = error;
        guard();
        throw error;
      }
    },
  });
  const seenCallIds = new Set<string>();
  class ProviderModel extends ChatModelBase {
    constructor() { super({ modelName: 'wujian-qwen-provider', stream: false, maxRetries: 0, formatter: new QwenTurnFormatter() }); }
    _formatToolChoice(choice: unknown) { return choice; }
    _formatToolSchemas(tools: unknown[]) { return tools; }
    protected async _callAPI(_model: string, request: { messages: unknown[] }): Promise<ChatResponse> {
      if (fatal) throw fatal;
      guard();
      const started = Date.now();
      let response: ModelResponse;
      try { response = await options.generate(providerMessages(request.messages)); }
      finally { guard(); }
      if (!['stop', 'tool_calls'].includes(response.finishReason) || !response.text && !response.toolCalls.length)
        throw new AgentError('模型回答未完整生成，未将其标记为完成', 502);
      const now = new Date().toISOString(), content: ChatResponse['content'] = [];
      if (response.reasoning) content.push({ type: 'thinking', id: crypto.randomUUID(), created_at: now, thinking: response.reasoning });
      if (response.text) content.push({ type: 'text', id: crypto.randomUUID(), created_at: now, text: response.text });
      for (const call of response.toolCalls) {
        if (!call.id || seenCallIds.has(call.id)) throw new AgentError('模型重复使用工具调用标识，未重复执行', 502);
        seenCallIds.add(call.id);
        content.push({ type: 'tool_call', id: call.id, name: call.function.name, input: call.function.arguments, state: 'pending', created_at: now });
      }
      return { type: 'chat', id: crypto.randomUUID(), createdAt: now, content,
        ...(response.tokens ? { usage: { type: 'chat_usage' as const, inputTokens: response.tokens.input, outputTokens: response.tokens.output, time: (Date.now() - started) / 1000 } } : {}) };
    }
  }
  const agent = new Agent({ name: '物间', sysPrompt: options.system, model: new ProviderModel(), toolkit, maxIters: 6,
    compressionConfig: { enabled: false, triggerThreshold: Number.MAX_SAFE_INTEGER } });
  const stream = agent.replyStream({ msgs: options.messages.map(m => createMsg({ name: '用户', role: 'user', content: m.content! })) });
  const toolNames = new Map<string, string>();
  try {
    while (true) {
      const step = await stream.next();
      if (fatal) throw fatal;
      if (step.done) {
        guard();
        const text = getTextContent(step.value) || '';
        if (!text.trim()) throw new AgentError('模型尚未形成完整答复', 502);
        return { text, finish: 'completed' };
      }
      const event = step.value;
      if (event.type === 'TOOL_RESULT_START' || event.type === 'TOOL_RESULT_END') guard();
      if ('tool_call_name' in event && 'tool_call_id' in event) toolNames.set(event.tool_call_id, event.tool_call_name);
      // Event details contain progress/usage only. In particular, never expose
      // reasoning, draft text, raw arguments or private tool results to the UI.
      if (!event.type.startsWith('THINKING_')) {
        const detail = {
          ...('tool_call_id' in event ? { callId: event.tool_call_id, tool: toolNames.get(event.tool_call_id) } : {}),
          ...('state' in event ? { state: event.state } : {}),
          ...('input_tokens' in event ? { inputTokens: event.input_tokens, outputTokens: event.output_tokens } : {}),
          ...('finished_reason' in event ? { finish: event.finished_reason } : {}),
        };
        options.onEvent(event.type, JSON.stringify(detail));
      }
      if (event.type === 'TOOL_RESULT_END' && event.state === 'success' && options.stopAfterTool?.()) {
        guard();
        return { text: '', finish: 'pending_confirmation' };
      }
    }
  } finally { await stream.return(undefined as never); }
}
