import { describe, expect, it } from "vitest";
import { toSpeechWebSocketUrl } from "../src/speech.js";

describe("authenticated speech URL", () => {
  it("uses the authenticated path for bare TLS server URLs", () => {
    expect(toSpeechWebSocketUrl("wss://speech.test")).toBe("wss://speech.test/v1/stream");
    expect(toSpeechWebSocketUrl("https://speech.test/")).toBe("wss://speech.test/v1/stream");
  });
  it("preserves explicit local ports and upgrades HTTP schemes", () => {
    expect(toSpeechWebSocketUrl("http://127.0.0.1:18765")).toBe("ws://127.0.0.1:18765/v1/stream");
  });
  it("does not append an authenticated path twice", () => {
    expect(toSpeechWebSocketUrl("wss://speech.test/v1/stream?trace=1")).toBe("wss://speech.test/v1/stream?trace=1");
  });
  it("rejects unsupported schemes and paths instead of connecting to a legacy route", () => {
    expect(() => toSpeechWebSocketUrl("file:///speech")).toThrow();
    expect(() => toSpeechWebSocketUrl("wss://speech.test/something-else")).toThrow();
  });
});
