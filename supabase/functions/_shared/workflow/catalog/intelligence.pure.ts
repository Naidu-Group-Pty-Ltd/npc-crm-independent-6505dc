/**
 * AI, inference and analytics operations.
 *
 * Model lists are deliberately short and current-generation only — the picker is
 * a starting point, not a mirror of every model a provider has ever shipped. The
 * Model Hub remains the place to manage model selection at the account level.
 */

import { f, opt, out, outs, provider } from './builders.pure.ts';
import type { CatalogNode } from '../types.pure.ts';

/** Chat-style providers all return the same envelope. */
const COMPLETION_OUTPUTS = outs(
  'text:string:Response text',
  'finishReason:string:Finish reason',
  'promptTokens:number:Prompt tokens',
  'completionTokens:number:Completion tokens',
  'costUsd:number:Estimated cost (USD)',
);

const promptFields = (models: ReturnType<typeof opt>[]) => [
  f.select('model', 'Model', models, { required: true, defaultValue: models[0].value }),
  f.textarea('system', 'System instructions', { placeholder: 'You are a property investment analyst writing for Australian investors.' }),
  f.expr('prompt', 'Prompt', { required: true, placeholder: 'Summarise {{report.summary}} in three bullet points.' }),
  f.number('maxTokens', 'Maximum response length', { defaultValue: 1024, help: 'Tokens, not characters. Roughly 750 words per 1000 tokens.' }),
  f.number('temperature', 'Creativity', { defaultValue: 0.3, help: '0 is deterministic, 1 is exploratory. Keep low for anything client-facing.' }),
];

