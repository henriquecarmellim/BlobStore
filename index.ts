import { mkdir, stat, unlink } from "node:fs/promises";
import { join, basename } from "node:path";

const STORAGE_PATH = Bun.env.STORAGE_PATH || "/mnt/storage";
const PORT = Number(Bun.env.PORT) || 3000;
const BASE_URL = Bun.env.BASE_URL || `http://localhost:${PORT}`;

// Garantir que a pasta existe
await mkdir(STORAGE_PATH, { recursive: true });

console.log(`⚡ BlobStore API | Operacional`);
console.log(`📂 Storage: ${STORAGE_PATH}\n`);

Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    const pathParts = url.pathname.split("/").filter(Boolean); // [v1, blobs, id]

    // --- ROTA: POST /v1/blobs/upload (UPLOAD) ---
    if (req.method === "POST" && url.pathname === "/v1/blobs/upload") {
      try {
        const formData = await req.formData();
        const file = formData.get("file") as File;

        if (!file) return Response.json({ status: "error", message: "No file uploaded" }, { status: 400 });

        const key = `${Date.now()}-${file.name.replace(/[^a-zA-Z0-9.-]/g, "_")}`;
        const finalPath = join(STORAGE_PATH, key);

        await Bun.write(finalPath, file);

        return Response.json({
          status: "success",
          response: {
            name: file.name,
            type: file.type,
            size: file.size,
            key: key,
            url: `${BASE_URL}/v1/blobs/${key}`
          }
        });
      } catch (e) {
        return Response.json({ status: "error", message: e }, { status: 500 });
      }
    }

    // --- ROTAS DINÂMICAS: /v1/blobs/:id ---
    if (pathParts[0] === "v1" && pathParts[1] === "blobs" && pathParts[2]) {
      const fileKey = pathParts[2];
      const filePath = join(STORAGE_PATH, basename(fileKey));

      try {
        const fileStat = await stat(filePath);

        // 1. GET /v1/blobs/:id (DOWNLOAD OU INFO)
        if (req.method === "GET") {
          // Se tiver um query parameter ?info=true, retorna apenas os metadados
          if (url.searchParams.get("info") === "true") {
            return Response.json({
              status: "success",
              response: {
                name: fileKey,
                size: fileStat.size,
                createdAt: fileStat.birthtime
              }
            });
          }

          // Caso contrário, entrega o arquivo (Download)
          const file = Bun.file(filePath);
          return new Response(file);
        }

        // 2. DELETE /v1/blobs/:id (EXCLUIR)
        if (req.method === "DELETE") {
          await unlink(filePath);
          return Response.json({
            status: "success",
            message: "File deleted successfully"
          });
        }
      } catch (e) {
        return Response.json({ status: "error", message: "File not found" }, { status: 404 });
      }
    }

    return Response.json({ status: "error", message: "Route not found" }, { status: 404 });
  },
});