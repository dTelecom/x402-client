import { GatewayError } from "./errors.js";
import { mapModerationInference } from "./client.js";
import type { ModerationInference, ModerationStreamTicket } from "./types.js";

// Structural transport interface supports browser WebSocket, Node's WebSocket or an injected adapter.
export interface ModerationSocket {
  send(data: string | ArrayBuffer): void;
  close(): void;
  addEventListener(type: string, listener: (event: any) => void): void;
}
export type ModerationSocketFactory = (url: string) => ModerationSocket;

/** Binary chunk/frame client. One request in flight; no capture, sampling or automatic retries. */
export class ModerationStream {
  private pending?: { id: string; resolve: (r: ModerationInference) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> };
  private sending = false;
  private closed = false;
  private constructor(private socket: ModerationSocket) {}

  static async connect(ticket: ModerationStreamTicket, factory?: ModerationSocketFactory): Promise<ModerationStream> {
    const fallback = (globalThis as any).WebSocket;
    if (!factory && !fallback) throw new Error("A WebSocket factory is required in this runtime");
    const socket = factory ? factory(ticket.websocketUrl) : new fallback(ticket.websocketUrl) as ModerationSocket;
    const client = new ModerationStream(socket);
    await new Promise<void>((resolve, reject) => {
      let ready = false;
      const timeout = setTimeout(() => { socket.close(); reject(new Error("Moderation connection timeout")); }, 10000);
      socket.addEventListener("open", () => socket.send(JSON.stringify({ type: "auth", token: ticket.token })));
      socket.addEventListener("message", (event: any) => {
        try {
          const value = JSON.parse(String(event.data));
          if (!ready) {
            if (value.type !== "ready" || value.protocol !== "dtelecom.moderation.v1") throw new Error("Invalid moderation handshake");
            ready = true; clearTimeout(timeout); resolve(); return;
          }
          const pending = client.pending;
          if (!pending || value.id !== pending.id || !["result", "error"].includes(value.type)) throw new Error("Unexpected moderation response");
          // Parse before removing the pending call so malformed replies reject it.
          const result = value.type === "result" ? mapModerationInference(value.request) : undefined;
          clearTimeout(pending.timer); client.pending = undefined;
          if (value.type === "error") pending.reject(new GatewayError(value.error ?? "Moderation failed", value.http_status ?? 503));
          else pending.resolve(result!);
        } catch (error) { clearTimeout(timeout); reject(error); client.fail(new Error("Invalid moderation protocol")); }
      });
      socket.addEventListener("error", () => { clearTimeout(timeout); reject(new Error("Moderation connection error")); client.fail(new Error("Moderation connection error")); });
      socket.addEventListener("close", () => { clearTimeout(timeout); reject(new Error("Moderation connection closed")); client.fail(new Error("Moderation connection closed")); });
    });
    return client;
  }

  /** Raw mono signed little-endian PCM16 at 16kHz; at most 30 seconds. */
  sendAudio(idempotencyKey: string, pcm: Blob, language = "en"): Promise<ModerationInference> {
    return this.send(idempotencyKey, "audio", pcm, language);
  }
  sendVideoFrame(idempotencyKey: string, image: Blob): Promise<ModerationInference> {
    return this.send(idempotencyKey, "video", image);
  }
  private async send(id: string, kind: "audio" | "video", media: Blob, language?: string): Promise<ModerationInference> {
    if (this.closed || this.pending || this.sending) throw new Error("Await the previous moderation result before sending");
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(id) || !media.size || media.size > (kind === "audio" ? 960000 : 6291456) || (kind === "audio" && media.size % 2)) throw new Error("Invalid moderation media or idempotency key");
    this.sending = true;
    try {
      const binary = await media.arrayBuffer();
      if (this.closed) throw new Error("Moderation connection closed");
      return await new Promise<ModerationInference>((resolve, reject) => {
        const timer = setTimeout(() => this.fail(new Error("Moderation response timeout")), 35000);
        this.pending = { id, resolve, reject, timer };
        try { this.socket.send(JSON.stringify({ id, kind, ...(language ? { language } : {}) })); this.socket.send(binary); }
        catch { this.fail(new Error("Moderation send failed")); }
      });
    } finally { this.sending = false; }
  }
  private fail(error: Error) {
    if (this.closed) return;
    this.closed = true;
    if (this.pending) { clearTimeout(this.pending.timer); this.pending.reject(error); this.pending = undefined; }
    this.socket.close();
  }
  close(): void { this.fail(new Error("Moderation connection closed")); }
}
