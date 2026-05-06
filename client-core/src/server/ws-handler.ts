import { WebSocket } from 'ws';
import { AgentSession, AgentEvent } from './agent-session';
import { SessionManager } from './routes';

/**
 * WebSocket 事件处理
 *
 * 每个 WebSocket 连接可能绑定一个 AgentSession。
 * 前端通过 WebSocket 发送指令，服务端通过 WebSocket 推送事件。
 */
export function handleWebSocketConnection(ws: WebSocket, sessionsManager: SessionManager): void {
  let boundSession: AgentSession | null = null;

  // 为此 WebSocket 连接创建一个新 session（或绑定已有 session）
  const session = sessionsManager.getDefault() ?? sessionsManager.create();
  boundSession = session;

  // 设置事件回调：core 内部事件通过 WebSocket 推送给前端
  session.setEventCallback((event: AgentEvent) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(event));
    }
  });

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

async function handleChat(ws: WebSocket, session: AgentSession, data: any): void {
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

async function handleNewSession(ws: WebSocket, sessionsManager: SessionManager, data: any): void {
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