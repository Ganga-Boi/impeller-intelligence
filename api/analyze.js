export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { text, model, system_type, expected_flow, actual_flow } = req.body;
  if (!text) return res.status(400).json({ error: 'Missing feedback text' });

  const apiKey = process.env.CLAUDE_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'Missing CLAUDE_API_KEY' });

  const prompt = `You are a senior application engineer specializing in axial fans and impellers (HVAC, industrial ventilation, powertrain cooling).

Analyze the field feedback below and return ONLY a valid JSON object — no markdown, no explanation, no preamble.

Return this exact JSON structure:
{
  "category": string,
  "system_issue": string,
  "observed_effects": array of strings,
  "probable_cause": string,
  "installation_issue_vs_design_issue": string,
  "impeller_type_relevance": string,
  "severity": number,
  "confidence": number,
  "recommended_actions": array of strings
}

Rules:
- category: one of "Flow deviation", "Inlet distortion", "Vibration", "Noise", "Pressure issue", "Overheating", "Bearing failure", "Cavitation", "Stall / surge", "Installation error", "Unknown"
- system_issue: short label e.g. "Inlet duct configuration", "Blade pitch mismatch", "System resistance too high"
- observed_effects: measurable symptoms e.g. ["pressure loss", "reduced flow", "tonal noise at high RPM"]
- probable_cause: 1-2 sentences, specific and technical, reference aerodynamic principles where relevant
- installation_issue_vs_design_issue: one of "Installation issue", "Design issue", "Both", "Unclear"
- impeller_type_relevance: one of "High", "Medium", "Low"
- severity: 1-5 (1=minor, 5=critical/system down)
- confidence: 0-100
- recommended_actions: 3-5 specific, actionable steps

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
        messages: [{ role: 'user', content: prompt }]
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      return res.status(502).json({ error: 'Claude API error', detail: errText });
    }

    const claudeData = await response.json();
    const rawText = claudeData.content?.[0]?.text || '{}';

    let parsed;
    try {
      const cleaned = rawText.replace(/```json|```/g, '').trim();
      parsed = JSON.parse(cleaned);
    } catch {
      return res.status(500).json({ error: 'Failed to parse Claude response', raw: rawText });
    }

    // Save to Supabase
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_KEY;

    if (supabaseUrl && supabaseKey) {
      await fetch(`${supabaseUrl}/rest/v1/feedback`, {
        method: 'POST',
        headers: {
          'apikey': supabaseKey,
          'Authorization': `Bearer ${supabaseKey}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal'
        },
        body: JSON.stringify({
          model: model || null,
          system_type: system_type || parsed.system_type || null,
          category: parsed.category || null,
          system_issue: parsed.system_issue || null,
          probable_cause: parsed.probable_cause || null,
          severity: parsed.severity || null,
          confidence: parsed.confidence || null,
          installation_vs_design: parsed.installation_issue_vs_design_issue || null,
          impeller_relevance: parsed.impeller_type_relevance || null,
          recommended_actions: (parsed.recommended_actions || []).join(' | ')
        })
      });
    }

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
