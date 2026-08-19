import { beforeEach, describe, expect, test, vi } from "vitest";

import type { FormattedComment, IComment, IRenderer } from "@/@types";
import { initConfig } from "@/definition/initConfig";
import NiconiComments from "@/main";
import { buildFixedComboChains } from "@/utils/fixedCombo";

const textMetrics = (width: number): TextMetrics =>
  ({
    width,
    actualBoundingBoxLeft: 0,
    actualBoundingBoxRight: width,
    actualBoundingBoxAscent: 0,
    actualBoundingBoxDescent: 0,
    alphabeticBaseline: 0,
    hangingBaseline: 0,
    emHeightAscent: 0,
    emHeightDescent: 0,
    fontBoundingBoxAscent: 0,
    fontBoundingBoxDescent: 0,
    ideographicBaseline: 0,
  }) as TextMetrics;

class FakeRenderer implements IRenderer {
  public readonly rendererName = "FakeRenderer";
  public readonly canvas = {} as HTMLCanvasElement;
  private font = "";
  private size = { width: 1920, height: 1080 };

  destroy() {}
  drawVideo() {}
  getFont() {
    return this.font;
  }
  getFillStyle() {
    return "#000000";
  }
  setScale() {}
  fillRect() {}
  strokeRect() {}
  fillText() {}
  strokeText() {}
  quadraticCurveTo() {}
  clearRect() {}
  setFont(font: string) {
    this.font = font;
  }
  setFillStyle() {}
  setStrokeStyle() {}
  setLineWidth() {}
  setGlobalAlpha() {}
  setSize(width: number, height: number) {
    this.size = { width, height };
  }
  getSize() {
    return this.size;
  }
  measureText() {
    return textMetrics(120);
  }
  beginPath() {}
  closePath() {}
  moveTo() {}
  lineTo() {}
  stroke() {}
  save() {}
  restore() {}
  getCanvas() {
    return this;
  }
  drawImage() {}
  flush() {}
  invalidateImage() {}
}

const ensureCanvasElement = () => {
  if (!("HTMLCanvasElement" in globalThis)) {
    Object.defineProperty(globalThis, "HTMLCanvasElement", {
      configurable: true,
      value: class HTMLCanvasElement {},
    });
  }
};

const createComment = (
  overrides: Partial<FormattedComment> = {},
): FormattedComment => ({
  id: overrides.id ?? 1,
  vpos: overrides.vpos ?? 0,
  content: overrides.content ?? "combo",
  date: overrides.date ?? 1,
  date_usec: overrides.date_usec ?? 0,
  owner: overrides.owner ?? false,
  premium: overrides.premium ?? false,
  mail: overrides.mail ?? ["ue"],
  user_id: overrides.user_id ?? 1,
  layer: overrides.layer ?? -1,
  is_my_post: overrides.is_my_post ?? false,
});

describe("fixedCombo suffix random color", () => {
  beforeEach(() => {
    ensureCanvasElement();
    initConfig();
    let timeoutId = 0;
    vi.stubGlobal("window", {
      setTimeout: vi.fn(() => ++timeoutId),
    });
    vi.stubGlobal("clearTimeout", vi.fn());
  });

  test("chain assigns one fixed random suffix color for the whole chain", () => {
    const comments = [100, 200, 300].map((vpos, i) => ({
      ...createComment({ id: i + 1, vpos, mail: ["ue", "@10"] }),
      comment: { size: "medium" },
      long: 1000,
    }));
    const chains = buildFixedComboChains(comments as unknown as IComment[]);

    expect(chains).toHaveLength(1);
    const chain = chains[0];
    expect(chain).toBeDefined();
    expect(chain?.suffixColor).toMatch(/^#[0-9A-F]{6}$/i);
  });

  test("host keeps native body color while suffix fields are written", () => {
    const renderer = new FakeRenderer();
    const instance = new NiconiComments(
      renderer,
      [100, 200, 300].map((vpos, i) =>
        createComment({ id: i + 1, vpos, mail: ["ue", "@10"] }),
      ),
      {
        format: "formatted",
        mode: "html5",
        config: { fixedCombo: true },
      },
    );
    const state = instance as unknown as { comments: IComment[] };
    const host = () => state.comments[0];

    instance.drawCanvas(150, true);
    expect(host()?.comment.comboSuffix).toBeUndefined();
    expect(host()?.comment.color).toBe("#FFFFFF");

    instance.drawCanvas(250, true);
    expect(host()?.comment.comboSuffix).toBe("x2");
    const suffixColor = host()?.comment.comboSuffixColor;
    expect(suffixColor).toMatch(/^#[0-9A-F]{6}$/i);
    expect(host()?.comment.color).toBe("#FFFFFF");

    instance.drawCanvas(350, true);
    expect(host()?.comment.comboSuffix).toBe("x3");
    expect(host()?.comment.comboSuffixColor).toBe(suffixColor);
    expect(host()?.comment.color).toBe("#FFFFFF");
  });

  test("count falling back to 1 clears the suffix fields", () => {
    const renderer = new FakeRenderer();
    const instance = new NiconiComments(
      renderer,
      [100, 200].map((vpos, i) =>
        createComment({ id: i + 1, vpos, mail: ["ue", "@10"] }),
      ),
      {
        format: "formatted",
        mode: "html5",
        config: { fixedCombo: true },
      },
    );
    const state = instance as unknown as { comments: IComment[] };
    const host = () => state.comments[0];

    instance.drawCanvas(250, true);
    expect(host()?.comment.comboSuffix).toBe("x2");

    instance.drawCanvas(1250, true);
    expect(host()?.comment.comboSuffix).toBeUndefined();
    expect(host()?.comment.comboSuffixColor).toBeUndefined();
    expect(host()?.comment.color).toBe("#FFFFFF");
  });
});
