import * as THREE from 'three';
import { MiracleType } from '../core/EventBus';

export interface Point2D {
  x: number;
  y: number;
}

export interface GestureMatch {
  type: MiracleType;
  score: number;
}

const NUM_POINTS = 32;
const SQUARE_SIZE = 250;

function resample(points: Point2D[], n: number): Point2D[] {
  if (points.length === 0) return [];
  const totalLen = pathLength(points);
  if (totalLen < 1e-4) return Array.from({ length: n }, () => ({ ...points[0] }));
  const interval = totalLen / (n - 1);
  let D = 0;
  const newPoints: Point2D[] = [{ ...points[0] }];
  const pts = points.map((p) => ({ ...p }));

  for (let i = 1; i < pts.length; i++) {
    const d = dist(pts[i - 1], pts[i]);
    if (D + d >= interval) {
      const qx = pts[i - 1].x + ((interval - D) / d) * (pts[i].x - pts[i - 1].x);
      const qy = pts[i - 1].y + ((interval - D) / d) * (pts[i].y - pts[i - 1].y);
      const q = { x: qx, y: qy };
      newPoints.push(q);
      pts.splice(i, 0, q);
      D = 0;
    } else {
      D += d;
    }
  }
  while (newPoints.length < n) {
    newPoints.push({ ...pts[pts.length - 1] });
  }
  return newPoints;
}

function pathLength(points: Point2D[]): number {
  let d = 0;
  for (let i = 1; i < points.length; i++) {
    d += dist(points[i - 1], points[i]);
  }
  return d;
}

function dist(a: Point2D, b: Point2D): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function centroid(points: Point2D[]): Point2D {
  let x = 0;
  let y = 0;
  for (const p of points) {
    x += p.x;
    y += p.y;
  }
  return { x: x / points.length, y: y / points.length };
}

function boundingBox(points: Point2D[]): { w: number; h: number } {
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  return { w: Math.max(1e-3, maxX - minX), h: Math.max(1e-3, maxY - minY) };
}

function normalize(points: Point2D[]): Point2D[] {
  const resampled = resample(points, NUM_POINTS);
  const c = centroid(resampled);
  const translated = resampled.map((p) => ({ x: p.x - c.x, y: p.y - c.y }));
  const box = boundingBox(translated);
  const scale = SQUARE_SIZE / Math.max(box.w, box.h);
  return translated.map((p) => ({ x: p.x * scale, y: p.y * scale }));
}

function pathDistance(a: Point2D[], b: Point2D[]): number {
  let d = 0;
  for (let i = 0; i < a.length; i++) {
    d += dist(a[i], b[i]);
  }
  return d / a.length;
}

function buildTemplates(): { type: MiracleType; points: Point2D[] }[] {
  // Circle (Food)
  const circle: Point2D[] = [];
  for (let i = 0; i <= 32; i++) {
    const a = (i / 32) * Math.PI * 2;
    circle.push({ x: Math.cos(a), y: Math.sin(a) });
  }

  // Triangle (Wood)
  const triangle: Point2D[] = [
    { x: 0, y: 1 },
    { x: 0.9, y: -0.7 },
    { x: -0.9, y: -0.7 },
    { x: 0, y: 1 },
  ];

  // Horizontal Wave (Rain)
  const wave: Point2D[] = [];
  for (let i = 0; i <= 32; i++) {
    const t = i / 32;
    wave.push({ x: -1 + t * 2, y: Math.sin(t * Math.PI * 2) * 0.45 });
  }

  // Spiral (Fireball)
  const spiral: Point2D[] = [];
  for (let i = 0; i <= 40; i++) {
    const t = i / 40;
    const a = t * Math.PI * 4;
    const r = 0.2 + t * 0.85;
    spiral.push({ x: Math.cos(a) * r, y: Math.sin(a) * r });
  }

  // Zigzag Z (Lightning)
  const zigzag: Point2D[] = [
    { x: -0.8, y: 0.9 },
    { x: 0.8, y: 0.9 },
    { x: -0.8, y: -0.1 },
    { x: 0.8, y: -0.9 },
  ];

  return [
    { type: 'food', points: normalize(circle) },
    { type: 'wood', points: normalize(triangle) },
    { type: 'rain', points: normalize(wave) },
    { type: 'fireball', points: normalize(spiral) },
    { type: 'lightning', points: normalize(zigzag) },
  ];
}

/**
 * Recognizes 3D air-drawn miracle gestures (projected onto the camera plane)
 * and renders a glowing 3D light ribbon while drawing.
 */
export class GestureRecognizer {
  private readonly templates = buildTemplates();
  private readonly raw3D: THREE.Vector3[] = [];
  private readonly ribbonLine: THREE.Line;
  private readonly ribbonMat: THREE.LineBasicMaterial;
  private drawing = false;

  constructor(scene?: THREE.Scene) {
    this.ribbonMat = new THREE.LineBasicMaterial({ color: 0xffe484, transparent: true, opacity: 0.92 });
    this.ribbonLine = new THREE.Line(new THREE.BufferGeometry(), this.ribbonMat);
    this.ribbonLine.frustumCulled = false;
    this.ribbonLine.visible = false;
    scene?.add(this.ribbonLine);
  }

  get isDrawing(): boolean {
    return this.drawing;
  }

  beginStroke(startWorldPos: THREE.Vector3): void {
    this.drawing = true;
    this.raw3D.length = 0;
    this.raw3D.push(startWorldPos.clone());
    this.ribbonLine.visible = true;
    this.updateRibbon();
  }

  addPoint(worldPos: THREE.Vector3): void {
    if (!this.drawing) return;
    const last = this.raw3D[this.raw3D.length - 1];
    if (!last || last.distanceToSquared(worldPos) > 0.0004) {
      this.raw3D.push(worldPos.clone());
      this.updateRibbon();
    }
  }

  endStroke(camera: THREE.Camera): GestureMatch | null {
    this.drawing = false;
    this.ribbonLine.visible = false;
    if (this.raw3D.length < 8) {
      this.raw3D.length = 0;
      return null;
    }

    // Project 3D stroke onto camera's right/up basis for view-independent recognition
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
    const pts2D: Point2D[] = this.raw3D.map((p) => ({
      x: p.dot(right),
      y: p.dot(up),
    }));

    this.raw3D.length = 0;
    return this.recognize2D(pts2D);
  }

  recognize2D(points: Point2D[]): GestureMatch | null {
    if (points.length < 4) return null;
    const candidate = normalize(points);
    const candidateReversed = [...candidate].reverse();

    let bestType: MiracleType = 'food';
    let bestDist = Infinity;

    for (const tmpl of this.templates) {
      const d1 = pathDistance(candidate, tmpl.points);
      const d2 = pathDistance(candidateReversed, tmpl.points);
      const d = Math.min(d1, d2);
      if (d < bestDist) {
        bestDist = d;
        bestType = tmpl.type;
      }
    }

    const halfDiag = 0.5 * Math.hypot(SQUARE_SIZE, SQUARE_SIZE);
    const score = Math.max(0, 1 - bestDist / halfDiag);
    if (score < 0.45) return null;
    return { type: bestType, score };
  }

  private updateRibbon(): void {
    this.ribbonLine.geometry.dispose();
    this.ribbonLine.geometry = new THREE.BufferGeometry().setFromPoints(this.raw3D);
  }
}
