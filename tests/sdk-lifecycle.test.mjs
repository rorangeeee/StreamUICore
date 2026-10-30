import test from 'node:test';
import assert from 'node:assert/strict';
import { StreamUIClient } from '../src/sdk/client.ts';
test('stopping a client closes every capability stream and prevents reconnect timers', () => {
  const originalSocket = globalThis.WebSocket, originalWindow = globalThis.window;
  const sockets = [];
  class Socket {
    constructor(url) { this.url = url; this.closed = false; sockets.push(this); }
    close() { this.closed = true; this.onclose?.(); }
  }
  globalThis.WebSocket = Socket;
  globalThis.window = { removeEventListener() {} };
  try {
    const client = new StreamUIClient('http://127.0.0.1:5280/', null);
    const off = client.binary('uptime', 'raw', () => {});
    client.binary('another', 'frames', () => {});
    assert.equal(sockets.length, 2);
    assert.equal(sockets[0].url, 'ws://127.0.0.1:5280/ws/plugins/uptime/raw');
    off(); assert.equal(sockets[0].closed, true);
    client.stop(); assert.equal(sockets[1].closed, true);
  } finally { globalThis.WebSocket = originalSocket; globalThis.window = originalWindow; }
});
