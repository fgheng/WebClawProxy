import { useEffect, useMemo, useRef, useState } from 'react';
import { AgentClient } from '../lib/AgentClient';
import type { AgentChatResponse, AgentEvent } from '../lib/AgentClient';

/** 工具参数最大显示字符数 */
const MAX_TOOL_ARGS_DISPLAY = 80;

type FeedItem = {
  id: string;
  role: 'user' | 'webclaw' | 'tool';
  content: string;
  tone?: 'normal' | 'error' | 'muted';
  /** 工具名称（仅 tool role 时有值） */
  toolName?: string;
  /** 工具调用摘要列表（用于可折叠展示） */
  toolCallSummaries?: { name: string; argsPreview: string }[];
  /** 是否展开工具详情 */
  toolExpanded?: boolean;
};

/** 将 tool_call 的 arguments 截断为可读预览 */
function truncateToolArgs(argsRaw: string, maxLen: number): string {
  if (!argsRaw) return '';
  try {
    const obj = JSON.parse(argsRaw);
    const preview = JSON.stringify(obj);
    return preview.length > maxLen ? preview.slice(0, maxLen) + '...' : preview;
  } catch {
    return argsRaw.length > maxLen ? argsRaw.slice(0, maxLen) + '...' : argsRaw;
  }
}

type WebClawPanelProps = {
  agentUrl: string;
  currentProvider: string;
  displayMode: 'web' | 'forward';
  selectedModel?: string;
  providerModels: Record<string, string[]>;
  serviceStatus: string;
  onProviderChange: (provider: string) => Promise<void> | void;
  onError: (message: string) => void;
  onSendingChange?: (sending: boolean) => void;
  notice?: { id: number; message: string; tone?: 'error' | 'muted' } | null;
};

function buildFeedFromEventHistory(messages: any[]): FeedItem[] {
  const items: FeedItem[] = [];
  for (let i = 0; i < messages.length; i += 1) {
    const msg = messages[i];
    if (!msg) continue;
    if (msg.role === 'user') {
      items.push({ id: `history-${i}-user`, role: 'user', content: msg.content ?? '', tone: 'normal' });
      continue;
    }
    if (msg.role === 'assistant') {
      const toolCalls = Array.isArray(msg.tool_calls) ? msg.tool_calls : [];
      const toolCallSummaries = toolCalls.map((tc: any) => ({
        name: tc?.function?.name ?? 'unknown',
        argsPreview: truncateToolArgs(tc?.function?.arguments ?? '', MAX_TOOL_ARGS_DISPLAY),
      }));
      const content = msg.content ?? '';
      items.push({
        id: `history-${i}-assistant`,
        role: 'webclaw',
        content,
        tone: toolCalls.length > 0 ? 'muted' : 'normal',
        toolCallSummaries: toolCallSummaries.length > 0 ? toolCallSummaries : undefined,
        toolExpanded: false,
      });
      continue;
    }
    if (msg.role === 'tool') {
      items.push({ id: `history-${i}-tool`, role: 'tool', content: msg.content ?? '', tone: 'muted', toolName: msg.name });
      continue;
    }
  }
  return items;
}

