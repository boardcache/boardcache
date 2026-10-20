/**
 * Built-in plugin loader: every directory under src/plugins/ with an
 * index.tsx IS a plugin — importing it registers it (registerPlugin side
 * effect). Add a directory, get a plugin; no list to maintain. Menu order
 * comes from manifest.order, not import order.
 */
const modules = import.meta.glob('./*/index.tsx', { eager: true });
void modules;
