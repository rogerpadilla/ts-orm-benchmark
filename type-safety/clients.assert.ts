/**
 * Keeps `clients.ts` honest. That file declares each client structurally so the probes can be compiled
 * in a browser, away from `src/clients.ts` and the `pg` pool, driver adapter and Bun globals it opens.
 * Structural means it can drift, and a drifted context scores the probes against a client nobody holds.
 *
 * So the real one is assigned to the declared one here, in a file that carries no probe and is compiled
 * with them: the day `src/clients.ts` hands out something else, this stops compiling and the run stops
 * with it. Types only - nothing here runs, and nothing here connects.
 */

import type { Clients } from '../src/clients';
import type { clients } from './clients';

/** Fails to compile unless `Actual` satisfies `Expected`, which is the whole of this file's job. */
type Satisfies<Actual extends Expected, Expected> = Actual;

/** What the benchmark creates has to be everything the probes were written against. */
export type Checked = Satisfies<Clients, typeof clients>;
