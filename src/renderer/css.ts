import type {
  BaseConfig,
  BaseOptions,
  CommentFont,
  FormattedCommentWithSize,
  FrameActiveState,
  IComment,
} from "@/@types/";
import { getConfig, getFontSizeAndScale, getStrokeColor } from "@/utils";

const POOL_MAX_SIZE = 512;

const CSS = `
[data-dm-css-container] {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  margin: auto;
  width: min(100vw, calc(100vh * 16 / 9));
  height: min(100vh, calc(100vw * 9 / 16));
  --dm-unit: calc(min(100vh, 56.25vw) / 1080);
  pointer-events: none;
  overflow: hidden;
  z-index: 1;
  font-family: Arial, "MS PGothic", MSPGothic, MS-PGothic, sans-serif;
}
[data-dm-comment] {
  position: absolute;
  will-change: transform, opacity;
  contain: layout style;
  overflow: visible;
  white-space: pre;
  pointer-events: none;
  paint-order: stroke fill;
  stroke-linejoin: round;
}
@keyframes dm-fade {
  0%, 90% { opacity: var(--dm-base-opacity, 1); }
  100% { opacity: 0; }
}
`;

class CSSRenderer {
  private readonly config: BaseConfig;
  private readonly options: BaseOptions;
  private container: HTMLDivElement;
  private pool: HTMLDivElement[] = [];
  private activeElements: Map<number, HTMLDivElement> = new Map();
  private activeSeenGeneration: Map<number, number> = new Map();
  private visibilityGeneration = 0;
  private styleElement: HTMLStyleElement;
  private paused = false;
  private lastUpdateVpos = -1;
  private measureCanvas: HTMLCanvasElement | null = null;
  private ascentCache: Map<string, number> = new Map();

  constructor(
    canvas: HTMLCanvasElement,
    config: BaseConfig,
    options: BaseOptions,
  ) {
    this.config = config;
    this.options = options;
    this.container = document.createElement("div");
    this.container.setAttribute("data-dm-css-container", "");

    const parent = canvas.parentElement;
    if (parent) {
      if (getComputedStyle(parent).position === "static") {
        parent.style.position = "relative";
      }
      parent.appendChild(this.container);
    } else {
      document.body.appendChild(this.container);
    }

    this.styleElement = document.createElement("style");
    this.styleElement.textContent = CSS;
    document.head.appendChild(this.styleElement);
  }

  pause() {
    if (this.paused) return;
    this.paused = true;
    for (const [, element] of this.activeElements) {
      const animations = element.getAnimations();
      for (let i = 0, n = animations.length; i < n; i++) {
        animations[i]?.pause();
      }
    }
  }

  resume() {
    if (!this.paused) return;
    this.paused = false;
    for (const [, element] of this.activeElements) {
      const animations = element.getAnimations();
      for (let i = 0, n = animations.length; i < n; i++) {
        animations[i]?.play();
      }
    }
  }

