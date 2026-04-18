import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { WebClawPanel } from './panels/WebClawPanel';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';

type WorkspaceTabKey = 'webclaw' | 'terminal' | 'config' | 'logs' | 'errors';

const tabs: { key: WorkspaceTabKey; label: string }[] = [
  { key: 'webclaw', label: 'webclaw' },
  { key: 'terminal', label: '终端' },
  { key: 'config', label: '配置' },
  { key: 'logs', label: '日志' },
  { key: 'errors', label: '错误' },
];

const PROVIDER_KEYS = ['gpt', 'qwen', 'deepseek', 'kimi', 'glm', 'claude', 'doubao'] as const;

const MIN_BROWSER_HEIGHT = 360;
const MIN_PANEL_HEIGHT = 280;
const SPLIT_DIVIDER_HEIGHT = 8;

export default function App() {
  const [activeTab, setActiveTab] = useState<WorkspaceTabKey>('webclaw');
  const [currentProvider, setCurrentProvider] = useState('gpt');
  const [displayMode, setDisplayMode] = useState<'web' | 'forward'>('web');
  const [selectedForwardModel, setSelectedForwardModel] = useState('');
  const [webclawSending, setWebclawSending] = useState(false);
  const [theme, setTheme] = useState<'dark' | 'light'>(() => (
    window.localStorage.getItem('webclaw:theme') === 'light' ? 'light' : 'dark'
  ));
  const [providerSites, setProviderSites] = useState<Record<string, string>>({});
  const [providerModels, setProviderModels] = useState<Record<string, string[]>>({});
  const [providerDefaultModes, setProviderDefaultModes] = useState<Record<string, 'web' | 'forward'>>({});
  const [providerInputMaxChars, setProviderInputMaxChars] = useState<Record<string, number | null>>({});
  const [providerForwardBaseUrls, setProviderForwardBaseUrls] = useState<Record<string, string>>({});
  const [providerApiKeys, setProviderApiKeys] = useState<Record<string, string>>({});
  const [providerApiKeyMasked, setProviderApiKeyMasked] = useState<Record<string, string>>({});
  const [servicePort, setServicePort] = useState(3000);
  const [promptConfig, setPromptConfig] = useState<{
    init_prompt: string;
    init_prompt_template: string;
    user_message_template: string;
    response_schema_template: string;
    format_only_retry_template: string;
  }>({
    init_prompt: '',
    init_prompt_template: '',
    user_message_template: '',
    response_schema_template: '',
    format_only_retry_template: '',
  });
  const [serviceStatus, setServiceStatus] = useState('stopped');
  const [serviceControlReady, setServiceControlReady] = useState(false);
  const [apiBaseUrl, setApiBaseUrl] = useState('http://127.0.0.1:3000');
  const [serviceLogs, setServiceLogs] = useState<string[]>([
    '等待服务日志...',
  ]);
  const [terminalsById, setTerminalsById] = useState<Record<string, {
    terminalId: string;
    status: string;
    backend: 'pty' | 'raw' | null;
    shell: string;
    cwd: string;
    pid: number | null;
    chunks: string[];
  }>>({});
  const [activeTerminalId, setActiveTerminalId] = useState<string | null>(null);
  const closedTerminalIdsRef = useRef<Set<string>>(new Set());
  const [logTypeFilter, setLogTypeFilter] = useState('all');
  const [logProviderFilter, setLogProviderFilter] = useState('all');
  const [logSearch, setLogSearch] = useState('');
  const [logAutoScroll, setLogAutoScroll] = useState(true);
  const [errors, setErrors] = useState<string[]>([]);
  const [terminalMenuOpen, setTerminalMenuOpen] = useState(false);
  const [terminalInited, setTerminalInited] = useState(false);
  const serviceStatusRef = useRef(serviceStatus);
  const handledStoppedResetRef = useRef(false);
  const [splitRatio, setSplitRatio] = useState(() => {
    const saved = window.localStorage.getItem('webclaw:split-ratio');
    const parsed = saved ? Number(saved) : 0.56;
    return Number.isFinite(parsed) ? Math.min(0.75, Math.max(0.38, parsed)) : 0.56;
  });
  const splitPaneRef = useRef<HTMLDivElement | null>(null);
  const browserPaneRef = useRef<HTMLDivElement | null>(null);

  const pushError = useCallback((message: string) => {
    setErrors((prev) => [`${new Date().toLocaleTimeString()} ${message}`, ...prev].slice(0, 100));
    setActiveTab('errors');
  }, []);

  const resetDesktopToInitialState = useCallback(() => {
    setActiveTab('webclaw');
    setDisplayMode('web');
    setSelectedForwardModel('');
    setCurrentProvider('gpt');
    setServiceLogs(['等待服务日志...']);
    setErrors([]);
    setLogTypeFilter('all');
    setLogProviderFilter('all');
    setLogSearch('');
    setTerminalsById({});
    setActiveTerminalId(null);
    setTerminalInited(false);
    void window.webclawDesktop?.showBrowserWaiting?.();
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    let timer: number | null = null;
    const onScroll = () => {
      root.classList.add('is-scrolling');
      if (timer != null) {
        window.clearTimeout(timer);
      }
      timer = window.setTimeout(() => {
        timer = null;
        root.classList.remove('is-scrolling');
      }, 700);
    };
    document.addEventListener('scroll', onScroll, { capture: true, passive: true });
    return () => {
      document.removeEventListener('scroll', onScroll, true);
      if (timer != null) window.clearTimeout(timer);
      root.classList.remove('is-scrolling');
    };
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'light') {
      root.classList.add('theme-light');
    } else {
      root.classList.remove('theme-light');
    }
    window.localStorage.setItem('webclaw:theme', theme);
    void window.webclawDesktop?.setTheme?.(theme);
  }, [theme]);

  useEffect(() => {
    serviceStatusRef.current = serviceStatus;
  }, [serviceStatus]);

  const createTerminalAndFocus = useCallback(async () => {
    const created = await window.webclawDesktop?.createTerminal?.();
    if (!created) return;
    setTerminalsById((prev) => ({
      ...prev,
      [created.terminalId]: {
        terminalId: created.terminalId,
        status: created.status,
          backend: created.backend,
        shell: created.shell,
        cwd: created.cwd,
        pid: created.pid,
        chunks: [],
      },
    }));
    setActiveTerminalId(created.terminalId);
    setActiveTab('terminal');
  }, []);

  useEffect(() => {
    if (!terminalMenuOpen) return;
    const onDown = () => setTerminalMenuOpen(false);
    window.addEventListener('pointerdown', onDown);
    return () => window.removeEventListener('pointerdown', onDown);
  }, [terminalMenuOpen]);

  useEffect(() => {
    if (displayMode !== 'forward') return;
    if (serviceStatus !== 'running') return;
    void window.webclawDesktop?.navigateBrowser?.(`${apiBaseUrl}/monitor`);
  }, [apiBaseUrl, displayMode, serviceStatus]);

  useEffect(() => {
    let mounted = true;
    const refreshDesktopState = async () => {
      const state = await window.webclawDesktop?.getDesktopState?.();
      if (!mounted || !state) return;
      setCurrentProvider((state.currentProvider as string | null) ?? 'gpt');
      setProviderSites(state.providerSites);
      setProviderModels(state.providerModels);
      setProviderDefaultModes(state.providerDefaultModes ?? {});
      setProviderInputMaxChars(state.providerInputMaxChars ?? {});
      setProviderForwardBaseUrls(state.providerForwardBaseUrls ?? {});
      setProviderApiKeys(state.providerApiKeys ?? {});
      setProviderApiKeyMasked(state.providerApiKeyMasked ?? {});
      setServicePort(Number.isInteger(state.servicePort) ? state.servicePort : 3000);
      if (state.serviceStatus === 'running' && state.promptConfig) {
        setPromptConfig(state.promptConfig);
      }
      const initialProvider = (state.currentProvider as string | null) ?? 'gpt';
      const initialModels = (state.providerModels?.[initialProvider] as string[] | undefined) ?? [];
      if (initialModels.length > 0) {
        setSelectedForwardModel((prev) => (prev && initialModels.includes(prev) ? prev : initialModels[0]));
      }
      setServiceStatus(state.serviceStatus);
      setApiBaseUrl(state.apiBaseUrl);
    };

    void refreshDesktopState();

    // ✅ 延迟设置 ready 状态，等待 BrowserView 初始化完成
    // 避免用户在初始化期间点击按钮导致冲突
    setTimeout(() => {
      if (mounted) setServiceControlReady(true);
    }, 500);

    const disposeLog = window.webclawDesktop?.onServiceLog?.((event) => {
      setServiceLogs((prev) => {
        const prefix = event.stream === 'stderr' ? '[ERR ]' : '[LOG ]';
        const lines = event.message
          .split(/\r?\n/)
          .filter((line) => line.trim().length > 0)
          .map((line) => `${new Date(event.timestamp).toLocaleTimeString()} ${prefix} ${line}`);
        return [...prev, ...lines].slice(-300);
      });
    });
    const disposeStatus = window.webclawDesktop?.onServiceStatus?.((event) => {
      setServiceStatus(event.status);
      setServiceLogs((prev) => [
        ...prev,
        `${new Date(event.timestamp).toLocaleTimeString()} [STAT] service -> ${event.status}`,
      ].slice(-300));
      if (event.status === 'running') {
        void refreshDesktopState();
      }
      requestSyncBrowserBounds();
    });
    const disposeError = window.webclawDesktop?.onServiceError?.((event) => {
      const line = `${new Date(event.timestamp).toLocaleTimeString()} [FAIL] ${event.message}`;
      setServiceLogs((prev) => [...prev, line].slice(-300));
      pushError(event.message);
      window.alert(event.message);
    });
    const disposeTerminalOutput = window.webclawDesktop?.onTerminalOutput?.((event) => {
      setTerminalsById((prev) => {
        if (closedTerminalIdsRef.current.has(event.terminalId)) return prev;
        const existing = prev[event.terminalId];
        if (!existing) {
          return {
            ...prev,
            [event.terminalId]: {
              terminalId: event.terminalId,
              status: 'running',
              backend: null,
              shell: '',
              cwd: '',
              pid: null,
              chunks: [event.message],
            },
          };
        }
        return {
          ...prev,
          [event.terminalId]: {
            ...existing,
            chunks: [...existing.chunks, event.message].slice(-1200),
          },
        };
      });
    });
    const disposeTerminalStatus = window.webclawDesktop?.onTerminalStatus?.((event) => {
      setTerminalsById((prev) => {
        if (closedTerminalIdsRef.current.has(event.terminalId)) return prev;
        const existing = prev[event.terminalId];
        const next = {
          terminalId: event.terminalId,
          status: event.status,
          backend: event.backend,
          shell: event.shell,
          cwd: event.cwd,
          pid: event.pid,
          chunks: existing?.chunks ?? [],
        };
        return { ...prev, [event.terminalId]: next };
      });
    });
    return () => {
      mounted = false;
      disposeLog?.();
      disposeStatus?.();
      disposeError?.();
      disposeTerminalOutput?.();
      disposeTerminalStatus?.();
    };
  }, [pushError]);

  useEffect(() => {
    let mounted = true;
    const timer = window.setInterval(async () => {
      const state = await window.webclawDesktop?.getDesktopState?.();
      if (!mounted || !state) return;
      const nextStatus = state.serviceStatus;
      const prevStatus = serviceStatusRef.current;
      if (nextStatus !== prevStatus) {
        setServiceStatus(nextStatus);
        setServiceLogs((prev) => [
          ...prev,
          `${new Date().toLocaleTimeString()} [HEALTH] service -> ${nextStatus}`,
        ].slice(-300));
      }
      if (nextStatus === 'running') {
        handledStoppedResetRef.current = false;
      }
      if (nextStatus === 'stopped' && prevStatus !== 'stopped' && !handledStoppedResetRef.current) {
        handledStoppedResetRef.current = true;
        await window.webclawDesktop?.resetBrowser?.();
        resetDesktopToInitialState();
        requestSyncBrowserBounds();
      }
    }, 2500);
    return () => {
      mounted = false;
      window.clearInterval(timer);
    };
  }, [resetDesktopToInitialState]);

  useEffect(() => {
    const models = providerModels[currentProvider] ?? [];
    if (models.length === 0) {
      if (selectedForwardModel) setSelectedForwardModel('');
      return;
    }
    if (!selectedForwardModel || !models.includes(selectedForwardModel)) {
      setSelectedForwardModel(models[0]);
    }
  }, [currentProvider, providerModels, selectedForwardModel]);

  const ensureTerminalReady = useCallback(async () => {
    if (terminalInited) return;
    const state = await window.webclawDesktop?.initTerminal?.();
    const terminals = state?.terminals ?? [];
    const nextById: Record<string, {
      terminalId: string;
      status: string;
      backend: 'pty' | 'raw' | null;
      shell: string;
      cwd: string;
      pid: number | null;
      chunks: string[];
    }> = {};
    for (const t of terminals) {
      nextById[t.terminalId] = {
        terminalId: t.terminalId,
        status: t.status,
        backend: t.backend,
        shell: t.shell,
        cwd: t.cwd,
        pid: t.pid,
        chunks: [],
      };
      closedTerminalIdsRef.current.delete(t.terminalId);
    }
    setTerminalsById(nextById);
    setActiveTerminalId(state?.activeTerminalId ?? terminals[0]?.terminalId ?? null);
    setTerminalInited(true);
  }, [terminalInited]);

  const syncBrowserBounds = useCallback((): boolean => {
    const pane = browserPaneRef.current;
    if (!pane) return false;
    const rect = pane.getBoundingClientRect();
    if (rect.width < 4 || rect.height < 4) return false;
    void window.webclawDesktop?.setBrowserBounds?.({
      x: Math.round(rect.left),
      y: Math.round(rect.top),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    });
    return true;
  }, []);

  const requestSyncBrowserBounds = useCallback(() => {
    let attempt = 0;
    const tick = () => {
      if (syncBrowserBounds()) return;
      attempt += 1;
      if (attempt < 10) window.requestAnimationFrame(tick);
    };
    window.requestAnimationFrame(tick);
  }, [syncBrowserBounds]);

  useEffect(() => {
    window.localStorage.setItem('webclaw:split-ratio', String(splitRatio));
    void window.webclawDesktop?.setBrowserSplitRatio?.(splitRatio);
    requestSyncBrowserBounds();
  }, [requestSyncBrowserBounds, splitRatio]);

  useEffect(() => {
    const container = splitPaneRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const minRatio = Math.min(0.72, Math.max(0.42, MIN_BROWSER_HEIGHT / rect.height));
    const maxRatio = Math.max(minRatio, Math.min(0.72, 1 - MIN_PANEL_HEIGHT / rect.height));
    if (splitRatio < minRatio || splitRatio > maxRatio) {
      setSplitRatio(Math.min(maxRatio, Math.max(minRatio, splitRatio)));
    }
  }, [splitRatio]);

  useEffect(() => {
    const onResize = () => requestSyncBrowserBounds();
    window.addEventListener('resize', onResize);
    const observer = new ResizeObserver(() => {
      const container = splitPaneRef.current;
      if (container) {
        const rect = container.getBoundingClientRect();
        const minRatio = Math.min(0.72, Math.max(0.42, MIN_BROWSER_HEIGHT / rect.height));
        const maxRatio = Math.max(minRatio, Math.min(0.72, 1 - MIN_PANEL_HEIGHT / rect.height));
        setSplitRatio((prev) => Math.min(maxRatio, Math.max(minRatio, prev)));
      }
      requestSyncBrowserBounds();
    });
    if (browserPaneRef.current) observer.observe(browserPaneRef.current);
    if (splitPaneRef.current) observer.observe(splitPaneRef.current);
    requestSyncBrowserBounds();
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', onResize);
    };
  }, [requestSyncBrowserBounds]);

  const handleProviderChange = useCallback(async (provider: string) => {
    setCurrentProvider(provider);
    // ✅ 只有在 web 模式下才切换 BrowserView
    // forward 模式下切换 provider 应该停留在 forward 界面
    if (displayMode === 'web') {
      await window.webclawDesktop?.selectProvider?.(provider);
    }
  }, [displayMode]);

  const handleProviderConfigSave = useCallback(
    async (payload: { provider: string; models: string[]; defaultMode: 'web' | 'forward'; inputMaxChars: number | null; forwardBaseUrl: string; apiKey?: string }) => {
      const result = await window.webclawDesktop?.updateProviderConfig?.(payload);
      if (!result?.ok) {
        throw new Error('更新配置失败');
      }
      setProviderSites(result.providerSites);
      setProviderModels(result.providerModels);
      setProviderDefaultModes(result.providerDefaultModes ?? {});
      setProviderInputMaxChars(result.providerInputMaxChars ?? {});
      setProviderForwardBaseUrls(result.providerForwardBaseUrls ?? {});
      setProviderApiKeys(result.providerApiKeys ?? {});
      setProviderApiKeyMasked(result.providerApiKeyMasked ?? {});
    },
    []
  );

  const handleServiceSettingsSave = useCallback(
    async (payload: { servicePort: number }) => {
      const result = await window.webclawDesktop?.updateSettings?.(payload);
      if (!result?.ok) {
        throw new Error('更新服务端口失败');
      }
      setServicePort(result.servicePort);
    },
    []
  );

  const handlePromptConfigSave = useCallback(
    async (payload: {
      init_prompt: string;
      init_prompt_template: string;
      user_message_template: string;
      response_schema_template: string;
      format_only_retry_template: string;
    }) => {
      const result = await window.webclawDesktop?.updatePromptConfig?.(payload);
      if (!result?.ok) {
        throw new Error('更新提示词配置失败');
      }
      setPromptConfig(result.promptConfig);
    },
    []
  );

  const handleStartService = useCallback(async () => {
    try {
      await window.webclawDesktop?.startService?.();
      requestSyncBrowserBounds();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      pushError(message);
    }
  }, [pushError, requestSyncBrowserBounds]);

  const handleStopService = useCallback(async () => {
    try {
      await window.webclawDesktop?.stopService?.();
      requestSyncBrowserBounds();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      pushError(message);
    }
  }, [pushError, requestSyncBrowserBounds]);

  const handleToggleService = useCallback(async () => {
    if (!serviceControlReady) return;
    if (serviceStatus === 'running') {
      const confirmed = window.confirm('确认停止 WebClaw 服务吗？');
      if (!confirmed) return;
      setServiceStatus('stopping');
      await handleStopService();
      return;
    }

    if (serviceStatus === 'starting' || serviceStatus === 'stopping') return;
    const confirmed = window.confirm('确认启动 WebClaw 服务吗？');
    if (!confirmed) return;
    await handleStartService();
  }, [handleStartService, handleStopService, serviceControlReady, serviceStatus]);

  function handleSplitDragStart(event: React.PointerEvent<HTMLDivElement>) {
    const container = splitPaneRef.current;
    if (!container) return;

    const startRect = container.getBoundingClientRect();
    const onMove = (moveEvent: PointerEvent) => {
      const offsetY = moveEvent.clientY - startRect.top;
      const minRatio = Math.min(0.72, Math.max(0.42, MIN_BROWSER_HEIGHT / startRect.height));
      const maxRatio = Math.max(minRatio, Math.min(0.72, 1 - MIN_PANEL_HEIGHT / startRect.height));
      const ratio = offsetY / startRect.height;
      setSplitRatio(Math.min(maxRatio, Math.max(minRatio, ratio)));
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    event.preventDefault();
  }

  useEffect(() => {
    if (activeTab !== 'terminal') return;
    void ensureTerminalReady();
  }, [activeTab, ensureTerminalReady]);

  const webclawPanel = useMemo(() => (
    <WebClawPanel
      apiBaseUrl={apiBaseUrl}
      currentProvider={currentProvider}
      displayMode={displayMode}
      selectedModel={displayMode === 'forward' ? selectedForwardModel : undefined}
      providerModels={providerModels}
      serviceStatus={serviceStatus}
      onProviderChange={handleProviderChange}
      onError={pushError}
      onSendingChange={setWebclawSending}
    />
  ), [apiBaseUrl, currentProvider, displayMode, selectedForwardModel, providerModels, serviceStatus, handleProviderChange, pushError]);

  const panel = useMemo(() => {
    if (activeTab === 'webclaw') return null;

    const filteredLogLines = serviceLogs.filter((line) => {
      const lower = line.toLowerCase();
      const typeMatches =
        logTypeFilter === 'all' ||
        (logTypeFilter === 'stdout' && line.includes('[LOG ]')) ||
        (logTypeFilter === 'stderr' && line.includes('[ERR ]')) ||
        (logTypeFilter === 'status' && line.includes('[STAT]')) ||
        (logTypeFilter === 'fail' && line.includes('[FAIL]'));
      const providerMatches =
        logProviderFilter === 'all' || lower.includes(logProviderFilter.toLowerCase());
      const searchMatches =
        logSearch.trim() === '' || lower.includes(logSearch.trim().toLowerCase());
      return typeMatches && providerMatches && searchMatches;
    });

    switch (activeTab) {
      case 'config':
        return (
          <ConfigPanel
            providerModels={providerModels}
            providerSites={providerSites}
            providerDefaultModes={providerDefaultModes}
            providerInputMaxChars={providerInputMaxChars}
            providerForwardBaseUrls={providerForwardBaseUrls}
            providerApiKeys={providerApiKeys}
            providerApiKeyMasked={providerApiKeyMasked}
            onSave={handleProviderConfigSave}
            servicePort={servicePort}
            serviceStatus={serviceStatus}
            onSaveServiceSettings={handleServiceSettingsSave}
            promptConfig={promptConfig}
            onSavePromptConfig={handlePromptConfigSave}
            onError={pushError}
          />
        );
      case 'terminal':
        return (
          <TerminalPanel
            terminals={Object.values(terminalsById)}
            activeTerminalId={activeTerminalId}
            theme={theme}
            onSelectTerminal={(terminalId) => {
              setActiveTerminalId((prev) => (terminalsById[terminalId] ? terminalId : prev));
            }}
            onCloseTerminal={async (terminalId) => {
              const confirmed = window.confirm(`确认关闭终端 ${terminalId} 吗？`);
              if (!confirmed) return;
              closedTerminalIdsRef.current.add(terminalId);
              const res = await window.webclawDesktop?.closeTerminal?.(terminalId);
              if (!res?.closed) {
                closedTerminalIdsRef.current.delete(terminalId);
                return;
              }
              setTerminalsById((prev) => {
                const next = { ...prev };
                delete next[terminalId];
                const remaining = Object.keys(next);
                setActiveTerminalId((activePrev) =>
                  activePrev === terminalId ? (remaining[0] ?? null) : activePrev
                );
                return next;
              });
            }}
          />
        );
      case 'logs':
        return (
          <ServiceLogsPanel
            logLines={filteredLogLines}
            providerOptions={Object.keys(providerSites)}
            logTypeFilter={logTypeFilter}
            logProviderFilter={logProviderFilter}
            logSearch={logSearch}
            autoScroll={logAutoScroll}
            onTypeChange={setLogTypeFilter}
            onProviderChange={setLogProviderFilter}
            onSearchChange={setLogSearch}
            onAutoScrollChange={setLogAutoScroll}
          />
        );
      case 'errors':
        return <ErrorPanel errors={errors} />;
      default:
        return null;
    }
  }, [activeTab, activeTerminalId, errors, handlePromptConfigSave, handleProviderConfigSave, handleServiceSettingsSave, logAutoScroll, logProviderFilter, logSearch, logTypeFilter, promptConfig, providerApiKeyMasked, providerApiKeys, providerDefaultModes, providerForwardBaseUrls, providerInputMaxChars, providerModels, providerSites, serviceLogs, servicePort, serviceStatus, terminalsById, pushError]);

  return (
    <div className="console-shell">
      <div
        className="main-split-pane"
        ref={splitPaneRef}
        style={{
          gridTemplateRows: `calc((100% - ${SPLIT_DIVIDER_HEIGHT}px) * ${splitRatio}) ${SPLIT_DIVIDER_HEIGHT}px calc((100% - ${SPLIT_DIVIDER_HEIGHT}px) * ${1 - splitRatio})`,
        }}
      >
        <section className="browser-workspace">
          <div className="browser-pane" ref={browserPaneRef} />
        </section>

        <div
          className="split-divider"
          onPointerDown={handleSplitDragStart}
          role="separator"
          aria-orientation="horizontal"
          aria-label="调整浏览器与面板高度"
        >
          <span className="split-divider-handle" />
        </div>

        <section className="bottom-workspace">
          <div className="workspace-tabs">
            <div className="tabs-left">
              <button
                className="service-toggle"
                onClick={() => void handleToggleService()}
                title={
                  !serviceControlReady
                    ? '桌面初始化中'
                    : serviceStatus === 'running'
                      ? '停止服务'
                      : serviceStatus === 'starting'
                        ? '正在启动'
                        : '启动服务'
                }
                disabled={!serviceControlReady || serviceStatus === 'starting' || serviceStatus === 'stopping'}
              >
                <span
                  className={`service-toggle-ring ${
                    !serviceControlReady
                      ? 'disabled'
                      : serviceStatus === 'running'
                      ? 'running'
                      : serviceStatus === 'starting'
                        ? 'starting'
                        : serviceStatus === 'stopping'
                          ? 'stopping'
                          : 'stopped'
                  }`}
                >
                  <span
                    className={`service-toggle-icon ${
                      !serviceControlReady
                        ? 'disabled'
                        : serviceStatus === 'running'
                        ? 'stop'
                        : serviceStatus === 'starting' || serviceStatus === 'stopping'
                          ? 'spinner'
                          : 'play'
                    }`}
                  />
                </span>
              </button>
              <select
                className="control-provider-select"
                value={currentProvider}
                onChange={(e) => void handleProviderChange(e.target.value)}
                disabled={!serviceControlReady || Object.keys(providerSites).length === 0 || (activeTab === 'webclaw' && webclawSending)}
              >
                {(Object.keys(providerSites).length > 0 ? Object.keys(providerSites) : [currentProvider]).map((provider) => (
                  <option key={provider} value={provider}>
                    {provider}
                  </option>
                ))}
              </select>
              <select
                className="control-provider-select control-mode-select"
                value={displayMode}
                onChange={(e) => {
                  const mode = e.target.value as 'web' | 'forward';
                  setDisplayMode(mode);
                  if (mode === 'forward') {
                    if (serviceStatus === 'running') {
                      void window.webclawDesktop?.navigateBrowser?.(`${apiBaseUrl}/monitor`);
                    } else {
                      pushError('WebClaw 服务未启动，无法加载 Forward Monitor');
                    }
                  } else {
                    void window.webclawDesktop?.selectProvider?.(currentProvider);
                  }
                }}
                title="切换 web / forward 模式（forward 模式会自动连接服务）"
                disabled={!serviceControlReady || serviceStatus !== 'running' || (activeTab === 'webclaw' && webclawSending)}
              >
                <option value="web">web</option>
                <option value="forward">forward</option>
              </select>
              {displayMode === 'forward' ? (
                <select
                  className="control-provider-select control-mode-select"
                  value={selectedForwardModel}
                  onChange={(e) => setSelectedForwardModel(e.target.value)}
                  title="forward 模式请求使用的模型"
                  disabled={activeTab === 'webclaw' && webclawSending}
                >
                  {(providerModels[currentProvider] ?? []).map((model) => (
                    <option key={model} value={model}>
                      {model}
                    </option>
                  ))}
                </select>
              ) : null}
              {tabs.map((tab) => {
                if (tab.key !== 'terminal') {
                  return (
                    <button
                      key={tab.key}
                      className={tab.key === activeTab ? 'tab active' : 'tab'}
                      onClick={() => setActiveTab(tab.key)}
                    >
                      {tab.label}
                    </button>
                  );
                }

                return (
                  <div key={tab.key} className="tab-with-menu">
                    <button
                      className={tab.key === activeTab ? 'tab active tab-merged' : 'tab tab-merged'}
                      onClick={async () => {
                        setTerminalMenuOpen(false);
                        setActiveTab(tab.key);
                        if (!terminalInited) {
                          await ensureTerminalReady();
                        }
                      }}
                      title="终端"
                    >
                      <span>{tab.label}</span>
                    </button>
                    <button
                      className="tab-menu-hitbox"
                      onClick={async (e) => {
                        e.stopPropagation();
                        setActiveTab('terminal');
                        if (!terminalInited) {
                          await ensureTerminalReady();
                        }
                        setTerminalMenuOpen((prev) => !prev);
                      }}
                      title="终端菜单"
                      aria-label="终端菜单"
                    />
                    {terminalMenuOpen ? (
                      <div
                        className="tab-menu"
                        onPointerDown={(e) => e.stopPropagation()}
                      >
                        <button
                          className="tab-menu-item"
                          onClick={() => {
                            setTerminalMenuOpen(false);
                            void createTerminalAndFocus();
                          }}
                        >
                          新建终端
                        </button>
                      </div>
                    ) : null}
                  </div>
                );
              })}
              <button className="tab" type="button" title="自我进化">
                自我进化
              </button>
              <span className="control-label mono">主题</span>
              <select
                className="control-provider-select control-theme-select"
                value={theme}
                onChange={(e) => setTheme(e.target.value as 'dark' | 'light')}
                title="主题（黑/白）"
              >
                <option value="dark">黑</option>
                <option value="light">白</option>
              </select>
            </div>
          </div>

          <div className="workspace-panel">
            <div style={{ display: activeTab === 'webclaw' ? 'block' : 'none', height: '100%' }}>
              {webclawPanel}
            </div>
            {activeTab === 'webclaw' ? null : panel}
          </div>
        </section>
      </div>

      <footer className="bottom-action-bar">
        <div className="footer-status mono">
          Service: {serviceStatus} | URL: {apiBaseUrl} | CDP: 9222 | Provider: {currentProvider} | Queue: --
        </div>
      </footer>
    </div>
  );
}

