const albumKeyPrefix = "gab-naia/album/originals/";

function getSupabaseHeaders(env, extra = {}) {
  return {
    apikey: env.SUPABASE_SECRET_KEY,
    ...(!env.SUPABASE_SECRET_KEY.startsWith("sb_secret_")
      ? { Authorization: `Bearer ${env.SUPABASE_SECRET_KEY}` }
      : {}),
    ...extra,
  };
}

async function parseResponse(response, fallbackMessage) {
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!response.ok) {
    const message = data?.error?.message || data?.message || String(data || fallbackMessage);
    throw new Error(`${fallbackMessage}: ${message}`);
  }
  return data;
}

async function getDriveAccessToken(env) {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.GOOGLE_DRIVE_CLIENT_ID,
      client_secret: env.GOOGLE_DRIVE_CLIENT_SECRET,
      refresh_token: env.GOOGLE_DRIVE_REFRESH_TOKEN,
      grant_type: "refresh_token",
    }),
  });
  const payload = await parseResponse(response, "Não foi possível autenticar no Google Drive");
  if (!payload?.access_token) throw new Error("O Google Drive não retornou um token de acesso.");
  return payload.access_token;
}

async function getAlbumRow(env, storageKey) {
  const endpoint = new URL("/rest/v1/album_media", env.SUPABASE_URL);
  endpoint.searchParams.set(
    "select",
    "id,storage_key,original_file_name,mime_type,bytes,etag,backup_status,backup_attempts,drive_file_id",
  );
  endpoint.searchParams.set("storage_key", `eq.${storageKey}`);
  endpoint.searchParams.set("limit", "1");
  const response = await fetch(endpoint, { headers: getSupabaseHeaders(env) });
  const rows = await parseResponse(response, "Não foi possível consultar o catálogo do álbum");
  return rows?.[0] || null;
}

async function updateAlbumRow(env, storageKey, changes) {
  const endpoint = new URL("/rest/v1/album_media", env.SUPABASE_URL);
  endpoint.searchParams.set("storage_key", `eq.${storageKey}`);
  const response = await fetch(endpoint, {
    method: "PATCH",
    headers: getSupabaseHeaders(env, {
      "Content-Type": "application/json",
      Prefer: "return=representation",
    }),
    body: JSON.stringify(changes),
  });
  const rows = await parseResponse(response, "Não foi possível atualizar o catálogo do álbum");
  if (!rows?.length) throw new Error("A mídia ainda não foi registrada no catálogo do álbum.");
  return rows[0];
}

function escapeDriveQueryValue(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

async function findDriveBackup(env, accessToken, storageKey) {
  const endpoint = new URL("https://www.googleapis.com/drive/v3/files");
  const query = [
    `'${escapeDriveQueryValue(env.GOOGLE_DRIVE_FOLDER_ID)}' in parents`,
    "trashed = false",
    `appProperties has { key='r2Key' and value='${escapeDriveQueryValue(storageKey)}' }`,
  ].join(" and ");
  endpoint.searchParams.set("q", query);
  endpoint.searchParams.set("spaces", "drive");
  endpoint.searchParams.set("fields", "files(id,name,size,md5Checksum)");
  endpoint.searchParams.set("pageSize", "1");
  const response = await fetch(endpoint, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const payload = await parseResponse(response, "Não foi possível verificar o backup no Drive");
  return payload?.files?.[0] || null;
}

async function uploadObjectToDrive(env, accessToken, row, object) {
  const endpoint = new URL("https://www.googleapis.com/upload/drive/v3/files");
  endpoint.searchParams.set("uploadType", "resumable");
  endpoint.searchParams.set("fields", "id,name,size,md5Checksum");
  const metadata = {
    name: row.original_file_name || row.storage_key.split("/").at(-1),
    parents: [env.GOOGLE_DRIVE_FOLDER_ID],
    appProperties: {
      r2Key: row.storage_key,
      r2Etag: row.etag || object.httpEtag || "",
      albumMediaId: row.id,
    },
  };
  const sessionResponse = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json; charset=utf-8",
      "X-Upload-Content-Type": row.mime_type,
      "X-Upload-Content-Length": String(object.size),
    },
    body: JSON.stringify(metadata),
  });
  if (!sessionResponse.ok) {
    await parseResponse(sessionResponse, "Não foi possível iniciar o backup no Drive");
  }
  const sessionUrl = sessionResponse.headers.get("Location");
  if (!sessionUrl) throw new Error("O Google Drive não retornou uma sessão de upload.");

  const uploadResponse = await fetch(sessionUrl, {
    method: "PUT",
    headers: {
      "Content-Type": row.mime_type,
      "Content-Length": String(object.size),
    },
    body: object.body,
  });
  return parseResponse(uploadResponse, "Não foi possível concluir o backup no Drive");
}

