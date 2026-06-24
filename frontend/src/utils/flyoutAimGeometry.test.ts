import { describe, expect, test } from 'bun:test';
import { isAimingAtSubmenu, isPointInAimTriangle, pointInRect, pointInTriangle } from './flyoutAimGeometry';

function rect(left: number, top: number, right: number, bottom: number): DOMRect {
  return {
    left,
    top,
    right,
    bottom,
    width: right - left,
    height: bottom - top,
    x: left,
    y: top,
    toJSON: () => ({}),
  } as DOMRect;
}

describe('isAimingAtSubmenu', () => {
  const submenu = rect(200, 100, 320, 220);

  test('right-opening: horizontal move toward submenu is aiming', () => {
    const prev = { x: 150, y: 150 };
    const loc = { x: 180, y: 150 };
    expect(isAimingAtSubmenu(prev, loc, submenu, 'right')).toBe(true);
  });

  test('right-opening: straight down to a sibling row is not aiming', () => {
    const prev = { x: 150, y: 150 };
    const loc = { x: 150, y: 190 };
    expect(isAimingAtSubmenu(prev, loc, submenu, 'right')).toBe(false);
  });

  test('right-opening: diagonal toward submenu lower area is aiming', () => {
    const prev = { x: 150, y: 150 };
    const loc = { x: 175, y: 175 };
    expect(isAimingAtSubmenu(prev, loc, submenu, 'right')).toBe(true);
  });

  test('left-opening: horizontal move toward submenu is aiming', () => {
    const prev = { x: 250, y: 150 };
    const loc = { x: 210, y: 150 };
    expect(isAimingAtSubmenu(prev, loc, submenu, 'left')).toBe(true);
  });

  test('left-opening: straight down to a sibling row is not aiming', () => {
    const prev = { x: 250, y: 150 };
    const loc = { x: 250, y: 190 };
    expect(isAimingAtSubmenu(prev, loc, submenu, 'left')).toBe(false);
  });

  test('point inside aim triangle from row toward submenu', () => {
    const apex = { x: 150, y: 150 };
    const onPath = { x: 175, y: 160 };
    expect(isPointInAimTriangle(onPath, apex, submenu, 'right')).toBe(true);
  });

  test('point below aim triangle is outside the wedge', () => {
    const apex = { x: 150, y: 150 };
    const below = { x: 160, y: 250 };
    expect(isPointInAimTriangle(below, apex, submenu, 'right')).toBe(false);
  });
});

describe('pointInRect', () => {
  test('detects points inside a rect', () => {
    const r = rect(10, 10, 20, 20);
    expect(pointInRect({ x: 15, y: 15 }, r)).toBe(true);
    expect(pointInRect({ x: 5, y: 15 }, r)).toBe(false);
  });
});
