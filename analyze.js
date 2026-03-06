export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { text, model, system_type, expected_flow, actual_flow } = req.body;

  if (!text) {
    return res.status(400).json({ error: 'Missing feedback text' });
  }

  const apiKey = process.env.CLAUDE_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'Missing CLAUDE_API_KEY environment variable' });
  }

  const prompt = `You are an expert in industrial fan and impeller engineering. 
Analyze the following field feedback and return ONLY a valid JSON object — no markdown, no explanation.

JSON schema to return:
{
  "category": string,           // One of: "Flow deviation", "Vibration", "Noise", "Pressure issue", "Overheating", "Bearing failure", "Cavitation", "Stall / surge", "Installation error", "Unknown"
  "possible_cause": string,     // 1-2 sentences describing the most likely root cause
  "system_type": string,        // Detected or confirmed system type (HVAC, industrial ventilation, etc.)
  "severity": number,           // 1-5 scale (1 = minor, 5 = critical)
  "confidence": number,         // 0-100 confidence in the classification
  "recommended_actions": array  // 2-4 short action strings the engineer should take
}

Feedback:
${text}

Return ONLY the JSON object.`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1000,
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ]
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      return res.status(502).json({ error: 'Claude API error', detail: errText });
    }

    const claudeData = await response.json();
    const rawText = claudeData.content?.[0]?.text || '{}';

    // Parse JSON — strip any accidental markdown fences
    let parsed;
    try {
      const cleaned = rawText.replace(/```json|```/g, '').trim();
      parsed = JSON.parse(cleaned);
    } catch {
      return res.status(500).json({
        error: 'Failed to parse Claude response as JSON',
        raw: rawText
      });
    }

    // Attach original inputs for data logging
    parsed._meta = {
      model: model || null,
      system_type_input: system_type || null,
      expected_flow: expected_flow ? Number(expected_flow) : null,
      actual_flow: actual_flow ? Number(actual_flow) : null,
      timestamp: new Date().toISOString()
    };

    return res.status(200).json(parsed);

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
