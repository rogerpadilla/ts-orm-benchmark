/**
 * Keeps `clients.ts` honest: the real clients are assigned to the declared ones, so this stops compiling the day
 * `src/clients.ts` hands out something else. Types only.
 */

import type { Clients } from '../src/clients';
import type { clients } from './clients';

/** Fails to compile unless `Actual` satisfies `Expected`, which is the whole of this file's job. */
type Satisfies<Actual extends Expected, Expected> = Actual;

/** What the benchmark creates has to be everything the probes were written against. */
export type Checked = Satisfies<Clients, typeof clients>;
