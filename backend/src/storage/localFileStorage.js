import { createReadStream } from "node:fs";
import { access, mkdir, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";

const UUID_KEY = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function objectPath(root, key) {
  if (typeof key !== "string" || !UUID_KEY.test(key)) {
    throw Object.assign(new TypeError("Invalid object key"), { code: "INVALID_OBJECT_KEY" });
  }
  const rootPath = resolve(root);
  const filePath = resolve(rootPath, key);
  if (!filePath.startsWith(`${rootPath}${sep}`)) {
    throw Object.assign(new TypeError("Invalid object key"), { code: "INVALID_OBJECT_KEY" });
  }
  return filePath;
}

export function createLocalFileStorage({ root }) {
  if (typeof root !== "string" || root.trim().length === 0) throw new TypeError("A local evidence root is required");

  return Object.freeze({
    async putObject({ key, body }) {
      const filePath = objectPath(root, key);
      const bytes = Buffer.from(body);
      await mkdir(dirname(filePath), { recursive: true });
      await writeFile(filePath, bytes, { flag: "wx", mode: 0o600 });
      return key;
    },

    async readObject(key) {
      const filePath = objectPath(root, key);
      await access(filePath);
      return createReadStream(filePath);
    },

    async deleteObject(key) {
      try {
        await unlink(objectPath(root, key));
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
    },
  });
}
