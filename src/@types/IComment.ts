import type {
  CommentLoc,
  FormattedCommentWithSize,
  IRenderer,
  Position,
} from "@/@types/";

export type FrameActiveState = {
  banActive: boolean;
  reverseActiveOwner: boolean;
  reverseActiveViewer: boolean;
};

export interface IComment {
  comment: FormattedCommentWithSize;
  invisible: boolean;
  index: number;
  loc: CommentLoc;
  width: number;
  long: number;
  height: number;
  vpos: number;
  flash: boolean;
  posY: number;
  owner: boolean;
  layer: number;
  mail: string[];
  content: string;
  /**
   * fixedCombo 宿主的等效 z 序 index(随接续动态更新)。
   * timeline 排序与 CSS zIndex 优先使用此值;未设置时退回 index。
   * 不直接改写 index:CSS 渲染器以 index 为键复用元素。
   */
  fixedComboZIndex?: number;
  image?: IRenderer | null;
  draw: (
    vpos: number,
    showCollision: boolean,
    cursor?: Position,
    frameActiveState?: FrameActiveState,
  ) => void;
  /**
   * Release comment-owned renderer surfaces and pending timeout handles.
   *
   * Implementations must be idempotent. NiconiComments calls this during
   * instance teardown before clearing shared image caches.
   */
  destroy?: () => void;
  isHovered: (cursor?: Position, posX?: number, posY?: number) => boolean;
}
