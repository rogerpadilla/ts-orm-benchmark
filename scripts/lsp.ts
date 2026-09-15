/**
 * Just enough of a language-server client to ask for a rename: start a server over stdio, open a document,
 * and request `textDocument/rename` on it. The rename-safety check uses it for TypeScript's server and for
 * Prisma's, so each tool is renamed by its own tooling.
 */

import { spawn } from 'node:child_process';

export type Position = { line: number; character: number };
export type TextEdit = { range: { start: Position; end: Position }; newText: string };
type WorkspaceEdit = {
  changes?: Record<string, TextEdit[]>;
  documentChanges?: { textDocument: { uri: string }; edits: TextEdit[] }[];
};
/** A response, or a request from the server. The only result this client reads is a rename's. */
type Message = { id?: number; method?: string; params?: { items?: unknown[] }; result?: WorkspaceEdit | null };

export type LanguageServer = {
  open(uri: string, languageId: string, text: string): void;
  rename(uri: string, position: Position, newName: string): Promise<TextEdit[]>;
  close(): void;
};

export async function startLanguageServer(command: string, args: string[], rootUri: string): Promise<LanguageServer> {
  const server = spawn(command, args);
  const pending = new Map<number, (message: Message) => void>();
  let buffer = Buffer.alloc(0);
  let lastId = 0;

  const send = (message: object) => {
    const body = JSON.stringify({ jsonrpc: '2.0', ...message });
    server.stdin.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
  };

  server.stdout.on('data', (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk]);
    for (;;) {
      const headerEnd = buffer.indexOf('\r\n\r\n');
      if (headerEnd < 0) return;
      const length = Number(/Content-Length: (\d+)/.exec(buffer.subarray(0, headerEnd).toString())?.[1]);
      if (buffer.length < headerEnd + 4 + length) return;
      const message: Message = JSON.parse(buffer.subarray(headerEnd + 4, headerEnd + 4 + length).toString());
      buffer = buffer.subarray(headerEnd + 4 + length);
      if (message.id === undefined) continue;
      if (message.method) {
        // An empty setting for each item the server asks about, nothing for anything else.
        send({ id: message.id, result: message.params?.items?.map(() => ({})) ?? null });
      } else {
        pending.get(message.id)?.(message);
        pending.delete(message.id);
      }
    }
  });

  const request = (method: string, params: object) =>
    new Promise<Message>((answer) => {
      const id = ++lastId;
      pending.set(id, answer);
      send({ id, method, params });
    });

  await request('initialize', { processId: process.pid, rootUri, capabilities: {} });
  send({ method: 'initialized', params: {} });

  return {
    open: (uri, languageId, text) =>
      send({ method: 'textDocument/didOpen', params: { textDocument: { uri, languageId, version: 1, text } } }),
    rename: async (uri, position, newName) => {
      const { result } = await request('textDocument/rename', { textDocument: { uri }, position, newName });
      return [
        ...(result?.changes?.[uri] ?? []),
        ...(result?.documentChanges ?? []).filter((change) => change.textDocument.uri === uri).flatMap((c) => c.edits),
      ];
    },
    close: () => server.kill(),
  };
}

export const offsetAt = (text: string, { line, character }: Position) =>
  text
    .split('\n')
    .slice(0, line)
    .reduce((sum, current) => sum + current.length + 1, 0) + character;

export const positionAt = (text: string, offset: number): Position => {
  const before = text.slice(0, offset).split('\n');
  return { line: before.length - 1, character: before[before.length - 1].length };
};

/** `edits` applied to `text`, last first, so no edit moves the range of one still to come. */
export const applyEdits = (text: string, edits: readonly TextEdit[]): string =>
  [...edits]
    .sort((a, b) => offsetAt(text, b.range.start) - offsetAt(text, a.range.start))
    .reduce(
      (out, { range, newText }) =>
        out.slice(0, offsetAt(text, range.start)) + newText + out.slice(offsetAt(text, range.end)),
      text,
    );