export const INTELLIGENCE_NODES: CatalogNode[] = [
  ...provider(
    { integrationId: 'openai', category: 'ai', docs: 'https://platform.openai.com/docs/api-reference' },
    [
      {
        op: 'chat',
        name: 'Generate text',
        summary: 'Sends a prompt to a GPT model and returns the response.',
        docsUrl: 'https://platform.openai.com/docs/api-reference/chat',
        fields: promptFields([opt('gpt-4o', 'GPT-4o', 'Vision, 128k context'), opt('gpt-4o-mini', 'GPT-4o mini', 'Cheapest, good for classification'), opt('o3', 'o3', 'Reasoning, slower')]),
        outputs: COMPLETION_OUTPUTS,
        keywords: ['gpt', 'llm', 'completion', 'write'],
        request: {
          method: 'POST',
          url: 'https://api.openai.com/v1/chat/completions',
          auth: { type: 'bearer', secret: 'OPENAI_API_KEY' },
          body: {
            model: '{{model}}',
            messages: [
              { $when: '{{system}}', role: 'system', content: '{{system}}' },
              { role: 'user', content: '{{prompt}}' },
            ],
            max_tokens: '{{maxTokens}}',
            temperature: '{{temperature}}',
          },
          outputs: {
            text: 'choices.0.message.content',
            finishReason: 'choices.0.finish_reason',
            promptTokens: 'usage.prompt_tokens',
            completionTokens: 'usage.completion_tokens',
          },
          errorPath: 'error',
          requires: ['OPENAI_API_KEY'],
        },
      },
      {
        op: 'structured',
        name: 'Extract structured data',
        summary: 'Pulls named fields out of free text and returns them as JSON.',
        docsUrl: 'https://platform.openai.com/docs/guides/structured-outputs',
        fields: [
          f.select('model', 'Model', [opt('gpt-4o'), opt('gpt-4o-mini')], { required: true, defaultValue: 'gpt-4o-mini' }),
          f.expr('input', 'Text to read', { required: true, placeholder: '{{document.text}}' }),
          f.json('schema', 'Fields to extract', { required: true, help: 'A JSON schema. The model is constrained to it, so the shape is guaranteed.' }),
        ],
        outputs: outs('data:object:Extracted data', 'promptTokens:number:Prompt tokens'),
        keywords: ['parse', 'json', 'schema', 'entity'],
      },
      {
        op: 'embed',
        name: 'Create embedding',
        summary: 'Turns text into a vector for semantic search.',
        docsUrl: 'https://platform.openai.com/docs/api-reference/embeddings',
        fields: [
          f.select('model', 'Model', [opt('text-embedding-3-small', 'Small', '1536 dimensions'), opt('text-embedding-3-large', 'Large', '3072 dimensions')], { defaultValue: 'text-embedding-3-small' }),
          f.expr('input', 'Text', { required: true }),
        ],
        outputs: outs('embedding:array:Vector', 'dimensions:number'),
        keywords: ['vector', 'semantic', 'similarity', 'rag'],
      },
      {
        op: 'transcribe',
        name: 'Transcribe audio',
        summary: 'Converts a recording into text with Whisper.',
        docsUrl: 'https://platform.openai.com/docs/api-reference/audio',
        fields: [f.expr('audioUrl', 'Audio file', { required: true, placeholder: '{{call.recordingUrl}}' }), f.text('language', 'Language', { placeholder: 'en' })],
        outputs: outs('text:string:Transcript', 'durationSeconds:number:Duration (seconds)'),
        keywords: ['whisper', 'speech', 'audio', 'call'],
      },
      {
        op: 'image',
        name: 'Generate image',
        summary: 'Creates an image from a description.',
        docsUrl: 'https://platform.openai.com/docs/api-reference/images',
        fields: [
          f.expr('prompt', 'Description', { required: true }),
          f.select('size', 'Size', [opt('1024x1024', 'Square'), opt('1792x1024', 'Landscape'), opt('1024x1792', 'Portrait')], { defaultValue: '1024x1024' }),
        ],
        outputs: outs('imageUrl:string:Image URL', 'revisedPrompt:string:Revised prompt'),
        keywords: ['dalle', 'picture', 'hero', 'artwork'],
      },
      {
        op: 'moderate',
        name: 'Check content safety',
        summary: 'Flags text that breaches content policy before you publish it.',
        docsUrl: 'https://platform.openai.com/docs/api-reference/moderations',
        fields: [f.expr('input', 'Text', { required: true })],
        outputs: outs('flagged:boolean:Flagged', 'categories:object:Categories'),
        keywords: ['safety', 'policy', 'filter', 'abuse'],
      },
    ],
  ),

  ...provider(
    { integrationId: 'anthropic', category: 'ai', docs: 'https://docs.anthropic.com/en/api' },
    [
      {
        op: 'messages',
        name: 'Generate text',
        summary: 'Sends a prompt to Claude and returns the response.',
        docsUrl: 'https://docs.anthropic.com/en/api/messages',
        fields: promptFields([opt('claude-opus-4', 'Opus', 'Deepest reasoning'), opt('claude-sonnet-4', 'Sonnet', 'Balanced'), opt('claude-haiku-4', 'Haiku', 'Fastest, cheapest')]),
        outputs: COMPLETION_OUTPUTS,
        keywords: ['claude', 'llm', 'reasoning', 'write'],
        request: {
          method: 'POST',
          url: 'https://api.anthropic.com/v1/messages',
          // Anthropic authenticates with its own header rather than a bearer.
          auth: { type: 'header', name: 'x-api-key', secret: 'ANTHROPIC_API_KEY' },
          headers: { 'anthropic-version': '2023-06-01' },
          body: {
            model: '{{model}}',
            // Top-level rather than a message, which is the API's own shape —
            // so a blank one is simply an absent key and needs no guard.
            system: '{{system}}',
            messages: [{ role: 'user', content: '{{prompt}}' }],
            max_tokens: '{{maxTokens}}',
            temperature: '{{temperature}}',
          },
          outputs: {
            text: 'content.0.text',
            finishReason: 'stop_reason',
            promptTokens: 'usage.input_tokens',
            completionTokens: 'usage.output_tokens',
          },
          errorPath: 'error',
          requires: ['ANTHROPIC_API_KEY'],
        },
      },
      {
        op: 'analyse_document',
        name: 'Analyse a document',
        summary: 'Reads a PDF or image and answers questions about it.',
        docsUrl: 'https://docs.anthropic.com/en/docs/build-with-claude/pdf-support',
        fields: [
          f.select('model', 'Model', [opt('claude-sonnet-4', 'Sonnet'), opt('claude-opus-4', 'Opus')], { defaultValue: 'claude-sonnet-4' }),
          f.expr('fileUrl', 'Document', { required: true, placeholder: '{{document.storagePath}}' }),
          f.textarea('question', 'What to find out', { required: true, placeholder: 'List every special condition and its due date.' }),
        ],
        outputs: outs('text:string:Answer', 'costUsd:number:Estimated cost (USD)'),
        keywords: ['pdf', 'contract', 'vision', 'read', 'review'],
      },
    ],
  ),

  ...provider({ integrationId: 'gemini', category: 'ai', docs: 'https://ai.google.dev/gemini-api/docs' }, [
    {
      op: 'generate',
      name: 'Generate text',
      summary: 'Sends a prompt to Gemini and returns the response.',
      fields: promptFields([opt('gemini-2.5-pro', 'Gemini 2.5 Pro'), opt('gemini-2.5-flash', 'Gemini 2.5 Flash', 'Fast and cheap')]),
      outputs: COMPLETION_OUTPUTS,
      keywords: ['google', 'llm', 'multimodal'],
    },
  ]),

  ...provider({ integrationId: 'perplexity', category: 'ai', docs: 'https://docs.perplexity.ai' }, [
    {
      op: 'search',
      name: 'Research with citations',
      summary: 'Answers a question from live web sources and returns the sources.',
      fields: [
        f.select('model', 'Model', [opt('sonar-pro', 'Sonar Pro', 'Deeper research'), opt('sonar', 'Sonar', 'Faster')], { defaultValue: 'sonar' }),
        f.expr('query', 'Question', { required: true, placeholder: 'What is the median house price in {{trigger.suburb}} this quarter?' }),
        f.text('recency', 'Only sources from', { placeholder: 'month', help: 'One of day, week, month, year.' }),
      ],
      outputs: outs('answer:string', 'citations:array:Sources', 'costUsd:number:Estimated cost (USD)'),
      keywords: ['web', 'research', 'sonar', 'sources', 'market'],
    },
  ]),

  ...provider({ integrationId: 'openrouter', category: 'ai', docs: 'https://openrouter.ai/docs' }, [
    {
      op: 'chat',
      name: 'Generate text (any model)',
      summary: 'Routes a prompt to any model OpenRouter carries.',
      fields: [
        f.text('model', 'Model', { required: true, placeholder: 'anthropic/claude-sonnet-4' }),
        f.textarea('system', 'System instructions'),
        f.expr('prompt', 'Prompt', { required: true }),
        f.number('maxTokens', 'Maximum response length', { defaultValue: 1024 }),
      ],
      outputs: COMPLETION_OUTPUTS,
      keywords: ['router', 'fallback', 'any model'],
    },
  ]),

  ...provider({ integrationId: 'groq', category: 'ai', docs: 'https://console.groq.com/docs' }, [
    {
      op: 'chat',
      name: 'Generate text (fast)',
      summary: 'Runs an open model on Groq for very low latency.',
      fields: promptFields([opt('llama-3.3-70b-versatile', 'Llama 3.3 70B'), opt('mixtral-8x7b-32768', 'Mixtral 8x7B')]),
      outputs: COMPLETION_OUTPUTS,
      keywords: ['fast', 'llama', 'latency', 'realtime'],
    },
  ]),

  ...provider({ integrationId: 'mistral', category: 'ai', docs: 'https://docs.mistral.ai' }, [
    { op: 'chat', name: 'Generate text', summary: 'Sends a prompt to a Mistral model.', fields: promptFields([opt('mistral-large-latest', 'Mistral Large'), opt('mistral-small-latest', 'Mistral Small')]), outputs: COMPLETION_OUTPUTS },
    { op: 'ocr', name: 'Read a document', summary: 'Extracts text and layout from a scanned document.', docsUrl: 'https://docs.mistral.ai/capabilities/document/', fields: [f.expr('fileUrl', 'Document', { required: true })], outputs: outs('text:string', 'pages:array'), keywords: ['ocr', 'scan', 'pdf'] },
  ]),

  ...provider({ integrationId: 'deepseek', category: 'ai', docs: 'https://api-docs.deepseek.com' }, [
    { op: 'chat', name: 'Generate text', summary: 'Sends a prompt to a DeepSeek model.', fields: promptFields([opt('deepseek-chat', 'DeepSeek Chat'), opt('deepseek-reasoner', 'DeepSeek Reasoner')]), outputs: COMPLETION_OUTPUTS },
  ]),

  ...provider({ integrationId: 'xai', category: 'ai', docs: 'https://docs.x.ai' }, [
    { op: 'chat', name: 'Generate text', summary: 'Sends a prompt to Grok.', fields: promptFields([opt('grok-4', 'Grok 4'), opt('grok-3-mini', 'Grok 3 mini')]), outputs: COMPLETION_OUTPUTS },
  ]),

  ...provider({ integrationId: 'cohere', category: 'ai', docs: 'https://docs.cohere.com' }, [
    { op: 'chat', name: 'Generate text', summary: 'Sends a prompt to a Command model.', fields: promptFields([opt('command-r-plus', 'Command R+'), opt('command-r', 'Command R')]), outputs: COMPLETION_OUTPUTS },
    {
      op: 'rerank',
      name: 'Rank by relevance',
      summary: 'Reorders a list of documents by how well they answer a query.',
      docsUrl: 'https://docs.cohere.com/reference/rerank',
      fields: [f.expr('query', 'Query', { required: true }), f.expr('documents', 'Documents', { required: true, placeholder: '{{search.results}}' }), f.number('topN', 'Keep top', { defaultValue: 5 })],
      outputs: outs('results:array:Ranked results'),
      keywords: ['rerank', 'relevance', 'search', 'rag'],
    },
  ]),

  ...provider({ integrationId: 'together', category: 'ai', docs: 'https://docs.together.ai' }, [
    { op: 'chat', name: 'Generate text', summary: 'Runs an open model hosted on Together.', fields: [f.text('model', 'Model', { required: true, placeholder: 'meta-llama/Llama-3.3-70B-Instruct-Turbo' }), f.expr('prompt', 'Prompt', { required: true }), f.number('maxTokens', 'Maximum response length', { defaultValue: 1024 })], outputs: COMPLETION_OUTPUTS },
  ]),

  ...provider({ integrationId: 'huggingface', category: 'ai', docs: 'https://huggingface.co/docs/api-inference' }, [
    { op: 'inference', name: 'Run a model', summary: 'Calls any model on the Inference API.', fields: [f.text('model', 'Model', { required: true, placeholder: 'sentence-transformers/all-MiniLM-L6-v2' }), f.json('inputs', 'Inputs', { required: true })], outputs: outs('output:object:Output'), keywords: ['open source', 'transformers'] },
  ]),

  ...provider({ integrationId: 'replicate', category: 'ai', docs: 'https://replicate.com/docs' }, [
    { op: 'run', name: 'Run a model', summary: 'Runs a hosted model and waits for the result.', fields: [f.text('model', 'Model', { required: true, placeholder: 'owner/name:version' }), f.json('input', 'Input', { required: true })], outputs: outs('output:object:Output', 'predictionId:string:Prediction ID'), keywords: ['image', 'video', 'upscale'] },
  ]),

  ...provider({ integrationId: 'fal', category: 'ai', docs: 'https://fal.ai/docs' }, [
    { op: 'generate_image', name: 'Generate image', summary: 'Creates an image with a fast diffusion model.', fields: [f.expr('prompt', 'Description', { required: true }), f.text('model', 'Model', { placeholder: 'fal-ai/flux/schnell' })], outputs: outs('imageUrl:string:Image URL'), keywords: ['flux', 'diffusion', 'render'] },
  ]),

  ...provider({ integrationId: 'stability', category: 'ai', docs: 'https://platform.stability.ai/docs/api-reference' }, [
    { op: 'generate_image', name: 'Generate image', summary: 'Creates an image with Stable Diffusion.', fields: [f.expr('prompt', 'Description', { required: true }), f.select('aspectRatio', 'Aspect ratio', [opt('1:1'), opt('16:9'), opt('3:2'), opt('9:16')], { defaultValue: '16:9' })], outputs: outs('imageUrl:string:Image URL') },
    { op: 'remove_background', name: 'Remove background', summary: 'Cuts the subject out of a photo.', fields: [f.expr('imageUrl', 'Image', { required: true })], outputs: outs('imageUrl:string:Image URL'), keywords: ['cutout', 'transparent', 'listing photo'] },
  ]),

  ...provider({ integrationId: 'elevenlabs', category: 'ai', docs: 'https://elevenlabs.io/docs/api-reference' }, [
    {
      op: 'text_to_speech',
      name: 'Speak text',
      summary: 'Turns text into a natural-sounding recording.',
      fields: [f.expr('text', 'Text', { required: true }), f.text('voiceId', 'Voice', { required: true, placeholder: 'Rachel' }), f.select('model', 'Model', [opt('eleven_turbo_v2_5', 'Turbo', 'Lowest latency'), opt('eleven_multilingual_v2', 'Multilingual')], { defaultValue: 'eleven_turbo_v2_5' })],
      outputs: outs('audioUrl:string:Audio URL', 'durationSeconds:number:Duration (seconds)'),
      keywords: ['voice', 'tts', 'narration', 'audio'],
    },
  ]),

  ...provider({ integrationId: 'deepgram', category: 'ai', docs: 'https://developers.deepgram.com' }, [
    { op: 'transcribe', name: 'Transcribe audio', summary: 'Converts a recording into text with speaker labels.', fields: [f.expr('audioUrl', 'Audio file', { required: true }), f.bool('diarize', 'Label speakers', { defaultValue: true })], outputs: outs('transcript:string', 'speakers:array', 'confidence:number'), keywords: ['stt', 'speech', 'call', 'diarization'] },
  ]),

  ...provider({ integrationId: 'assemblyai', category: 'ai', docs: 'https://www.assemblyai.com/docs' }, [
    {
      op: 'transcribe',
      name: 'Transcribe and summarise',
      summary: 'Transcribes a recording and returns a summary and action items.',
      fields: [f.expr('audioUrl', 'Audio file', { required: true }), f.bool('summarize', 'Include summary', { defaultValue: true }), f.bool('detectTopics', 'Detect topics')],
      outputs: outs('transcript:string', 'summary:string', 'topics:array', 'sentiment:string'),
      keywords: ['stt', 'meeting', 'notes', 'call'],
    },
  ]),

  ...provider({ integrationId: 'voyage', category: 'ai', docs: 'https://docs.voyageai.com' }, [
    { op: 'embed', name: 'Create embedding', summary: 'Turns text into a vector tuned for retrieval.', fields: [f.select('model', 'Model', [opt('voyage-3'), opt('voyage-finance-2', 'Finance', 'Tuned for financial text')], { defaultValue: 'voyage-3' }), f.expr('input', 'Text', { required: true })], outputs: outs('embedding:array:Vector'), keywords: ['vector', 'rag', 'retrieval'] },
  ]),

  ...provider({ integrationId: 'pinecone', category: 'ai', docs: 'https://docs.pinecone.io' }, [
    { op: 'upsert', name: 'Store vectors', summary: 'Saves embeddings so they can be searched later.', fields: [f.text('namespace', 'Namespace', { placeholder: 'reports' }), f.expr('vectors', 'Vectors', { required: true, placeholder: '{{embed.embedding}}' }), f.json('metadata', 'Metadata')], outputs: outs('upsertedCount:number:Vectors stored') },
    { op: 'query', name: 'Search vectors', summary: 'Finds the closest stored vectors to a query.', fields: [f.text('namespace', 'Namespace'), f.expr('vector', 'Query vector', { required: true }), f.number('topK', 'Return', { defaultValue: 5 })], outputs: outs('matches:array:Matches'), keywords: ['semantic', 'similarity', 'rag'] },
  ]),

  // ── Analytics & monitoring ────────────────────────────────────────────────
  ...provider({ integrationId: 'posthog', category: 'analytics', docs: 'https://posthog.com/docs/api' }, [
    { op: 'capture', name: 'Record an event', summary: 'Sends a product analytics event.', fields: [f.text('event', 'Event name', { required: true, placeholder: 'report_generated' }), f.expr('distinctId', 'Person', { required: true }), f.keyValue('properties', 'Properties')], outputs: outs('eventId:string:Event ID') },
    { op: 'feature_flag', name: 'Check a feature flag', summary: 'Reads whether a flag is on for a person.', fields: [f.text('flagKey', 'Flag', { required: true }), f.expr('distinctId', 'Person', { required: true })], outputs: outs('enabled:boolean:Enabled', 'variant:string') },
  ]),

  ...provider({ integrationId: 'google_analytics', category: 'analytics', docs: 'https://developers.google.com/analytics/devguides/reporting/data/v1' }, [
    { op: 'run_report', name: 'Run a report', summary: 'Pulls metrics and dimensions from GA4.', fields: [f.multi('metrics', 'Metrics', [opt('activeUsers', 'Active users'), opt('sessions', 'Sessions'), opt('conversions', 'Conversions'), opt('screenPageViews', 'Page views')], { required: true }), f.multi('dimensions', 'Break down by', [opt('date', 'Date'), opt('pagePath', 'Page'), opt('sessionSource', 'Source'), opt('country', 'Country')]), f.text('dateRange', 'Period', { defaultValue: '28daysAgo', placeholder: '28daysAgo' })], outputs: outs('rows:array:Rows', 'totals:object:Totals') },
  ]),

  ...provider({ integrationId: 'mixpanel', category: 'analytics', docs: 'https://developer.mixpanel.com/reference' }, [
    { op: 'track', name: 'Record an event', summary: 'Sends an event to Mixpanel.', fields: [f.text('event', 'Event name', { required: true }), f.expr('distinctId', 'Person', { required: true }), f.keyValue('properties', 'Properties')], outputs: outs('status:string') },
  ]),

  ...provider({ integrationId: 'amplitude', category: 'analytics', docs: 'https://www.docs.developers.amplitude.com/analytics/apis/http-v2-api/' }, [
    { op: 'track', name: 'Record an event', summary: 'Sends an event to Amplitude.', fields: [f.text('eventType', 'Event name', { required: true }), f.expr('userId', 'Person', { required: true }), f.keyValue('eventProperties', 'Properties')], outputs: outs('status:string') },
  ]),

  ...provider({ integrationId: 'sentry', category: 'analytics', docs: 'https://docs.sentry.io/api/' }, [
    { op: 'issue_created', kind: 'trigger', name: 'New error', summary: 'Runs when Sentry records a new issue.', fields: [f.select('level', 'Minimum level', [opt('warning', 'Warning and above'), opt('error', 'Error and above'), opt('fatal', 'Fatal only')], { defaultValue: 'error' })], outputs: outs('issueId:string:Issue ID', 'title:string', 'culprit:string', 'level:string', 'permalink:string:Link'), keywords: ['exception', 'crash', 'bug'] },
    { op: 'resolve', name: 'Resolve an issue', summary: 'Marks a Sentry issue as resolved.', fields: [f.expr('issueId', 'Issue', { required: true })], outputs: outs('status:string') },
  ]),

  ...provider({ integrationId: 'logrocket', category: 'analytics', docs: 'https://docs.logrocket.com' }, [
    { op: 'session_url', name: 'Get session replay', summary: 'Returns the replay link for a user’s session.', fields: [f.expr('userId', 'Person', { required: true })], outputs: outs('sessionUrl:string:Session URL'), keywords: ['replay', 'recording', 'support'] },
  ]),

  ...provider({ integrationId: 'datadog', category: 'analytics', docs: 'https://docs.datadoghq.com/api/latest/' }, [
    { op: 'send_metric', name: 'Send a metric', summary: 'Records a custom metric point.', fields: [f.text('metric', 'Metric name', { required: true, placeholder: 'workflow.reports.generated' }), f.expr('value', 'Value', { required: true }), f.keyValue('tags', 'Tags')], outputs: outs('status:string') },
    { op: 'send_event', name: 'Send an event', summary: 'Posts an event to the Datadog stream.', fields: [f.expr('title', 'Title', { required: true }), f.expr('text', 'Details'), f.select('alertType', 'Type', [opt('info', 'Info'), opt('warning', 'Warning'), opt('error', 'Error'), opt('success', 'Success')], { defaultValue: 'info' })], outputs: outs('eventId:string:Event ID') },
  ]),

  ...provider({ integrationId: 'semrush', category: 'analytics', docs: 'https://developer.semrush.com' }, [
    { op: 'keyword_overview', name: 'Look up a keyword', summary: 'Returns search volume and difficulty for a keyword.', fields: [f.expr('keyword', 'Keyword', { required: true, placeholder: 'buyers agent {{trigger.suburb}}' }), f.text('database', 'Market', { defaultValue: 'au' })], outputs: outs('volume:number:Search volume', 'difficulty:number', 'cpc:number:Cost per click'), keywords: ['seo', 'search', 'content'] },
    { op: 'domain_overview', name: 'Look up a domain', summary: 'Returns traffic and ranking data for a domain.', fields: [f.expr('domain', 'Domain', { required: true }), f.text('database', 'Market', { defaultValue: 'au' })], outputs: outs('organicTraffic:number:Organic traffic', 'organicKeywords:number:Ranking keywords', 'authorityScore:number:Authority score') },
  ]),

  ...provider({ integrationId: 'google_search_console', category: 'analytics', docs: 'https://developers.google.com/webmaster-tools/v1/api_reference_index' }, [
    { op: 'query', name: 'Get search performance', summary: 'Returns clicks and impressions for your pages or queries.', fields: [f.select('dimension', 'Break down by', [opt('query', 'Search query'), opt('page', 'Page'), opt('country', 'Country'), opt('device', 'Device')], { required: true, defaultValue: 'query' }), f.number('days', 'Over the last (days)', { defaultValue: 28 }), f.number('rowLimit', 'Rows', { defaultValue: 25 })], outputs: outs('rows:array:Rows', 'clicks:number:Total clicks', 'impressions:number:Total impressions'), keywords: ['seo', 'gsc', 'ranking'] },
  ]),
];
