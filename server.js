import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from 'url';
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());

// Serve static files (HTML, CSS, JS) from 'public' folder

app.use(express.static(path.join(__dirname, "public")));

let ai = null;
const useGemini = Boolean(process.env.GEMINI_API_KEY);
const useOpenRouter = Boolean(process.env.OPENROUTER_API_KEY);
const openRouterModel = process.env.OPENROUTER_MODEL || 'gpt-4o-mini';
const useOpenAI = Boolean(process.env.OPENAI_API_KEY);

// Log environment detection for easier debugging
console.log('LLM env flags:', {
  GEMINI: useGemini,
  OPENROUTER: useOpenRouter,
  OPENROUTER_MODEL: openRouterModel,
  OPENAI: useOpenAI,
});

if (useGemini) {
  ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
} else {
  console.log('GEMINI_API_KEY not found. OpenRouter available:', useOpenRouter, 'OpenAI available:', useOpenAI);
}

// Per-request responder logging helper
function logResponder(name) {
  try {
    console.log(`[tax-chat] Using responder: ${name}`);
  } catch (e) {
    // ignore logging errors
  }
}
app.post("/api/tax-chat", async (req, res) => {
  try {
    const { message, history = [] } = req.body;

    const prompt = `
You are a qualified Indian tax consultant.
Answer users' tax questions (GST, TDS, audit, income tax, refunds) in simple language.
If exact legal advice or latest law changes are needed, remind them to consult CA Shivani Jain directly.

User question: ${message}
`;

    // If Gemini API key is present, use GoogleGenAI
    if (useGemini && ai) {
      const chat = ai.chats.create({
        model: "gemini-2.5-flash",
        history,
      });

      const response = await chat.sendMessage({ message: prompt });
      logResponder('Gemini');
      return res.json({ reply: response.text });
    }

    // Fallback to OpenAI REST API if OPENAI_API_KEY is available
    // Try OpenRouter if configured (acts like an OpenAI-compatible endpoint)
    if (useOpenRouter) {
      const openrouterResp = await fetch('https://api.openrouter.ai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
        },
        body: JSON.stringify({
          model: openRouterModel,
          messages: [
            { role: 'system', content: 'You are a qualified Indian tax consultant. Answer tax questions (GST, TDS, audit, income tax, refunds) in simple language. If exact legal advice or latest law changes are needed, remind users to consult CA Shivani Jain directly.' },
            { role: 'user', content: message }
          ],
          max_tokens: 800,
        }),
      });

      const orjson = await openrouterResp.json();
      const orReply = (
        orjson?.choices && orjson.choices.length > 0 && (orjson.choices[0].message?.content || orjson.choices[0].text)
      ) || 'Sorry, no answer from OpenRouter.';
      logResponder('OpenRouter');
      return res.json({ reply: orReply });
    }

    if (useOpenAI) {
      const openaiResp = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: 'gpt-3.5-turbo',
          messages: [
            { role: 'system', content: 'You are a qualified Indian tax consultant. Answer tax questions (GST, TDS, audit, income tax, refunds) in simple language. If exact legal advice or latest law changes are needed, remind users to consult CA Shivani Jain directly.' },
            { role: 'user', content: message }
          ],
          max_tokens: 800,
        }),
      });

      const json = await openaiResp.json();
      const reply = (
        json?.choices && json.choices.length > 0 && json.choices[0].message?.content
      ) || 'Sorry, no answer from OpenAI.';
      logResponder('OpenAI');
      return res.json({ reply });
    }

    // No external API keys available — use a small local rule-based responder
    const localResponder = (text) => {
      const t = (text || '').toLowerCase();
      if (t.includes('itr') || (t.includes('income tax') && t.includes('business'))) {
        return (
          'For a businessman in India, filing ITR depends on business type (proprietorship, partnership, LLP, company). ' +
          'Generally: maintain books of accounts, compute profits as per Income Tax rules, pay advance tax if applicable, and file the appropriate ITR form (ITR-3/ITR-4 for proprietors, ITR-5/ITR-6 for other entities). ' +
          'For exact form selection and tax planning, please consult a CA with your financial details.'
        );
      }
      if (t.includes('gst')) {
        return 'GST applies to supply of goods/services. Small suppliers below threshold may be exempt; registration, return filing and invoice rules apply. For specifics share turnover and activity.';
      }
      if (t.includes('tds')) {
        return 'TDS is tax deducted at source by the payer. Rates and applicability depend on payment type (salary, contractor, professional). Ensure correct deduction and timely deposit & filing.';
      }
      // generic fallback
      return 'I can help with GST, TDS, audits, income tax returns and refunds. Please provide more details (e.g., business turnover, structure, or the specific question).';
    };

    const reply = localResponder(message);
    logResponder('LocalResponder');
    return res.json({ reply });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error processing request", detail: err.message });
  }
});

app.listen(3000, () => {
  console.log("Server running on http://localhost:3000");
});

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});