function TerminalPanel({
  terminals,
  activeTerminalId,
  onSelectTerminal,
  onCloseTerminal,
  theme,
}: {
  terminals: Array<{
    terminalId: string;
    status: string;
    backend: 'pty' | 'raw' | null;
    shell: string;
    cwd: string;
    pid: number | null;
    chunks: string[];
  }>;
  activeTerminalId: string | null;
  onSelectTerminal: (terminalId: string) => void;
  onCloseTerminal: (terminalId: string) => Promise<void>;
  theme: 'dark' | 'light';
}) {
  const terminalHostRef = useRef<HTMLDivElement | null>(null);
  const terminalRootRef = useRef<HTMLDivElement | null>(null);
  const terminalContainerRef = useRef<HTMLDivElement | null>(null);
  const terminalInstanceRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const renderedCountByTerminalRef = useRef<Record<string, number>>({});
  const activeIdRef = useRef<string | null>(activeTerminalId);
  const terminalsRef = useRef(terminals);
  const scrollbarTimerRef = useRef<number | null>(null);

  useEffect(() => {
    terminalsRef.current = terminals;
  }, [terminals]);

  useEffect(() => {
    const host = terminalHostRef.current;
    if (!host) return;

    const fitAddon = new FitAddon();
    const terminal = new Terminal({
      cursorBlink: true,
      convertEol: true,
      fontSize: 10,
      lineHeight: 1.15,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      theme: {
        background: theme === 'light' ? '#ffffff' : '#0b1220',
        foreground: theme === 'light' ? '#0f172a' : '#e2e8f0',
      },
    });

    terminal.loadAddon(fitAddon);
    terminal.open(host);
    fitAddon.fit();
    terminal.focus();

    terminalInstanceRef.current = terminal;
    fitAddonRef.current = fitAddon;
    renderedCountByTerminalRef.current = {};

    const applySize = () => {
      fitAddon.fit();
      const id = activeIdRef.current;
      if (!id) return;
      void window.webclawDesktop?.resizeTerminal?.(id, terminal.cols, terminal.rows);
    };

    const observer = new ResizeObserver(() => applySize());
    observer.observe(host);
    if (terminalRootRef.current) observer.observe(terminalRootRef.current);

    const dataDisposable = terminal.onData((data) => {
      const id = activeIdRef.current;
      if (!id) return;
      const active = terminalsRef.current.find((t) => t.terminalId === id);
      const payload = active?.backend === 'raw'
        ? data.replace(/\r/g, '\n')
        : data;
      if (active?.backend === 'raw') {
        terminal.write(data);
      }
      void window.webclawDesktop?.writeTerminal?.(id, payload);
    });

    const keyDisposable = terminal.onKey(({ domEvent }) => {
      if ((domEvent.ctrlKey || domEvent.metaKey) && domEvent.key.toLowerCase() === 'c') {
        const id = activeIdRef.current;
        if (!id) return;
        void window.webclawDesktop?.interruptTerminal?.(id);
      }
    });

    applySize();

    return () => {
      observer.disconnect();
      dataDisposable.dispose();
      keyDisposable.dispose();
      terminal.dispose();
      terminalInstanceRef.current = null;
      fitAddonRef.current = null;
    };
  }, []);

  useEffect(() => {
    const terminal = terminalInstanceRef.current;
    if (!terminal) return;
    terminal.options.theme = {
      background: theme === 'light' ? '#ffffff' : '#0b1220',
      foreground: theme === 'light' ? '#0f172a' : '#e2e8f0',
    };
    terminal.refresh(0, Math.max(0, terminal.rows - 1));
  }, [theme]);

  useEffect(() => {
    activeIdRef.current = activeTerminalId;
    const terminal = terminalInstanceRef.current;
    if (!terminal) return;
    terminal.reset();
    terminalContainerRef.current?.classList.remove('show-scrollbar');
    const active = terminals.find((t) => t.terminalId === activeTerminalId);
    const chunks = active?.chunks ?? [];
    for (const chunk of chunks) terminal.write(chunk);
    if (activeTerminalId) renderedCountByTerminalRef.current[activeTerminalId] = chunks.length;
    fitAddonRef.current?.fit();
    terminal.focus();
  }, [activeTerminalId]);

  useEffect(() => {
    const id = activeTerminalId;
    if (!id) return;
    const terminal = terminalInstanceRef.current;
    if (!terminal) return;
    const active = terminals.find((t) => t.terminalId === id);
    if (!active) return;
    const already = renderedCountByTerminalRef.current[id] ?? 0;
    if (active.chunks.length <= already) return;
    for (let i = already; i < active.chunks.length; i += 1) {
      terminal.write(active.chunks[i]);
    }
    renderedCountByTerminalRef.current[id] = active.chunks.length;
  }, [terminals, activeTerminalId]);

  const showList = terminals.length > 1;

  return (
    <div
      ref={terminalRootRef}
      className={showList ? 'panel-shell terminal-panel terminal-split' : 'panel-shell terminal-panel'}
    >
      <div className="terminal-main">
        <div
          className="terminal-view"
          ref={terminalContainerRef}
          onWheel={() => {
            const el = terminalContainerRef.current;
            if (!el) return;
            const viewport = el.querySelector('.xterm-viewport') as HTMLDivElement | null;
            if (!viewport) return;
            const canScroll = viewport.scrollHeight > viewport.clientHeight + 1;
            if (!canScroll) return;
            el.classList.add('show-scrollbar');
            if (scrollbarTimerRef.current) window.clearTimeout(scrollbarTimerRef.current);
            scrollbarTimerRef.current = window.setTimeout(() => {
              terminalContainerRef.current?.classList.remove('show-scrollbar');
            }, 900);
          }}
        >
          <div className="terminal-host" ref={terminalHostRef} />
        </div>
      </div>
      {showList ? (
      <div className="terminal-list panel-box">
        <div className="panel-title terminal-list-title">终端</div>
        <div className="terminal-list-body">
            {terminals.map((t) => (
              <div
                key={t.terminalId}
                className={t.terminalId === activeTerminalId ? 'terminal-item active' : 'terminal-item'}
              >
                <button
                  className="terminal-item-main"
                  onClick={() => onSelectTerminal(t.terminalId)}
                  title={`${t.shell} · ${t.cwd}`}
                >
                  <span className="terminal-item-id">{t.terminalId}</span>
                  <span
                    className="terminal-item-close"
                    onClick={(e) => {
                      e.stopPropagation();
                      void onCloseTerminal(t.terminalId);
                    }}
                    title="关闭终端"
                  >
                    ×
                  </span>
                </button>
              </div>
            ))}
        </div>
      </div>
      ) : null}
    </div>
  );
}

