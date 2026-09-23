/** Browser-only content port. Hosts report accumulated public text, never model-private reasoning. */
export type PresenceTextUpdate = {
  text: string;
  /** Stable while a message grows; changes for a replacement or a deliberately revisited record. */
  revision: number;
  streaming: boolean;
  reducedMotion: boolean;
};
export type PresenceTextRenderer = {
  render(update: PresenceTextUpdate): void;
  /** The whole message as a reader would hear it, independent of how much is revealed so far. */
  readText?(): string;
  dispose(): void;
};
export type PresenceTextFactory = (container: HTMLElement) => PresenceTextRenderer;