  updateComments(
    comments: readonly IComment[],
    vpos: number,
    frameActiveState: FrameActiveState,
  ): number {
    if (frameActiveState.banActive) {
      if (this.activeElements.size > 0) {
        this.clear();
      }
      return 0;
    }

    const generation = ++this.visibilityGeneration;
    const isSeek =
      this.lastUpdateVpos >= 0 && Math.abs(vpos - this.lastUpdateVpos) > 150;
    let drawnCount = 0;

    let startIndex = 0;
    let endIndex = comments.length;
    const limit = this.config.commentLimit;
    // commentLimit によって描画範囲から外されたコメントの index を記録し、
    // 回収ループで stillPlaying チェックを回避して即時回収するために使う
    const excludedByLimit = new Set<number>();
    if (limit !== undefined) {
      if (limit === 0) {
        if (this.activeElements.size > 0) this.clear();
        this.lastUpdateVpos = vpos;
        return 0;
      }
      if (this.config.hideCommentOrder === "asc") {
        startIndex = Math.max(0, comments.length - limit);
      } else {
        endIndex = Math.min(comments.length, limit);
      }
      for (let i = 0; i < startIndex; i++) {
        const c = comments[i];
        if (c) excludedByLimit.add(c.index);
      }
      for (let i = endIndex; i < comments.length; i++) {
        const c = comments[i];
        if (c) excludedByLimit.add(c.index);
      }
    }

    for (let i = startIndex; i < endIndex; i++) {
      const comment = comments[i];
      if (!comment || comment.invisible) {
        continue;
      }

      this.activeSeenGeneration.set(comment.index, generation);

      const element = this.activeElements.get(comment.index);

      if (!element) {
        if (!this.createCommentElement(comment, vpos)) {
          this.activeSeenGeneration.delete(comment.index);
          continue;
        }
      } else if (comment.loc === "naka" && isSeek) {
        this.reanimateScroll(comment, vpos);
      } else if (isSeek) {
        this.setupFixedAnimation(
          element,
          comment,
          vpos,
          this.getEffectiveAlpha(comment.comment),
        );
      }
      drawnCount++;
    }

    this.lastUpdateVpos = vpos;

    for (const [index, element] of this.activeElements) {
      if (this.activeSeenGeneration.get(index) !== generation) {
        // commentLimit によって範囲外とされたコメントはアニメーション状態に
        // 関わらず即時回収する
        if (!excludedByLimit.has(index)) {
          // 若 CSS 动画仍在播放（running/paused），说明弹幕尚未走完轨迹。
          // 这通常发生在 seek 重建动画后 timeline 生命周期已到尽头、但动画
          // currentTime 还很小的情形。此时不应回收，否则弹幕会凭空消失。
          const anims = element.getAnimations();
          let stillPlaying = false;
          for (let i = 0, n = anims.length; i < n; i++) {
            const state = anims[i]?.playState;
            if (state === "running" || state === "paused") {
              stillPlaying = true;
              break;
            }
          }
          if (stillPlaying) continue;
        }
        this.recycleElement(element);
        this.activeElements.delete(index);
        this.activeSeenGeneration.delete(index);
      }
    }

    return drawnCount;
  }

