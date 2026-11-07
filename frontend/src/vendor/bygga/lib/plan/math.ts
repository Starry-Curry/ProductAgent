import type { Pose, Vec3 } from "../types";

export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const mul = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
export const neg = (a: Vec3): Vec3 => [-a[0], -a[1], -a[2]];

function rx(v: Vec3, a: number): Vec3 {
  const c = Math.cos(a), s = Math.sin(a);
  return [v[0], v[1] * c - v[2] * s, v[1] * s + v[2] * c];
}
function ry(v: Vec3, a: number): Vec3 {
  const c = Math.cos(a), s = Math.sin(a);
  return [v[0] * c + v[2] * s, v[1], -v[0] * s + v[2] * c];
}
function rz(v: Vec3, a: number): Vec3 {
  const c = Math.cos(a), s = Math.sin(a);
  return [v[0] * c - v[1] * s, v[0] * s + v[1] * c, v[2]];
}

/** Rotate by an XYZ Euler (same convention as three.js): R = Rx * Ry * Rz */
export function rotate(v: Vec3, e: Vec3): Vec3 {
  return rx(ry(rz(v, e[2]), e[1]), e[0]);
}
export function unrotate(v: Vec3, e: Vec3): Vec3 {
  return rz(ry(rx(v, -e[0]), -e[1]), -e[2]);
}

export function toLocal(p: Vec3, pos: Vec3, rot: Vec3): Vec3 {
  return unrotate(sub(p, pos), rot);
}
export function toWorld(p: Vec3, pos: Vec3, rot: Vec3): Vec3 {
  return add(rotate(p, rot), pos);
}

export const POSE_EULER: Record<Pose, Vec3> = {
  "+y": [0, 0, 0],
  "-y": [Math.PI, 0, 0],
  "+z": [-Math.PI / 2, 0, 0],
  "-z": [Math.PI / 2, 0, 0],
  "+x": [0, 0, Math.PI / 2],
  "-x": [0, 0, -Math.PI / 2],
};

export const round = (n: number) => Math.round(n * 10) / 10;
export const clamp = (n: number, a: number, b: number) => Math.min(b, Math.max(a, n));
