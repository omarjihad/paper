import { isRotated } from '../telegram.js';

export interface JoystickState {
  active: boolean;
  originX: number;
  originY: number;
  knobX: number;
  knobY: number;
}

export interface IntentSink {
  /** زاوية حرة بالراديان ونسبة سرعة 0..1. */
  onIntent(heading: number, throttle: number): void;
  /** رُفع الإصبع: يواصل اللاعب بآخر زاوية. */
  onRelease(): void;
}

/** أقل إزاحة تُعتبر حركة — تمنع اهتزاز الاتجاه عند ثبات الإصبع. */
const DEAD_ZONE = 12;
/** نصف قطر العصا: عنده تكون السرعة قصوى، ولا يزيد بعده شيء. */
const MAX_RADIUS = 54;
/** أدنى نسبة سرعة داخل النطاق كي لا يتجمّد اللاعب. */
const MIN_THROTTLE = 0.4;

const KEY_VECTORS: Record<string, [number, number]> = {
  ArrowRight: [1, 0], d: [1, 0], D: [1, 0],
  ArrowLeft: [-1, 0], a: [-1, 0], A: [-1, 0],
  ArrowDown: [0, 1], s: [0, 1], S: [0, 1],
  ArrowUp: [0, -1], w: [0, -1], W: [0, -1],
};

/**
 * إدخال تناظري موحّد: العصا تعطي متجهًا حرًّا بأي زاوية،
 * ولوحة المفاتيح تُجمع مفاتيحها في المتجه نفسه (فالقطري مدعوم).
 * لا حصر على أربعة أو ثمانية اتجاهات، ولا التصاق بزوايا محددة.
 */
export class InputController {
  readonly joystick: JoystickState = {
    active: false,
    originX: 0,
    originY: 0,
    knobX: 0,
    knobY: 0,
  };

  private pointerId: number | null = null;
  private readonly pressedKeys = new Set<string>();

  constructor(
    private readonly surface: HTMLElement,
    private readonly sink: IntentSink,
  ) {}

  attach(): void {
    this.surface.addEventListener('pointerdown', this.onPointerDown);
    this.surface.addEventListener('pointermove', this.onPointerMove);
    this.surface.addEventListener('pointerup', this.onPointerUp);
    this.surface.addEventListener('pointercancel', this.onPointerUp);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
  }

  detach(): void {
    this.surface.removeEventListener('pointerdown', this.onPointerDown);
    this.surface.removeEventListener('pointermove', this.onPointerMove);
    this.surface.removeEventListener('pointerup', this.onPointerUp);
    this.surface.removeEventListener('pointercancel', this.onPointerUp);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    this.pressedKeys.clear();
    this.joystick.active = false;
    this.pointerId = null;
  }

  // ------------------------------------------------------------- اللمس

  private onPointerDown = (event: PointerEvent): void => {
    if (this.pointerId !== null) return;
    this.pointerId = event.pointerId;
    this.surface.setPointerCapture?.(event.pointerId);

    const point = toLocalPoint(event.clientX, event.clientY);
    this.joystick.active = true;
    this.joystick.originX = point.x;
    this.joystick.originY = point.y;
    this.joystick.knobX = point.x;
    this.joystick.knobY = point.y;
    event.preventDefault();
  };

  private onPointerMove = (event: PointerEvent): void => {
    if (this.pointerId !== event.pointerId) return;

    const point = toLocalPoint(event.clientX, event.clientY);
    let dx = point.x - this.joystick.originX;
    let dy = point.y - this.joystick.originY;
    const distance = Math.hypot(dx, dy);

    // الإصبع أبعد من نصف القطر: نُزحزح المركز خلفه بدل تقييد المدى،
    // فيبقى التحكم تحت الإصبع وتبقى السرعة قصوى لا متغيّرة مع بُعد السحب.
    if (distance > MAX_RADIUS) {
      const scale = MAX_RADIUS / distance;
      this.joystick.originX = point.x - dx * scale;
      this.joystick.originY = point.y - dy * scale;
      dx *= scale;
      dy *= scale;
    }
    this.joystick.knobX = this.joystick.originX + dx;
    this.joystick.knobY = this.joystick.originY + dy;

    const clamped = Math.hypot(dx, dy);
    if (clamped < DEAD_ZONE) return;

    // الاتجاه من متجه العصا مباشرة — أي زاوية، بلا تقريب.
    this.sink.onIntent(Math.atan2(dy, dx), throttleFor(clamped));
    event.preventDefault();
  };

  private onPointerUp = (event: PointerEvent): void => {
    if (this.pointerId !== event.pointerId) return;
    this.pointerId = null;
    this.joystick.active = false;
    this.sink.onRelease();
  };

  // ------------------------------------------------- لوحة المفاتيح

  private onKeyDown = (event: KeyboardEvent): void => {
    if (!(event.key in KEY_VECTORS)) return;
    this.pressedKeys.add(event.key);
    this.emitKeys();
    event.preventDefault();
  };

  private onKeyUp = (event: KeyboardEvent): void => {
    if (!this.pressedKeys.delete(event.key)) return;
    this.emitKeys();
  };

  private onBlur = (): void => {
    this.pressedKeys.clear();
  };

  /** تُجمع المفاتيح المضغوطة في متجه واحد، فيعطي الضغط المزدوج قطريًا حقيقيًا. */
  private emitKeys(): void {
    let x = 0;
    let y = 0;
    for (const key of this.pressedKeys) {
      const vector = KEY_VECTORS[key];
      if (!vector) continue;
      x += vector[0];
      y += vector[1];
    }
    if (x === 0 && y === 0) {
      this.sink.onRelease();
      return;
    }
    this.sink.onIntent(Math.atan2(y, x), 1);
  }
}

/**
 * إحداثيات المؤشر تصل في فضاء الشاشة، والمحتوى قد يكون مُدارًا 90 درجة.
 * بلا هذا التحويل يتحرك اللاعب عموديًا حين يسحب اللاعب أفقيًا.
 */
function toLocalPoint(clientX: number, clientY: number): { x: number; y: number } {
  if (!isRotated()) return { x: clientX, y: clientY };
  const width = window.visualViewport?.width ?? window.innerWidth;
  return { x: clientY, y: width - clientX };
}

/** تدرّج خطي من أدنى سرعة عند حافة المنطقة الميتة إلى السرعة الكاملة عند الحافة. */
function throttleFor(distance: number): number {
  const ratio = (distance - DEAD_ZONE) / (MAX_RADIUS - DEAD_ZONE);
  const clamped = ratio < 0 ? 0 : ratio > 1 ? 1 : ratio;
  return MIN_THROTTLE + (1 - MIN_THROTTLE) * clamped;
}
