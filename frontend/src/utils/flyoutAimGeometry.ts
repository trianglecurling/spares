export type FlyoutDirection = 'left' | 'right';

export interface Point {
  x: number;
  y: number;
}

export function pointInRect(p: Point, r: DOMRect, tol = 0): boolean {
  return p.x >= r.left - tol && p.x <= r.right + tol && p.y >= r.top - tol && p.y <= r.bottom + tol;
}

function aimTriangleCorners(
  rect: DOMRect,
  direction: FlyoutDirection,
  tol: number,
): { topCorner: Point; bottomCorner: Point } {
  if (direction === 'right') {
    return {
      topCorner: { x: rect.left, y: rect.top - tol },
      bottomCorner: { x: rect.left, y: rect.bottom + tol },
    };
  }
  return {
    topCorner: { x: rect.right, y: rect.top - tol },
    bottomCorner: { x: rect.right, y: rect.bottom + tol },
  };
}

/** Barycentric point-in-triangle test. */
export function pointInTriangle(p: Point, a: Point, b: Point, c: Point): boolean {
  const sign = (p1: Point, p2: Point, p3: Point) =>
    (p1.x - p3.x) * (p2.y - p3.y) - (p2.x - p3.x) * (p1.y - p3.y);
  const d1 = sign(p, a, b);
  const d2 = sign(p, b, c);
  const d3 = sign(p, c, a);
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNeg && hasPos);
}

/**
 * True when `p` lies inside the safe triangle from the row activation point
 * (`apex`) to the open submenu's near edge.
 */
export function isPointInAimTriangle(
  p: Point,
  apex: Point,
  rect: DOMRect,
  direction: FlyoutDirection,
  tol = 8,
): boolean {
  const { topCorner, bottomCorner } = aimTriangleCorners(rect, direction, tol);
  return pointInTriangle(p, apex, topCorner, bottomCorner);
}

/**
 * True when movement from `prev` to `loc` heads into the triangle between the
 * cursor and the open submenu's near edge (Amazon menu wedge).
 *
 * Uses the last two pointer samples — not an older buffered point.
 */
export function isAimingAtSubmenu(
  prev: Point,
  loc: Point,
  rect: DOMRect,
  direction: FlyoutDirection,
  tol = 8,
): boolean {
  const slope = (a: Point, b: Point) => (b.y - a.y) / (b.x - a.x);
  const { topCorner, bottomCorner } = aimTriangleCorners(rect, direction, tol);

  if (direction === 'right') {
    return (
      slope(loc, topCorner) < slope(prev, topCorner) &&
      slope(loc, bottomCorner) > slope(prev, bottomCorner)
    );
  }

  return (
    slope(loc, topCorner) > slope(prev, topCorner) &&
    slope(loc, bottomCorner) < slope(prev, bottomCorner)
  );
}
