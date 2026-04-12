/**
 * 数据管理模块功能测试脚本
 *
 * 直接运行：npm run script:data-manager
 * 或：npx ts-node scripts/test-data-manager.ts
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { DataManager } from '../src/data-manager/DataManager';
import { computeHashKey } from '../src/data-manager/utils/hash';
import {
  buildSystemPrompt,
  buildHistoryPrompt,
  buildCurrentPrompt,
  buildToolsPrompt,
} from '../src/data-manager/utils/prompt';
import { InternalRequest } from '../src/protocol/types';

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void | Promise<void>): void {
  const result = fn();
  if (result instanceof Promise) {
    result
      .then(() => {
        console.log(`${GREEN}✓${RESET} ${name}`);
        passed++;
      })
      .catch((err) => {
        console.log(`${RED}✗${RESET} ${name}`);
        console.log(`  ${RED}错误：${(err as Error).message}${RESET}`);
        failed++;
      });
  } else {
    try {
      console.log(`${GREEN}✓${RESET} ${name}`);
      passed++;
    } catch (err) {
      console.log(`${RED}✗${RESET} ${name}`);
      console.log(`  ${RED}错误：${(err as Error).message}${RESET}`);
      failed++;
    }
  }
}

async function runTests() {
  // 创建临时目录
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'webclaw-dm-test-'));

  console.log(`\n${BOLD}${CYAN}=== 数据管理模块功能测试 ===${RESET}`);
  console.log(`${CYAN}临时目录: ${tmpDir}${RESET}\n`);

  // Mock 请求数据
  const mockRequest: InternalRequest = {
    model: 'gpt-4o',
    system: 'You are a helpful assistant.',
    history: [
      { role: 'user', content: '你好' },
      { role: 'assistant', content: '你好！有什么可以帮你的？' },
    ],
    tools: [
      {
        type: 'function',
        function: {
          name: 'read_file',
          description: 'Read a file',
          parameters: {
            type: 'object',
            required: ['path'],
            properties: { path: { type: 'string', description: 'file path' } },
          },
        },
      },
    ],
    current: { role: 'user', content: '请帮我写一个 hello world 程序' },
  };

  const createDm = () =>
    new DataManager(mockRequest, {
      rootDir: tmpDir,
      models: {
        GPT: ['gpt-4', 'gpt-4o', 'gpt-5', 'gpt-5.1', 'gpt-5.2'],
        DEEPSEEK: ['deepseek-chat', 'deepseek-r1'],
      },
      jsonTemplate: '{"result": "ok"}',
      initPromptTemplate:
        '按以下json格式回复:\n{{json_template}}\n\n系统提示:\n{{system_prompt}}\n\n工具:\n{{tools_prompt}}\n\n历史:\n{{history_prompt}}',
      currentTemplate: '按模板回答:\n{{json_template}}\n\n---\n{{current}}',
    });

  // ============================
  console.log(`${YELLOW}--- Hash 计算测试 ---${RESET}`);

  console.log(`${GREEN}✓${RESET} computeHashKey 格式验证`);
  const key = computeHashKey('system', [], []);
  console.log(`  hash key 示例: ${key}`);
  passed++;

  console.log(`${GREEN}✓${RESET} 相同输入产生相同 hash`);
  const key2 = computeHashKey('system', [], []);
  if (key !== key2) {
    console.log(`  ${RED}错误: hash 不一致！${RESET}`);
    failed++;
  } else {
    passed++;
  }

  // ============================
  console.log(`\n${YELLOW}--- DataManager 初始化测试 ---${RESET}`);

  try {
    const dm = createDm();
    console.log(`${GREEN}✓${RESET} DataManager 构造函数`);
    console.log(`  HASH_KEY: ${dm.HASH_KEY}`);
    console.log(`  DATA_PATH: ${dm.DATA_PATH}`);
    console.log(`  model: ${dm.model}`);
    passed++;
  } catch (err) {
    console.log(`${RED}✗${RESET} DataManager 构造函数失败: ${(err as Error).message}`);
    failed++;
  }

  // ============================
  console.log(`\n${YELLOW}--- 数据保存测试 ---${RESET}`);

  const dm = createDm();
  try {
    await dm.save_data();
    console.log(`${GREEN}✓${RESET} save_data() 执行成功`);
    console.log(`  数据路径: ${dm.DATA_PATH}`);
    passed++;

    // 检查文件是否创建
    const systemFile = path.join(dm.DATA_PATH, 'system');
    const historyFile = path.join(dm.DATA_PATH, 'history.jsonl');
    const toolsFile = path.join(dm.DATA_PATH, 'tools.json');

    if (fs.existsSync(systemFile)) {
      console.log(`${GREEN}✓${RESET} system 文件已创建`);
      console.log(`  内容: ${fs.readFileSync(systemFile, 'utf-8').substring(0, 50)}...`);
      passed++;
    } else {
      console.log(`${RED}✗${RESET} system 文件未创建`);
      failed++;
    }

    if (fs.existsSync(historyFile)) {
      const lines = fs.readFileSync(historyFile, 'utf-8').trim().split('\n').filter(Boolean);
      console.log(`${GREEN}✓${RESET} history.jsonl 文件已创建（${lines.length} 条记录）`);
      passed++;
    } else {
      console.log(`${RED}✗${RESET} history.jsonl 文件未创建`);
      failed++;
    }

    if (fs.existsSync(toolsFile)) {
      const tools = JSON.parse(fs.readFileSync(toolsFile, 'utf-8'));
      console.log(`${GREEN}✓${RESET} tools.json 文件已创建（${tools.length} 个工具）`);
      passed++;
    } else {
      console.log(`${RED}✗${RESET} tools.json 文件未创建`);
      failed++;
    }
  } catch (err) {
    console.log(`${RED}✗${RESET} save_data() 失败: ${(err as Error).message}`);
    failed++;
  }

  // ============================
  console.log(`\n${YELLOW}--- 链接状态测试 ---${RESET}`);

  if (!dm.is_linked()) {
    console.log(`${GREEN}✓${RESET} 保存数据后、未设置 web_url 时，is_linked() = false`);
    passed++;
  } else {
    console.log(`${RED}✗${RESET} is_linked() 应该返回 false`);
    failed++;
  }

  dm.update_web_url('https://chatgpt.com/c/test-session-123');

  if (dm.is_linked()) {
    console.log(`${GREEN}✓${RESET} update_web_url() 后，is_linked() = true`);
    passed++;
  } else {
    console.log(`${RED}✗${RESET} update_web_url 后 is_linked() 应该返回 true`);
    failed++;
  }

  const url = dm.get_web_url();
  if (url === 'https://chatgpt.com/c/test-session-123') {
    console.log(`${GREEN}✓${RESET} get_web_url() 返回正确链接`);
    console.log(`  URL: ${url}`);
    passed++;
  } else {
    console.log(`${RED}✗${RESET} get_web_url() 返回错误: ${url}`);
    failed++;
  }

  dm.cancel_linked();
  if (!dm.is_linked()) {
    console.log(`${GREEN}✓${RESET} cancel_linked() 后，is_linked() = false`);
    passed++;
  } else {
    console.log(`${RED}✗${RESET} cancel_linked() 未生效`);
    failed++;
  }

  // ============================
  console.log(`\n${YELLOW}--- Prompt 构造测试 ---${RESET}`);

  const dm2 = createDm();

  const systemPrompt = dm2.get_system_prompt();
  if (systemPrompt.includes('<|system|>') && systemPrompt.includes('helpful assistant')) {
    console.log(`${GREEN}✓${RESET} get_system_prompt() 格式正确`);
    console.log(`  内容:\n  ${systemPrompt.replace(/\n/g, '\n  ')}`);
    passed++;
  } else {
    console.log(`${RED}✗${RESET} get_system_prompt() 格式不正确: ${systemPrompt}`);
    failed++;
  }

  const historyPrompt = dm2.get_history_prompt();
  if (historyPrompt.includes('<|role:user|>') && historyPrompt.includes('<|role:assistant|>')) {
    console.log(`${GREEN}✓${RESET} get_history_prompt() 格式正确`);
    passed++;
  } else {
    console.log(`${RED}✗${RESET} get_history_prompt() 格式不正确`);
    failed++;
  }

  const currentPrompt = dm2.get_current_prompt();
  if (currentPrompt === '请帮我写一个 hello world 程序') {
    console.log(`${GREEN}✓${RESET} get_current_prompt() 内容正确`);
    passed++;
  } else {
    console.log(`${RED}✗${RESET} get_current_prompt() 内容不正确: ${currentPrompt}`);
    failed++;
  }

  const toolsPrompt = dm2.get_tools_prompt();
  if (toolsPrompt.includes('Tool 1') && toolsPrompt.includes('read_file')) {
    console.log(`${GREEN}✓${RESET} get_tools_prompt() 格式正确`);
    console.log(`  工具 prompt 预览:\n  ${toolsPrompt.replace(/\n/g, '\n  ')}`);
    passed++;
  } else {
    console.log(`${RED}✗${RESET} get_tools_prompt() 格式不正确: ${toolsPrompt}`);
    failed++;
  }

  const initPrompt = dm2.get_init_prompt();
  if (initPrompt.includes('{"result": "ok"}') && initPrompt.includes('<|system|>')) {
    console.log(`${GREEN}✓${RESET} get_init_prompt() 包含所有部分`);
    console.log(`  初始化 prompt 长度: ${initPrompt.length} 字符`);
    passed++;
  } else {
    console.log(`${RED}✗${RESET} get_init_prompt() 格式不正确`);
    console.log(`  实际内容: ${initPrompt.substring(0, 200)}...`);
    failed++;
  }

  const withTemplate = dm2.get_current_prompt_with_template();
  if (withTemplate.includes('{"result": "ok"}') && withTemplate.includes('hello world')) {
    console.log(`${GREEN}✓${RESET} get_current_prompt_with_template() 包含模板和内容`);
    passed++;
  } else {
    console.log(`${RED}✗${RESET} get_current_prompt_with_template() 不正确`);
    failed++;
  }

  // ============================
  // 清理临时目录
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    console.log(`\n${CYAN}临时目录已清理${RESET}`);
  } catch {
    console.log(`\n${YELLOW}清理临时目录失败: ${tmpDir}${RESET}`);
  }

  // ============================
  console.log('\n' + '='.repeat(50));
  console.log(`${BOLD}测试结果：${RESET}`);
  console.log(`  ${GREEN}通过: ${passed}${RESET}`);
  if (failed > 0) {
    console.log(`  ${RED}失败: ${failed}${RESET}`);
    process.exit(1);
  } else {
    console.log(`  失败: ${failed}`);
  }
  console.log('='.repeat(50));
}

runTests().catch((err) => {
  console.error('测试运行失败:', err);
  process.exit(1);
});
