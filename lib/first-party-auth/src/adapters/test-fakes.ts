import type { Clock, EpochMillis, IdGenerator } from "../shared/clock.js";
import { epochMillis } from "../shared/clock.js";
import type { EventPublisher, DomainEvent } from "../shared/events.js";

/** Deterministic clock for tests; advance manually. */
export class FakeClock implements Clock {
  private current: EpochMillis;

  constructor(start = 0) {
    this.current = epochMillis(start);
  }

  now(): EpochMillis {
    return this.current;
  }

  advance(ms: number): void {
    this.current = epochMillis(this.current + ms);
  }

  set(ms: number): void {
    this.current = epochMillis(ms);
  }
}

/** Sequential id generator for tests. */
export class SequentialIdGenerator implements IdGenerator {
  private n = 0;
  private readonly prefix: string;

  constructor(prefix = "id") {
    this.prefix = prefix;
  }

  next(): string {
    this.n += 1;
    return `${this.prefix}-${this.n}`;
  }
}

/** EventPublisher that records published events for assertions. */
export class RecordingEventPublisher implements EventPublisher {
  readonly events: DomainEvent[] = [];

  publish(event: DomainEvent): void {
    this.events.push(event);
  }
}
