/**
 * Web 驱动模块功能测试脚本
 *
 * 直接运行：npm run script:web-driver
 * 或：npx ts-node scripts/test-web-driver.ts
 *
 * 注意：此脚本会真实打开浏览器进行测试，需要用户已登录对应网站
 */

import * as readline from 'readline';
import { WebDriverManager, WebDriverError, WebDriverErrorCode } from '../src/web-driver';
import type { SiteKey } from '../src/web-driver';

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function question(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      resolve(answer);
    });
  });
}

async function main() {
  console.log(`\n${BOLD}${CYAN}=== Web 驱动模块功能测试 ===${RESET}\n`);
  console.log(`${YELLOW}注意：此测试会真实打开浏览器，需要用户已登录对应网站${RESET}\n`);

  // 选择网站
  console.log('支持的网站：');
  console.log('  1. gpt      - https://chatgpt.com/');
  console.log('  2. qwen     - https://chat.qwen.ai/');
  console.log('  3. deepseek - https://chat.deepseek.com/');
  console.log('  4. kimi     - https://www.kimi.com/');

  const siteInput = await question('\n请选择网站 (输入 key，如 gpt / deepseek): ');
  const site = siteInput.trim() as SiteKey;

  if (!['gpt', 'qwen', 'deepseek', 'kimi'].includes(site)) {
    console.log(`${RED}无效的网站 key: ${site}${RESET}`);
    process.exit(1);
  }

  const testMessage = await question('请输入测试消息（直接回车使用默认消息）: ');
  const message = testMessage.trim() || '你好，这是 WebClawProxy 的功能测试，请简单回复"收到"即可。';

  console.log(`\n${CYAN}开始测试 ${site} 网站...${RESET}`);

  const manager = new WebDriverManager({
    headless: false, // 显示浏览器
    responseTimeoutMs: 120000,
  });

  try {
    // ============================
    // 测试 1：浏览器弹出服务
    // ============================
    console.log(`\n${YELLOW}[1/3] 测试浏览器弹出服务...${RESET}`);
    const siteUrls: Record<SiteKey, string> = {
      gpt: 'https://chatgpt.com/',
      qwen: 'https://chat.qwen.ai/',
      deepseek: 'https://chat.deepseek.com/',
      kimi: 'https://www.kimi.com/',
    };
    await manager.openBrowser(siteUrls[site], `WebClawProxy 测试 - 正在连接 ${site}`);
    console.log(`${GREEN}✓ 浏览器弹出成功${RESET}`);

    // ============================
    // 测试 2：对话初始化
    // ============================
    console.log(`\n${YELLOW}[2/3] 测试对话初始化服务...${RESET}`);
    console.log(`  （如果未登录，请在浏览器中手动完成登录）`);

    let sessionUrl: string;
    try {
      const initResult = await manager.initConversation(
        site,
        '这是一个 WebClawProxy 的功能测试对话，这是初始化消息，请简单回复"初始化完成"即可。'
      );
      sessionUrl = initResult.url;
      console.log(`${GREEN}✓ 对话初始化成功${RESET}`);
      console.log(`  对话 URL: ${sessionUrl}`);
    } catch (err) {
      if (err instanceof WebDriverError && err.code === WebDriverErrorCode.NOT_LOGGED_IN) {
        console.log(`${RED}✗ 未登录，请先在浏览器中登录 ${site}${RESET}`);
        await manager.close();
        rl.close();
        return;
      }
      throw err;
    }

    // ============================
    // 测试 3：对话服务
    // ============================
    console.log(`\n${YELLOW}[3/3] 测试对话服务...${RESET}`);
    console.log(`  发送消息: ${message}`);
    console.log(`  等待模型响应...`);

    const chatResult = await manager.chat(site, sessionUrl, message);
    console.log(`${GREEN}✓ 对话服务成功${RESET}`);
    console.log(`\n${CYAN}模型回复：${RESET}`);
    console.log('-'.repeat(60));
    console.log(chatResult.content);
    console.log('-'.repeat(60));

    console.log(`\n${BOLD}${GREEN}所有测试通过！${RESET}`);

  } catch (err) {
    if (err instanceof WebDriverError) {
      console.log(`\n${RED}WebDriver 错误 [${err.code}]: ${err.message}${RESET}`);
    } else {
      console.log(`\n${RED}测试失败: ${(err as Error).message}${RESET}`);
    }
    console.error(err);
  } finally {
    await manager.close();
    rl.close();
  }
}

main().catch((err) => {
  console.error('测试运行失败:', err);
  process.exit(1);
});
