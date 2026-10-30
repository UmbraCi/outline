// @vitest-isolate true
import { once } from "node:events";
import type { onLoadDocumentPayload } from "@hocuspocus/server";
import { Server } from "@hocuspocus/server";
import WebSocket from "ws";
import EDITOR_VERSION from "@shared/editor/version";
import { sleep } from "@shared/utils/timers";
import { ConnectionLimitExtension } from "./ConnectionLimitExtension";
import { EditorVersionExtension } from "./EditorVersionExtension";

vi.mock("@server/env", () => ({
  default: {
    COLLABORATION_MAX_CLIENTS_PER_DOCUMENT: 2,
  },
  COLLABORATION_MAX_CLIENTS_PER_DOCUMENT: 2,
}));

describe("ConnectionLimitExtension", () => {
  let server: typeof Server;
  let extension: ConnectionLimitExtension;
  const port = 12345;
  const url = `ws://127.0.0.1:${port}`;
  const documentName = "test";

  beforeEach(async () => {
    extension = new ConnectionLimitExtension();
    server = Server.configure({
      port,
      extensions: [extension, new EditorVersionExtension()],
      quiet: true,
    });
    await server.listen();
  });

  afterEach(async () => {
    await server.destroy();
  });

  const getConnections = () =>
    extension.connectionsByDocument.get(documentName)?.size ?? 0;

  const createWebSocket = (editorVersion = EDITOR_VERSION) =>
    new Promise<WebSocket>((resolve, reject) => {
      const ws = new WebSocket(
        `${url}/${documentName}?editorVersion=${editorVersion}`
      );
      ws.on("open", () => resolve(ws));
      ws.on("error", reject);
    });

  it("should allow connections within limit", async () => {
    const ws1 = await createWebSocket();
    const ws2 = await createWebSocket();

    expect(ws1.readyState).toBe(WebSocket.OPEN);
    expect(ws2.readyState).toBe(WebSocket.OPEN);
    expect(getConnections()).toBe(2);

    ws1.close();
    ws2.close();

    await sleep(250);
    expect(getConnections()).toBe(0);
  });

  it("should close connections exceeding limit", async () => {
    const ws1 = await createWebSocket();
    const ws2 = await createWebSocket();

    const ws3 = await createWebSocket();
    await sleep(250);

    expect(ws3.readyState).toBe(WebSocket.CLOSED);
    expect(ws2.readyState).toBe(WebSocket.OPEN);
    expect(ws1.readyState).toBe(WebSocket.OPEN);
    expect(getConnections()).toBe(2);

    ws1.close();
    ws2.close();

    await sleep(250);
    expect(getConnections()).toBe(0);
  });

  it("should handle connections closed by other extensions", async () => {
    const ws1 = await createWebSocket();

    // Create a connection that will be closed by the EditorVersionExtension
    const ws2 = await createWebSocket("1.0.0");

    ws1.close();
    ws2.close();

    await sleep(250);
    expect(getConnections()).toBe(0);
  });

  it("should allow new connection after disconnect", async () => {
    const ws1 = await createWebSocket();
    const ws2 = await createWebSocket();

    ws1.close();
    await sleep(250);
    expect(getConnections()).toBe(1);

    const ws3 = await createWebSocket();
    expect(ws3.readyState).toBe(WebSocket.OPEN);
    expect(getConnections()).toBe(2);

    ws2.close();
    ws3.close();

    await sleep(250);
    expect(getConnections()).toBe(0);
  });

  it("should not exhaust the limit when clients disconnect while loading", async () => {
    let loading = Promise.resolve();
    const handleLoadDocument = vi.fn((_data: onLoadDocumentPayload) => loading);
    const handleConnected = vi.fn();
    server.configure({
      extensions: [
        extension,
        new EditorVersionExtension(),
        { onLoadDocument: handleLoadDocument, connected: handleConnected },
      ],
    });

    for (let i = 0; i < 2; i++) {
      let finishLoading: (() => void) | undefined;
      loading = new Promise<void>((resolve) => {
        finishLoading = resolve;
      });

      try {
        const ws = await createWebSocket();
        await vi.waitFor(() => {
          expect(handleLoadDocument).toHaveBeenCalledTimes(i + 1);
        });
        const closed = once(ws, "close");
        ws.close();
        await closed;
      } finally {
        finishLoading?.();
      }

      await vi.waitFor(() => {
        expect(handleConnected).toHaveBeenCalledTimes(i + 1);
      });

      const document = handleLoadDocument.mock.calls[i][0].document;
      expect(document.getConnectionsCount()).toBe(0);
      expect(document.isDestroyed).toBe(true);
      expect(server.getDocumentsCount()).toBe(0);
    }

    expect(server.getConnectionsCount()).toBe(0);
    expect(getConnections()).toBe(0);

    const ws = await createWebSocket();
    await vi.waitFor(() => {
      expect(getConnections()).toBe(1);
      expect(ws.readyState).toBe(WebSocket.OPEN);
    });
    ws.close();
  });
});
