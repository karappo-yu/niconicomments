# [niconicomments](https://xpadev.net/niconicomments/)

[![GitHub license](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/xpadev-net/niconicomments/blob/master/LICENSE)
[![CodeQL](https://github.com/xpadev-net/niconicomments/actions/workflows/codeql-analysis.yml/badge.svg?branch=master)](https://github.com/xpadev-net/niconicomments/actions/workflows/codeql-analysis.yml)
[![TypeDoc](https://github.com/xpadev-net/niconicomments/actions/workflows/typedoc.yml/badge.svg?branch=master)](https://github.com/xpadev-net/niconicomments/actions/workflows/typedoc.yml)

[[English](https://github.com/xpadev-net/niconicomments/blob/develop/README.en.md)]
[[中文](https://github.com/karappo-yu/niconicomments/blob/develop/README.zh.md)]

## ⚠️ このフォークについて / About this fork

**このリポジトリは karappo-yu による個人フォークであり、アップストリーム (xpadev-net/niconicomments) との同期は意図的に行っていません。**

**This repository is a personal fork by karappo-yu. It intentionally does NOT track upstream (xpadev-net/niconicomments).**

**本仓库为 karappo-yu 的个人 fork,有意不与上游 (xpadev-net/niconicomments) 同步。**

目的は [IINA 弹幕插件 (Danmaku Cosmos)](https://github.com/karappo-yu/iina-plugin-danmaku-cosmos) 専用のカスタマイズです。IINA の WKWebView 環境に特化した変更が多数含まれており、汎用ライブラリとしての互換性・保守性は保証されません。

This fork exists solely to serve the [IINA danmaku plugin (Danmaku Cosmos)](https://github.com/karappo-yu/iina-plugin-danmaku-cosmos). It contains IINA/WKWebView-specific changes and does not guarantee general-purpose compatibility.

此 fork 仅服务于 [IINA 弹幕插件 (Danmaku Cosmos)](https://github.com/karappo-yu/iina-plugin-danmaku-cosmos),包含大量 IINA/WKWebView 特化改动,不保证作为通用库的兼容性与可维护性。

### 変更点一覧 / Changes / 改动清单

| 変更 / Change / 改动 | 説明 / Description / 说明 |
|---|---|
| **CSS レンダラー追加** `src/renderer/css.ts` | 真の DOM ベース描画 (div + CSS `@keyframes`)。WKWebView で小さいフォントでもシャープに描画され、GPU 合成でスクロールが滑らか。`mode: "css"` で有効。canvas の代わりに DOM ノードで弾幕を描くため、Canvas モードと併用は不可 / True DOM-based rendering (div + CSS `@keyframes`): crisp small fonts and GPU-composited smooth scrolling in WKWebView. Enabled via `mode: "css"`. Mutually exclusive with canvas rendering / 真正的 DOM 渲染 (div + CSS `@keyframes`):小字号依然锐利,滚动走 GPU 合成。通过 `mode: "css"` 启用,与 canvas 渲染互斥 |
| **owner コメントのスケール除外** | 投稿者コメント (owner) はフォントスケール調整の対象外にし、CA (コメントアート) の構図が崩れないようにした。適用箇所: CSS + HTML5 + Flash / Owner comments are excluded from font scale adjustment so comment-art (CA) composition stays intact (CSS + HTML5 + Flash) / 投稿者评论不参与字号缩放,保护 CA(弹幕艺术)构图(CSS + HTML5 + Flash 三处) |
| **フォント縮小下限 (font scale floor)** | 縮小時にフォントが medium サイズの 25% 未満にならないよう測定レイヤーで底上げ。測定・レイアウト・描画のデータが一致する実装 / When scaling down, font size never drops below 25% of medium size, enforced at the measurement layer so measurement/layout/rendering stay consistent / 缩小时字号不低于 medium 的 25%,在测量层统一抬升,保证测量/布局/渲染一致 |
| **スクロール速度制御** `setPlaybackSpeed()` | 再生速度変更時にアクティブなスクロール弾幕を現在位置基準で再アニメーション。CSS モードの実時間アニメーションをビデオ時間に揃える / Re-animates active scrolling danmaku on playback-speed change so CSS real-time animations stay aligned to video time / 播放速度变化时以当前位置重启动画,使 CSS 实时动画与视频时间对齐 |
| **`@reverse` 対応** | スクロール弾幕の逆方向再生 (`@reverse` nicoscript) を CSS モードでサポート / Reverse-direction scrolling (`@reverse` nicoscript) supported in CSS mode / CSS 模式支持反向滚动 (`@reverse` nicoscript) |
| **オブジェクトプール** | 最大 512 個の DOM ノードを再利用するプールで、バースト時の DOM 生成/破棄コストを削減 / Reuses up to 512 DOM nodes via a pool to cut DOM churn during burst / 复用最多 512 个 DOM 节点,降低弹幕爆发时的 DOM 创建/销毁开销 |
| **`mode: "css"` 追加** | `ModeType` と typeGuard に `"css"` を追加 / `"css"` added to `ModeType` and typeGuard / 在 `ModeType` 与 typeGuard 中新增 `"css"` |
| **`_resolveCommentPositions` 抽出** | CSS モードが `drawCanvas` から直接位置解決できるよう main.ts の位置解決ロジックを分離 / Position-resolution logic extracted in main.ts so CSS mode can resolve positions directly from `drawCanvas` / 从 main.ts 抽出位置解析逻辑,CSS 模式可直接从 `drawCanvas` 解析位置 |
| **`pauseCSS` / `resumeCSS` / `getVisibleComments`** | CSS モード専用の公開 API。一時停止/再開、可視弾幕一覧を取得 / Public CSS-mode APIs: pause/resume and visible-comment listing / CSS 模式专用公开 API:暂停/恢复、获取可见弹幕列表 |

### 同期ポリシー / Sync policy / 同步策略

アップストリームの変更は**取り込みません**。このフォークは IINA プラグインの動作に合わせて自由に変更します。バグ修正・機能追加は独自にメンテナンスします。

Upstream changes are **NOT merged**. This fork is freely modified to fit the IINA plugin; bugs and features are maintained independently.

**不合并上游改动**。本 fork 按 IINA 插件需求自由修改,bug 修复与功能维护均独立进行。

---
ニコニコ動画の公式プレイヤー互換の高パフォーマンスなコメント描画ライブラリ  
High peformance High compatibility comment drawing library  
Reference： https://xpadev-net.github.io/niconicomments/  
Github： https://github.com/xpadev-net/niconicomments  
npm： https://www.npmjs.com/package/@xpadev-net/niconicomments


## Installation

CDN から読み込む場合は、可変エイリアスではなく固定バージョンを指定してください。

```html
<script src="https://cdn.jsdelivr.net/npm/@xpadev-net/niconicomments@0.3.1/dist/bundle.js"></script>
```

or

```shell
npm i @xpadev-net/niconicomments
```

npm で読み込む場合:

```javascript
import NiconiComments from "@xpadev-net/niconicomments";
```

## Examples

```javascript
const canvas = document.getElementById("canvas");
const video = document.getElementById("video");
const req = await fetch("sample.json");
const res = await req.json();
const niconiComments = new NiconiComments(canvas, res);
//video.ontimeupdateを使用すると、呼び出し回数の関係でコメントカクつく
let animationFrameId = null;

const stopDrawing = () => {
  if (animationFrameId === null) return;
  cancelAnimationFrame(animationFrameId);
  animationFrameId = null;
};

const draw = () => {
  animationFrameId = null;
  niconiComments.drawCanvas(video.currentTime * 100);
  if (!video.paused && document.visibilityState !== "hidden") {
    animationFrameId = requestAnimationFrame(draw);
  }
};

const startDrawing = () => {
  if (animationFrameId === null && document.visibilityState !== "hidden") {
    animationFrameId = requestAnimationFrame(draw);
  }
};

video.addEventListener("play", startDrawing);
video.addEventListener("pause", () => {
  stopDrawing();
  niconiComments.drawCanvas(video.currentTime * 100);
});
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden" || video.paused) {
    stopDrawing();
  } else {
    startDrawing();
  }
});
```

## Sample

[サンプル](https://xpadev-net.github.io/niconicomments/sample/)


### このライブラリを使用される方へ

このライブラリを使用するかどうかに関わらず、リアルタイムでコメントを取得、画面を描画、コメントの投稿という一連の流れを実装した場合、ニコニコの特許を侵害する可能性があります  
詳しくはこちら[ニコニコが保有する特許について](https://github.com/xpadev-net/niconicomments/blob/develop/ABOUT_PATENT.md)を参照してください
