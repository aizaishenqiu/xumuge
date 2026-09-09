/**
 * 虚募阁 Native Agent front-end helpers (no hermes CLI).
 * Listens to `xu:chunk` events from Rust agent / dispatch.
 */
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { StreamChunk } from "../types";

export type FouChunkHandler = (chunk: StreamChunk) => void;

/** Subscribe to Native Agent stream chunks. */
export async function listenFouChunks(handler: FouChunkHandler): Promise<UnlistenFn> {
  return listen<StreamChunk>("xu:chunk", (event) => {
    handler(event.payload);
  });
}
