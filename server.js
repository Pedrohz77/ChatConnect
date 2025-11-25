import express from "express";
import fetch from "node-fetch";
import dotenv from "dotenv";
import cors from "cors";
import fs from "fs";

dotenv.config();

const app = express();
app.use(express.json());
app.use(cors());

import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const faqPath = path.join(__dirname, "faqconnect.json");
const gddPath = path.join(__dirname, "gdd.json");

const faq = JSON.parse(fs.readFileSync(faqPath, "utf-8"));
const gdd = JSON.parse(fs.readFileSync(gddPath, "utf-8"));

console.log("FAQ Carregado:", faqPath);
console.log("GDD Carregado:", gddPath)

function buscarInfosGDD(pergunta) {
  const texto = pergunta.toLowerCase();
  const palavras = texto.split(" ").filter(p => p.length > 3);

  const trechos = [];

  function explorar(obj, caminho = "") {
    if (typeof obj === "string") {
      const score = palavras.reduce((acc, p) => acc + (obj.toLowerCase().includes(p) ? 1 : 0), 0);
      if (score > 0) trechos.push({ caminho, conteudo: obj, score });
      return;
    }

    if (Array.isArray(obj)) {
      obj.forEach((item, i) => explorar(item, `${caminho}[${i}]`));
      return;
    }

    if (typeof obj === "object" && obj !== null) {
      Object.entries(obj).forEach(([key, value]) =>
        explorar(value, `${caminho}.${key}`)
      );
    }
  }

  explorar(gdd);

  return trechos
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
}

function buscarMelhoresRespostas(perguntaUsuario) {
  const texto = perguntaUsuario.toLowerCase().trim();
  if (!texto) return [];

  const sinonimos = {
    "app": "aplicativo",
    "apps": "aplicativo",
    "software": "aplicativo",
    "sistema": "aplicativo",
    "connect+": "connect",
  };

  let textoNormalizado = texto;
  for (const [chave, valor] of Object.entries(sinonimos)) {
    textoNormalizado = textoNormalizado.replaceAll(chave, valor);
  }

  const palavras = textoNormalizado.split(" ").filter(p => p.length > 2);
  const correspondencias = faq.map(f => {
    const perguntaFaq = f.pergunta.toLowerCase();
    const pontos = palavras.reduce(
      (acc, palavra) => acc + (perguntaFaq.includes(palavra) ? 1 : 0),
      0
    );

    return { ...f, pontos };
  });

  return correspondencias.sort((a, b) => b.pontos - a.pontos).slice(0, 5);
}

app.post("/api/chat", async (req, res) => {
  try {
    const { messages } = req.body;
    const ultimaMensagem = messages?.[messages.length - 1]?.content || "";

    const perguntasGenericas = [
      "e agora","o que faço","o que eu faço","o que fazer",
      "pronto","finalizei","terminei","acabei","já terminei",
      "enviei tudo","acabei tudo","o que vem depois","o que devo fazer",
      "depois disso"
    ];

    const generica = perguntasGenericas.find(p =>
      ultimaMensagem.toLowerCase().includes(p)
    );

    if (generica) {
      return res.json({
        assistant: {
          role: "assistant",
          content: "Após enviar tudo, confirme se os dados foram recebidos no dashboard técnico Connect+."
        },
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
      });
    }

    const melhores = buscarMelhoresRespostas(ultimaMensagem);

    if (melhores[0] && melhores[0].pontos > 2) {
      return res.json({
        assistant: { role: "assistant", content: melhores[0].resposta },
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
      });
    }

    const infosGDD = buscarInfosGDD(ultimaMensagem);

    const contextoGDD = infosGDD
      .map((i, idx) => `GDD#${idx + 1}: ${i.conteudo}`)
      .join("\n");

    const contextoFAQ = melhores
      .map((f, i) => `FAQ#${i + 1} Pergunta: ${f.pergunta}\nResposta: ${f.resposta}`)
      .join("\n\n");

    const contextoFinal = `
        INFORMAÇÕES RELEVANTES DO FAQ:
        ${contextoFAQ}

        INFORMAÇÕES DO GDD:
        ${contextoGDD}
    `;

    const systemPrompt = `
        Você é a assistente virtual da Connect+, aplicativo criado para CTI Brasil — provedor de internet corporativa.

        Sua função é ajudar clientes e técnicos da CTI com:
          - Instalação e suporte de links dedicados e internet corporativa.
          - Uso do aplicativo Connect+ (avaliações técnicas, modo AR, fotos, medições e checklists).
          - Explicações institucionais: missão, valores e funcionamento da CTI.
          - Orientações sobre coleta de evidências e envio de dados pelo Connect+.

        Use APENAS as informações abaixo para responder:

        ${contextoFinal}

        Regras:
          - Responda com no máximo 15 palavras.
          - Mantenha tom profissional, educado e confiante.
          - Se o usuário perguntar sobre outro tema (esporte, política, clima etc.), diga:
            “Posso ajudar apenas com temas da CTI e suporte técnico corporativo.”
          - Sempre que possível, mencione o app Connect+ nas orientações.
    `;

    const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
    const apiKey = process.env.AZURE_OPENAI_KEY;
    const deploymentName = process.env.AZURE_OPENAI_DEPLOYMENT_NAME;
    const apiVersion = process.env.AZURE_OPENAI_API_VERSION;

    const url = `${endpoint}/openai/deployments/${deploymentName}/chat/completions?api-version=${apiVersion}`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-key": apiKey
      },
      body: JSON.stringify({
        messages: [
          { role: "system", content: systemPrompt },
          ...messages
        ],
        max_tokens: 30,
        temperature: 0.3
      })
    });

    const raw = await response.text();
    let data;

    try { data = JSON.parse(raw); }
    catch {
      return res.json({
        assistant: { role: "assistant", content: "Erro JSON Azure: " + raw }
      });
    }

    if (!response.ok) {
      return res.json({
        assistant: { role: "assistant", content: "Erro Azure: " + (data.error?.message || raw) }
      });
    }

    const assistant = data.choices?.[0]?.message ?? {
      role: "assistant",
      content: "Erro ao gerar resposta."
    };

    console.log("TOKENS USADOS ➜ ", data.usage);

    return res.json({
      assistant,
      usage: data.usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
    });

  } catch (err) {
    console.error("Erro no servidor:", err);
    return res.status(500).json({ error: "Erro no servidor." });
  }
});

app.get("/", (req, res) =>
  res.send("Servidor ChatConnect ativo e online!")
);

const PORT = process.env.PORT || process.env.WEBSITES_PORT || 8080;
app.listen(PORT, "0.0.0.0", () => console.log(`Servidor rodando na porta ${PORT}`));