function ServiceLogsPanel({
  logLines,
  providerOptions,
  logTypeFilter,
  logProviderFilter,
  logSearch,
  autoScroll,
  onTypeChange,
  onProviderChange,
  onSearchChange,
  onAutoScrollChange,
}: {
  logLines: string[];
  providerOptions: string[];
  logTypeFilter: string;
  logProviderFilter: string;
  logSearch: string;
  autoScroll: boolean;
  onTypeChange: (value: string) => void;
  onProviderChange: (value: string) => void;
  onSearchChange: (value: string) => void;
  onAutoScrollChange: (value: boolean) => void;
}) {
  const logListRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const container = logListRef.current;
    if (!container || !autoScroll) return;
    container.scrollTop = container.scrollHeight;
  }, [autoScroll, logLines]);

  return (
    <div className="panel-shell">
      <div className="panel-toolbar">
        <select value={logTypeFilter} onChange={(e) => onTypeChange(e.target.value)}>
          <option value="all">all</option>
          <option value="stdout">stdout</option>
          <option value="stderr">stderr</option>
          <option value="status">status</option>
          <option value="fail">fail</option>
        </select>
        <select value={logProviderFilter} onChange={(e) => onProviderChange(e.target.value)}>
          <option value="all">all providers</option>
          {providerOptions.map((provider) => (
            <option key={provider} value={provider}>{provider}</option>
          ))}
        </select>
        <input value={logSearch} onChange={(e) => onSearchChange(e.target.value)} placeholder="搜索日志..." />
        <label className="checkbox-inline">
          <input type="checkbox" checked={autoScroll} onChange={(e) => onAutoScrollChange(e.target.checked)} /> Auto Scroll
        </label>
      </div>

      <div className="log-list" ref={logListRef}>
        {logLines.map((line, index) => (
          <div key={`${index}-${line}`} className="log-line mono">{line}</div>
        ))}
      </div>
    </div>
  );
}

