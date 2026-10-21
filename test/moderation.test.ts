import { describe, it, expect } from "vitest";
import { ModerationStream, type ModerationSocket } from "../src/moderation.js";

class Socket implements ModerationSocket {
  events = new Map<string, ((event: any) => void)[]>(); sent: (string | ArrayBuffer)[] = []; closed = false;
  send(data: string | ArrayBuffer) { this.sent.push(data); }
  close() { if (!this.closed) { this.closed = true; this.emit("close", {}); } }
  addEventListener(type: string, listener: (event: any) => void) { this.events.set(type, [...(this.events.get(type) ?? []), listener]); }
  emit(type: string, value: any) { for (const fn of this.events.get(type) ?? []) fn(value); }
  message(value: unknown) { this.emit("message", { data: JSON.stringify(value) }); }
}
const ticket = { token: "credential", websocketUrl: "wss://service/v1/moderation/stream", expiresAt: "later", protocol: "dtelecom.moderation.v1" as const };
async function connect() {
  const socket = new Socket(); const pending = ModerationStream.connect(ticket, () => socket);
  socket.emit("open", {}); expect(JSON.parse(socket.sent[0] as string)).toEqual({ type: "auth", token: "credential" });
  socket.message({ type: "ready", protocol: ticket.protocol }); return { socket, stream: await pending };
}
const flush = () => new Promise<void>(resolve => setTimeout(resolve, 0));
describe("binary moderation stream client", () => {
  it("sends metadata then binary media and maps the matching durable result", async () => {
    const { socket, stream } = await connect();
    const result = stream.sendAudio("audio-1", new Blob([new Uint8Array(64000)]), "ar"); await flush();
    expect(JSON.parse(socket.sent[1] as string)).toEqual({ id: "audio-1", kind: "audio", language: "ar" });
    expect((socket.sent[2] as ArrayBuffer).byteLength).toBe(64000);
    socket.message({ type: "result", id: "audio-1", request: { id: "request-uuid", kind: "moderation-audio", status: "completed", charged_microcredits: "134" } });
    expect(await result).toMatchObject({ id: "request-uuid", chargedMicrocredits: "134" }); stream.close();
  });
  it("applies backpressure while media is converting or a result is pending", async () => {
    const { socket, stream } = await connect(); const first = stream.sendVideoFrame("frame", new Blob(["image"]));
    await expect(stream.sendVideoFrame("second", new Blob(["image"]))).rejects.toThrow("previous"); await flush();
    socket.message({ type: "result", id: "frame", request: { id: "id", status: "completed", kind: "moderation-video", charged_microcredits: "500" } });
    await first; stream.close();
  });
  it("surfaces admission errors without retrying or buying credits", async () => {
    const { socket, stream } = await connect(); const result = stream.sendVideoFrame("frame", new Blob(["image"])); await flush();
    socket.message({ type: "error", id: "frame", http_status: 402, error: "insufficient_credits" });
    await expect(result).rejects.toMatchObject({ status: 402 }); expect(socket.sent).toHaveLength(3); stream.close();
  });
  it("rejects pending work on disconnect and rejects malformed correlation", async () => {
    for (const mode of ["close", "wrong-id"]) {
      const { socket, stream } = await connect(); const result = stream.sendVideoFrame("frame", new Blob(["image"])); await flush();
      if (mode === "close") socket.close(); else socket.message({ type: "result", id: "unrelated", request: {} });
      await expect(result).rejects.toThrow(); expect(socket.closed).toBe(true); stream.close();
    }
  });
  it("rejects a correlated malformed result instead of orphaning the pending promise", async () => {
    for (const request of [null, {}, { id: "id", kind: "moderation-video", status: "completed", charged_microcredits: -1 }]) {
      const { socket, stream } = await connect();
      const pending = stream.sendVideoFrame("frame", new Blob(["image"])); await flush();
      const settled = pending.then(() => "resolved", () => "rejected");
      socket.message({ type: "result", id: "frame", request });
      expect(await Promise.race([settled, new Promise(resolve => setTimeout(() => resolve("hung"), 100))])).toBe("rejected");
      expect(socket.closed).toBe(true); stream.close();
    }
  });
  it("rejects empty/odd/oversized audio without sending a media pair", async () => {
    const { socket, stream } = await connect();
    for (const size of [0, 3, 960002]) await expect(stream.sendAudio("audio", new Blob([new Uint8Array(size)]))).rejects.toThrow("Invalid");
    expect(socket.sent).toHaveLength(1); stream.close();
  });
});
