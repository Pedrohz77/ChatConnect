import express from "express";
import fetch from "node-fetch";
import dotenv from "dotenv";
import cors from "cors";
import fs from "fs";

dotenv.config();

const app = express();
app.use(express.json());
app.use(cors());

const faq = JSON.parse(fs.readFileSync("./faqconnect.json", "utf-8"));

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

    let bonus = 0;
    if (
      (textoNormalizado.includes("aplicativo") && perguntaFaq.includes("connect")) ||
      (textoNormalizado.includes("connect") && perguntaFaq.includes("aplicativo"))
    ) bonus = 2;

    return { ...f, pontos: pontos + bonus };
  });

  return correspondencias.sort((a, b) => b.pontos - a.pontos).slice(0, 5);
}

app.post("/api/chat", async (req, res) => {
  try {
    const { messages } = req.body;
    const ultimaMensagem = messages?.[messages.length - 1]?.content || "";

    const perguntasGenericas = [
      "e agora", "o que faço", "o que eu faço", "pronto",
      "enviei tudo", "já terminei", "terminei", "o que vem depois",
      "o que devo fazer", "depois disso", "finalizei"
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

    const contexto = melhores
      .map((f, i) => `#${i + 1} Pergunta: ${f.pergunta}\nResposta: ${f.resposta}`)
      .join("\n\n");

    const systemPrompt = `
    Você é a assistente virtual da Connect+, aplicativo criado para CTI Brasil — provedor de internet corporativa.

    Sua função é ajudar clientes e técnicos da CTI com:
      - Instalação e suporte de links dedicados e internet corporativa.
      - Uso do aplicativo Connect+ (avaliações técnicas, modo AR, fotos, medições e checklists).
      - Explicações institucionais: missão, valores e funcionamento da CTI.
      - Orientações sobre coleta de evidências e envio de dados pelo Connect+.

    Use APENAS as informações abaixo para responder:
    ${contexto}

    Regras:
      - Responda com no máximo 15 palavras.
      - Mantenha tom profissional, educado e confiante.
      - Se o usuário perguntar sobre outro tema (esporte, política, clima etc.), diga:
        “Posso ajudar apenas com temas da CTI e suporte técnico corporativo.”
      - Sempre que possível, mencione o app Connect+ nas orientações.
    `;

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          ...messages
        ],
        max_tokens: 30,
        temperature: 0.4
      })
    });

    const data = await response.json();
    const assistant = data.choices?.[0]?.message ?? {
      role: "assistant",
      content: "Erro ao gerar resposta."
    };

    console.log("Resposta GPT:", assistant.content);
    console.log("Tokens usados:", data.usage);

    return res.json({
      assistant,
      usage: data.usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
    });

  } catch (err) {
    console.error("Erro no servidor:", err);
    return res.status(500).json({ error: "Erro no servidor." });
  }
});

app.get("/", (req, res) => {
  res.send("Servidor ChatConnect ativo e online!");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () =>
  console.log(`Servidor rodando em http://localhost:${PORT}`)
);
