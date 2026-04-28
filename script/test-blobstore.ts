const API_URL = "http://192.168.15.20:16020/v1/blobs";
const TEST_FILE_NAME = "teste_parrudo.txt";
const TEST_CONTENT = "Conteudo de teste para validar o armazenamento no TrueNAS " + Date.now();

async function runTests() {
  console.log("🚀 Iniciando Testes de Stress do BlobStore...\n");

  try {
    // --- 1. TESTE DE UPLOAD ---
    console.log("📤 [1/4] Testando Upload...");
    const formData = new FormData();
    const blob = new Blob([TEST_CONTENT], { type: "text/plain" });
    formData.append("file", blob, TEST_FILE_NAME);

    const uploadRes = await fetch(`${API_URL}/upload`, {
      method: "POST",
      body: formData,
    });

    const uploadData = await uploadRes.json();
    if (uploadData.status !== "success") throw new Error("Falha no Upload");
    
    const fileKey = uploadData.response.key;
    console.log(`✅ Upload OK! Key gerada: ${fileKey}`);

    // --- 2. TESTE DE INFO (Metadados) ---
    console.log("\nℹ️ [2/4] Testando Busca de Informações...");
    const infoRes = await fetch(`${API_URL}/${fileKey}?info=true`);
    const infoData = await infoRes.json();|
    
    if (infoData.status === "success") {
      console.log(`✅ Info OK! Tamanho detectado: ${infoData.response.size} bytes`);
    } else {
      throw new Error("Falha ao buscar informações");
    }

    // --- 3. TESTE DE DOWNLOAD (Integridade) ---
    console.log("\n📥 [3/4] Testando Download e Integridade...");
    const downloadRes = await fetch(`${API_URL}/${fileKey}`);
    const downloadedText = await downloadRes.text();

    if (downloadedText === TEST_CONTENT) {
      console.log("✅ Download OK! O conteúdo coincide perfeitamente.");
    } else {
      throw new Error("Falha na integridade: O conteúdo baixado é diferente do enviado!");
    }

    // --- 4. TESTE DE DELETE ---
    console.log("\n🗑️ [4/4] Testando Exclusão...");
    const deleteRes = await fetch(`${API_URL}/${fileKey}`, {
      method: "DELETE",
    });
    const deleteData = await deleteRes.json();

    if (deleteData.status === "success") {
      console.log("✅ Delete OK! Arquivo removido do TrueNAS.");
    } else {
      throw new Error("Falha ao deletar arquivo");
    }

    console.log("\n🏆 Todos os testes passaram! Seu BlobStore está pronto para produção.");

  } catch (error) {
    console.error(`\n❌ TESTE FALHOU: ${error}`);
  }
}

runTests();