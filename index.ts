import { mkdir, stat, unlink, writeFile, readFile } from "node:fs/promises";
import { join, basename } from "node:path";

// ─── Config ───────────────────────────────────────────────────────────────────

const STORAGE_PATH = Bun.env.STORAGE_PATH || "/mnt/storage";
const PORT         = Number(Bun.env.PORT)  || 3000;
const BASE_URL     = Bun.env.BASE_URL      || `http://localhost:${PORT}`;
const MAX_BYTES    = (Number(Bun.env.MAX_FILE_SIZE_MB) || 50) * 1024 * 1024;
const AUTH_TOKEN   = Bun.env.AUTH_TOKEN;

if (!AUTH_TOKEN) {
  console.error("❌ AUTH_TOKEN não definido no .env — abortando por segurança.");
  process.exit(1);
}

await mkdir(STORAGE_PATH, { recursive: true });

console.log(`⚡ BlobStore API | Operacional`);
console.log(`📂 Storage : ${STORAGE_PATH}`);
console.log(`📦 Limite  : ${(MAX_BYTES / 1024 / 1024).toFixed(0)} MB`);
console.log(`🔒 Auth    : Bearer token ativo\n`);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sanitizeName(raw: string): string {
  return basename(raw).replace(/[^a-zA-Z0-9.\-_]/g, "_") || "file";
}

function generateKey(originalName: string): string {
  const safe = sanitizeName(originalName);
  return `${Date.now()}-${crypto.randomUUID()}-${safe}`;
}

function resolvePath(key: string): string {
  return join(STORAGE_PATH, basename(key));
}

function metaPath(key: string): string {
  return resolvePath(key) + ".meta.json";
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function errorResponse(message: string, status: number): Response {
  return Response.json({ status: "error", message }, { status });
}

function isAuthorized(req: Request): boolean {
  const header = req.headers.get("authorization") ?? "";
  const token  = header.startsWith("Bearer ") ? header.slice(7) : "";

  if (token.length !== AUTH_TOKEN!.length) return false;

  let mismatch = 0;
  for (let i = 0; i < token.length; i++) {
    mismatch |= token.charCodeAt(i) ^ AUTH_TOKEN!.charCodeAt(i);
  }
  return mismatch === 0;
}

// ─── Upload ───────────────────────────────────────────────────────────────────

async function handleUpload(req: Request): Promise<Response> {
  let formData: FormData;

  try {
    formData = await req.formData();
  } catch {
    return errorResponse("Invalid multipart body", 400);
  }

  const file = formData.get("file") as File | null;
  if (!file) return errorResponse("No file uploaded", 400);

  if (file.size > MAX_BYTES) {
    return errorResponse(`File too large. Max allowed: ${MAX_BYTES} bytes`, 413);
  }

  const key = generateKey(file.name);
  const filePath = resolvePath(key);
  const metaFile = metaPath(key);

  try {
    await Bun.write(filePath, file);

    await writeFile(metaFile, JSON.stringify({
      originalName: file.name,
      type: file.type,
      size: file.size,
      createdAt: new Date().toISOString()
    }));
  } catch (e) {
    return errorResponse(`Failed to save file: ${errMsg(e)}`, 500);
  }

  return Response.json({
    status: "success",
    response: {
      name: file.name,
      type: file.type,
      size: file.size,
      key,
      url: `${BASE_URL}/v1/blobs/${key}`,
    },
  });
}

// ─── GET ──────────────────────────────────────────────────────────────────────

async function handleGet(req: Request, filePath: string, key: string): Promise<Response> {
  const url = new URL(req.url);
  const info = url.searchParams.get("info") === "true";

  // 🔒 INFO agora é protegido
  if (info) {
    if (!isAuthorized(req)) {
      return errorResponse("Unauthorized", 401);
    }

    try {
      const fileStat = await stat(filePath);
      const metaRaw = await readFile(metaPath(key), "utf-8").catch(() => null);

      const meta = metaRaw ? JSON.parse(metaRaw) : null;

      return Response.json({
        status: "success",
        response: {
          key,
          size: fileStat.size,
          createdAt: meta?.createdAt ?? fileStat.birthtime,
          originalName: meta?.originalName ?? key,
        },
      });
    } catch {
      return errorResponse("File not found", 404);
    }
  }

  const file = Bun.file(filePath);
  if (!(await file.exists())) {
    return errorResponse("File not found", 404);
  }

  return new Response(file, {
    headers: {
      "Cache-Control": "public, max-age=31536000, immutable",
      "Content-Disposition": `inline; filename="${key}"`,
    },
  });
}

// ─── DELETE ───────────────────────────────────────────────────────────────────

async function handleDelete(filePath: string, key: string): Promise<Response> {
  try {
    await unlink(filePath).catch(() => {});
    await unlink(metaPath(key)).catch(() => {});

    return Response.json({ status: "success", message: "File deleted successfully" });
  } catch (e) {
    return errorResponse(`Failed to delete file: ${errMsg(e)}`, 500);
  }
}

// ─── Router ───────────────────────────────────────────────────────────────────

Bun.serve({
  port: PORT,

  async fetch(req) {
    const url = new URL(req.url);
    const parts = url.pathname.split("/").filter(Boolean);

    // 🚫 bloqueia rota ambígua /upload antes de cair no blob handler
    if (url.pathname === "/v1/blobs/upload" && req.method === "GET") {
      return errorResponse("Not Found", 404);
    }

    // GET público do arquivo
    if (req.method === "GET" && parts[0] === "v1" && parts[1] === "blobs" && parts[2]) {
      const key = parts[2];
      return handleGet(req, resolvePath(key), key);
    }

    // tudo abaixo exige auth
    if (!isAuthorized(req)) {
      return errorResponse("Unauthorized", 401);
    }

    if (req.method === "POST" && url.pathname === "/v1/blobs/upload") {
      return handleUpload(req);
    }

    if (parts[0] === "v1" && parts[1] === "blobs" && parts[2]) {
      const key = parts[2];
      const filePath = resolvePath(key);

      if (req.method === "DELETE") {
        return handleDelete(filePath, key);
      }

      return errorResponse("Method not allowed", 405);
    }

    return errorResponse("Route not found", 404);
  },
});