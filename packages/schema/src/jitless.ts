import { z } from 'zod';

// Zod compiles object schemas with `new Function` where it can, and probes
// for that with an eval of its own. Under a content security policy without
// 'unsafe-eval' the probe fails and it falls back; without one it reports a
// violation per compile. Jitless everywhere: one behaviour, no eval, same
// results.
//
// Zod decides per schema, at definition time, so this has to run before the
// first `z.object()` anywhere in the bundle: it is the first import of this
// package's index and of every browser entry (ESM evaluates imports depth
// first, in order). A `z.config()` call in a module body comes too late,
// because that module's own imports have already defined their schemas.
z.config({ jitless: true });
