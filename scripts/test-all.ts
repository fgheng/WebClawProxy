/**
 * 统一功能测试程序
 *
 * 直接运行：npm run script:all
 * 或：npx ts-node scripts/test-all.ts
 *
 * 支持通过命令行参数选择测试模式：
 * --mode=mock   使用 mock 数据，不需要真实浏览器（默认）
 * --mode=real   使用真实浏览器（需要登录）
 * --site=gpt    指定测试网站（real 模式有效）
 */

import { OpenAIProtocol } from '../src/protocol';
import { DataManager } from '../src/data-manager/DataManager';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as readline from 'readline';

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';

// 解析命令行参数
const args = process.argv.slice(2);
const mode = args.find((a) => a.startsWith('--mode='))?.split('=')[1] ?? 'mock';
const siteArg = args.find((a) => a.startsWith('--site='))?.split('=')[1] ?? 'deepseek';

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
  details?: string;
}

const results: TestResult[] = [];

async function runTest(name: string, fn: () => Promise<void> | void): Promise<void> {
  try {
    await fn();
    console.log(`  ${GREEN}✓${RESET} ${name}`);
    results.push({ name, passed: true });
  } catch (err) {
    const error = (err as Error).message;
    console.log(`  ${RED}✗${RESET} ${name}`);
    console.log(`    ${RED}错误: ${error}${RESET}`);
    results.push({ name, passed: false, error });
  }
}

