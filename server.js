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

function buscarRespostaLocal(perguntaUsuario) {
  const texto = perguntaUsuario.toLowerCase().trim();
  if (!texto) return null;

  let encontrada = faq.find(f => texto.includes(f.pergunta.toLowerCase()));
  if (encontrada) return encontrada;

  const palavras = texto.split(" ").filter(p => p.length > 2);
  const correspondencias = faq.map(f => {
    const p = f.pergunta.toLowerCase();
    const pontos = palavras.reduce(
      (acc, palavra) => acc + (p.includes(palavra) ? 1 : 0),
      0
    );
    return { ...f, pontos };
  });

  correspondencias.sort((a, b) => b.pontos - a.pontos);
  const melhor = correspondencias[0];

  if (melhor && melhor.pontos > 0) return melhor;

  return null;
}

app.post("/api/chat", async (req, res) => {
  try {
    const { messages } = req.body;
    const ultimaMensagem = messages?.[messages.length - 1]?.content || "";

    
    const local = buscarRespostaLocal(ultimaMensagem);
    if (local) {
      return res.json({
        assistant: { role: "assistant", content: local.resposta },
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
      });
    }

    // Caso não encontre no FAQ, chama GPT
    const systemPrompt = `
      Você é a assistente virtual da Connect+, aplicativo criado para CTI Brasil — provedor de internet corporativa.

    Sua função é ajudar clientes e técnicos da CTI com:
    - Instalação e suporte de links dedicados e internet corporativa.
    - Uso do aplicativo Connect+ (avaliações técnicas, modo AR, fotos, medições e checklists).
    - Explicações institucionais: missão, valores e funcionamento da CTI.
    - Orientações sobre coleta de evidências e envio de dados pelo Connect+.

    🔹 Regras:
    - Responda com no máximo **15 palavras**.
    - Mantenha **tom profissional, educado e confiante**.
    - Se o usuário perguntar sobre outro tema (esporte, política, clima etc.), diga:
      “Posso ajudar apenas com temas da CTI e suporte técnico corporativo.”
    - Sempre que possível, mencione o **app Connect+** nas orientações.
    `;

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [{ role: "system", content: systemPrompt }, ...messages],
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor rodando em http://localhost:${PORT}`));
