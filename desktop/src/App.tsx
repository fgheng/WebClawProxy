import { useEffect, useMemo, useState } from 'react';

type WorkspaceTabKey = 'logs' | 'terminal' | 'trace' | 'sessions' | 'errors';

const tabs: { key: WorkspaceTabKey; label: string }[] = [
  { key: 'logs', label: '服务日志' },
  { key: 'terminal', label: '终端' },
  { key: 'trace', label: '请求追踪' },
  { key: 'sessions', label: '会话状态' },
  { key: 'errors', label: '错误' },
];

const terminalLines = [
  '~/Workspace/WebClawProxy',
  '$ npm run dev',
  '[server] listening on 3000',
  '[WebDriver] 启动打开站点：gpt -> https://chatgpt.com/',
  '[WebDriver] 启动打开站点：qwen -> https://chat.qwen.ai/',
];

const requests = [
  { id: 'req-1776101', provider: 'gpt', status: 'running' },
  { id: 'req-1776102', provider: 'qwen', status: 'success' },
  { id: 'req-1776103', provider: 'kimi', status: 'failed' },
  { id: 'req-1776104', provider: 'glm', status: 'queued' },
];

const providerRows = [
  ['gpt', 'busy', '1', 'req-1776101', 'https://chatgpt.com/c/xxx'],
  ['qwen', 'idle', '0', '-', 'https://chat.qwen.ai/c/yyy'],
  ['deepseek', 'idle', '0', '-', 'https://chat.deepseek.com/'],
  ['kimi', 'busy', '2', 'req-1776108', 'https://www.kimi.com/'],
  ['glm', 'idle', '0', '-', 'https://chatglm.cn/'],
];

const errors = [
  '12:03:11  qwen   SEND_MESSAGE_FAILED',
  '12:04:22  glm    RESPONSE_EXTRACTION_FAILED',
  '12:05:01  gpt    waitForDispatch timeout',
];

