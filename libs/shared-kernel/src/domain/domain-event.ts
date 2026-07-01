/** Marker interface for a domain event emitted by an aggregate. */
export interface DomainEvent {
  readonly eventType: string;
  readonly occurredAt: Date;
  readonly aggregateId: string;
}
