export function clampPointerSpeed(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 1;
  return Math.max(0.5, Math.min(3, numeric));
}

export function scalePointerDelta(dx, dy, speed) {
  const multiplier = clampPointerSpeed(speed);
  return { dx: dx * multiplier, dy: dy * multiplier };
}

export function clampScrollWidth(trackpadWidth, value) {
  const availableWidth = Math.max(0, Number(trackpadWidth) || 0);
  const maximumWidth = Math.max(38, availableWidth * 0.45);
  const numeric = Number(value);
  return Math.max(38, Math.min(maximumWidth, Number.isFinite(numeric) ? numeric : 38));
}

export class HoldState {
  constructor(onDown, onUp) {
    this.onDown = onDown;
    this.onUp = onUp;
    this.active = false;
  }

  press() {
    if (this.active) return;
    this.active = true;
    this.onDown();
  }

  release() {
    if (!this.active) return;
    this.active = false;
    this.onUp();
  }
}

export class TapDetector {
  constructor(options = {}) {
    this.interval = options.interval ?? 350;
    this.distance = options.distance ?? 24;
  }

  register(tap) {
    const previous = this.previous;
    this.previous = tap;
    if (!previous) return 1;
    const elapsed = tap.time - previous.time;
    const distance = Math.hypot(tap.x - previous.x, tap.y - previous.y);
    if (elapsed >= 0 && elapsed <= this.interval && distance <= this.distance) {
      this.previous = undefined;
      return 2;
    }
    return 1;
  }
}
