import { smoothStream, streamText, type ModelMessage } from 'ai'
import { createOpenAI } from '@ai-sdk/openai'
import { getEffectiveAISettings, settings } from '../core/settings'

const SMALL_STREAM_CHUNK_SIZE = 8
const LARGE_STREAM_CHUNK_SIZE = 24
const LARGE_STREAM_BUFFER_THRESHOLD = 96
const STREAM_CHUNK_DELAY_MS = 12

// The system prompt is fully managed by the renderer (prompt scenes in the
// settings store) and synced here via updateAppSettings on app startup
function getSystemPrompt(extra?: string) {
  const scenePrompt = settings.scenes.find((scene) => scene.id === settings.activeSceneId)?.prompt
  return [scenePrompt ?? settings.customPrompt, extra].filter(Boolean).join('\n\n') || undefined
}

function getModel(aiSettings: ReturnType<typeof getEffectiveAISettings>) {
  const fallbackModel = aiSettings.apiBaseURL.includes('siliconflow')
    ? 'Qwen/Qwen3-VL-32B-Instruct'
    : 'gpt-5-mini'
  return aiSettings.model || fallbackModel
}

function isOpenAIReasoningModel(model: string): boolean {
  const modelId = model.split('/').at(-1) ?? model
  return modelId.startsWith('gpt-5') || /^o[1-9](?:$|-)/.test(modelId)
}

function getProviderOptions(model: string) {
  const reasoningEffort = settings.scenes.find(
    (scene) => scene.id === settings.activeSceneId
  )?.reasoningEffort
  if (!reasoningEffort || reasoningEffort === 'default' || !isOpenAIReasoningModel(model))
    return undefined
  return {
    openai: {
      reasoningEffort
    }
  }
}

export function getSmoothStreamChunk(buffer: string): string | null {
  const characters = Array.from(buffer)
  if (characters.length < SMALL_STREAM_CHUNK_SIZE) return null
  const chunkSize =
    characters.length >= LARGE_STREAM_BUFFER_THRESHOLD
      ? LARGE_STREAM_CHUNK_SIZE
      : SMALL_STREAM_CHUNK_SIZE
  return characters.slice(0, chunkSize).join('')
}

function getStreamOptions() {
  const aiSettings = getEffectiveAISettings(settings)
  const openai = createOpenAI({
    baseURL: aiSettings.apiBaseURL,
    apiKey: aiSettings.apiKey
  })
  const model = getModel(aiSettings)
  const providerOptions = getProviderOptions(model)
  return {
    model: openai.chat(model),
    experimental_transform: smoothStream({
      delayInMs: STREAM_CHUNK_DELAY_MS,
      chunking: getSmoothStreamChunk
    }),
    ...(providerOptions ? { providerOptions } : {})
  }
}

export function getSolutionStream(messages: ModelMessage[], abortSignal?: AbortSignal) {
  const { textStream } = streamText({
    ...getStreamOptions(),
    system: getSystemPrompt(),
    messages,
    abortSignal,
    onError: (err) => {
      throw err.error ?? err
    }
  })
  return textStream
}

export function getFollowUpStream(
  messages: ModelMessage[],
  userQuestion: string,
  abortSignal?: AbortSignal
) {
  // Add the user's follow-up question to the conversation
  const updatedMessages: ModelMessage[] = [
    ...messages,
    {
      role: 'user',
      content: [
        {
          type: 'text',
          text: userQuestion
        }
      ]
    }
  ]

  const { textStream } = streamText({
    ...getStreamOptions(),
    system: getSystemPrompt(),
    messages: updatedMessages,
    abortSignal,
    onError: (err) => {
      throw err.error ?? err
    }
  })
  return textStream
}

export function getGeneralStream(messages: ModelMessage[], abortSignal?: AbortSignal) {
  const { textStream } = streamText({
    ...getStreamOptions(),
    system: getSystemPrompt(
      '注意：如果有多张截图，请结合所有截图内容进行完整分析，不要遗漏任何部分。'
    ),
    messages,
    abortSignal,
    onError: (err) => {
      throw err.error ?? err
    }
  })
  return textStream
}
