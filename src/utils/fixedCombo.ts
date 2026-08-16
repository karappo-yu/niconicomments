import type { IComment } from "@/@types/";

/**
 * 固定弹幕(ue/shita)渐进合并(combo)。
 *
 * 弹幕数据是静态的,因此在位置解析前一次性预计算合并链:
 * 同文本・同位置・同尺寸的固定弹幕,前一条还在屏上时到达 → 接上同一条链
 * (宿主 = 链内第一条,显示计时随每次到达重置);前一条已消失才到达 → 断开另起新链。
 *
 * 链的变更在 getCommentPos 之前应用,因此宿主的 long 延长会自然反映到
 * timeline 注册(宿主显示到链尾),被吸收的成员标记 invisible 后不会进入 timeline。
 * 渐进计数(x2→x3)则是每帧按 vpos 纯函数式重算,seek 天然安全。
 */

export type FixedComboChain = {
  /** 链宿主(第一条,也是唯一可见的成员) */
  host: IComment;
  /** 原始文本(不含 xN 后缀) */
  base: string;
  /** 宿主合并前的原色(计数回到 1 时恢复) */
  originalColor: string;
  /** 合并后的稳定色(按文本 hash 选色,重放/seek 不闪色) */
  color: string;
  /** 各成员 vpos(升序,含宿主) */
  memberVposes: number[];
  /** 链显示结束 vpos = 最后成员的 vpos + long */
  end: number;
  /** 宿主原始字号数据(超宽文本测量会缩放字号,计数更新前须还原防止漂移) */
  charSize: number;
  lineHeight: number;
  fontSize: number;
  /** 宿主原始高度(content setter 会重新测量,固定高度避免 shita 弹幕垂直抖动) */
  height: number;
  /** 当前渐进计数缓存(0 = 未在屏) */
  currentCount: number;
};

/** 合并后的颜色池(鲜艳色,与插件侧预合并色池一致) */
const COMBO_COLORS = [
  "#FF0000",
  "#FF8080",
  "#FFCC00",
  "#FFFF00",
  "#00FF00",
  "#00FFFF",
  "#0000FF",
  "#800080",
];

/** 链的最大时长上限(与单条弹幕 MAX_COMMENT_LONG 一致,防止刷屏链无限延长 timeline) */
const MAX_CHAIN_LONG = 120 * 100;

const hashText = (text: string): number => {
  let h = 0;
  for (let i = 0; i < text.length; i++) {
    h = (h * 31 + text.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
};

export const pickFixedComboColor = (text: string): string =>
  COMBO_COLORS[hashText(text) % COMBO_COLORS.length] ?? "#FFCC00";

const isComboCandidate = (comment: IComment): boolean => {
  if (!comment || comment.invisible || comment.owner) return false;
  if (comment.loc === "naka") return false;
  // content getter = rawContent(显示文本);多行固定弹幕不参与(后缀追加语义不明)
  const base = comment.content;
  return typeof base === "string" && base.length > 0 && !base.includes("\n");
};

/**
 * 应用一条链的变更:宿主延长显示计时并预留占位宽度,其余成员隐藏。
 * 占位宽度 = 最大文本(原文x最大计数)的实测宽度:固定弹幕居中显示,
 * 预留宽度后宿主以占位盒整体居中、文本左对齐锚定,xN 增长时位置不移动。
 * 测量失败(异常 comment 实现)时返回 null,该链全员保持原样。
 */
const makeChain = (members: IComment[]): FixedComboChain | null => {
  const host = members[0];
  if (!host) return null;
  const base = host.content;
  const originalColor = host.comment.color;
  const color = pickFixedComboColor(base);
  const last = members[members.length - 1];
  if (!last) return null;
  const end = last.vpos + last.long;
  // 原始字号数据(超宽测量会原地缩放 charSize,之后必须还原)
  const charSize = host.comment.charSize;
  const lineHeight = host.comment.lineHeight;
  const fontSize = host.comment.fontSize;
  const height = host.comment.height;
  let reservedWidth: number;
  try {
    // 临时写入最大文本触发完整测量(含超宽缩放),得到的宽度即真实渲染宽度
    host.content = `${base}x${members.length}`;
    reservedWidth = Math.max(host.comment.width, host.width);
    // 还原字号后恢复原文(否则 base 会按缩放后的字号测量,且后续计数更新字号漂移)
    host.comment.charSize = charSize;
    host.comment.lineHeight = lineHeight;
    host.comment.fontSize = fontSize;
    host.content = base;
  } catch (_e) {
    return null;
  }
  host.comment.long = end - host.vpos;
  host.comment.width = reservedWidth;
  host.fixedComboReservedWidth = reservedWidth;
  for (let i = 1; i < members.length; i++) {
    const member = members[i];
    if (member) member.comment.invisible = true;
  }
  return {
    host,
    base,
    originalColor,
    color,
    memberVposes: members.map((m) => m.vpos).sort((a, b) => a - b),
    end,
    charSize,
    lineHeight,
    fontSize,
    height,
    currentCount: 0,
  };
};

/**
 * 预计算全部合并链。在 createCommentInstance 之后、getCommentPos 之前调用。
 * @param comments 全部评论实例
 * @returns 合并链列表(仅含成员 ≥ 2 的链)
 */
const buildFixedComboChains = (comments: IComment[]): FixedComboChain[] => {
  const groups = new Map<string, IComment[]>();
  for (const comment of comments) {
    if (!isComboCandidate(comment)) continue;
    // 同文本・同位置(ue/shita)・同尺寸才合并;颜色不同可合并(合并后统一着色)
    const key = `${comment.loc}\u0000${comment.comment.size}\u0000${comment.content}`;
    const list = groups.get(key);
    if (list) {
      list.push(comment);
    } else {
      groups.set(key, [comment]);
    }
  }
  const chains: FixedComboChain[] = [];
  for (const [, list] of groups) {
    if (list.length < 2) continue;
    list.sort((a, b) => a.vpos - b.vpos || a.index - b.index);
    let chain: IComment[] = [];
    let chainStart = 0;
    let curEnd = Number.NEGATIVE_INFINITY;
    const flush = () => {
      if (chain.length >= 2) {
        const built = makeChain(chain);
        if (built) chains.push(built);
      }
      chain = [];
    };
    for (const comment of list) {
      const ownEnd = comment.vpos + comment.long;
      // 接续条件: 前一条还在屏上(comment.vpos < 链当前结束) 且 链总时长不超上限
      if (
        chain.length > 0 &&
        comment.vpos < curEnd &&
        ownEnd - chainStart <= MAX_CHAIN_LONG
      ) {
        chain.push(comment);
        curEnd = ownEnd;
      } else {
        flush();
        chain = [comment];
        chainStart = comment.vpos;
        curEnd = ownEnd;
      }
    }
    flush();
  }
  return chains;
};

/**
 * 计算指定 vpos 时链的渐进计数(纯函数,seek 安全)。
 * @param chain 合并链
 * @param vpos 当前 vpos
 * @returns 在屏成员数(0 = 链未在屏)
 */
const fixedComboCountAt = (chain: FixedComboChain, vpos: number): number => {
  if (vpos < chain.host.vpos || vpos >= chain.end) return 0;
  let lo = 0;
  let hi = chain.memberVposes.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((chain.memberVposes[mid] ?? Number.POSITIVE_INFINITY) <= vpos) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  return lo;
};

export { buildFixedComboChains, fixedComboCountAt };
