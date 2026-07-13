import assert from "node:assert/strict";
import test from "node:test";

import {
  HoldState,
  TapDetector,
  clampPointerSpeed,
  scalePointerDelta,
  scaleScrollDelta,
} from "./input-behavior.js";

test("pointer speed is bounded and scales movement", () => {
  assert.equal(clampPointerSpeed(0.1), 0.5);
  assert.equal(clampPointerSpeed(4), 3);
  assert.deepEqual(scalePointerDelta(10, -4, 1.5), { dx: 15, dy: -6 });
});

test("hold state sends one down and no up until release", () => {
  const calls = [];
  const hold = new HoldState(
    () => calls.push("down"),
    () => calls.push("up"),
  );

  hold.press();
  hold.press();
  assert.deepEqual(calls, ["down"]);
  assert.equal(hold.active, true);
  hold.release();
  hold.release();
  assert.deepEqual(calls, ["down", "up"]);
  assert.equal(hold.active, false);
});

test("tap detector marks a nearby second tap as a double click", () => {
  const detector = new TapDetector({ interval: 350, distance: 24 });
  assert.equal(detector.register({ x: 20, y: 30, time: 1_000 }), 1);
  assert.equal(detector.register({ x: 28, y: 35, time: 1_240 }), 2);
  assert.equal(detector.register({ x: 100, y: 100, time: 1_300 }), 1);
  assert.equal(detector.register({ x: 101, y: 101, time: 1_800 }), 1);
});

test("scroll speed is bounded and scales the travelled distance", () => {
  assert.equal(scaleScrollDelta(10, 0.1), 5);
  assert.equal(scaleScrollDelta(10, 1.5), 15);
  assert.equal(scaleScrollDelta(10, 4), 30);
});
