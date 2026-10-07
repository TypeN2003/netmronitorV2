import { EventEmitter } from 'node:events';

export type NetMonitorEvent =
  | { type: 'telemetry'; at: string; polled: number; reachable: number; failed: number }
  | { type: 'alert'; at: string; alertId: string; severity: string; deviceName: string; message: string }
  | { type: 'device'; at: string; deviceId: string; action: 'created' | 'updated' | 'deleted' }
  | { type: 'syslog'; at: string; host: string; severity: string; message: string }
  | { type: 'settings'; at: string };

/**
 * In-process pub/sub that backs the `/api/stream` SSE endpoint.
 *
 * The frontend subscribes once and refetches the collections an event touched,
 * instead of polling every endpoint on a timer.
 */
class EventBus extends EventEmitter {
  publish(event: NetMonitorEvent): void {
    this.emit('event', event);
  }

  subscribe(listener: (event: NetMonitorEvent) => void): () => void {
    this.on('event', listener);
    return () => this.off('event', listener);
  }
}

export const events = new EventBus();
// One listener per connected browser tab; the default cap of 10 is too low for a NOC wall.
events.setMaxListeners(200);
