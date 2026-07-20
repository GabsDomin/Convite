import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import worker from "../cloudflare/drive-backup-worker/src/index.js";

const originalFetch = globalThis.fetch;
const storageKey = "gab-naia/album/originals/00000000-0000-4000-8000-000000000000.jpg";
const row = {
  id: "10000000-0000-4000-8000-000000000000",
  storage_key: storageKey,
  original_file_name: "foto.jpg",
  mime_type: "image/jpeg",
  bytes: 3,
  etag: "etag-r2",
  backup_status: "pending",
  backup_attempts: 0,
  drive_file_id: null,
};

let requests;

before(() => {
  requests = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    requests.push({ url: url.href, method: init.method || "GET", body: init.body });

    if (url.hostname === "oauth2.googleapis.com") {
      return Response.json({ access_token: "access-token" });
    }
    if (url.hostname === "example.supabase.co" && (init.method || "GET") === "GET") {
      return Response.json([row]);
    }
    if (url.hostname === "example.supabase.co" && init.method === "PATCH") {
      return Response.json([{ ...row, ...JSON.parse(init.body) }]);
    }
    if (url.hostname === "www.googleapis.com" && url.pathname === "/drive/v3/files") {
      return Response.json({ files: [] });
    }
    if (url.hostname === "www.googleapis.com" && url.pathname === "/upload/drive/v3/files") {
      return new Response(null, {
        status: 200,
        headers: { Location: "https://upload.example/session" },
      });
    }
    if (url.hostname === "upload.example") {
      return Response.json({ id: "drive-file-id", name: "foto.jpg", size: "3" });
    }
    throw new Error(`Requisição inesperada: ${url.href}`);
  };
});

after(() => {
  globalThis.fetch = originalFetch;
});

test("Worker copia o original para o Drive e confirma o backup no Supabase", async () => {
  let acknowledged = false;
  let retried = false;
  const message = {
    attempts: 1,
    body: { object: { key: storageKey } },
    ack() { acknowledged = true; },
    retry() { retried = true; },
  };
  const env = {
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_SECRET_KEY: "sb_secret_test",
    GOOGLE_DRIVE_CLIENT_ID: "client-id",
    GOOGLE_DRIVE_CLIENT_SECRET: "client-secret",
    GOOGLE_DRIVE_REFRESH_TOKEN: "refresh-token",
    GOOGLE_DRIVE_FOLDER_ID: "folder-id",
    ALBUM_BUCKET: {
      async get(key) {
        assert.equal(key, storageKey);
        return {
          size: 3,
          body: new Blob(["abc"]).stream(),
          httpEtag: '"etag-r2"',
        };
      },
    },
  };

  await worker.queue({ messages: [message] }, env);

  assert.equal(acknowledged, true);
  assert.equal(retried, false);
  assert.ok(requests.some((request) => request.url.includes("uploadType=resumable")));
  const completedUpdate = requests.find((request) =>
    request.method === "PATCH" && String(request.body).includes('"backup_status":"complete"'));
  assert.ok(completedUpdate);
});
