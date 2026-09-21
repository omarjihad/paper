import type { Dir } from '@riqaa/game-core';

export interface JoystickState {
  active: boolean;
  originX: number;
  originY: number;
  knobX: number;
  knobY: number;
}

const DEAD_ZONE = 16;
const MAX_RADIUS = 58;

/**
 * إدخال موحّد: عصا تحكم تظهر تحت الإصبع أينما لمس + لوحة مفاتيح للتطوير.
 * لا أزرار ثابتة تغطي الشاشة.
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
  private lastDirection: Dir | null = null;

  constructor(
    private readonly surface: HTMLElement,
    private readonly onDirection: (dir: Dir) => void,
  ) {}

  attach(): void {
    this.surface.addEventListener('pointerdown', this.onPointerDown);
    this.surface.addEventListener('pointermove', this.onPointerMove);
    this.surface.addEventListener('pointerup', this.onPointerUp);
    this.surface.addEventListener('pointercancel', this.onPointerUp);
    window.addEventListener('keydown', this.onKeyDown);
  }

  detach(): void {
    this.surface.removeEventListener('pointerdown', this.onPointerDown);
    this.surface.removeEventListener('pointermove', this.onPointerMove);
    this.surface.removeEventListener('pointerup', this.onPointerUp);
    this.surface.removeEventListener('pointercancel', this.onPointerUp);
    window.removeEventListener('keydown', this.onKeyDown);
    this.joystick.active = false;
    this.pointerId = null;
  }

  private onPointerDown = (event: PointerEvent): void => {
    if (this.pointerId !== null) return;
    this.pointerId = event.pointerId;
    this.surface.setPointerCapture?.(event.pointerId);
    this.joystick.active = true;
    this.joystick.originX = event.clientX;
    this.joystick.originY = event.clientY;
    this.joystick.knobX = event.clientX;
    this.joystick.knobY = event.clientY;
    event.preventDefault();
  };

  private onPointerMove = (event: PointerEvent): void => {
    if (this.pointerId !== event.pointerId) return;

    let dx = event.clientX - this.joystick.originX;
    let dy = event.clientY - this.joystick.originY;
    const distance = Math.hypot(dx, dy);

    // إذا ابتعد الإصبع كثيرًا نُزحزح المركز خلفه: تحكّم يبقى تحت الإصبع دائمًا.
    if (distance > MAX_RADIUS) {
      const scale = MAX_RADIUS / distance;
      this.joystick.originX = event.clientX - dx * scale;
      this.joystick.originY = event.clientY - dy * scale;
      dx *= scale;
      dy *= scale;
    }
    this.joystick.knobX = this.joystick.originX + dx;
    this.joystick.knobY = this.joystick.originY + dy;

    if (distance < DEAD_ZONE) return;
    this.emit(this.resolveDirection(dx, dy));
    event.preventDefault();
  };

  private onPointerUp = (event: PointerEvent): void => {
    if (this.pointerId !== event.pointerId) return;
    this.pointerId = null;
    this.joystick.active = false;
  };

  private onKeyDown = (event: KeyboardEvent): void => {
    const direction = keyToDirection(event.key);
    if (direction === null) return;
    this.emit(direction);
    event.preventDefault();
  };

  /** اختيار المحور المسيطر مع هامش يمنع الاهتزاز بين محورين متقاربين. */
  private resolveDirection(dx: number, dy: number): Dir {
    const horizontal = Math.abs(dx) > Math.abs(dy) * 1.15;
    const vertical = Math.abs(dy) > Math.abs(dx) * 1.15;

    if (horizontal) return dx > 0 ? 0 : 2;
    if (vertical) return dy > 0 ? 1 : 3;
    // منطقة قطرية: أبقِ الاتجاه السابق إن وُجد.
    return this.lastDirection ?? (Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? 0 : 2) : dy > 0 ? 1 : 3);
  }

  private emit(direction: Dir): void {
    if (direction === this.lastDirection) return;
    this.lastDirection = direction;
    this.onDirection(direction);
  }
}

function keyToDirection(key: string): Dir | null {
  switch (key) {
    case 'ArrowRight':
    case 'd':
    case 'D':
      return 0;
    case 'ArrowDown':
    case 's':
    case 'S':
      return 1;
    case 'ArrowLeft':
    case 'a':
    case 'A':
      return 2;
    case 'ArrowUp':
    case 'w':
    case 'W':
      return 3;
    default:
      return null;
  }
}
