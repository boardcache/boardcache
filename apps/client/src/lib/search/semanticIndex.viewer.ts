/**
 * The semantic index as the viewer builds see it: every export of
 * semanticIndex.ts, doing nothing. A read-only board embeds nothing on the
 * device, and leaving the real module out keeps transformers.js, the models
 * and the embedding worker out of the viewer bundles (vite.viewer.shared.ts).
 */
export type SemanticState = 'off' | 'loading' | 'ready' | 'error';

const OFF = { state: 'off' as SemanticState, pct: 0 };

export const semanticEnabled = (): boolean => false;
export const rerankerEnabled = (): boolean => false;
export const clipEnabled = (): boolean => false;
export const localWhisperEnabled = (): boolean => false;
export function onSemanticState(_cb: () => void): () => void {
  return () => undefined;
}
export function semanticState(): { state: SemanticState; pct: number } {
  return OFF;
}
export function rerankerState(): { state: SemanticState; pct: number } {
  return OFF;
}
export function clipModelState(): { state: SemanticState; pct: number } {
  return OFF;
}
export function asrModelState(): { state: SemanticState; pct: number } {
  return OFF;
}
export async function setClipEnabled(_on: boolean): Promise<void> {}
export async function clipTextVectors(_texts: string[]): Promise<Float32Array[]> {
  return [];
}
export async function clipImageVectors(_blobs: Blob[], _hints: string[]): Promise<Float32Array[]> {
  return [];
}
export async function setLocalWhisperEnabled(_on: boolean): Promise<void> {}
export async function asrTranscribe(_pcm: Float32Array): Promise<string> {
  throw new Error('Transcription is not available in the viewer.');
}
export function warmClip(): void {}
export async function setRerankerEnabled(_on: boolean): Promise<void> {}
export async function rerankTexts(_query: string, texts: string[]): Promise<number[]> {
  return texts.map(() => 0);
}
export function rerankStats(): { enabled: boolean; state: SemanticState; reranks: number } {
  return { enabled: false, state: 'off', reranks: 0 };
}
export async function setSemanticEnabled(_on: boolean): Promise<void> {}
export function queueEmbed(_id: string, _title: string, _body: string, _key: string): void {}
export function dropVectors(_id: string): void {}
export async function boardItemVectors(): Promise<Map<string, Float32Array[]>> {
  return new Map();
}
export interface SemanticHit {
  id: string;
  score: number;
  chunkText: string;
}
export async function semanticSearch(_query: string, _limit = 12): Promise<SemanticHit[]> {
  return [];
}
export async function embedQueryVec(_query: string): Promise<Float32Array | null> {
  return null;
}
export function currentModelVersion(): string {
  return 'none';
}
export function clearMemory(): void {}
export function semanticStats(): { enabled: boolean; state: SemanticState; vectors: number } {
  return { enabled: false, state: 'off', vectors: 0 };
}
