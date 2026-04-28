# 📦 BlobStore

Serviço de armazenamento de objetos de alta performance, replicando a API da Square Cloud. Construído com **Bun** para máxima velocidade em operações de I/O, ideal para integração com **TrueNAS/ZFS** via **Pterodactyl**.

## 🚀 Tecnologias
- **Runtime:** Bun (v1.x)
- **Engine:** Bun.serve & Bun.write (Zero-copy optimization)
- **Target:** Pterodactyl Containers / Linux Nodes

## 🛠️ Instalação & Execução

1. Instale as dependências:
   ```bash
   bun install
   ```
2. Configure o `.env` (exemplo no repositório).
3. Inicie em produção:
   ```bash
   bun start
   ```

---

## 📡 Documentação da API

### 1. Upload de Arquivo
Envia um arquivo para o storage persistente.

**Endpoint:** `POST /v1/blobs/upload`  
**Content-Type:** `multipart/form-data`

**Requisição (cURL):**
```bash
curl -X POST http://localhost:3000/v1/blobs/upload \
  -F "file=@imagem.png"
```

**Resposta de Sucesso:**
```json
{
  "status": "success",
  "response": {
    "name": "imagem.png",
    "type": "image/png",
    "size": 10240,
    "key": "1714321234-imagem.png",
    "url": "http://localhost:3000/v1/blobs/1714321234-imagem.png"
  }
}
```

---

### 2. Download / Visualização
Recupera o arquivo original do storage.

**Endpoint:** `GET /v1/blobs/{key}`

**Exemplo:** `http://localhost:3000/v1/blobs/1714321234-imagem.png`  
*Retorna o corpo binário do arquivo.*

---

### 3. Metadados (Info)
Obtém informações sobre o arquivo sem baixá-lo.

**Endpoint:** `GET /v1/blobs/{key}?info=true`

**Resposta de Sucesso:**
```json
{
  "status": "success",
  "response": {
    "name": "1714321234-imagem.png",
    "size": 10240,
    "createdAt": "2026-04-28T16:15:00.000Z"
  }
}
```

---

### 4. Excluir Arquivo
Remove permanentemente o arquivo do sistema.

**Endpoint:** `DELETE /v1/blobs/{key}`

**Resposta de Sucesso:**
```json
{
  "status": "success",
  "message": "File deleted successfully"
}
```

---

## 🔒 Segurança & Permissões
Para garantir que o serviço funcione no Pterodactyl com Mounts externos:
1. Certifique-se que o dono da pasta no host é o ID **998**:
   ```bash
   sudo chown -R 998:998 /mnt/storage
   ```
2. Defina o `BASE_URL` no `.env` para que as URLs retornadas no upload sejam acessíveis externamente.

---
Desenvolvido para alta escalabilidade por **NateTracker**.