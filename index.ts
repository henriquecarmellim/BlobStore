import { mkdir, stat, unlink } from "node:fs/promises";
import { join, basename } from "node:path";

// ─── Config ───────────────────────────────────────────────────────────────────

const STORAGE_PATH = Bun.env.STORAGE_PATH || "/mnt/storage";
const PORT         = Number(Bun.env.PORT)  || 3000;
const BASE_URL     = Bun.env.BASE_URL      || `http://localhost:${PORT}`;
const MAX_BYTES    = Number(Bun.env.MAX_FILE_BYTES) || 50 * 1024 * 1024; // 50 MB padrão

await mkdir(STORAGE_PATH, { recursive: true });

console.log(`⚡ BlobStore API | Operacional`);
console.log(`📂 Storage : ${STORAGE_PATH}`);
console.log(`📦 Limite  : ${(MAX_BYTES / 1024 / 1024).toFixed(0)} MB\n`);

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Sanitiza um nome de arquivo — nunca permite path traversal. */
function sanitizeName(raw: string): string {
  return basename(raw).replace(/[^a-zA-Z0-9.\-_]/g, "_") || "file";
}

/** Gera uma key única e segura para o arquivo. */
function generateKey(originalName: string): string {
  const safe = sanitizeName(originalName);
  return `${Date.now()}-${crypto.randomUUID()}-${safe}`;
}

/** Resolve o caminho absoluto de uma key, garantindo que fique dentro do STORAGE_PATH. */
function resolvePath(key: string): string {
  const safe = basename(key); // impede ../../ na key
  return join(STORAGE_PATH, safe);
}

/** Serializa qualquer erro em string legível. */
function errMsg(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}

/** Resposta JSON padronizada para erros. */
function errorResponse(message: string, status: number): Response {
  return Response.json({ status: "error", message }, { status });
}

// ─── Handlers ─────────────────────────────────────────────────────────────────

/** POST /v1/blobs/upload */
async function handleUpload(req: Request): Promise<Response> {
  // 1. Valida tamanho pelo header antes de ler o body
  const contentLength = Number(req.headers.get("content-length") ?? 0);
  if (contentLength > MAX_BYTES) {
    return errorResponse(
      `File too large. Max allowed: ${MAX_BYTES} bytes`,
      413
    );
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return errorResponse("Invalid multipart body", 400);
  }

  const file = formData.get("file") as File | null;
  if (!file) return errorResponse("No file uploaded", 400);

  // 2. Segunda barreira de tamanho (após parse real)
  if (file.size > MAX_BYTES) {
    return errorResponse(
      `File too large. Max allowed: ${MAX_BYTES} bytes`,
      413
    );
  }

  const key       = generateKey(file.name);
  const finalPath = resolvePath(key);

  try {
    await Bun.write(finalPath, file);
  } catch (e) {
    return errorResponse(`Failed to save file: ${errMsg(e)}`, 500);
  }

  return Response.json({
    status: "success",
    response: {
      name : file.name,
      type : file.type,
      size : file.size,
      key,
      url  : `${BASE_URL}/v1/blobs/${key}`,
    },
  });
}

/** GET /v1/blobs/:key */
async function handleGet(
  req: Request,
  filePath: string,
  key: string
): Promise<Response> {
  const url = new URL(req.url);

  if (url.searchParams.get("info") === "true") {
    // Metadados — precisa do stat
    let fileStat: Awaited<ReturnType<typeof stat>>;
    try {
      fileStat = await stat(filePath);
    } catch {
      return errorResponse("File not found", 404);
    }

    return Response.json({
      status: "success",
      response: {
        name     : key,
        size     : fileStat.size,
        createdAt: fileStat.birthtime,
      },
    });
  }

  // Download — Bun.file já trata ausência do arquivo com status 404 nativo
  const file = Bun.file(filePath);
  const exists = await file.exists();
  if (!exists) return errorResponse("File not found", 404);

  return new Response(file, {
    headers: {
      // Imutável: a key já carrega timestamp + UUID, nunca reutilizada
      "Cache-Control": "public, max-age=31536000, immutable",
      "Content-Disposition": `inline; filename="${key}"`,
    },
  });
}

/** DELETE /v1/blobs/:key */
async function handleDelete(filePath: string): Promise<Response> {
  try {
    await unlink(filePath);
    return Response.json({ status: "success", message: "File deleted successfully" });
  } catch (e: any) {
    if (e?.code === "ENOENT") return errorResponse("File not found", 404);
    return errorResponse(`Failed to delete file: ${errMsg(e)}`, 500);
  }
}

// ─── Router ───────────────────────────────────────────────────────────────────

Bun.serve({
  port: PORT,

  async fetch(req) {
    const url       = new URL(req.url);
    const parts     = url.pathname.split("/").filter(Boolean);
    // parts esperados: ["v1", "blobs", <key?>]

    // POST /v1/blobs/upload
    if (req.method === "POST" && url.pathname === "/v1/blobs/upload") {
      return handleUpload(req);
    }

    // /v1/blobs/:key
    if (parts[0] === "v1" && parts[1] === "blobs" && parts[2]) {
      const key      = parts[2];
      const filePath = resolvePath(key);

      if (req.method === "GET")    return handleGet(req, filePath, key);
      if (req.method === "DELETE") return handleDelete(filePath);

      return errorResponse("Method not allowed", 405);
    }

    return errorResponse("Route not found", 404);
  },
});