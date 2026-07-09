// Cloudflare Worker — proxies food-photo analysis to the Claude API so the
// Anthropic API key never has to live in the public index.html.
//
// Deploy from this directory:
//   wrangler deploy
//   wrangler secret put ANTHROPIC_API_KEY
//   wrangler secret put APP_SECRET      (any random string — must match
//                                        SCAN_APP_SECRET in index.html)

const SCHEMA = {
  type: 'object',
  properties: {
    food_name: { type: 'string' },
    calories: { type: 'integer' },
    protein_g: { type: 'integer' },
    carbs_g: { type: 'integer' },
    fat_g: { type: 'integer' },
  },
  required: ['food_name', 'calories', 'protein_g', 'carbs_g', 'fat_g'],
  additionalProperties: false,
};

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, x-app-secret',
  };
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders() });
    }
    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405, headers: corsHeaders() });
    }
    if (request.headers.get('x-app-secret') !== env.APP_SECRET) {
      return new Response('Unauthorized', { status: 401, headers: corsHeaders() });
    }

    const { image, media_type } = await request.json();
    if (!image || !media_type) {
      return new Response('Missing image', { status: 400, headers: corsHeaders() });
    }

    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-5',
        max_tokens: 500,
        thinking: { type: 'disabled' },
        output_config: { format: { type: 'json_schema', schema: SCHEMA } },
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type, data: image } },
            {
              type: 'text',
              text: 'Identify the food in this photo and estimate calories and macros ' +
                '(grams of protein, carbs, fat) for the visible portion. If multiple ' +
                'items are visible, combine them into one total estimate. Give your ' +
                'best numeric estimate even if uncertain — never refuse.',
            },
          ],
        }],
      }),
    });

    if (!claudeRes.ok) {
      const detail = await claudeRes.text();
      return new Response(JSON.stringify({ error: 'Claude API error', detail }), {
        status: 502,
        headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
      });
    }

    const data = await claudeRes.json();
    if (data.stop_reason === 'refusal') {
      return new Response(JSON.stringify({ error: 'refused' }), {
        status: 422,
        headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
      });
    }

    const textBlock = (data.content || []).find((b) => b.type === 'text');
    if (!textBlock) {
      return new Response(JSON.stringify({ error: 'no output' }), {
        status: 502,
        headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
      });
    }

    // textBlock.text is already valid JSON matching SCHEMA (structured outputs).
    return new Response(textBlock.text, {
      headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
    });
  },
};
