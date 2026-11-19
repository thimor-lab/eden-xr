import * as THREE from 'three';

export type MiracleType = 'food' | 'wood' | 'rain' | 'fireball' | 'lightning';

export interface EdenEvents {
  'alignment:changed': { alignment: number; delta: number; reason: string };
  'miracle:cast': { type: MiracleType; position: THREE.Vector3; targetVillageId?: string };
  'object:thrown': { kind: string; position: THREE.Vector3; speed: number };
  'object:impact': { kind: string; position: THREE.Vector3; impulse: number };
  'building:completed': { villageId: string; position: THREE.Vector3; impressiveness: number };
  'building:damaged': { villageId: string; position: THREE.Vector3; amount: number; destroyed: boolean };
  'village:converted': { villageId: string; method: 'peaceful' | 'conquest' };
  'creature:action': { action: string; targetType: string; position: THREE.Vector3 };
  'creature:conditioned': { type: 'pet' | 'slap'; action: string; newWeight: number };
  'toast:show': { message: string; durationMs?: number };
}

type Listener<T> = (payload: T) => void;

export class EventBus {
  private listeners = new Map<keyof EdenEvents, Set<Listener<unknown>>>();

  on<K extends keyof EdenEvents>(event: K, listener: Listener<EdenEvents[K]>): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(listener as Listener<unknown>);
    return () => {
      set?.delete(listener as Listener<unknown>);
    };
  }

  emit<K extends keyof EdenEvents>(event: K, payload: EdenEvents[K]): void {
    const set = this.listeners.get(event);
    if (!set) return;
    for (const listener of set) {
      listener(payload);
    }
  }
}
