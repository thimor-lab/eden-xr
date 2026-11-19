import { describe, expect, it } from 'vitest';
import { GestureRecognizer, Point2D } from '../src/xr/GestureRecognizer';

describe('GestureRecognizer', () => {
  const rec = new GestureRecognizer();

  it('recognizes a circle as food miracle', () => {
    const pts: Point2D[] = [];
    for (let i = 0; i <= 32; i++) {
      const a = (i / 32) * Math.PI * 2;
      pts.push({ x: Math.cos(a) * 100, y: Math.sin(a) * 100 });
    }
    const match = rec.recognize2D(pts);
    expect(match?.type).toBe('food');
    expect(match!.score).toBeGreaterThan(0.75);
  });

  it('recognizes a triangle as wood miracle', () => {
    const pts: Point2D[] = [
      { x: 0, y: 120 },
      { x: 105, y: -80 },
      { x: -105, y: -80 },
      { x: 0, y: 120 },
    ];
    const match = rec.recognize2D(pts);
    expect(match?.type).toBe('wood');
    expect(match!.score).toBeGreaterThan(0.75);
  });

  it('recognizes a horizontal wave as rain miracle', () => {
    const pts: Point2D[] = [];
    for (let i = 0; i <= 32; i++) {
      const t = i / 32;
      pts.push({ x: -100 + t * 200, y: Math.sin(t * Math.PI * 2) * 45 });
    }
    const match = rec.recognize2D(pts);
    expect(match?.type).toBe('rain');
    expect(match!.score).toBeGreaterThan(0.75);
  });

  it('recognizes a spiral as fireball miracle', () => {
    const pts: Point2D[] = [];
    for (let i = 0; i <= 40; i++) {
      const t = i / 40;
      const a = t * Math.PI * 4;
      const r = 20 + t * 85;
      pts.push({ x: Math.cos(a) * r, y: Math.sin(a) * r });
    }
    const match = rec.recognize2D(pts);
    expect(match?.type).toBe('fireball');
    expect(match!.score).toBeGreaterThan(0.75);
  });

  it('recognizes a Z zigzag as lightning miracle', () => {
    const pts: Point2D[] = [
      { x: -80, y: 90 },
      { x: 80, y: 90 },
      { x: -80, y: -10 },
      { x: 80, y: -90 },
    ];
    const match = rec.recognize2D(pts);
    expect(match?.type).toBe('lightning');
    expect(match!.score).toBeGreaterThan(0.75);
  });

  it('returns null for too few points', () => {
    expect(rec.recognize2D([{ x: 0, y: 0 }])).toBeNull();
  });
});