// ============================
// Mock 模式测试
// ============================
async function runMockTests() {
  let tmpDir = '';
  const protocol = new OpenAIProtocol();

  console.log(`\n${BOLD}${CYAN}╔══════════════════════════════════════════╗${RESET}`);
  console.log(`${BOLD}${CYAN}║     WebClawProxy 统一功能测试（Mock）      ║${RESET}`);
  console.log(`${BOLD}${CYAN}╚══════════════════════════════════════════╝${RESET}\n`);

  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'webclaw-all-test-'));

  // 完整的 OpenAI 测试请求
  const openAIRequest = {
    model: 'gpt-5.2',
    messages: [
      {
        role: 'system',
        content: 'You are a personal assistant running inside OpenClaw.\n',
      },
      {
        role: 'user',
        content: [{ type: 'text', text: '你好' }],
      },
    ],
    stream: false,
    store: false,
    max_completion_tokens: 8192,
    tools: [
      {
        type: 'function',
        function: {
          name: 'read',
          description: 'Read the contents of a file.',
          parameters: {
            type: 'object',
            required: ['path'],
            properties: {
              path: { description: 'Path to the file', type: 'string' },
              offset: { description: 'Line number to start', type: 'number' },
              limit: { description: 'Max lines to read', type: 'number' },
            },
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'memory_get',
          description: 'Safe snippet read from MEMORY.md',
          parameters: {
            type: 'object',
            required: ['path'],
            properties: {
              path: { type: 'string' },
              from: { type: 'number' },
              lines: { type: 'number' },
            },
          },
        },
      },
    ],
    parallel_tool_calls: true,
  };

  // ===========================
  console.log(`${YELLOW}[Step 1] 协议转换模块测试${RESET}`);

  let internalReq: ReturnType<typeof protocol.parse> | null = null;

  await runTest('解析 OpenAI 请求', () => {
    internalReq = protocol.parse(openAIRequest);
    if (!internalReq) throw new Error('解析结果为空');
  });

  await runTest('model 字段提取正确', () => {
    if (internalReq!.model !== 'gpt-5.2') {
      throw new Error(`model 应为 gpt-5.2，实际为 ${internalReq!.model}`);
    }
  });

  await runTest('system 字段提取正确', () => {
    if (!internalReq!.system.includes('personal assistant')) {
      throw new Error('system 字段提取不正确');
    }
  });

  await runTest('history 不包含 system 消息', () => {
    internalReq!.history.forEach((m) => {
      if (m.role === 'system') throw new Error('history 中包含 system 消息');
    });
  });

  await runTest('current 是最后一条非 system 消息', () => {
    if (internalReq!.current.role !== 'user') {
      throw new Error(`current.role 应为 user`);
    }
  });

  await runTest('tools 包含 2 个工具', () => {
    if (internalReq!.tools.length !== 2) {
      throw new Error(`tools 应有 2 个，实际有 ${internalReq!.tools.length}`);
    }
  });

  await runTest('格式化 OpenAI 响应', () => {
    const resp = protocol.format(
      'gpt-5.2',
      { content: '你好！有什么可以帮你？' },
      { prompt_tokens: 50, completion_tokens: 10, total_tokens: 60 }
    ) as any;
    if (!resp.id || !resp.choices || resp.choices[0].message.content !== '你好！有什么可以帮你？') {
      throw new Error('响应格式不正确');
    }
  });

  // ===========================
  console.log(`\n${YELLOW}[Step 2] 数据管理模块测试${RESET}`);

  let dm: DataManager | null = null;

  await runTest('初始化 DataManager', () => {
    dm = new DataManager(internalReq!, {
      rootDir: tmpDir,
      models: {
        GPT: ['gpt-4', 'gpt-4o', 'gpt-5', 'gpt-5.1', 'gpt-5.2'],
        DEEPSEEK: ['deepseek-chat', 'deepseek-r1'],
      },
      responseSchemaTemplate: '{"answer": "test"}',
    });
    if (!dm.HASH_KEY || !dm.DATA_PATH) throw new Error('HASH_KEY 或 DATA_PATH 为空');
    console.log(`    ${DIM}DATA_PATH: ${dm.DATA_PATH}${RESET}`);
  });

  await runTest('保存对话数据', async () => {
    await dm!.save_data();
    if (!fs.existsSync(dm!.DATA_PATH)) throw new Error('数据目录未创建');
  });

  await runTest('is_linked() 初始返回 false', () => {
    if (dm!.is_linked()) throw new Error('初始状态不应该是已链接');
  });

  await runTest('update_web_url + is_linked() 返回 true', () => {
    dm!.update_web_url('https://chatgpt.com/c/test-session-001');
    if (!dm!.is_linked()) throw new Error('更新 web_url 后应该是已链接');
  });

  await runTest('get_web_url() 返回正确 URL', () => {
    const url = dm!.get_web_url();
    if (url !== 'https://chatgpt.com/c/test-session-001') {
      throw new Error(`URL 不正确: ${url}`);
    }
  });

  await runTest('get_system_prompt() 格式正确', () => {
    const p = dm!.get_system_prompt();
    if (!p.includes('<|system|>')) throw new Error('缺少 <|system|> 标记');
  });

  await runTest('get_tools_prompt() 包含工具信息', () => {
    const p = dm!.get_tools_prompt();
    if (!p.includes('Tool 1') || !p.includes('read')) throw new Error('工具信息不完整');
    console.log(`    ${DIM}tools prompt 前 80 字符: ${p.substring(0, 80)}...${RESET}`);
  });

  await runTest('get_init_prompt() 包含所有部分', () => {
    const p = dm!.get_init_prompt();
    if (!p.includes('{"answer": "test"}')) throw new Error('缺少 response_schema_template');
    if (!p.includes('<|system|>')) throw new Error('缺少 system_prompt');
    console.log(`    ${DIM}init prompt 长度: ${p.length} 字符${RESET}`);
  });

  await runTest('get_current_prompt_with_template() 格式正确', () => {
    const p = dm!.get_current_prompt_with_template();
    if (!p.includes('{"answer": "test"}')) throw new Error('缺少 response_schema_template');
  });

  await runTest('update_current() 更新当前消息', () => {
    dm!.update_current({ role: 'assistant', content: '新的回复内容' });
    const p = dm!.get_current_prompt();
    if (p !== '新的回复内容') throw new Error(`current_prompt 不正确: ${p}`);
  });

  await runTest('cancel_linked() 取消链接', () => {
    dm!.cancel_linked();
    if (dm!.is_linked()) throw new Error('cancel_linked 后应该是未链接');
  });

  // ===========================
  console.log(`\n${YELLOW}[Step 3] 完整流程模拟（Mock）${RESET}`);

  await runTest('模拟控制模块完整流程', async () => {
    // 步骤 1：解析请求
    const req = protocol.parse({
      model: 'deepseek-chat',
      messages: [
        { role: 'system', content: '你是一个专业的 TypeScript 开发工程师' },
        { role: 'user', content: '请用 TypeScript 实现一个简单的计数器类' },
      ],
    });

    // 步骤 2：初始化 DataManager
    const testDm = new DataManager(req, {
      rootDir: tmpDir,
      models: { DEEPSEEK: ['deepseek-chat'], GPT: ['gpt-4o'] },
      responseSchemaTemplate: '{"result": "..."}',
    });
    await testDm.save_data();

    // 步骤 3：判断链接状态，获取初始化 prompt
    if (!testDm.is_linked()) {
      const initPrompt = testDm.get_init_prompt();
      console.log(`    ${DIM}init prompt 长度: ${initPrompt.length} 字符${RESET}`);

      // 模拟 web driver 返回的 URL
      testDm.update_web_url('https://chat.deepseek.com/a/chat/s/mock-session-001');
    }

    // 步骤 4：发送当前消息
    const currentPrompt = testDm.get_current_prompt();
    console.log(`    ${DIM}current prompt: ${currentPrompt.substring(0, 50)}...${RESET}`);

    // 步骤 5：模拟模型响应（JSON 格式）
    const mockResponse = JSON.stringify({
      id: 'chatcmpl-mock123',
      object: 'chat.completion',
      created: Date.now(),
      model: 'deepseek-chat',
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content:
              '```typescript\nclass Counter {\n  private count: number = 0;\n  increment() { this.count++; }\n  decrement() { this.count--; }\n  getCount() { return this.count; }\n}\n```',
          },
          logprobs: null,
          finish_reason: 'stop',
        },
      ],
      usage: { prompt_tokens: 50, completion_tokens: 80, total_tokens: 130 },
    });

    // 步骤 6：更新 current 并保存
    testDm.update_current({ role: 'assistant', content: mockResponse });
    await testDm.save_data();

    console.log(`    ${DIM}完整流程模拟成功！${RESET}`);
  });

  // 清理临时目录
  fs.rmSync(tmpDir, { recursive: true, force: true });

  return printSummary();
}

