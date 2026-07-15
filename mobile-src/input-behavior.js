export function clampPointerSpeed(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 1;
  return Math.max(0.5, Math.min(3, numeric));
}

export function scalePointerDelta(dx, dy, speed) {
  const multiplier = clampPointerSpeed(speed);
  return { dx: dx * multiplier, dy: dy * multiplier };
}

export function scaleScrollDelta(delta, speed) {
  return Number(delta) * clampPointerSpeed(speed);
}

const defaultScrollZoneRatio = 0.22;
const minimumScrollZoneWidth = 52;
const maximumScrollZoneRatio = 0.45;

export function clampScrollZoneWidth(value, trackpadWidth) {
  const availableWidth = Number(trackpadWidth);
  if (!Number.isFinite(availableWidth) || availableWidth <= 0) return minimumScrollZoneWidth;
  const desiredWidth = Number(value);
  const fallbackWidth = availableWidth * defaultScrollZoneRatio;
  const maximumWidth = Math.max(minimumScrollZoneWidth, availableWidth * maximumScrollZoneRatio);
  return Math.max(
    minimumScrollZoneWidth,
    Math.min(maximumWidth, Number.isFinite(desiredWidth) ? desiredWidth : fallbackWidth),
  );
}

export function scrollZoneRatio(width, trackpadWidth) {
  const availableWidth = Number(trackpadWidth);
  if (!Number.isFinite(availableWidth) || availableWidth <= 0) return defaultScrollZoneRatio;
  return clampScrollZoneWidth(width, availableWidth) / availableWidth;
}

const legacyUtilityKeyOrder = ["escape", "tab", "space", "backspace", "enter"];
const keyboardUtilityKeyOrder = ["escape", "backspace", "tab", "space", "enter"];

export function normalizeUtilityKeyOrder(keys) {
  const ids = keys.map((item) => item.id);
  if (ids.join() !== legacyUtilityKeyOrder.join()) return keys;
  return keyboardUtilityKeyOrder.map((id) => keys.find((item) => item.id === id));
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
