import { WebSocket } from 'ws';
import { AgentSession, AgentEvent } from './agent-session';
import { SessionManager } from './routes';

/**
 * WebSocket 事件处理
 *
 * 事件通过 SessionManager.broadcastEvent 广播到所有已连接的 WebSocket，
 * 而不是绑定到特定 session。这样 HTTP /v1/chat 触发的工具事件
 * 也能推送到已连接的前端。
 */
export function handleWebSocketConnection(ws: WebSocket, sessionsManager: SessionManager): void {
  // 注册到 SessionManager 以接收事件广播
  sessionsManager.registerWs(ws);

  // 默认 session（如果还不存在则创建）
  const session = sessionsManager.getDefault() ?? sessionsManager.create();

  ws.on('message', async (raw: any) => {
    try {
      const data = JSON.parse(String(raw));
      const { type } = data;

      switch (type) {
        case 'chat':
          await handleChat(ws, session, data);
          break;

        case 'new_session':
          await handleNewSession(ws, sessionsManager, data);
          break;

        case 'set_config':
          handleSetConfig(session, data);
          break;

        case 'get_state':
          ws.send(JSON.stringify({
            type: 'state',
            data: session.getState(),
            sessionId: session.getSessionId(),
            timestamp: Date.now(),
          }));
          break;

        case 'ping':
          ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
          break;

        default:
          ws.send(JSON.stringify({
            type: 'error',
            data: { message: `Unknown message type: ${type}` },
            timestamp: Date.now(),
          }));
      }
    } catch (err: any) {
      ws.send(JSON.stringify({
        type: 'error',
        data: { message: err.message ?? String(err) },
        timestamp: Date.now(),
      }));
    }
  });

  ws.on('close', () => {
    // WebSocket 断开时不销毁 session（session 可能被 REST API 重新使用）
    boundSession = null;
  });

  ws.on('error', () => {
    boundSession = null;
  });

  // 发送初始状态
  ws.send(JSON.stringify({
    type: 'connected',
    data: { sessionId: session.getSessionId() },
    timestamp: Date.now(),
  }));
}

async function handleChat(ws: WebSocket, session: AgentSession, data: any): Promise<void> {
  const { message, model, system, mode } = data;

  if (!message) {
    ws.send(JSON.stringify({ type: 'error', data: { message: 'message is required' }, timestamp: Date.now() }));
    return;
  }

  if (model) session.setModel(model);
  if (system) session.setSystem(system);
  if (mode) session.setMode(mode);

  try {
    const result = await session.chat(message);

    ws.send(JSON.stringify({
      type: result.kind === 'chat' ? 'chat_response' : 'command_result',
      data: result,
      sessionId: session.getSessionId(),
      timestamp: Date.now(),
    }));
  } catch (err: any) {
    ws.send(JSON.stringify({
      type: 'error',
      data: { message: err.message ?? String(err) },
      sessionId: session.getSessionId(),
      timestamp: Date.now(),
    }));
  }
}

async function handleNewSession(ws: WebSocket, sessionsManager: SessionManager, data: any): Promise<void> {
  const { model, system, mode, proxyBaseUrl } = data;
  const newSession = sessionsManager.create({ proxyBaseUrl, model, system, mode });

  // 重新绑定此 WebSocket 到新 session
  newSession.setEventCallback((event: AgentEvent) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(event));
    }
  });

  ws.send(JSON.stringify({
    type: 'session_created',
    data: { sessionId: newSession.getSessionId() },
    timestamp: Date.now(),
  }));
}

function handleSetConfig(session: AgentSession, data: any): void {
  const { model, system, mode } = data;
  if (model) session.setModel(model);
  if (system) session.setSystem(system);
  if (mode) session.setMode(mode);
}