// ============================
// Real 模式测试
// ============================
async function runRealTests() {
  const { WebDriverManager } = await import('../src/web-driver/WebDriverManager');
  const { WebDriverError, WebDriverErrorCode } = await import('../src/web-driver/types');
  const { OpenAIProtocol } = await import('../src/protocol');

  const protocol = new OpenAIProtocol();
  const manager = new WebDriverManager({ headless: false });

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const q = (prompt: string) => new Promise<string>((resolve) => rl.question(prompt, resolve));

  console.log(`\n${BOLD}${CYAN}╔══════════════════════════════════════════╗${RESET}`);
  console.log(`${BOLD}${CYAN}║   WebClawProxy 统一功能测试（真实浏览器）   ║${RESET}`);
  console.log(`${BOLD}${CYAN}╚══════════════════════════════════════════╝${RESET}\n`);
  console.log(`${YELLOW}目标网站: ${siteArg}${RESET}`);
  console.log(`${YELLOW}注意：需要用户已登录目标网站${RESET}\n`);

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'webclaw-real-test-'));
  const site = siteArg as any;

  try {
    // 步骤 1：解析请求
    console.log(`${YELLOW}[Step 1] 解析 OpenAI 请求${RESET}`);
    const internalReq = protocol.parse({
      model: site === 'gpt' ? 'gpt-4o' : `${site}-chat`,
      messages: [
        { role: 'system', content: '你是一个专业的 AI 助手，请简洁回答问题。' },
        { role: 'user', content: '你好，这是 WebClawProxy 的集成测试，请简短回复"测试成功"。' },
      ],
    });
    console.log(`  ${GREEN}✓${RESET} 解析成功 - model: ${internalReq.model}`);

    // 步骤 2：初始化 DataManager
    console.log(`\n${YELLOW}[Step 2] 初始化数据管理器${RESET}`);
    const dm = new DataManager(internalReq, {
      rootDir: tmpDir,
      models: {
        GPT: ['gpt-4o', 'gpt-4o-chat'],
        DEEPSEEK: ['deepseek-chat', 'deepseek-r1'],
        QWEN: ['qwen-max'],
        KIMI: ['kimi'],
      },
    });
    await dm.save_data();
    console.log(`  ${GREEN}✓${RESET} DataManager 初始化完成`);

    // 步骤 3：对话初始化
    console.log(`\n${YELLOW}[Step 3] 初始化 Web 对话${RESET}`);
    console.log(`  （如果未登录，请在弹出的浏览器中完成登录）`);

    const initPrompt = dm.get_init_prompt();
    let sessionUrl: string;
    try {
      const initResult = await manager.initConversation(site, initPrompt);
      sessionUrl = initResult.url;
      dm.update_web_url(sessionUrl);
      console.log(`  ${GREEN}✓${RESET} 对话初始化成功`);
      console.log(`    URL: ${sessionUrl}`);
    } catch (err: any) {
      console.log(`  ${RED}✗${RESET} 对话初始化失败: ${err.message}`);
      throw err;
    }

    // 步骤 4：发送消息
    console.log(`\n${YELLOW}[Step 4] 发送消息并等待响应${RESET}`);
    const currentPrompt = dm.get_current_prompt();

    let chatResult: { content: string };
    try {
      chatResult = await manager.chat(site, sessionUrl, currentPrompt);
      console.log(`  ${GREEN}✓${RESET} 获取到模型响应`);
      console.log(`\n  ${CYAN}模型回复：${RESET}`);
      console.log('  ' + '-'.repeat(60));
      console.log('  ' + chatResult.content.replace(/\n/g, '\n  '));
      console.log('  ' + '-'.repeat(60));
    } catch (err: any) {
      console.log(`  ${RED}✗${RESET} 获取响应失败: ${err.message}`);
      throw err;
    }

    // 步骤 5：更新数据
    dm.update_current({ role: 'assistant', content: chatResult.content });
    await dm.save_data();
    console.log(`\n  ${GREEN}✓${RESET} 数据更新成功`);

    console.log(`\n${BOLD}${GREEN}✓ 完整集成测试通过！${RESET}`);

  } finally {
    await manager.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
    rl.close();
  }
}

// ============================
// 输出测试汇总
// ============================
function printSummary() {
  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;

  console.log('\n' + '═'.repeat(50));
  console.log(`${BOLD}测试汇总：${RESET}`);
  console.log(`  总计：${results.length}`);
  console.log(`  ${GREEN}通过：${passed}${RESET}`);
  if (failed > 0) {
    console.log(`  ${RED}失败：${failed}${RESET}`);
    console.log(`\n${RED}失败的测试：${RESET}`);
    results.filter((r) => !r.passed).forEach((r) => {
      console.log(`  - ${r.name}: ${r.error}`);
    });
  } else {
    console.log(`  ${GREEN}所有测试通过！🎉${RESET}`);
  }
  console.log('═'.repeat(50) + '\n');

  if (failed > 0) {
    process.exit(1);
  }
}

// ============================
// 入口
// ============================
if (mode === 'real') {
  runRealTests().catch((err) => {
    console.error(`${RED}测试运行失败:${RESET}`, err);
    process.exit(1);
  });
} else {
  runMockTests().catch((err) => {
    console.error(`${RED}测试运行失败:${RESET}`, err);
    process.exit(1);
  });
}
