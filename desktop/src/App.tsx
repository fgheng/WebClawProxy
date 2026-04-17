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

const MIN_BROWSER_HEIGHT = 360;
const MIN_PANEL_HEIGHT = 280;
const SPLIT_DIVIDER_HEIGHT = 8;

export default function App() {
  const [activeTab, setActiveTab] = useState<WorkspaceTabKey>('webclaw');
  const [currentProvider, setCurrentProvider] = useState('gpt');
  const [displayMode, setDisplayMode] = useState<'web' | 'forward'>('web');
  const [providerSites, setProviderSites] = useState<Record<string, string>>({});
  const [providerModels, setProviderModels] = useState<Record<string, string[]>>({});
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
  const [logTypeFilter, setLogTypeFilter] = useState('all');
  const [logProviderFilter, setLogProviderFilter] = useState('all');
  const [logSearch, setLogSearch] = useState('');
  const [logAutoScroll, setLogAutoScroll] = useState(true);
  const [errors, setErrors] = useState<string[]>([]);
  const [terminalMenuOpen, setTerminalMenuOpen] = useState(false);
  const [terminalInited, setTerminalInited] = useState(false);
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
    void window.webclawDesktop?.navigateBrowser?.('http://127.0.0.1:3000/monitor');
  }, [displayMode, serviceStatus]);

  useEffect(() => {
    let mounted = true;
    void window.webclawDesktop?.getDesktopState?.().then((state) => {
      if (!mounted || !state) return;
      setCurrentProvider((state.currentProvider as string | null) ?? 'gpt');
      setProviderSites(state.providerSites);
      setProviderModels(state.providerModels);
      setServiceStatus(state.serviceStatus);
      setApiBaseUrl(state.apiBaseUrl);
      
      // ✅ 延迟设置 ready 状态，等待 BrowserView 初始化完成
      // 避免用户在初始化期间点击按钮导致冲突
      setTimeout(() => {
        if (mounted) setServiceControlReady(true);
      }, 500);
    });

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
    });
    const disposeError = window.webclawDesktop?.onServiceError?.((event) => {
      const line = `${new Date(event.timestamp).toLocaleTimeString()} [FAIL] ${event.message}`;
      setServiceLogs((prev) => [...prev, line].slice(-300));
      pushError(event.message);
      window.alert(event.message);
    });
    const disposeTerminalOutput = window.webclawDesktop?.onTerminalOutput?.((event) => {
      setTerminalsById((prev) => {
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
    }
    setTerminalsById(nextById);
    setActiveTerminalId(state?.activeTerminalId ?? terminals[0]?.terminalId ?? null);
    setTerminalInited(true);
  }, [terminalInited]);

  const syncBrowserBounds = useCallback(() => {
    const pane = browserPaneRef.current;
    if (!pane) return;
    const rect = pane.getBoundingClientRect();
    void window.webclawDesktop?.setBrowserBounds?.({
      x: Math.round(rect.left),
      y: Math.round(rect.top),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    });
  }, []);

  useEffect(() => {
    window.localStorage.setItem('webclaw:split-ratio', String(splitRatio));
    const raf = window.requestAnimationFrame(syncBrowserBounds);
    return () => window.cancelAnimationFrame(raf);
  }, [splitRatio, syncBrowserBounds]);

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
    const onResize = () => syncBrowserBounds();
    window.addEventListener('resize', onResize);
    const observer = new ResizeObserver(() => {
      const container = splitPaneRef.current;
      if (container) {
        const rect = container.getBoundingClientRect();
        const minRatio = Math.min(0.72, Math.max(0.42, MIN_BROWSER_HEIGHT / rect.height));
        const maxRatio = Math.max(minRatio, Math.min(0.72, 1 - MIN_PANEL_HEIGHT / rect.height));
        setSplitRatio((prev) => Math.min(maxRatio, Math.max(minRatio, prev)));
      }
      syncBrowserBounds();
    });
    if (browserPaneRef.current) observer.observe(browserPaneRef.current);
    if (splitPaneRef.current) observer.observe(splitPaneRef.current);
    const raf = window.requestAnimationFrame(syncBrowserBounds);
    return () => {
      window.removeEventListener('resize', onResize);
      observer?.disconnect();
      window.cancelAnimationFrame(raf);
    };
  }, [syncBrowserBounds]);

  const handleProviderChange = useCallback(async (provider: string) => {
    setCurrentProvider(provider);
    // ✅ 只有在 web 模式下才切换 BrowserView
    // forward 模式下切换 provider 应该停留在 forward 界面
    if (displayMode === 'web') {
      await window.webclawDesktop?.selectProvider?.(provider);
    }
  }, [displayMode]);

  const handleStartService = useCallback(async () => {
    await window.webclawDesktop?.startService?.();
  }, []);

  const handleStopService = useCallback(async () => {
    await window.webclawDesktop?.stopService?.();
  }, []);

  const handleToggleService = useCallback(async () => {
    if (!serviceControlReady) return;
    if (serviceStatus === 'running') {
      const confirmed = window.confirm('确认停止 WebClaw 服务吗？');
      if (!confirmed) return;
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

  const panel = useMemo(() => {
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
      case 'webclaw':
        return (
          <WebClawPanel
            apiBaseUrl={apiBaseUrl}
            currentProvider={currentProvider}
            displayMode={displayMode}
            providerModels={providerModels}
            serviceStatus={serviceStatus}
            onProviderChange={handleProviderChange}
            onError={pushError}
          />
        );
      case 'config':
        return <ConfigPanel apiBaseUrl={apiBaseUrl} providerModels={providerModels} providerSites={providerSites} />;
      case 'terminal':
        return (
          <TerminalPanel
            terminals={Object.values(terminalsById)}
            activeTerminalId={activeTerminalId}
            onSelectTerminal={(terminalId) => {
              setActiveTerminalId(terminalId);
            }}
            onCloseTerminal={async (terminalId) => {
              const confirmed = window.confirm(`确认关闭终端 ${terminalId} 吗？`);
              if (!confirmed) return;
              const res = await window.webclawDesktop?.closeTerminal?.(terminalId);
              if (!res?.closed) return;
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
  }, [activeTab, apiBaseUrl, currentProvider, displayMode, errors, handleProviderChange, logAutoScroll, logProviderFilter, logSearch, logTypeFilter, providerModels, providerSites, pushError, serviceLogs, serviceStatus, terminalsById, activeTerminalId, createTerminalAndFocus]);

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
                disabled={!serviceControlReady}
              >
                {Object.keys(providerSites).map((provider) => (
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
                      void window.webclawDesktop?.navigateBrowser?.('http://127.0.0.1:3000/monitor');
                    } else {
                      pushError('WebClaw 服务未启动，无法加载 Forward Monitor（需要 3000 端口服务运行）');
                    }
                  } else {
                    void window.webclawDesktop?.selectProvider?.(currentProvider);
                  }
                }}
                title="切换 web / forward 模式（forward 模式会自动连接服务）"
              >
                <option value="web">web</option>
                <option value="forward">forward</option>
              </select>
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
            </div>
          </div>

          <div className="workspace-panel">{panel}</div>
        </section>
      </div>

      <footer className="bottom-action-bar">
        <div className="footer-status mono">
          Service: {serviceStatus} | API: 3000 | CDP: 9222 | Provider: {currentProvider} | Queue: --
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
        background: '#0b1220',
        foreground: '#e2e8f0',
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
  apiBaseUrl,
  providerModels,
  providerSites,
}: {
  apiBaseUrl: string;
  providerModels: Record<string, string[]>;
  providerSites: Record<string, string>;
}) {
  return (
    <div className="panel-shell">
      <div className="panel-box">
        <div className="panel-title">当前配置</div>
        <div className="detail-list mono">
          <div>API Base URL: {apiBaseUrl}</div>
          <div>Provider Count: {Object.keys(providerSites).length}</div>
        </div>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Provider</th>
              <th>Site</th>
              <th>Models</th>
            </tr>
          </thead>
          <tbody>
            {Object.keys(providerSites).map((provider) => (
              <tr key={provider}>
                <td>{provider}</td>
                <td className="mono">{providerSites[provider]}</td>
                <td className="mono">{(providerModels[provider] ?? []).join(', ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
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
