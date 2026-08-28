import { describe, expect, test } from 'bun:test';
import {
  BRACKET_CANVAS_MAX_ZOOM,
  BRACKET_CANVAS_MIN_ZOOM,
  bracketContentPointFromShell,
  bracketPanForContentPoint,
  bracketPinchZoomFromDistance,
  clampBracketCanvasZoom,
} from './useBracketCanvasView';

describe('clampBracketCanvasZoom', () => {
  test('clamps to min and max', () => {
    expect(clampBracketCanvasZoom(0.1)).toBe(BRACKET_CANVAS_MIN_ZOOM);
    expect(clampBracketCanvasZoom(10)).toBe(BRACKET_CANVAS_MAX_ZOOM);
    expect(clampBracketCanvasZoom(1.5)).toBe(1.5);
  });
});

describe('bracket pinch zoom around a point', () => {
  test('doubling finger distance doubles zoom and keeps content under the centroid', () => {
    const pan = { x: 10, y: 20 };
    const zoom = 1;
    const shellX = 100;
    const shellY = 80;
    const content = bracketContentPointFromShell({
      shellX,
      shellY,
      panX: pan.x,
      panY: pan.y,
      zoom,
    });
    const nextZoom = bracketPinchZoomFromDistance(zoom, 40, 80);
    expect(nextZoom).toBe(2);
    const nextPan = bracketPanForContentPoint({
      shellX,
      shellY,
      contentX: content.x,
      contentY: content.y,
      zoom: nextZoom,
    });
    const underCentroid = bracketContentPointFromShell({
      shellX,
      shellY,
      panX: nextPan.x,
      panY: nextPan.y,
      zoom: nextZoom,
    });
    expect(underCentroid.x).toBeCloseTo(content.x);
    expect(underCentroid.y).toBeCloseTo(content.y);
  });

  test('moving the centroid pans while keeping the same content point underneath', () => {
    const start = bracketContentPointFromShell({
      shellX: 50,
      shellY: 40,
      panX: 8,
      panY: 12,
      zoom: 1,
    });
    const nextZoom = bracketPinchZoomFromDistance(1, 30, 45);
    const nextPan = bracketPanForContentPoint({
      shellX: 90,
      shellY: 70,
      contentX: start.x,
      contentY: start.y,
      zoom: nextZoom,
    });
    const underNewCentroid = bracketContentPointFromShell({
      shellX: 90,
      shellY: 70,
      panX: nextPan.x,
      panY: nextPan.y,
      zoom: nextZoom,
    });
    expect(underNewCentroid.x).toBeCloseTo(start.x);
    expect(underNewCentroid.y).toBeCloseTo(start.y);
    expect(nextZoom).toBe(1.5);
  });
});
