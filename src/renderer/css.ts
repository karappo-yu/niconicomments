import type { CommentFont, FrameActiveState, IComment } from "@/@types/";
import { config, options } from "@/definition/config";
import { getConfig, getStrokeColor } from "@/utils";

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
}
@keyframes dm-fade {
  0%, 75% { opacity: var(--dm-base-opacity, 1); }
  100% { opacity: 0; }
}
`;

class CSSRenderer {
  private container: HTMLDivElement;
  private pool: HTMLDivElement[] = [];
  private activeElements: Map<number, HTMLDivElement> = new Map();
  private activeReverseState: Map<number, boolean> = new Map();
  private styleElement: HTMLStyleElement;
  private paused = false;

  constructor(canvas: HTMLCanvasElement) {
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

  private getDrawScale(comment: IComment): number {
    const commentScale = getConfig(config.commentScale, comment.flash);
    const layerScale = comment.comment.layer === -1 ? options.scale : 1;
    return commentScale * layerScale;
  }

  pause() {
    if (this.paused) return;
    this.paused = true;
    for (const [, element] of this.activeElements) {
      const animations = element.getAnimations();
      for (let i = 0, n = animations.length; i < n; i++) {
        animations[i]!.pause();
      }
    }
  }

  resume() {
    if (!this.paused) return;
    this.paused = false;
    for (const [, element] of this.activeElements) {
      const animations = element.getAnimations();
      for (let i = 0, n = animations.length; i < n; i++) {
        animations[i]!.play();
      }
    }
  }

  updateComments(
    comments: readonly IComment[],
    vpos: number,
    frameActiveState: FrameActiveState,
  ): number {
    const currentVisible = new Set<number>();
    let drawnCount = 0;

    for (let i = 0, n = comments.length; i < n; i++) {
      const comment = comments[i];
      if (!comment || comment.invisible) continue;

      const banActive = frameActiveState.banActive;
      if (banActive) continue;

      currentVisible.add(comment.index);

      const reverse = comment.owner
        ? frameActiveState.reverseActiveOwner
        : frameActiveState.reverseActiveViewer;

      if (!this.activeElements.has(comment.index)) {
        this.createCommentElement(comment, vpos, frameActiveState);
      } else if (
        comment.loc === "naka" &&
        this.activeReverseState.get(comment.index) !== reverse
      ) {
        this.reanimateScroll(comment, vpos, reverse);
      }
      drawnCount++;
    }

    for (const [index, element] of this.activeElements) {
      if (!currentVisible.has(index)) {
        this.recycleElement(element);
        this.activeElements.delete(index);
        this.activeReverseState.delete(index);
      }
    }

    return drawnCount;
  }

  private createCommentElement(
    comment: IComment,
    vpos: number,
    frameActiveState: FrameActiveState,
  ) {
    const element = this.getElementFromPool();
    const c = comment.comment;

    const reverse = comment.owner
      ? frameActiveState.reverseActiveOwner
      : frameActiveState.reverseActiveViewer;

    const layerScale = c.layer === -1 ? options.scale : 1;
    const scaledPosY = comment.posY * layerScale;
    const scaledHeight = comment.height * layerScale;
    const posY =
      comment.loc === "shita"
        ? config.canvasHeight - scaledPosY - scaledHeight
        : scaledPosY;

    const drawScale = this.getDrawScale(comment);
    const fontSizePx = c.fontSize * drawScale;

    element.textContent = comment.content;

    const lineWidth = getConfig(config.contextLineWidth, comment.flash);
    const strokeColor = getStrokeColor(c);
    const strokeWidthPx = lineWidth * drawScale;

    const effectiveAlpha =
      typeof c.opacity === "number"
        ? c.opacity
        : c._live
          ? config.contextFillLiveOpacity
          : 1;

    element.style.top = `calc(${posY} * var(--dm-unit))`;
    element.style.fontSize = `calc(${fontSizePx} * var(--dm-unit))`;
    element.style.color = c.color;
    element.style.zIndex = String(comment.layer + 1);
    element.style.webkitTextStroke = `calc(${strokeWidthPx} * var(--dm-unit)) ${strokeColor}`;
    element.style.lineHeight = String(c.lineHeight / c.fontSize);

    this.applyFont(element, c.font);

    if (effectiveAlpha !== 1) {
      element.style.opacity = String(effectiveAlpha);
    }

    if (c.fillColor) {
      element.style.backgroundColor = c.fillColor;
    }

    if (c.wakuColor) {
      const borderWidthPx = lineWidth * drawScale;
      element.style.border = `calc(${borderWidthPx} * var(--dm-unit)) solid ${c.wakuColor}`;
    }

    if (comment.loc === "naka") {
      if (!this.setupScrollAnimation(element, comment, vpos, reverse)) {
        this.recycleElement(element);
        return;
      }
    } else {
      this.setupFixedAnimation(element, comment, vpos, effectiveAlpha);
    }

    this.container.appendChild(element);
    this.activeElements.set(comment.index, element);
    if (comment.loc === "naka") {
      this.activeReverseState.set(comment.index, reverse);
    }

    if (this.paused) {
      const animations = element.getAnimations();
      for (let i = 0, n = animations.length; i < n; i++) {
        animations[i]!.pause();
      }
    }
  }

  private reanimateScroll(comment: IComment, vpos: number, reverse: boolean) {
    const element = this.activeElements.get(comment.index);
    if (!element) return;

    const animations = element.getAnimations();
    for (let i = 0, n = animations.length; i < n; i++) {
      animations[i]?.cancel();
    }

    if (!this.setupScrollAnimation(element, comment, vpos, reverse)) {
      this.recycleElement(element);
      this.activeElements.delete(comment.index);
      this.activeReverseState.delete(comment.index);
      return;
    }

    this.activeReverseState.set(comment.index, reverse);

    if (this.paused) {
      const newAnimations = element.getAnimations();
      for (let i = 0, n = newAnimations.length; i < n; i++) {
        newAnimations[i]?.pause();
      }
    }
  }

  private setupScrollAnimation(
    element: HTMLDivElement,
    comment: IComment,
    vpos: number,
    reverse: boolean,
  ): boolean {
    const c = comment.comment;

    const speed =
      (config.commentDrawRange + c.width * config.nakaCommentSpeedOffset) /
      (comment.long + 100);

    const vposLapsed = vpos - comment.vpos;
    const normalXPx =
      config.commentDrawPadding +
      config.commentDrawRange -
      (vposLapsed + 100) * speed;

    let currentXPx: number;
    let toXPx: number;
    let remainingPx: number;

    if (reverse) {
      currentXPx = config.canvasWidth - c.width - normalXPx;
      toXPx = config.canvasWidth;
      remainingPx = toXPx - currentXPx;
    } else {
      currentXPx = normalXPx;
      toXPx = -c.width;
      remainingPx = currentXPx - toXPx;
    }

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
    const c = comment.comment;
    const leftPx = (config.canvasWidth - c.width) / 2;

    const durationSec = comment.long / 100;
    const vposLapsed = vpos - comment.vpos;
    const elapsedSec = Math.max(0, vposLapsed / 100);

    element.style.left = `calc(${leftPx} * var(--dm-unit))`;
    element.style.setProperty("--dm-base-opacity", String(effectiveAlpha));
    element.style.animation = `dm-fade ${durationSec}s linear forwards`;
    element.style.animationDelay = `-${elapsedSec}s`;
  }

  private applyFont(element: HTMLDivElement, font: CommentFont) {
    const html5Fonts = config.fonts.html5;
    const fontConfig =
      font === "gothic" || font === "mincho" || font === "defont"
        ? html5Fonts[font]
        : html5Fonts.defont;
    if (!fontConfig) return;
    element.style.fontFamily = fontConfig.font;
    element.style.fontWeight = String(fontConfig.weight);
  }

  private getElementFromPool(): HTMLDivElement {
    if (this.pool.length > 0) {
      return this.pool.pop()!;
    }
    const element = document.createElement("div");
    element.setAttribute("data-dm-comment", "");
    return element;
  }

  private recycleElement(element: HTMLDivElement) {
    const animations = element.getAnimations();
    for (let i = 0, n = animations.length; i < n; i++) {
      animations[i]!.cancel();
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
    this.activeReverseState.clear();
  }

  destroy() {
    this.clear();
    this.container.remove();
    this.styleElement.remove();
    this.pool = [];
  }
}

export { CSSRenderer };