export default function App() {
  const [activeTab, setActiveTab] = useState<WorkspaceTabKey>('logs');
  const [currentProvider, setCurrentProvider] = useState('gpt');
  const [providerSites, setProviderSites] = useState<Record<string, string>>({});
  const [serviceStatus, setServiceStatus] = useState('stopped');
  const [serviceLogs, setServiceLogs] = useState<string[]>([
    '等待服务日志...',
  ]);

  useEffect(() => {
    let mounted = true;
    void window.webclawDesktop?.getDesktopState?.().then((state) => {
      if (!mounted || !state) return;
      setCurrentProvider((state.currentProvider as string | null) ?? 'gpt');
      setProviderSites(state.providerSites);
      setServiceStatus(state.serviceStatus);
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
    });

    return () => {
      mounted = false;
      disposeLog?.();
      disposeStatus?.();
    };
  }, []);

  async function handleProviderChange(provider: string) {
    setCurrentProvider(provider);
    await window.webclawDesktop?.selectProvider?.(provider);
  }

  async function handleStartService() {
    const result = await window.webclawDesktop?.startService?.();
    if (result?.status) setServiceStatus(result.status);
  }

  async function handleStopService() {
    const result = await window.webclawDesktop?.stopService?.();
    if (result?.status) setServiceStatus(result.status);
  }

  async function handleRestartService() {
    const result = await window.webclawDesktop?.restartService?.();
    if (result?.status) setServiceStatus(result.status);
  }

  const panel = useMemo(() => {
    switch (activeTab) {
      case 'logs':
        return <ServiceLogsPanel logLines={serviceLogs} />;
      case 'terminal':
        return <TerminalPanel />;
      case 'trace':
        return <RequestTracePanel />;
      case 'sessions':
        return <SessionStatePanel />;
      case 'errors':
        return <ErrorPanel />;
      default:
        return null;
    }
  }, [activeTab, serviceLogs]);

  return (
    <div className="console-shell">
      <div className="main-split-pane">
        <section className="browser-workspace">
          <div className="browser-toolbar">
            <div className="toolbar-left">
              <select value={currentProvider} onChange={(e) => void handleProviderChange(e.target.value)}>
                {Object.keys(providerSites).map((provider) => (
                  <option key={provider} value={provider}>
                    {provider}
                  </option>
                ))}
              </select>
              <button>返回</button>
              <button>前进</button>
              <button>刷新</button>
              <button>主页</button>
            </div>

            <div className="toolbar-right">
              <button onClick={() => void window.webclawDesktop?.openBrowserDevTools?.()}>DevTools</button>
              <button
                onClick={() => void window.webclawDesktop?.openExternal?.(providerSites[currentProvider] ?? '')}
              >
                外部打开
              </button>
            </div>
          </div>

          <div className="browser-pane" />
        </section>

        <section className="bottom-workspace">
          <div className="workspace-tabs">
            <div className="tabs-left">
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

            <div className="tabs-actions">
              {serviceStatus === 'running' ? (
                <>
                  <button className="icon-button" title="停止服务" onClick={() => void handleStopService()}>
                    ■
                  </button>
                  <button className="icon-button" title="重启服务" onClick={() => void handleRestartService()}>
                    ↻
                  </button>
                </>
              ) : serviceStatus === 'starting' || serviceStatus === 'stopping' ? (
                <button className="icon-button" title="服务处理中" disabled>
                  ...
                </button>
              ) : (
                <button className="icon-button" title="启动服务" onClick={() => void handleStartService()}>
                  ▶
                </button>
              )}
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

function ServiceLogsPanel({ logLines }: { logLines: string[] }) {
  return (
    <div className="panel-shell">
      <div className="panel-toolbar">
        <select>
          <option>all</option>
          <option>info</option>
          <option>warn</option>
          <option>error</option>
          <option>debug</option>
        </select>
        <select>
          <option>all providers</option>
          <option>gpt</option>
          <option>qwen</option>
          <option>deepseek</option>
          <option>kimi</option>
          <option>glm</option>
        </select>
        <input placeholder="搜索日志..." />
        <label className="checkbox-inline"><input type="checkbox" defaultChecked /> Auto Scroll</label>
      </div>

      <div className="log-list">
        {logLines.map((line, index) => (
          <div key={`${index}-${line}`} className="log-line mono">{line}</div>
        ))}
      </div>
    </div>
  );
}

function TerminalPanel() {
  return (
    <div className="panel-shell">
      <div className="panel-toolbar">
        <button>新建终端</button>
        <button>发送 Ctrl+C</button>
        <button>清屏</button>
      </div>

      <div className="terminal-view mono">
        {terminalLines.map((line) => (
          <div key={line}>{line}</div>
        ))}
      </div>
    </div>
  );
}

function RequestTracePanel() {
  return (
    <div className="trace-grid">
      <div className="trace-list panel-box">
        <div className="panel-title">Request List</div>
        {requests.map((item) => (
          <div key={item.id} className="trace-item">
            <span className="mono">{item.id}</span>
            <span>{item.provider}</span>
            <span className="badge">{item.status}</span>
          </div>
        ))}
      </div>

      <div className="trace-detail panel-box">
        <div className="panel-title">Request Detail</div>
        <div className="detail-list mono">
          <div>Provider : gpt</div>
          <div>Model    : gpt-4o</div>
          <div>Session  : https://chatgpt.com/c/demo</div>
          <div>Request  : req-1776101</div>
          <div>------------------------------</div>
          <div>[1] request_received</div>
          <div>[2] init_conversation</div>
          <div>[3] wait_page_ready</div>
          <div>[4] send_message</div>
          <div>[5] wait_for_response</div>
          <div>[6] extract_response</div>
        </div>
      </div>
    </div>
  );
}

function SessionStatePanel() {
  return (
    <div className="panel-shell session-panel">
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Provider</th>
              <th>Status</th>
              <th>Queue</th>
              <th>Locked By</th>
              <th>Current URL</th>
            </tr>
          </thead>
          <tbody>
            {providerRows.map((row) => (
              <tr key={row[0]}>
                {row.map((cell) => (
                  <td key={cell} className={cell.startsWith('https://') ? 'mono' : undefined}>{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="panel-box provider-detail">
        <div className="panel-title">Selected Provider Detail</div>
        <div className="detail-list mono">
          <div>Last request id: req-1776101</div>
          <div>Last error     : none</div>
          <div>Driver ready   : true</div>
          <div>Page visible   : true</div>
          <div>Lock age       : 12s</div>
        </div>
      </div>
    </div>
  );
}

function ErrorPanel() {
  return (
    <div className="trace-grid">
      <div className="panel-box">
        <div className="panel-title">Error List</div>
        <div className="log-list">
          {errors.map((error) => (
            <div key={error} className="log-line mono">{error}</div>
          ))}
        </div>
      </div>

      <div className="panel-box">
        <div className="panel-title">Error Detail</div>
        <div className="detail-list mono">
          <div>Request : req-1776107007763</div>
          <div>Provider: qwen</div>
          <div>Code    : SEND_MESSAGE_FAILED</div>
          <div>Cause   : page.fill timeout on readonly ime-text-area</div>
          <div>Stack   : at QwenDriver.fillInputRobustly(...)</div>
        </div>
      </div>
    </div>
  );
}