  private createCommentElement(comment: IComment, vpos: number): boolean {
    const element = this.getElementFromPool();
    const c = comment.comment;

    const drawScale = getConfig(this.config.commentScale, comment.flash);
    const layerScale = c.layer === -1 ? this.options.scale : 1;
    const { fontSize: renderFontSize, scale: fontScale } = getFontSizeAndScale(
      c.charSize,
      this.config,
    );
    const fontSizePx = renderFontSize * drawScale * fontScale * layerScale;

    const lineHeightPx = c.lineHeight * drawScale * layerScale;

    const paddingTop =
      (10 - fontScale * 10) *
      ((c.lineCount + 1) / this.config.html5HiResCommentCorrection);
    const paddingTopCanvas = paddingTop * lineHeightPx;

    const fontOffset =
      (c.font === "gothic" || c.font === "mincho" || c.font === "defont"
        ? this.config.fonts.html5[c.font]?.offset
        : undefined) ?? 0;
    const offsetY =
      (c.charSize - c.lineHeight) / 2 + c.lineHeight * -0.16 + fontOffset;
    const offsetYCanvas = offsetY * drawScale * layerScale;

    let posY: number;
    if (comment.loc === "shita") {
      posY = this.config.canvasHeight - comment.posY - comment.height;
    } else {
      posY = comment.posY;
    }

    element.textContent = comment.content;

    const lineWidth = getConfig(this.config.contextLineWidth, comment.flash);
    const strokeColor = getStrokeColor(c, this.config);
    const strokeWidthPx = lineWidth * drawScale * fontScale * layerScale;

    const effectiveAlpha = this.getEffectiveAlpha(c);

    this.applyFont(element, c.font, comment.flash);

    const fontFamily = element.style.fontFamily || "sans-serif";
    const fontWeight = element.style.fontWeight || "400";
    const ascentFraction = this.measureAscentFraction(fontFamily, fontWeight);
    const ascentRendered = ascentFraction * fontSizePx;
    const baselineCorrection =
      lineHeightPx / 2 + fontSizePx / 2 - ascentRendered;

    element.style.top = `calc(${posY} * var(--dm-unit))`;
    element.style.paddingTop = `calc(${paddingTopCanvas + offsetYCanvas + baselineCorrection} * var(--dm-unit))`;
    element.style.fontSize = `calc(${fontSizePx} * var(--dm-unit))`;
    element.style.lineHeight = String(
      c.lineHeight / (renderFontSize * fontScale),
    );
    element.style.color = c.color;
    element.style.zIndex = String(comment.layer + 1);
    element.style.webkitTextStroke = `calc(${strokeWidthPx} * var(--dm-unit)) ${strokeColor}`;

    if (effectiveAlpha !== 1) {
      element.style.opacity = String(effectiveAlpha);
    }

    if (c.fillColor) {
      element.style.backgroundColor = c.fillColor;
    }

    if (c.wakuColor) {
      const borderWidthPx = lineWidth * drawScale * layerScale;
      element.style.border = `calc(${borderWidthPx} * var(--dm-unit)) solid ${c.wakuColor}`;
    }

    if (comment.loc === "naka") {
      if (!this.setupScrollAnimation(element, comment, vpos)) {
        this.recycleElement(element);
        return false;
      }
    } else {
      this.setupFixedAnimation(element, comment, vpos, effectiveAlpha);
    }

    this.container.appendChild(element);
    this.activeElements.set(comment.index, element);

    if (this.paused) {
      const animations = element.getAnimations();
      for (let i = 0, n = animations.length; i < n; i++) {
        animations[i]?.pause();
      }
    }
    return true;
  }

  private reanimateScroll(comment: IComment, vpos: number) {
    const element = this.activeElements.get(comment.index);
    if (!element) return;

    const animations = element.getAnimations();
    for (let i = 0, n = animations.length; i < n; i++) {
      animations[i]?.cancel();
    }

    if (!this.setupScrollAnimation(element, comment, vpos)) {
      this.recycleElement(element);
      this.activeElements.delete(comment.index);
      this.activeSeenGeneration.delete(comment.index);
      return;
    }

    if (this.paused) {
      const animations = element.getAnimations();
      for (let i = 0, n = animations.length; i < n; i++) {
        animations[i]?.pause();
      }
    }
  }

  private setupScrollAnimation(
    element: HTMLDivElement,
    comment: IComment,
    vpos: number,
  ): boolean {
    const c = comment.comment;
    const commentScale = getConfig(this.config.commentScale, comment.flash);
    const layerScale = c.layer === -1 ? this.options.scale : 1;
    const { fontSize: renderFontSize, scale: fontScale } = getFontSizeAndScale(
      c.charSize,
      this.config,
    );
    const fontSizePx = renderFontSize * commentScale * fontScale * layerScale;

    const speed =
      (this.config.commentDrawRange +
        c.width * this.config.nakaCommentSpeedOffset) /
      (comment.long + 100);

    const vposLapsed = vpos - comment.vpos;
    const normalXPx =
      this.config.commentDrawPadding +
      this.config.commentDrawRange -
      (vposLapsed + 100) * speed;

    const currentXPx = normalXPx;
    const toXPx = -(c.width + fontSizePx);
    const remainingPx = currentXPx - toXPx;

    const remainingSec = remainingPx / (speed * 100);

    if (remainingSec <= 0) {
      return false;
    }

    element.animate(
      [
        { transform: `translateX(calc(${currentXPx} * var(--dm-unit)))` },
        { transform: `translateX(calc(${toXPx} * var(--dm-unit)))` },
      ],
      {
        duration: remainingSec * 1000,
        easing: "linear",
        fill: "forwards",
      },
    );
    return true;
  }

