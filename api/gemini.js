/* Vercel serverless function — keeps the Gemini API key server-side.
   The browser calls POST /api/gemini with { prompt }; this function
   attaches the key from an environment variable and forwards the
   request to Google, returning Google's response unchanged so the
   client-side parsing logic doesn't need to change shape.

   Deploy: push this project to Vercel (vercel.com/new, or `vercel`
   from the CLI), then in the project's Settings > Environment
   Variables add GEMINI_API_KEY with your key from
   https://aistudio.google.com/apikey. No build step or package.json
   is required — Vercel auto-detects any file under /api as a function. */
module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: "Server is missing GEMINI_API_KEY" });
    return;
  }

  const { prompt } = req.body || {};
  if (!prompt || typeof prompt !== "string") {
    res.status(400).json({ error: 'Missing "prompt" string in request body' });
    return;
  }

  try {
    const upstream = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.7, maxOutputTokens: 8192 },
        }),
      }
    );
    const data = await upstream.json();
    res.status(upstream.status).json(data);
  } catch (err) {
    res.status(502).json({ error: "Failed to reach Gemini API", detail: err.message });
  }
};