export function WebClawPanel(props: WebClawPanelProps) {
  const { agentUrl, currentProvider, displayMode, selectedModel, providerModels, serviceStatus, onProviderChange, onError, onSendingChange, notice } = props;
  const feedRef = useRef<HTMLDivElement | null>(null);
  const clientRef = useRef<AgentClient | null>(null);
  const onProviderChangeRef = useRef(onProviderChange);
  const hydratedRef = useRef(false);
  const [draft, setDraft] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [feed, setFeed] = useState<FeedItem[]>([
    {
      id: 'welcome',
      role: 'webclaw',
      content: `已进入 WebClaw 面板。Agent Service: ${agentUrl}`,
      tone: 'muted',
    },
  ]);

  useEffect(() => {
    onProviderChangeRef.current = onProviderChange;
  }, [onProviderChange]);

  // 外部推入的通知消息
  const prevNoticeIdRef = useRef<number | null>(null);
  useEffect(() => {
    if (!notice || notice.id === prevNoticeIdRef.current) return;
    prevNoticeIdRef.current = notice.id;
    setFeed((prev) => [
      ...prev,
      {
        id: `notice-${notice.id}`,
        role: 'webclaw' as const,
        content: notice.message,
        tone: notice.tone ?? 'muted',
      },
    ]);
  }, [notice]);

  useEffect(() => {
    onSendingChange?.(isSending);
  }, [isSending, onSendingChange]);

  // 监听主进程推送的 Agent Service 日志
  useEffect(() => {
    const unsubscribe = window.webclawDesktop?.onAgentLog?.((payload: { message: string; timestamp: number }) => {
      setFeed((prev) => [
        ...prev,
        { id: `agent-log-${payload.timestamp}`, role: 'webclaw', content: `[Agent] ${payload.message}`, tone: 'muted' },
      ]);
    });
    return () => {
      // cleanup if needed
    };
  }, []);

  // 初始化 AgentClient
  useEffect(() => {
    if (!agentUrl || clientRef.current) return;
    console.log(`[WebClawPanel] Initializing AgentClient with agentUrl=${agentUrl}`);

    const client = new AgentClient({ agentUrl });

    // WebSocket 事件回调
    client.setEventCallback((event: AgentEvent) => {
      if (event.type === 'provider_change' && event.data.provider) {
        void onProviderChangeRef.current(String(event.data.provider));
      }
      if (event.type === 'tool_loop_start') {
        // 清除上一轮工具的完成提示，然后显示新一轮的开始提示
        setFeed((prev) => {
          const cleaned = prev.filter((item) => !item.id.startsWith('tool-loop-') && !item.id.startsWith('tool-'));
          return [...cleaned, { id: `tool-loop-${Date.now()}`, role: 'webclaw', content: '开始执行工具...', tone: 'muted' }];
        });
      }
      if (event.type === 'tool_executing' && event.data.toolName) {
        const name = String(event.data.toolName);
        const args = event.data.toolArgs;
        // 将参数转为截断预览
        let argsPreview = '';
        if (args && typeof args === 'object') {
          const serialized = JSON.stringify(args);
          argsPreview = serialized.length > MAX_TOOL_ARGS_DISPLAY
            ? serialized.slice(0, MAX_TOOL_ARGS_DISPLAY) + '...'
            : serialized;
        }
        const displayText = argsPreview
          ? `执行工具: ${name}(${argsPreview})`
          : `执行工具: ${name}`;

        setFeed((prev) => {
          // 移除之前的 tool-loop 提示，替换为具体工具名+参数
          const cleaned = prev.filter((item) => !item.id.startsWith('tool-loop-') && !item.id.startsWith('tool-'));
          return [...cleaned, { id: `tool-${Date.now()}`, role: 'webclaw', content: displayText, tone: 'muted' }];
        });
      }
      if (event.type === 'tool_loop_end') {
        // 将正在执行的工具提示改为完成提示，而不是直接删除
        setFeed((prev) => prev.map((item) => {
          if (item.id.startsWith('tool-loop-') || item.id.startsWith('tool-')) {
            return { ...item, content: '✓ 工具执行完毕', tone: 'muted' };
          }
          return item;
        }));
      }
    });

    client.connectWebSocket();
    clientRef.current = client;

    return () => {
      client.disconnectWebSocket();
      clientRef.current = null;
    };
  }, [agentUrl]); // 注意：不包含 onProviderChange，避免 re-render 重建 client

  // 启动时恢复上次的 session（验证是否还在服务端）+ 拉取历史消息
  useEffect(() => {
    const client = clientRef.current;
    if (!client) return;
    const savedId = client.getSessionId();
    if (!savedId) return;

    client.validateSession().then(async (valid) => {
      if (valid) {
        const history = await client.getSessionHistory();
        if (history.length > 0) {
          const historyItems = buildFeedFromEventHistory(
            history.filter((m: any) => m.role === 'user' || m.role === 'assistant' || m.role === 'tool')
          );
          setFeed((prev) => [
            ...historyItems,
            ...prev,
            { id: `session-restore-${Date.now()}`, role: 'webclaw', content: `已恢复上次会话 (${history.length} 条历史消息)`, tone: 'muted' },
          ]);
        } else {
          setFeed((prev) => [
            ...prev,
            { id: `session-restore-${Date.now()}`, role: 'webclaw', content: `已恢复上次会话: ${savedId}`, tone: 'muted' },
          ]);
        }
      } else {
        // 服务端已重启，session 不存在，清除并创建新 session
        const newId = await client.newSession();
        setFeed((prev) => [
          ...prev,
          { id: `session-new-${Date.now()}`, role: 'webclaw', content: `上次会话已失效，已创建新会话: ${newId}`, tone: 'muted' },
        ]);
      }
    }).catch(() => {});
  }, [agentUrl]);

  // 同步 provider 和 mode（静默失败，Agent Service 可能还没启动）
  useEffect(() => {
    const client = clientRef.current;
    if (!client) return;

    const nextModel = selectedModel || providerModels[currentProvider]?.[0];
    if (nextModel) {
      client.updateConfig({
        model: nextModel,
        mode: displayMode,
      }).catch(() => { /* Agent Service 可能未启动，忽略 */ });
    }
  }, [currentProvider, displayMode, selectedModel, providerModels]);

  useEffect(() => {
    feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight, behavior: 'smooth' });
  }, [feed]);

  /** 切换工具调用区域的展开/折叠 */
  function toggleToolExpanded(itemId: string) {
    setFeed((prev) => prev.map((item) =>
      item.id === itemId ? { ...item, toolExpanded: !item.toolExpanded } : item
    ));
  }

  async function handleSubmit() {
    const client = clientRef.current;
    if (!client || !draft.trim() || isSending) return;
    const input = draft.trim();
    const blockedCommand = input.match(/^\/(provider|mode)\b/i)?.[1]?.toLowerCase();
    setDraft('');
    setIsSending(true);

    const userId = `user-${Date.now()}`;
    const pendingId = `assistant-pending-${Date.now()}`;
    const isCommand = input.startsWith('/');

    try {
      if (blockedCommand) {
        setFeed((prev) => [
          ...prev,
          {
            id: `blocked-${Date.now()}`,
            role: 'webclaw',
            content: `命令 /${blockedCommand} 已禁用，请使用顶部选择器切换 provider 和 web/forward 模式。`,
            tone: 'muted',
          },
        ]);
        return;
      }

      const nextModel = selectedModel || providerModels[currentProvider]?.[0];

      if (!isCommand) {
        setFeed((prev) => [
          ...prev,
          { id: userId, role: 'user', content: input },
          { id: pendingId, role: 'webclaw', content: '...', tone: 'muted' },
        ]);
      }

      // 处理特殊命令
      if (input === '/clear') {
        setFeed([{ id: `clear-${Date.now()}`, role: 'webclaw', content: '已清空对话', tone: 'muted' }]);
        setIsSending(false);
        return;
      }
      if (input === '/new') {
        const newSessionId = await client.newSession({ model: nextModel, mode: displayMode });
        setFeed([{ id: `new-${Date.now()}`, role: 'webclaw', content: `已创建新会话: ${newSessionId}`, tone: 'muted' }]);
        hydratedRef.current = false;
        setIsSending(false);
        return;
      }
      if (input === '/help') {
        setFeed((prev) => [
          ...prev,
          { id: `help-${Date.now()}`, role: 'webclaw', content: '可用命令:\n/new - 创建新会话\n/clear - 清空对话面板\n/sessions - 列出所有会话\n/session - 显示当前会话信息\n/help - 查看帮助\n工具调用由 Agent Service 自动执行', tone: 'muted' },
        ]);
        setIsSending(false);
        return;
      }
      if (input === '/sessions') {
        const sessions = await client.getSessions();
        const lines = sessions.length === 0
          ? '没有活跃会话'
          : sessions.map((s) => `  ${s.sessionId}  模型: ${s.model}  提供商: ${s.provider}`).join('\n');
        setFeed((prev) => [
          ...prev,
          { id: `sessions-${Date.now()}`, role: 'webclaw', content: `会话列表:\n${lines}`, tone: 'muted' },
        ]);
        setIsSending(false);
        return;
      }
      if (input === '/session') {
        const sid = client.getSessionId();
        if (!sid) {
          setFeed((prev) => [...prev, { id: `session-${Date.now()}`, role: 'webclaw', content: '当前没有活跃会话', tone: 'muted' }]);
        } else {
          const config = await client.getConfig();
          setFeed((prev) => [
            ...prev,
            { id: `session-${Date.now()}`, role: 'webclaw', content: `当前会话:\n  ID: ${sid}\n  模型: ${config.model ?? '未设置'}\n  提供商: ${config.provider ?? '未设置'}\n  模式: ${config.mode ?? '未设置'}`, tone: 'muted' },
          ]);
        }
        setIsSending(false);
        return;
      }

      const result = await client.chat(input, {
        model: nextModel,
        mode: displayMode,
      });

      applyResultToFeed(result, pendingId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      onError(message);
      setFeed((prev) => prev.map((item) => (
        item.id === pendingId
          ? { ...item, content: message, tone: 'error' }
          : item
      )));
    } finally {
      setIsSending(false);
    }
  }

  function applyResultToFeed(result: AgentChatResponse, pendingId?: string) {
    if (result.kind === 'chat') {
      const toolCalls = Array.isArray(result.toolCalls) ? result.toolCalls : [];
      const toolCallSummaries = toolCalls.map((tc: any) => ({
        name: tc?.function?.name ?? 'unknown',
        argsPreview: truncateToolArgs(tc?.function?.arguments ?? '', MAX_TOOL_ARGS_DISPLAY),
      }));
      const content = result.content || '（空响应）';

      setFeed((prev) => prev.map((item) =>
        item.id === pendingId
          ? {
            ...item,
            id: `assistant-${Date.now()}-${result.model}`,
            content,
            tone: toolCalls.length > 0 ? 'muted' : 'normal',
            toolCallSummaries: toolCallSummaries.length > 0 ? toolCallSummaries : undefined,
            toolExpanded: false,
          }
          : item
      ));
      return;
    }

    // command result
    if (result.command) {
      setFeed((prev) => {
        const withoutPending = pendingId ? prev.filter((item) => item.id !== pendingId) : prev;
        return [
          ...withoutPending,
          {
            id: `cmd-${Date.now()}-${result.command}`,
            role: 'webclaw',
            content: (result.lines ?? []).join('\n'),
            tone: 'muted',
          },
        ];
      });
    }
  }

  return (
    <div className="webclaw-panel">
      <div className="webclaw-feed" ref={feedRef}>
        {feed.map((item) => (
          <div key={item.id} className={`chat-row ${item.role}`}>
            <div className={`chat-bubble ${item.role} ${item.tone ?? 'normal'}`}>
              {/* content 部分 */}
              {item.content && (
                <div className="chat-content">{item.content}</div>
              )}

              {/* 工具调用摘要区域：可折叠 */}
              {item.toolCallSummaries && item.toolCallSummaries.length > 0 && (
                <div className="tool-call-area">
                  <div
                    className="tool-call-toggle"
                    onClick={() => toggleToolExpanded(item.id)}
                  >
                    🔧 {item.toolCallSummaries.length} 个工具调用
                    {item.toolExpanded ? ' ▼' : ' ▸'}
                  </div>
                  {item.toolExpanded && (
                    <div className="tool-call-list">
                      {item.toolCallSummaries.map((tc, idx) => (
                        <div key={idx} className="tool-call-item">
                          <span className="tool-call-name">{tc.name}</span>
                          {tc.argsPreview && (
                            <span className="tool-call-args">{tc.argsPreview}</span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="webclaw-inputbar">
        <textarea
          value={draft}
          placeholder={serviceStatus === 'running' ? '输入消息或 /help 查看命令' : 'Agent Service 未连接'}
          onChange={(e) => setDraft(e.target.value)}
          disabled={isSending}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void handleSubmit();
            }
          }}
        />
        <button
          className={`primary webclaw-send-button ${isSending ? 'danger' : ''}`}
          onClick={() => {
            if (!isSending) {
              void handleSubmit();
            }
          }}
          disabled={!isSending && !draft.trim()}
        >
          {isSending ? '等待...' : '发送'}
        </button>
      </div>
    </div>
  );
}