  private setupFixedAnimation(
    element: HTMLDivElement,
    comment: IComment,
    vpos: number,
    effectiveAlpha: number,
  ) {
    const durationSec = comment.long / 100;
    const vposLapsed = vpos - comment.vpos;
    const elapsedSec = Math.max(0, vposLapsed / 100);

    element.style.left = "50%";
    element.style.transform = "translateX(-50%)";
    element.style.setProperty("--dm-base-opacity", String(effectiveAlpha));
    element.style.animation = `dm-fade ${durationSec}s linear forwards`;
    element.style.animationDelay = `-${elapsedSec}s`;
  }

  private getEffectiveAlpha(c: FormattedCommentWithSize): number {
    if (typeof c.opacity === "number") return c.opacity;
    return c._live ? this.config.contextFillLiveOpacity : 1;
  }

  private measureAscentFraction(
    fontFamily: string,
    fontWeight: string,
  ): number {
    const cacheKey = fontFamily + "|" + fontWeight;
    const cached = this.ascentCache.get(cacheKey);
    if (cached !== undefined) return cached;

    if (!this.measureCanvas) {
      this.measureCanvas = document.createElement("canvas");
    }
    const ctx = this.measureCanvas.getContext("2d");
    if (!ctx) {
      return 0.9;
    }
    const measureFontSize = 100;
    ctx.font = `${fontWeight} ${measureFontSize}px ${fontFamily}`;
    const metrics = ctx.measureText("Ag");
    const ascent =
      (metrics as TextMetrics).fontBoundingBoxAscent ?? measureFontSize * 0.9;
    const fraction = ascent / measureFontSize;
    this.ascentCache.set(cacheKey, fraction);
    return fraction;
  }

  private applyFont(
    element: HTMLDivElement,
    font: CommentFont,
    isFlash: boolean,
  ) {
    if (isFlash) {
      const flashFonts = this.config.fonts.flash as Record<string, string>;
      const fontTemplate = flashFonts[font] || flashFonts.gulim;
      if (fontTemplate) {
        const parts = fontTemplate.split("[size]px");
        if (parts.length === 2) {
          const before = parts[0]?.trim() ?? "";
          const after = parts[1]?.trim() ?? "";
          const weightMatch = before.match(/(\d+)\s*$/);
          if (weightMatch?.[1]) {
            element.style.fontWeight = weightMatch[1];
          }
          element.style.fontFamily = after;
        }
      }
    } else {
      const html5Fonts = this.config.fonts.html5;
      const fontConfig =
        font === "gothic" || font === "mincho" || font === "defont"
          ? html5Fonts[font]
          : html5Fonts.defont;
      if (fontConfig) {
        element.style.fontFamily = fontConfig.font;
        element.style.fontWeight = String(fontConfig.weight);
      }
    }
  }

  private getElementFromPool(): HTMLDivElement {
    if (this.pool.length > 0) {
      return this.pool.pop() as HTMLDivElement;
    }
    const element = document.createElement("div");
    element.setAttribute("data-dm-comment", "");
    return element;
  }

  private recycleElement(element: HTMLDivElement) {
    const animations = element.getAnimations();
    for (let i = 0, n = animations.length; i < n; i++) {
      animations[i]?.cancel();
    }
    element.remove();
    element.style.cssText = "";
    element.textContent = "";
    if (this.pool.length < POOL_MAX_SIZE) {
      this.pool.push(element);
    }
  }

  clear() {
    for (const [, element] of this.activeElements) {
      this.recycleElement(element);
    }
    this.activeElements.clear();
    this.activeSeenGeneration.clear();
    this.lastUpdateVpos = -1;
  }

  getVisibleCommentIndices(): number[] {
    return Array.from(this.activeElements.keys());
  }

  destroy() {
    this.clear();
    this.container.remove();
    this.styleElement.remove();
    this.pool = [];
    this.measureCanvas = null;
    this.ascentCache.clear();
  }
}

export { CSSRenderer };
