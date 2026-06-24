/**
 * Event trigger handler — listens for ODW agent events (§9.1–9.3).
 */

import { createLogger } from '@loop/observability';
import { TriggerDispatcher, type TriggerEvent } from './dispatcher.js';

const logger = createLogger({ name: 'loop:triggers:event', component: 'triggers' });

export class EventTriggerHandler {
  constructor(private dispatcher: TriggerDispatcher) {}

  /** Receive an event from an ODW agent and dispatch to matching triggers. */
  async receive(event: TriggerEvent): Promise<string[]> {
    logger.info({ source: event.source, event_type: event.event_type }, 'Event received');
    return this.dispatcher.dispatch(event);
  }
}
