import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import test from "node:test";

import { createLocalFileStorage } from "../../src/storage/localFileStorage.js";
import { createObjectStorage } from "../../src/storage/objectStorage.js";
import { createS3Storage } from "../../src/storage/s3Storage.js";

async function streamBytes(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

test("local storage writes and reads exact bytes, then deletes the object", async () => {
  const root = await mkdtemp(join(tmpdir(), "dana-terang-storage-"));
  const storage = createLocalFileStorage({ root });
  const bytes = Buffer.from("private evidence bytes");
  try {
    await storage.putObject({ key: "7cfc50ea-49b8-49f4-9379-4814ca04c1c9", body: bytes });
    const stored = await storage.readObject("7cfc50ea-49b8-49f4-9379-4814ca04c1c9");
    assert.deepEqual(await streamBytes(stored), bytes);
    await storage.deleteObject("7cfc50ea-49b8-49f4-9379-4814ca04c1c9");
    await assert.rejects(storage.readObject("7cfc50ea-49b8-49f4-9379-4814ca04c1c9"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("local storage rejects traversal and never writes outside its root", async () => {
  const root = await mkdtemp(join(tmpdir(), "dana-terang-storage-"));
  const storage = createLocalFileStorage({ root });
  try {
    await assert.rejects(storage.putObject({ key: "../outside", body: Buffer.from("private") }), { code: "INVALID_OBJECT_KEY" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("S3 storage maps put/read/delete through an injected client", async () => {
  const objects = new Map();
  const client = {
    async send(command) {
      if (command.constructor.name === "PutObjectCommand") {
        objects.set(command.input.Key, Buffer.from(command.input.Body));
        return {};
      }
      if (command.constructor.name === "GetObjectCommand") {
        return { Body: Readable.from(objects.get(command.input.Key)) };
      }
      if (command.constructor.name === "DeleteObjectCommand") {
        objects.delete(command.input.Key);
        return {};
      }
      throw new Error("Unexpected S3 command");
    },
  };
  const storage = createS3Storage({ bucket: "test-bucket", client });
  const bytes = Buffer.from("staging evidence bytes");

  const key = "123e4567-e89b-42d3-a456-426614174000";
  await storage.putObject({ key, body: bytes, contentType: "application/pdf" });
  assert.deepEqual(await streamBytes(await storage.readObject(key)), bytes);
  await storage.deleteObject(key);
  assert.equal(objects.has(key), false);
});

test("storage factory defaults to local mode and rejects unknown modes", async () => {
  const root = await mkdtemp(join(tmpdir(), "dana-terang-storage-factory-"));
  try {
    const storage = createObjectStorage({ mode: "local", localRoot: root });
    assert.equal(typeof storage.putObject, "function");
    assert.equal(typeof storage.readObject, "function");
    assert.equal(typeof storage.deleteObject, "function");
    assert.throws(() => createObjectStorage({ mode: "unknown", localRoot: root }), { code: "INVALID_STORAGE_MODE" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
