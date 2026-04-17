import { useEffect, useMemo, useRef, useState } from 'react';
import { WebClawClientCore } from '../../../client-core/src/core/WebClawClientCore';
import type { ClientCoreResult } from '../../../client-core/src/core/types';
import type { ProviderKey, ProviderModelCatalog } from '../../../client-core/src/core/provider-models';
import { WebClawBrowserTransport } from '../lib/WebClawBrowserTransport';
import { BrowserClientSessionStore } from '../lib/BrowserClientSessionStore';

type FeedItem = {
  id: string;
  role: 'user' | 'webclaw';
  content: string;
  tone?: 'normal' | 'error' | 'muted';
};

type WebClawPanelProps = {
  apiBaseUrl: string;
  currentProvider: string;
  displayMode: 'web' | 'forward';
  selectedModel?: string;
  providerModels: Record<string, string[]>;
  serviceStatus: string;
  onProviderChange: (provider: string) => Promise<void> | void;
  onError: (message: string) => void;
};

function buildCatalog(providerModels: Record<string, string[]>): ProviderModelCatalog {
  const modelToProvider = new Map<string, ProviderKey>();
  const providerToModels = new Map<ProviderKey, string[]>();
  const providers: ProviderKey[] = ['gpt', 'qwen', 'deepseek', 'kimi', 'glm', 'claude', 'doubao'];

  for (const provider of providers) {
    const models = providerModels[provider] ?? [];
    providerToModels.set(provider, models);
    for (const model of models) {
      modelToProvider.set(model.toLowerCase(), provider);
    }
  }

  return { modelToProvider, providerToModels };
}