async function backupObject(env, accessToken, storageKey) {
  if (!storageKey.startsWith(albumKeyPrefix)) return;
  const row = await getAlbumRow(env, storageKey);
  if (!row) throw new Error("A mídia ainda não foi registrada no Supabase.");
  if (row.backup_status === "complete" && row.drive_file_id) return;

  const attempts = Number(row.backup_attempts || 0) + 1;
  await updateAlbumRow(env, storageKey, {
    backup_status: "processing",
    backup_attempts: attempts,
    backup_error: null,
  });

  const existingBackup = await findDriveBackup(env, accessToken, storageKey);
  let driveFile = existingBackup;
  if (!driveFile) {
    const object = await env.ALBUM_BUCKET.get(storageKey);
    if (!object) throw new Error("O arquivo original não foi encontrado no R2.");
    if (Number(object.size) !== Number(row.bytes)) {
      throw new Error("O tamanho do original no R2 não corresponde ao catálogo.");
    }
    driveFile = await uploadObjectToDrive(env, accessToken, row, object);
  }

  if (!driveFile?.id) throw new Error("O Google Drive não confirmou o arquivo criado.");
  if (driveFile.size != null && Number(driveFile.size) !== Number(row.bytes)) {
    throw new Error("O tamanho do backup no Drive não corresponde ao original.");
  }

  await updateAlbumRow(env, storageKey, {
    backup_status: "complete",
    drive_file_id: driveFile.id,
    backup_error: null,
    backed_up_at: new Date().toISOString(),
  });
}

async function recordBackupError(env, storageKey, error) {
  if (!storageKey?.startsWith(albumKeyPrefix)) return;
  try {
    await updateAlbumRow(env, storageKey, {
      backup_status: "error",
      backup_error: String(error?.message || error).slice(0, 500),
    });
  } catch {
    // O registro pode ainda não existir; a fila ou a reconciliação tentará novamente.
  }
}

async function getPendingBackups(env) {
  const endpoint = new URL("/rest/v1/album_media", env.SUPABASE_URL);
  endpoint.searchParams.set("select", "storage_key");
  endpoint.searchParams.set("storage_provider", "eq.r2");
  endpoint.searchParams.set("backup_status", "in.(pending,error)");
  endpoint.searchParams.set("backup_attempts", "lt.20");
  endpoint.searchParams.set("order", "created_at.asc");
  endpoint.searchParams.set("limit", "20");
  const response = await fetch(endpoint, { headers: getSupabaseHeaders(env) });
  return parseResponse(response, "Não foi possível consultar backups pendentes");
}

export default {
  async fetch() {
    return Response.json({ ok: true, service: "gab-naia-drive-backup" });
  },

  async queue(batch, env) {
    const accessToken = await getDriveAccessToken(env);
    for (const message of batch.messages) {
      const storageKey = String(message.body?.object?.key || "");
      try {
        await backupObject(env, accessToken, storageKey);
        message.ack();
      } catch (error) {
        await recordBackupError(env, storageKey, error);
        message.retry({ delaySeconds: Math.min(300, 10 * (message.attempts || 1)) });
      }
    }
  },

  async scheduled(_controller, env, ctx) {
    ctx.waitUntil((async () => {
      const rows = await getPendingBackups(env);
      if (!rows?.length) return;
      const accessToken = await getDriveAccessToken(env);
      for (const row of rows) {
        try {
          await backupObject(env, accessToken, row.storage_key);
        } catch (error) {
          await recordBackupError(env, row.storage_key, error);
        }
      }
    })());
  },
};
