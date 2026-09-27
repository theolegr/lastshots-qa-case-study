// Pure participant-roster logic — no database, no side effects.

export interface RosterParticipant {
  id: string;
}

/**
 * Merges a realtime-delivered participant into the known roster.
 *
 * Idempotent by `id`, which is the whole point (BUG-005). `PartyLobby` fetches
 * the roster once and *also* subscribes to `participants` INSERT events. Those
 * two sources overlap: anyone already returned by the fetch shows up again as
 * an INSERT whenever the event lands after the fetch resolves. Whether that
 * happens is pure timing — locally the event almost always arrives first and is
 * discarded, in CI it usually arrives second and the person is rendered twice.
 *
 * Returning `prev` unchanged when the id is known also keeps the reference
 * stable, so React skips a re-render instead of producing an identical list.
 */
export function mergeParticipant<P extends RosterParticipant>(
  prev: P[],
  incoming: P
): P[] {
  return prev.some((p) => p.id === incoming.id) ? prev : [...prev, incoming];
}
