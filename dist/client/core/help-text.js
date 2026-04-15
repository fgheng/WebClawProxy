"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getClientCommandHelpText = getClientCommandHelpText;
function getClientCommandHelpText() {
    return `客户端内置命令：
  /help                显示帮助
  /model <名称>        切换模型
  /provider <名称>     切换 provider，并自动切到其默认模型
  /system <文本>       设置系统提示词
  /trace [on|off]      查看或开关链路日志
  /stream [on|off]     查看或开关流式请求
  /clear               清空对话历史
  /new                 新建本地对话上下文
  /history             查看对话历史
  /config              查看当前配置
  /quit                退出`;
}
//# sourceMappingURL=help-text.js.map