export function WebClawPanel(props: WebClawPanelProps) {
  const { apiBaseUrl, currentProvider, displayMode, selectedModel, providerModels, serviceStatus, onProviderChange, onError } = props;
  const feedRef = useRef<HTMLDivElement | null>(null);
  const coreRef = useRef<WebClawClientCore | null>(null);
  const onProviderChangeRef = useRef(onProviderChange);
  const [draft, setDraft] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [feed, setFeed] = useState<FeedItem[]>([
    {
      id: 'welcome',
      role: 'webclaw',
      content: '已进入 WebClaw 面板。支持 /model /clear /new /help 命令（provider/mode 请使用上方选择器）。',
      tone: 'muted',
    },
  ]);

  useEffect(() => {
    onProviderChangeRef.current = onProviderChange;
  }, [onProviderChange]);

  const catalog = useMemo(() => buildCatalog(providerModels), [providerModels]);
  useEffect(() => {
    if (!apiBaseUrl || coreRef.current) return;
    const transport = new WebClawBrowserTransport({
      baseUrl: apiBaseUrl,
      model: selectedModel || providerModels[currentProvider]?.[0] || 'gpt-4o',
      routeMode: displayMode,
      stream: false,
      traceEnabled: true,
    });

    const nextCore = new WebClawClientCore({
      transport,
      catalog,
      sessionStore: new BrowserClientSessionStore(),
      hostActions: {
        onEvent: (event) => {
          if (event.type === 'provider-change' && event.provider) {
            void onProviderChangeRef.current(event.provider);
          }
        },
      },
    });

    coreRef.current = nextCore;
  }, [apiBaseUrl, catalog, currentProvider, displayMode, selectedModel, onProviderChange, providerModels]);

  useEffect(() => {
    const core = coreRef.current;
    if (!core) return;
    const nextModel = selectedModel || providerModels[currentProvider]?.[0];
    if (!nextModel) return;
    const transport = core.getTransport();
    if (transport.getConfig().model === nextModel) return;
    transport.setModel(nextModel);
    setFeed([
      {
        id: `provider-${Date.now()}`,
        role: 'webclaw',
        content: `已切换到 ${currentProvider}，默认模型为 ${nextModel}`,
        tone: 'muted',
      },
    ]);
  }, [currentProvider, providerModels, selectedModel]);

  useEffect(() => {
    const core = coreRef.current;
    if (!core) return;
    const transport = core.getTransport() as WebClawBrowserTransport;
    if (transport.getRouteMode() === displayMode) return;
    transport.setRouteMode(displayMode);
    setFeed((prev) => [
      ...prev,
      {
        id: `route-${Date.now()}`,
        role: 'webclaw',
        content:
          displayMode === 'forward'
            ? `已切换为 forward 路由：${currentProvider} 将走直连转发`
            : `已切换为 web 路由：${currentProvider} 将走 WebClaw 网页驱动`,
        tone: 'muted',
      },
    ]);
  }, [currentProvider, displayMode]);

  useEffect(() => {
    const core = coreRef.current;
    if (!core) return;

    let syncing = false;
    const runSync = async () => {
      if (syncing) return;
      syncing = true;
      try {
        const state = core.getState();
        const desiredMode = displayMode;
        const desiredProvider = currentProvider as ProviderKey;

        const adjusted: string[] = [];
        if (state.provider !== desiredProvider) {
          await core.executeInput(`/provider ${desiredProvider}`);
          adjusted.push(`provider=${desiredProvider}`);
        }
        if (state.mode !== desiredMode) {
          await core.executeInput(`/mode ${desiredMode}`);
          adjusted.push(`mode=${desiredMode}`);
        }

        if (adjusted.length > 0) {
          setFeed((prev) => [
            ...prev,
            {
              id: `sync-${Date.now()}`,
              role: 'webclaw',
              content: `已同步当前会话设置：${adjusted.join(', ')}`,
              tone: 'muted',
            },
          ]);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        onError(message);
      } finally {
        syncing = false;
      }
    };

    void runSync();
    const timer = window.setInterval(() => {
      void runSync();
    }, 2000);
    return () => window.clearInterval(timer);
  }, [currentProvider, displayMode, onError]);

  useEffect(() => {
    feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight, behavior: 'smooth' });
  }, [feed]);

  async function handleSubmit() {
    const core = coreRef.current;
    if (!core || !draft.trim() || isSending) return;
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
      if (nextModel && core.getTransport().getConfig().model !== nextModel) {
        core.getTransport().setModel(nextModel);
        setFeed([
          {
            id: `provider-${Date.now()}`,
            role: 'webclaw',
            content: `已切换到 ${currentProvider}，当前模型为 ${nextModel}`,
            tone: 'muted',
          },
        ]);
      }
      if (!isCommand) {
        setFeed((prev) => [
          ...prev,
          { id: userId, role: 'user', content: input },
          { id: pendingId, role: 'webclaw', content: '...', tone: 'muted' },
        ]);
      }
      const result = await core.executeInput(input);
      applyResultToFeed(result, pendingId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      onError(message);
      setFeed((prev) => prev.map((item) => (
        item.id === pendingId ? { ...item, content: message, tone: 'error' } : item
      )));
    } finally {
      setIsSending(false);
    }
  }

  function applyResultToFeed(result: ClientCoreResult, pendingId?: string) {
    if (result.kind === 'chat') {
      setFeed((prev) => prev.map((item) => (
        item.id === pendingId
          ? { ...item, id: `assistant-${Date.now()}-${result.model}`, content: result.response.content || '（空响应）', tone: 'normal' }
          : item
      )));
      return;
    }

    if (result.command === 'noop') return;
    if (result.command === 'clear' || result.command === 'new' || result.command === 'reset') {
      setFeed([
        {
          id: `reset-${Date.now()}`,
          role: 'webclaw',
          content: result.lines.join('\n'),
          tone: 'muted',
        },
      ]);
      return;
    }
    const tone = result.command === 'invalid' ? 'error' : 'muted';
    setFeed((prev) => {
      const withoutPending = pendingId ? prev.filter((item) => item.id !== pendingId) : prev;
      return [
        ...withoutPending,
        {
          id: `cmd-${Date.now()}-${result.command}`,
          role: 'webclaw',
          content: result.lines.join('\n'),
          tone,
        },
      ];
    });
  }

  return (
    <div className="webclaw-panel">
      <div className="webclaw-feed" ref={feedRef}>
        {feed.map((item) => (
          <div key={item.id} className={`chat-row ${item.role}`}>
            <div className={`chat-bubble ${item.role} ${item.tone ?? 'normal'}`}>
              <div className="chat-content">{item.content}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="webclaw-inputbar">
        <textarea
          value={draft}
          placeholder={serviceStatus === 'running' ? '输入消息或 /help 查看命令' : '服务未启动，输入后也可直接尝试发送'}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void handleSubmit();
            }
          }}
        />
        <button className="primary webclaw-send-button" onClick={() => void handleSubmit()} disabled={isSending || !draft.trim()}>
          {isSending ? '发送中...' : '发送'}
        </button>
      </div>
    </div>
  );
}
