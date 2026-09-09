/**
 * Boss 办公室：停工 / 重规划 / 待命 / 开工 中文意图识别。
 */

/** Boss 要求先停、清理或待命，等下次下令再派活（不要立刻全员开工）。 */
export function isWorkWaitDefer(text: string): boolean {
  return /等我通知|等我指令|等我下令|等我再说|等我安排|先别开始|不要开始|暂不开工|先不要开始|先别开工|不要开工|通知.{0,8}再开始|通知.{0,8}后开始|之后再开始|之后再开工|到时候再|稍后开工|之后开工|先等等|待命|先缓一缓再|hold\s*on|wait\s*for/i.test(
    text,
  );
}

export function isWorkStop(text: string): boolean {
  return (
    /停止工作|全员停|全部停止|都停|停工|停下|停手|停一下|先别干|先别做了|别做了|不要做了|取消工作|停止干活|暂停工作|停止执行|收工|别写了|暂停一下|先缓一缓|别继续了|先停下来|全部暂停|别动了|停止一下|停下手中活|别再做了|别继续干了|先停|全体停工|都别干了|先停下|停一停|别搞了|先别写|stop\s*work/i.test(
      text,
    ) &&
    !isWorkReset(text) &&
    !isWorkWaitDefer(text)
  );
}

export function isWorkReset(text: string): boolean {
  return /清理|清空|清除|删除.*文档|重新规划|重来|重做|推翻|从零|整顿|整理.*重新|清理掉|作废|推倒重来|全盘推翻|删掉重做|从头来过|清空重做/.test(
    text,
  );
}

/** 清理/重规划后是否应立即派活（false = 仅停工待命）。 */
export function shouldKickoffAfterReset(text: string): boolean {
  return isWorkReset(text) && !isWorkWaitDefer(text);
}

export function isWorkKickoff(text: string): boolean {
  if (isWorkStop(text) || isWorkReset(text) || isWorkWaitDefer(text)) return false;
  return (
    /(?:全体|全员|强制全员)(?:开始|开工|执行|干活|启动|动手|派活)/.test(text) ||
    /(?:开始|开工|执行|干活|启动|动手|去做|立刻|马上|派活)(?:吧|了|呀|！|!)?/i.test(text) ||
    /通知.{0,8}再开工/.test(text) ||
    /去工/.test(text)
  );
}

/** 飞书/IM 第一次确认：是否执行清除。 */
export function isResetClearIntentConfirm(text: string): boolean {
  const t = text.trim();
  return t === "确认清除" || /^确认清除$/i.test(t);
}

/** 飞书/IM 第二次确认：精确输入删除短语。 */
export function isResetDeletePhrase(text: string): boolean {
  return text.trim() === "确认删除";
}

/** @deprecated 兼容旧口令；新流程请用 isResetClearIntentConfirm + isResetDeletePhrase */
export function isResetReplanConfirm(text: string): boolean {
  const t = text.trim();
  return isResetClearIntentConfirm(t) || /^确认清理(重规划)?$/i.test(t) || t === "确认清理";
}

/** 飞书二次确认：放弃待处理的清理重规划。 */
export function isResetReplanCancel(text: string): boolean {
  const t = text.trim();
  return /^取消(清理(重规划)?)?$/i.test(t) || t === "取消" || t === "取消清理";
}
