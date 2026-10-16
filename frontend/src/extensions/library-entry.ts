/**
 * The packaged renderer does not load this file as a DOM observer.
 * `scripts/lib/library-host-renderer-patch.mjs` compiles `RLibraryHost`
 * into the overview chunk and renders it with that chunk's React.
 */
export { RLibraryHost, libraryDesktopFromWindow } from "./library-host-mount";
