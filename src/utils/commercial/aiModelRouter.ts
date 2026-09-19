export type AiTaskType = 'commentary' | 'marketResearch' | 'executiveSummary' | 'embedding' | 'voiceTranscription' | 'orchestration';

export interface AiModelRoute { taskType: AiTaskType; model: string; purpose: string; deterministicCalculationsAllowed: false; }

export function routeAiModel(taskType: AiTaskType): AiModelRoute {
  const routes: Record<AiTaskType, Omit<AiModelRoute, 'taskType' | 'deterministicCalculationsAllowed'>> = {
    commentary: { model: 'gpt-4o', purpose: 'commentary, explanations, report sections and risk summaries' },
    marketResearch: { model: 'perplexity-sonar-pro', purpose: 'market cap-rate, comparable, vacancy and location context' },
    executiveSummary: { model: 'gemini-2.5-flash', purpose: 'concise client-facing summaries' },
    embedding: { model: 'text-embedding-3-small', purpose: 'RAG embeddings, document chunking and source matching' },
    voiceTranscription: { model: 'whisper', purpose: 'voice note transcription' },
    orchestration: { model: 'supabase-edge-functions', purpose: 'prompt assembly, persistence, JSON output storage and recalculation triggers' },
  };
  return { taskType, ...routes[taskType], deterministicCalculationsAllowed: false };
}