function ConfigPanel({
  providerModels,
  providerSites,
  providerDefaultModes,
  providerInputMaxChars,
  providerForwardBaseUrls,
  providerApiKeys,
  providerApiKeyMasked,
  onSave,
  servicePort,
  serviceStatus,
  onSaveServiceSettings,
  promptConfig,
  onSavePromptConfig,
  onError,
}: {
  providerModels: Record<string, string[]>;
  providerSites: Record<string, string>;
  providerDefaultModes: Record<string, 'web' | 'forward'>;
  providerInputMaxChars: Record<string, number | null>;
  providerForwardBaseUrls: Record<string, string>;
  providerApiKeys: Record<string, string>;
  providerApiKeyMasked: Record<string, string>;
  onSave: (payload: { provider: string; models: string[]; defaultMode: 'web' | 'forward'; inputMaxChars: number | null; forwardBaseUrl: string; apiKey?: string }) => Promise<void>;
  servicePort: number;
  serviceStatus: string;
  onSaveServiceSettings: (payload: { servicePort: number }) => Promise<void>;
  promptConfig: {
    init_prompt: string;
    init_prompt_template: string;
    user_message_template: string;
    response_schema_template: string;
    format_only_retry_template: string;
  };
  onSavePromptConfig: (payload: {
    init_prompt: string;
    init_prompt_template: string;
    user_message_template: string;
    response_schema_template: string;
    format_only_retry_template: string;
  }) => Promise<void>;
  onError: (message: string) => void;
}) {
  const normalizeModels = (text: string): string[] =>
    text
      .split(/[\n,]/g)
      .map((item) => item.trim())
      .filter((item) => item.length > 0);

  const [rows, setRows] = useState<Record<string, {
    modelsText: string;
    defaultMode: 'web' | 'forward';
    inputMaxCharsDraft: string;
    forwardBaseUrl: string;
    apiKeyValue: string;
    apiKeyDraft: string;
    apiKeyReveal: boolean;
    saving: boolean;
    message: string;
  }>>({});
  const [servicePortDraft, setServicePortDraft] = useState(String(servicePort));
  const [servicePortSaving, setServicePortSaving] = useState(false);
  const [servicePortMessage, setServicePortMessage] = useState('');
  const servicePortSaveIntentRef = useRef(false);
  const servicePortBlurPendingRef = useRef(false);
  const servicePortBlurTimerRef = useRef<number | null>(null);
  const servicePortInputRef = useRef<HTMLInputElement | null>(null);
  const configScrollRef = useRef<HTMLDivElement | null>(null);

  const [promptDraft, setPromptDraft] = useState(promptConfig);
  const [promptSaving, setPromptSaving] = useState(false);
  const [promptMessage, setPromptMessage] = useState('');

  useEffect(() => {
    setPromptDraft(promptConfig);
  }, [promptConfig]);

  useEffect(() => {
    setServicePortDraft(String(servicePort));
  }, [servicePort]);

  useEffect(() => {
    if (serviceStatus !== 'running') return;
    configScrollRef.current?.scrollTo({ top: 0 });
  }, [serviceStatus]);

  const promptChanged =
    promptDraft.init_prompt !== promptConfig.init_prompt ||
    promptDraft.init_prompt_template !== promptConfig.init_prompt_template ||
    promptDraft.user_message_template !== promptConfig.user_message_template ||
    promptDraft.response_schema_template !== promptConfig.response_schema_template ||
    promptDraft.format_only_retry_template !== promptConfig.format_only_retry_template;

  const handlePromptSave = async () => {
    if (!promptChanged) return;
    setPromptSaving(true);
    setPromptMessage('');
    try {
      await onSavePromptConfig(promptDraft);
      setPromptMessage('已保存');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      onError(message);
      setPromptMessage(`保存失败: ${message}`);
    } finally {
      setPromptSaving(false);
    }
  };

  useEffect(() => {
    const providers = [...PROVIDER_KEYS];
    setRows((prev) => {
      const next: Record<string, {
        modelsText: string;
        defaultMode: 'web' | 'forward';
        inputMaxCharsDraft: string;
        forwardBaseUrl: string;
        apiKeyValue: string;
        apiKeyDraft: string;
        apiKeyReveal: boolean;
        saving: boolean;
        message: string;
      }> = {};
      for (const provider of providers) {
        const current = prev[provider];
        const baseApiKey = providerApiKeys[provider] ?? '';
        const baseMode = providerDefaultModes[provider] ?? 'web';
        const baseMaxChars = providerInputMaxChars[provider];
        const baseMaxCharsText = typeof baseMaxChars === 'number' ? String(baseMaxChars) : '';
        next[provider] = {
          modelsText: current?.modelsText ?? (providerModels[provider] ?? []).join(', '),
          defaultMode: current?.defaultMode ?? baseMode,
          inputMaxCharsDraft: current?.inputMaxCharsDraft ?? baseMaxCharsText,
          forwardBaseUrl: current?.forwardBaseUrl ?? (providerForwardBaseUrls[provider] ?? ''),
          apiKeyValue: current?.apiKeyValue ?? baseApiKey,
          apiKeyDraft: current?.apiKeyDraft ?? baseApiKey,
          apiKeyReveal: current?.apiKeyReveal ?? false,
          saving: false,
          message: current?.message ?? '',
        };
      }
      return next;
    });
  }, [providerSites, providerModels, providerDefaultModes, providerInputMaxChars, providerForwardBaseUrls, providerApiKeys, providerApiKeyMasked]);

  const updateRow = (provider: string, patch: Partial<{
    modelsText: string;
    defaultMode: 'web' | 'forward';
    inputMaxCharsDraft: string;
    forwardBaseUrl: string;
    apiKeyValue: string;
    apiKeyDraft: string;
    apiKeyReveal: boolean;
    saving: boolean;
    message: string;
  }>) => {
    setRows((prev) => ({
      ...prev,
      [provider]: {
        ...(prev[provider] ?? {
          modelsText: '',
          defaultMode: 'web',
          inputMaxCharsDraft: '',
          forwardBaseUrl: '',
          apiKeyValue: '',
          apiKeyDraft: '',
          apiKeyReveal: false,
          saving: false,
          message: '',
        }),
        ...patch,
      },
    }));
  };

  const getModelsParseResult = (provider: string): { list: string[]; error: string } => {
    const row = rows[provider];
    if (!row) return { list: [], error: '' };
    const list = normalizeModels(row.modelsText);
    if (row.modelsText.trim().length === 0) {
      return { list, error: 'models 不能为空' };
    }
    if (list.length === 0) {
      return { list, error: 'models 解析失败，请用逗号或换行分隔' };
    }
    return { list, error: '' };
  };

  const getBaseUrlError = (provider: string): string => {
    const row = rows[provider];
    if (!row) return '';
    const baseRaw = (providerForwardBaseUrls[provider] ?? '').trim();
    const raw = row.forwardBaseUrl.trim();
    const changed = raw !== baseRaw;
    if (!changed) return '';
    if (!raw) return '';
    try {
      const u = new URL(raw);
      if (!/^https?:$/.test(u.protocol)) return 'base_url 必须是 http/https';
      return '';
    } catch {
      return 'base_url 不是合法 URL';
    }
  };

  const getInputMaxCharsError = (provider: string): string => {
    const row = rows[provider];
    if (!row) return '';
    const base = providerInputMaxChars[provider];
    const baseText = typeof base === 'number' ? String(base) : '';
    const raw = row.inputMaxCharsDraft.trim();
    if (raw === baseText) return '';
    if (raw === '') return '';
    if (!/^\d+$/.test(raw)) return '最大字符数必须是整数';
    const value = Number(raw);
    if (!Number.isInteger(value) || value <= 0) return '最大字符数必须 > 0';
    return '';
  };

  const parseInputMaxChars = (provider: string): number | null => {
    const row = rows[provider];
    if (!row) return null;
    const raw = row.inputMaxCharsDraft.trim();
    if (!raw) return null;
    const value = Number(raw);
    return Number.isInteger(value) && value > 0 ? value : null;
  };

  const handleSave = async (provider: string) => {
    const row = rows[provider];
    if (!row) return;
    if (!hasChanges(provider)) return;
    const modelsParsed = getModelsParseResult(provider);
    const baseUrlError = getBaseUrlError(provider);
    const maxCharsError = getInputMaxCharsError(provider);
    if (modelsParsed.error || baseUrlError || maxCharsError) {
      updateRow(provider, { message: modelsParsed.error || baseUrlError || maxCharsError });
      return;
    }
    updateRow(provider, { saving: true, message: '' });
    try {
      const models = modelsParsed.list;
      const apiKeyChanged = row.apiKeyDraft.trim() !== row.apiKeyValue.trim();
      await onSave({
        provider,
        models,
        defaultMode: row.defaultMode,
        inputMaxChars: parseInputMaxChars(provider),
        forwardBaseUrl: row.forwardBaseUrl.trim(),
        apiKey: apiKeyChanged ? row.apiKeyDraft.trim() : undefined,
      });
      updateRow(provider, {
        saving: false,
        message: '已保存',
        modelsText: models.join(', '),
        inputMaxCharsDraft: parseInputMaxChars(provider) == null ? '' : String(parseInputMaxChars(provider)),
        forwardBaseUrl: row.forwardBaseUrl.trim(),
        apiKeyValue: row.apiKeyDraft.trim(),
        apiKeyDraft: row.apiKeyDraft.trim(),
        apiKeyReveal: false,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      onError(message);
      updateRow(provider, { saving: false, message: `保存失败: ${message}` });
    }
  };

  const hasChanges = (provider: string): boolean => {
    const row = rows[provider];
    if (!row) return false;
    const nextModels = normalizeModels(row.modelsText).join('\n');
    const baseModels = (providerModels[provider] ?? []).map((item) => item.trim()).filter(Boolean).join('\n');
    const nextMode = row.defaultMode;
    const baseMode = providerDefaultModes[provider] ?? 'web';
    const nextMaxChars = row.inputMaxCharsDraft.trim();
    const baseMaxChars = providerInputMaxChars[provider];
    const baseMaxCharsText = typeof baseMaxChars === 'number' ? String(baseMaxChars) : '';
    const nextBaseUrl = row.forwardBaseUrl.trim();
    const baseBaseUrl = (providerForwardBaseUrls[provider] ?? '').trim();
    const apiKeyChanged = row.apiKeyDraft.trim() !== row.apiKeyValue.trim();
    return nextModels !== baseModels || nextMode !== baseMode || nextMaxChars !== baseMaxCharsText || nextBaseUrl !== baseBaseUrl || apiKeyChanged;
  };

  const servicePortChanged = servicePortDraft.trim() !== String(servicePort);
  const servicePortError = (() => {
    if (!servicePortChanged) return '';
    if (!/^\d+$/.test(servicePortDraft.trim())) return '端口必须是整数';
    const value = Number(servicePortDraft.trim());
    if (!Number.isInteger(value) || value < 1 || value > 65535) return '端口范围必须在 1-65535';
    return '';
  })();

  const handleServicePortSave = async () => {
    if (!servicePortChanged || servicePortError) return;
    servicePortSaveIntentRef.current = false;
    servicePortBlurPendingRef.current = false;
    if (servicePortBlurTimerRef.current != null) {
      window.clearTimeout(servicePortBlurTimerRef.current);
      servicePortBlurTimerRef.current = null;
    }
    const raw = (servicePortInputRef.current?.value ?? servicePortDraft).trim();
    const value = Number(raw);
    const confirmed = window.confirm(`确认修改 WebClawProxy 端口为 ${value} 吗？将会自动重启服务。`);
    if (!confirmed) {
      setServicePortDraft(String(servicePort));
      return;
    }
    setServicePortSaving(true);
    setServicePortMessage('');
    try {
      await onSaveServiceSettings({ servicePort: value });
      setServicePortDraft(String(value));
      if (serviceStatus === 'running' || serviceStatus === 'starting' || serviceStatus === 'stopping') {
        await window.webclawDesktop?.stopService?.();
      }
      await window.webclawDesktop?.resetBrowser?.();
      await window.webclawDesktop?.startService?.();
      setServicePortMessage('已保存并重启服务');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      onError(message);
      setServicePortMessage(`保存失败: ${message}`);
    } finally {
      setServicePortSaving(false);
    }
  };

  return (
    <div className="panel-shell config-shell">
      <div className="config-scroll-all" ref={configScrollRef}>
        <div className="panel-box">
          <div className="detail-list mono">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
              <span>WebClawProxy 端口:</span>
              <input
                ref={servicePortInputRef}
                className={`mono ${servicePortError ? 'input-invalid' : ''}`}
                style={{ width: 110 }}
                value={servicePortDraft}
                onChange={(e) => {
                  setServicePortDraft(e.target.value);
                  setServicePortMessage('');
                  servicePortBlurPendingRef.current = false;
                  if (servicePortBlurTimerRef.current != null) {
                    window.clearTimeout(servicePortBlurTimerRef.current);
                    servicePortBlurTimerRef.current = null;
                  }
                }}
                onFocus={() => {
                  servicePortBlurPendingRef.current = false;
                  if (servicePortBlurTimerRef.current != null) {
                    window.clearTimeout(servicePortBlurTimerRef.current);
                    servicePortBlurTimerRef.current = null;
                  }
                }}
                onBlur={(event) => {
                  if (servicePortSaving) return;
                  if (servicePortSaveIntentRef.current) return;
                  const next = event.relatedTarget as HTMLElement | null;
                  if (next?.dataset?.action === 'save-port') return;
                  servicePortBlurPendingRef.current = true;
                  const capturedDraft = servicePortDraft;
                  if (servicePortBlurTimerRef.current != null) {
                    window.clearTimeout(servicePortBlurTimerRef.current);
                  }
                  servicePortBlurTimerRef.current = window.setTimeout(() => {
                    servicePortBlurTimerRef.current = null;
                    if (!servicePortBlurPendingRef.current) return;
                    if (servicePortSaving) return;
                    if (capturedDraft !== servicePortDraft) return;
                    if (servicePortDraft.trim() !== String(servicePort)) {
                      setServicePortDraft(String(servicePort));
                      setServicePortMessage('');
                    }
                  }, 0);
                }}
                placeholder="3000"
              />
              <button
                className="primary"
                type="button"
                data-action="save-port"
                onMouseDownCapture={(event) => {
                  event.preventDefault();
                  servicePortSaveIntentRef.current = true;
                  servicePortBlurPendingRef.current = false;
                  if (servicePortBlurTimerRef.current != null) {
                    window.clearTimeout(servicePortBlurTimerRef.current);
                    servicePortBlurTimerRef.current = null;
                  }
                }}
                onClick={() => void handleServicePortSave()}
                disabled={servicePortSaving || !servicePortChanged || Boolean(servicePortError)}
              >
                {servicePortSaving ? '保存中...' : '保存端口'}
              </button>
            </div>
            {servicePortError ? <div className="config-error mono">{servicePortError}</div> : null}
            {servicePortMessage ? <div className="mono" style={{ marginTop: 4, opacity: 0.8 }}>{servicePortMessage}</div> : null}
          </div>
        </div>

        {serviceStatus === 'running' ? (
          <>
            <div className="table-wrap">
              <table className="config-table">
              <thead>
                <tr>
                  <th>Provider</th>
                  <th>Site</th>
                  <th>Models</th>
                  <th>Default Mode</th>
                  <th>Max Chars</th>
                  <th>Forward Base URL</th>
                  <th>API Key</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {PROVIDER_KEYS.map((provider) => (
                  <tr key={provider}>
                    <td>{provider}</td>
                    <td className="mono">{providerSites[provider] ?? ''}</td>
                    <td>
                      {(() => {
                        const modelsError = getModelsParseResult(provider).error;
                        return (
                      <input
                        className={`mono ${modelsError ? 'input-invalid' : ''}`}
                        value={rows[provider]?.modelsText ?? (providerModels[provider] ?? []).join(', ')}
                        onChange={(e) => updateRow(provider, { modelsText: e.target.value })}
                        onBlur={(event) => {
                          if (rows[provider]?.saving) return;
                          const next = event.relatedTarget as HTMLElement | null;
                          if (next?.dataset?.action === 'save-provider' && next?.dataset?.provider === provider) return;
                          const base = (providerModels[provider] ?? []).join(', ');
                          if ((rows[provider]?.modelsText ?? '') !== base) {
                            updateRow(provider, { modelsText: base, message: '' });
                          }
                        }}
                        placeholder="逗号分隔模型"
                      />
                        );
                      })()}
                      {getModelsParseResult(provider).error ? (
                        <div className="config-error mono">{getModelsParseResult(provider).error}</div>
                      ) : null}
                    </td>
                    <td>
                      <select
                        className="mono"
                        value={rows[provider]?.defaultMode ?? (providerDefaultModes[provider] ?? 'web')}
                        onChange={(e) => updateRow(provider, { defaultMode: e.target.value as 'web' | 'forward' })}
                        onBlur={(event) => {
                          if (rows[provider]?.saving) return;
                          const next = event.relatedTarget as HTMLElement | null;
                          if (next?.dataset?.action === 'save-provider' && next?.dataset?.provider === provider) return;
                          const base = providerDefaultModes[provider] ?? 'web';
                          if ((rows[provider]?.defaultMode ?? base) !== base) {
                            updateRow(provider, { defaultMode: base, message: '' });
                          }
                        }}
                      >
                        <option value="web">web</option>
                        <option value="forward">forward</option>
                      </select>
                    </td>
                    <td>
                      <input
                        className={`mono ${getInputMaxCharsError(provider) ? 'input-invalid' : ''}`}
                        value={rows[provider]?.inputMaxCharsDraft ?? (typeof providerInputMaxChars[provider] === 'number' ? String(providerInputMaxChars[provider]) : '')}
                        onChange={(e) => updateRow(provider, { inputMaxCharsDraft: e.target.value })}
                        onBlur={(event) => {
                          if (rows[provider]?.saving) return;
                          const next = event.relatedTarget as HTMLElement | null;
                          if (next?.dataset?.action === 'save-provider' && next?.dataset?.provider === provider) return;
                          const base = typeof providerInputMaxChars[provider] === 'number' ? String(providerInputMaxChars[provider]) : '';
                          if ((rows[provider]?.inputMaxCharsDraft ?? '') !== base) {
                            updateRow(provider, { inputMaxCharsDraft: base, message: '' });
                          }
                        }}
                        placeholder="(empty)"
                      />
                      {getInputMaxCharsError(provider) ? (
                        <div className="config-error mono">{getInputMaxCharsError(provider)}</div>
                      ) : null}
                    </td>
                    <td>
                      <input
                        className={`mono ${getBaseUrlError(provider) ? 'input-invalid' : ''}`}
                        value={rows[provider]?.forwardBaseUrl ?? providerForwardBaseUrls[provider] ?? ''}
                        onChange={(e) => updateRow(provider, { forwardBaseUrl: e.target.value })}
                        onBlur={(event) => {
                          if (rows[provider]?.saving) return;
                          const next = event.relatedTarget as HTMLElement | null;
                          if (next?.dataset?.action === 'save-provider' && next?.dataset?.provider === provider) return;
                          const base = providerForwardBaseUrls[provider] ?? '';
                          if ((rows[provider]?.forwardBaseUrl ?? '') !== base) {
                            updateRow(provider, { forwardBaseUrl: base, message: '' });
                          }
                        }}
                        placeholder="https://api.example.com"
                      />
                      {getBaseUrlError(provider) ? (
                        <div className="config-error mono">{getBaseUrlError(provider)}</div>
                      ) : null}
                    </td>
                    <td>
                      <input
                        className="mono"
                        value={
                          rows[provider]?.apiKeyReveal
                            ? (rows[provider]?.apiKeyDraft ?? '')
                            : ((rows[provider]?.apiKeyDraft?.trim() || providerApiKeyMasked[provider]) ? '****' : '')
                        }
                        placeholder="粘贴后自动掩码"
                        onMouseEnter={() => updateRow(provider, { apiKeyReveal: true })}
                        onMouseLeave={() => updateRow(provider, { apiKeyReveal: false })}
                        onFocus={() => updateRow(provider, { apiKeyReveal: true })}
                        onPaste={(e) => {
                          e.preventDefault();
                          const text = e.clipboardData.getData('text');
                          updateRow(provider, { apiKeyDraft: text, apiKeyReveal: false });
                        }}
                        onChange={(e) => {
                          updateRow(provider, { apiKeyDraft: e.target.value });
                        }}
                        onBlur={(event) => {
                          if (rows[provider]?.saving) return;
                          const next = event.relatedTarget as HTMLElement | null;
                          if (next?.dataset?.action === 'save-provider' && next?.dataset?.provider === provider) return;
                          const base = rows[provider]?.apiKeyValue ?? '';
                          if ((rows[provider]?.apiKeyDraft ?? '') !== base) {
                            updateRow(provider, { apiKeyDraft: base, apiKeyReveal: false, message: '' });
                            return;
                          }
                          updateRow(provider, { apiKeyReveal: false });
                        }}
                      />
                    </td>
                    <td>
                      <button
                        className="primary"
                        type="button"
                        data-action="save-provider"
                        data-provider={provider}
                        onClick={() => void handleSave(provider)}
                        disabled={
                          rows[provider]?.saving ||
                          !hasChanges(provider) ||
                          Boolean(getModelsParseResult(provider).error) ||
                          Boolean(getInputMaxCharsError(provider)) ||
                          Boolean(getBaseUrlError(provider))
                        }
                      >
                        {rows[provider]?.saving ? '保存中...' : '保存'}
                      </button>
                      <div className="mono" style={{ marginTop: 4, opacity: 0.8 }}>
                        {rows[provider]?.message ?? ''}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
              </table>
            </div>

            <div className="prompt-grid">
              <div className="panel-box prompt-card">
                <div className="prompt-card-head mono">
                  <div className="prompt-card-title">init_prompt</div>
                  <div className="prompt-card-actions">
                    {promptMessage ? <div className="prompt-card-message">{promptMessage}</div> : null}
                    <button
                      className="primary"
                      type="button"
                      data-action="save-prompt"
                      onClick={() => void handlePromptSave()}
                      disabled={promptSaving || !promptChanged}
                    >
                      {promptSaving ? '保存中...' : '保存'}
                    </button>
                  </div>
                </div>
                <textarea
                  className="mono"
                  rows={8}
                  value={promptDraft.init_prompt}
                  onChange={(e) => setPromptDraft((prev) => ({ ...prev, init_prompt: e.target.value }))}
                  onBlur={(event) => {
                    const next = event.relatedTarget as HTMLElement | null;
                    if (next?.dataset?.action === 'save-prompt') return;
                    if (promptDraft.init_prompt !== promptConfig.init_prompt) {
                      setPromptDraft((prev) => ({ ...prev, init_prompt: promptConfig.init_prompt }));
                    }
                  }}
                />
              </div>

              <div className="panel-box prompt-card">
                <div className="prompt-card-head mono">
                  <div className="prompt-card-title">init_prompt_template</div>
                  <div className="prompt-card-actions">
                    {promptMessage ? <div className="prompt-card-message">{promptMessage}</div> : null}
                    <button
                      className="primary"
                      type="button"
                      data-action="save-prompt"
                      onClick={() => void handlePromptSave()}
                      disabled={promptSaving || !promptChanged}
                    >
                      {promptSaving ? '保存中...' : '保存'}
                    </button>
                  </div>
                </div>
                <textarea
                  className="mono"
                  rows={8}
                  value={promptDraft.init_prompt_template}
                  onChange={(e) => setPromptDraft((prev) => ({ ...prev, init_prompt_template: e.target.value }))}
                  onBlur={(event) => {
                    const next = event.relatedTarget as HTMLElement | null;
                    if (next?.dataset?.action === 'save-prompt') return;
                    if (promptDraft.init_prompt_template !== promptConfig.init_prompt_template) {
                      setPromptDraft((prev) => ({ ...prev, init_prompt_template: promptConfig.init_prompt_template }));
                    }
                  }}
                />
              </div>

              <div className="panel-box prompt-card">
                <div className="prompt-card-head mono">
                  <div className="prompt-card-title">user_message_template</div>
                  <div className="prompt-card-actions">
                    {promptMessage ? <div className="prompt-card-message">{promptMessage}</div> : null}
                    <button
                      className="primary"
                      type="button"
                      data-action="save-prompt"
                      onClick={() => void handlePromptSave()}
                      disabled={promptSaving || !promptChanged}
                    >
                      {promptSaving ? '保存中...' : '保存'}
                    </button>
                  </div>
                </div>
                <textarea
                  className="mono"
                  rows={6}
                  value={promptDraft.user_message_template}
                  onChange={(e) => setPromptDraft((prev) => ({ ...prev, user_message_template: e.target.value }))}
                  onBlur={(event) => {
                    const next = event.relatedTarget as HTMLElement | null;
                    if (next?.dataset?.action === 'save-prompt') return;
                    if (promptDraft.user_message_template !== promptConfig.user_message_template) {
                      setPromptDraft((prev) => ({ ...prev, user_message_template: promptConfig.user_message_template }));
                    }
                  }}
                />
              </div>

              <div className="panel-box prompt-card">
                <div className="prompt-card-head mono">
                  <div className="prompt-card-title">response_schema_template</div>
                  <div className="prompt-card-actions">
                    {promptMessage ? <div className="prompt-card-message">{promptMessage}</div> : null}
                    <button
                      className="primary"
                      type="button"
                      data-action="save-prompt"
                      onClick={() => void handlePromptSave()}
                      disabled={promptSaving || !promptChanged}
                    >
                      {promptSaving ? '保存中...' : '保存'}
                    </button>
                  </div>
                </div>
                <textarea
                  className="mono"
                  rows={4}
                  value={promptDraft.response_schema_template}
                  onChange={(e) => setPromptDraft((prev) => ({ ...prev, response_schema_template: e.target.value }))}
                  onBlur={(event) => {
                    const next = event.relatedTarget as HTMLElement | null;
                    if (next?.dataset?.action === 'save-prompt') return;
                    if (promptDraft.response_schema_template !== promptConfig.response_schema_template) {
                      setPromptDraft((prev) => ({ ...prev, response_schema_template: promptConfig.response_schema_template }));
                    }
                  }}
                />
              </div>

              <div className="panel-box prompt-card">
                <div className="prompt-card-head mono">
                  <div className="prompt-card-title">format_only_retry_template</div>
                  <div className="prompt-card-actions">
                    {promptMessage ? <div className="prompt-card-message">{promptMessage}</div> : null}
                    <button
                      className="primary"
                      type="button"
                      data-action="save-prompt"
                      onClick={() => void handlePromptSave()}
                      disabled={promptSaving || !promptChanged}
                    >
                      {promptSaving ? '保存中...' : '保存'}
                    </button>
                  </div>
                </div>
                <textarea
                  className="mono"
                  rows={6}
                  value={promptDraft.format_only_retry_template}
                  onChange={(e) => setPromptDraft((prev) => ({ ...prev, format_only_retry_template: e.target.value }))}
                  onBlur={(event) => {
                    const next = event.relatedTarget as HTMLElement | null;
                    if (next?.dataset?.action === 'save-prompt') return;
                    if (promptDraft.format_only_retry_template !== promptConfig.format_only_retry_template) {
                      setPromptDraft((prev) => ({ ...prev, format_only_retry_template: promptConfig.format_only_retry_template }));
                    }
                  }}
                />
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="panel-box">
              <div className="detail-list mono">
                <div>Provider 配置：启动 WebClawProxy 服务后可查看和编辑</div>
              </div>
            </div>
            <div className="panel-box">
              <div className="detail-list mono">
                <div>提示词配置：启动 WebClawProxy 服务后可查看和编辑</div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function ErrorPanel({ errors }: { errors: string[] }) {
  return (
    <div className="panel-shell">
      <div className="panel-box provider-detail">
        <div className="panel-title">错误</div>
        <div className="log-list">
          {errors.length === 0 ? (
            <div className="log-line mono">暂无错误</div>
          ) : (
            errors.map((error, index) => (
              <div key={`${index}-${error}`} className="log-line mono">{error}</div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
