import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { WebClawPanel } from './panels/WebClawPanel';

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
  const [providerSites, setProviderSites] = useState<Record<string, string>>({});
  const [providerModels, setProviderModels] = useState<Record<string, string[]>>({});
  const [serviceStatus, setServiceStatus] = useState('stopped');
  const [apiBaseUrl, setApiBaseUrl] = useState('http://127.0.0.1:3000');
  const [serviceLogs, setServiceLogs] = useState<string[]>([
    '等待服务日志...',
  ]);
  const [terminalLines, setTerminalLines] = useState<string[]>([]);
  const [terminalStatus, setTerminalStatus] = useState('stopped');
  const [terminalShell, setTerminalShell] = useState('/bin/zsh');
  const [terminalCwd, setTerminalCwd] = useState('/Users/fgh001/Workspace/WebClawProxy');
  const [terminalPid, setTerminalPid] = useState<number | null>(null);
  const [logTypeFilter, setLogTypeFilter] = useState('all');
  const [logProviderFilter, setLogProviderFilter] = useState('all');
  const [logSearch, setLogSearch] = useState('');
  const [logAutoScroll, setLogAutoScroll] = useState(true);
  const [errors, setErrors] = useState<string[]>([]);
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

  useEffect(() => {
    let mounted = true;
    void window.webclawDesktop?.getDesktopState?.().then((state) => {
      if (!mounted || !state) return;
      setCurrentProvider((state.currentProvider as string | null) ?? 'gpt');
      setProviderSites(state.providerSites);
      setProviderModels(state.providerModels);
      setServiceStatus(state.serviceStatus);
      setApiBaseUrl(state.apiBaseUrl);
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
      const prefix = event.stream === 'stderr' ? '[ERR ]' : event.stream === 'system' ? '[SYS ]' : '';
      const lines = event.message
        .split(/\r?\n/)
        .filter((line) => line.length > 0)
        .map((line) => `${prefix}${line}`);
      if (lines.length === 0) return;
      setTerminalLines((prev) => [...prev, ...lines].slice(-500));
    });
    const disposeTerminalStatus = window.webclawDesktop?.onTerminalStatus?.((event) => {
      setTerminalStatus(event.status);
      setTerminalShell(event.shell);
      setTerminalCwd(event.cwd);
      setTerminalPid(event.pid);
    });
    void window.webclawDesktop?.initTerminal?.().then((state) => {
      if (!mounted || !state) return;
      setTerminalStatus(state.status);
      setTerminalShell(state.shell);
      setTerminalCwd(state.cwd);
      setTerminalPid(state.pid);
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
    await window.webclawDesktop?.selectProvider?.(provider);
  }, []);

  const handleStartService = useCallback(async () => {
    await window.webclawDesktop?.startService?.();
  }, []);

  const handleStopService = useCallback(async () => {
    await window.webclawDesktop?.stopService?.();
  }, []);

  const handleToggleService = useCallback(async () => {
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
  }, [handleStartService, handleStopService, serviceStatus]);

  const handleTerminalCommand = useCallback(async (command: string) => {
    const trimmed = command.trim();
    if (!trimmed) return;
    setTerminalLines((prev) => [...prev, `$ ${trimmed}`].slice(-500));
    try {
      await window.webclawDesktop?.writeTerminal?.(trimmed);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setTerminalLines((prev) => [...prev, `[ERR ] ${message}`].slice(-500));
      pushError(message);
    }
  }, [pushError]);

  const handleTerminalInterrupt = useCallback(async () => {
    setTerminalLines((prev) => [...prev, '^C'].slice(-500));
    await window.webclawDesktop?.interruptTerminal?.();
  }, []);

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
            lines={terminalLines}
            status={terminalStatus}
            shell={terminalShell}
            cwd={terminalCwd}
            pid={terminalPid}
            onRunCommand={handleTerminalCommand}
            onInterrupt={handleTerminalInterrupt}
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
  }, [activeTab, apiBaseUrl, currentProvider, errors, handleProviderChange, handleTerminalCommand, handleTerminalInterrupt, logAutoScroll, logProviderFilter, logSearch, logTypeFilter, providerModels, providerSites, pushError, serviceLogs, serviceStatus, terminalCwd, terminalLines, terminalPid, terminalShell, terminalStatus]);

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
                title={serviceStatus === 'running' ? '停止服务' : serviceStatus === 'starting' ? '正在启动' : '启动服务'}
                disabled={serviceStatus === 'starting' || serviceStatus === 'stopping'}
              >
                <span
                  className={`service-toggle-ring ${
                    serviceStatus === 'running'
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
                      serviceStatus === 'running'
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
              >
                {Object.keys(providerSites).map((provider) => (
                  <option key={provider} value={provider}>
                    {provider}
                  </option>
                ))}
              </select>
              {tabs.map((tab) => (
                <button
                  key={tab.key}
                  className={tab.key === activeTab ? 'tab active' : 'tab'}
                  onClick={() => setActiveTab(tab.key)}
                >
                  {tab.label}
                </button>
              ))}
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
  lines,
  status,
  shell,
  cwd,
  pid,
  onRunCommand,
  onInterrupt,
}: {
  lines: string[];
  status: string;
  shell: string;
  cwd: string;
  pid: number | null;
  onRunCommand: (command: string) => Promise<void>;
  onInterrupt: () => Promise<void>;
}) {
  const terminalRef = useRef<HTMLDivElement | null>(null);
  const [command, setCommand] = useState('');

  useEffect(() => {
    const container = terminalRef.current;
    if (!container) return;
    container.scrollTop = container.scrollHeight;
  }, [lines]);

  async function handleSubmit() {
    const value = command.trim();
    if (!value) return;
    setCommand('');
    await onRunCommand(value);
  }

  return (
    <div className="panel-shell terminal-panel">
      <div className="panel-toolbar">
        <span className="terminal-badge mono">{shell}</span>
        <span className="terminal-status mono">status: {status}</span>
        <span className="terminal-status mono">pid: {pid ?? '-'}</span>
      </div>

      <div className="terminal-view mono" ref={terminalRef}>
        <div className="terminal-line terminal-line-muted">{cwd}</div>
        {lines.map((line, index) => (
          <div key={`${index}-${line}`} className="terminal-line">{line}</div>
        ))}
      </div>

      <div className="terminal-inputbar">
        <div className="terminal-prompt mono">$</div>
        <input
          value={command}
          placeholder="输入命令并回车执行"
          onChange={(e) => setCommand(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void handleSubmit();
            }
          }}
        />
        <button onClick={() => void handleSubmit()} disabled={!command.trim()}>执行</button>
        <button onClick={() => void onInterrupt()}>Ctrl+C</button>
      </div>
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
