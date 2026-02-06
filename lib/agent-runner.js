/**
 * Agent Runner
 * Bridges the Claude Agent SDK to SSE broadcasts.
 * Handles streaming, tool calls, session resumption, and interruption.
 */

import { query } from '@anthropic-ai/claude-agent-sdk';
import { v4 as uuid } from 'uuid';
import sse from './sse-manager.js';
import store from './session-store.js';

class AgentRunner {
  constructor() {
    /** @type {Map<string, AbortController>} */
    this.active = new Map();
  }

  /**
   * Run a prompt against a session via the Agent SDK.
   * @param {string} sessionId - Our session ID
   * @param {string} prompt - User's message
   */
  async run(sessionId, prompt) {
    const session = store.get(sessionId);
    if (!session) throw new Error('Session not found');
    if (session.status === 'running') throw new Error('Session already running');

    const abortController = new AbortController();
    this.active.set(sessionId, abortController);

    store.update(sessionId, { status: 'running' });
    sse.broadcast(sessionId, 'status', { status: 'running' });

    // Record user message
    const userMsg = {
      id: uuid(),
      role: 'user',
      content: prompt,
      timestamp: new Date().toISOString()
    };
    store.addMessage(sessionId, userMsg);
    sse.broadcast(sessionId, 'user_message', userMsg);

    let currentMsgId = null;
    let currentToolCallId = null;
    let currentToolName = null;

    try {
      const options = {
        cwd: session.cwd,
        model: session.model,
        systemPrompt: { type: 'preset', preset: 'claude_code' },
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
        includePartialMessages: true,
        abortController,
        settingSources: ['user', 'project']
      };

      // Resume if we have a prior SDK session
      if (session.sdkSessionId) {
        options.resume = session.sdkSessionId;
      }

      const q = query({ prompt, options });

      for await (const message of q) {
        if (abortController.signal.aborted) break;

        switch (message.type) {
          case 'system': {
            if (message.subtype === 'init') {
              // Capture SDK session ID for resume
              store.update(sessionId, { sdkSessionId: message.session_id });
              sse.broadcast(sessionId, 'system_init', {
                sdkSessionId: message.session_id,
                model: message.model,
                tools: message.tools
              });
            }
            break;
          }

          case 'stream_event': {
            const event = message.event;

            if (event.type === 'content_block_start') {
              if (event.content_block.type === 'text') {
                currentMsgId = currentMsgId || uuid();
              } else if (event.content_block.type === 'tool_use') {
                currentToolCallId = event.content_block.id;
                currentToolName = event.content_block.name;
                sse.broadcast(sessionId, 'tool_start', {
                  msgId: currentMsgId || uuid(),
                  toolCallId: currentToolCallId,
                  tool: currentToolName
                });
              }
            }

            if (event.type === 'content_block_delta') {
              const delta = event.delta;

              if (delta.type === 'text_delta') {
                if (!currentMsgId) currentMsgId = uuid();
                sse.broadcast(sessionId, 'text_delta', {
                  msgId: currentMsgId,
                  text: delta.text
                });
              } else if (delta.type === 'input_json_delta') {
                sse.broadcast(sessionId, 'tool_input_delta', {
                  msgId: currentMsgId,
                  toolCallId: currentToolCallId,
                  partial_json: delta.partial_json
                });
              }
            }

            if (event.type === 'content_block_stop') {
              // Tool block just finished streaming its input
              if (currentToolCallId) {
                // Tool execution will follow — keep tracking
              }
            }

            break;
          }

          case 'assistant': {
            // Complete assistant message — includes full content blocks and tool results
            currentMsgId = currentMsgId || uuid();
            const assistantMsg = {
              id: currentMsgId,
              role: 'assistant',
              content: [],
              toolCalls: [],
              timestamp: new Date().toISOString()
            };

            const apiMsg = message.message;
            if (apiMsg && apiMsg.content) {
              for (const block of apiMsg.content) {
                if (block.type === 'text') {
                  assistantMsg.content.push({ type: 'text', text: block.text });
                } else if (block.type === 'tool_use') {
                  assistantMsg.toolCalls.push({
                    id: block.id,
                    tool: block.name,
                    input: block.input
                  });
                }
              }
            }

            store.addMessage(sessionId, assistantMsg);
            sse.broadcast(sessionId, 'assistant_message', assistantMsg);

            // Reset for next turn
            currentMsgId = null;
            currentToolCallId = null;
            currentToolName = null;
            break;
          }

          case 'user': {
            // Tool results come back as user messages
            if (message.message && message.message.content) {
              const contents = Array.isArray(message.message.content)
                ? message.message.content
                : [message.message.content];

              for (const block of contents) {
                if (block.type === 'tool_result') {
                  const output = typeof block.content === 'string'
                    ? block.content
                    : Array.isArray(block.content)
                      ? block.content.map(c => c.type === 'text' ? c.text : '').join('')
                      : '';

                  sse.broadcast(sessionId, 'tool_complete', {
                    msgId: currentMsgId,
                    toolCallId: block.tool_use_id,
                    output: output.slice(0, 4000), // Cap output size for SSE
                    is_error: block.is_error || false
                  });
                }
              }
            }
            break;
          }

          case 'result': {
            const result = {
              subtype: message.subtype,
              cost: message.total_cost_usd || 0,
              duration: message.duration_ms || 0,
              numTurns: message.num_turns || 0,
              usage: {
                input: message.usage?.input_tokens || 0,
                output: message.usage?.output_tokens || 0,
                cache_read: message.usage?.cache_read_input_tokens || 0,
                cache_create: message.usage?.cache_creation_input_tokens || 0
              },
              isError: message.is_error || false
            };

            // Accumulate totals
            store.update(sessionId, {
              totalCost: (session.totalCost || 0) + result.cost,
              totalInputTokens: (session.totalInputTokens || 0) + result.usage.input,
              totalOutputTokens: (session.totalOutputTokens || 0) + result.usage.output
            });

            result.sessionTotals = {
              cost: store.get(sessionId).totalCost,
              inputTokens: store.get(sessionId).totalInputTokens,
              outputTokens: store.get(sessionId).totalOutputTokens
            };

            sse.broadcast(sessionId, 'result', result);
            break;
          }
        }
      }
    } catch (err) {
      if (err.name === 'AbortError' || abortController.signal.aborted) {
        sse.broadcast(sessionId, 'status', { status: 'interrupted' });
      } else {
        console.error(`[AgentRunner] Error in session ${sessionId}:`, err.message);
        sse.broadcast(sessionId, 'error', { message: err.message });
        store.update(sessionId, { status: 'error' });
      }
    } finally {
      this.active.delete(sessionId);
      const s = store.get(sessionId);
      if (s && s.status === 'running') {
        store.update(sessionId, { status: 'idle' });
      }
      sse.broadcast(sessionId, 'status', { status: store.get(sessionId)?.status || 'idle' });
    }
  }

  /**
   * Interrupt a running query.
   * @param {string} sessionId
   * @returns {boolean}
   */
  interrupt(sessionId) {
    const controller = this.active.get(sessionId);
    if (controller) {
      controller.abort();
      return true;
    }
    return false;
  }

  /**
   * Check if a session is currently running.
   * @param {string} sessionId
   * @returns {boolean}
   */
  isRunning(sessionId) {
    return this.active.has(sessionId);
  }
}

export default new AgentRunner();
