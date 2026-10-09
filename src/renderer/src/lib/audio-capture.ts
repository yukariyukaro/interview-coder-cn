import { useSettingsStore } from '@/lib/store/settings'

const TARGET_SAMPLE_RATE = 16000

/**
 * The two tracks the transcriber listens to. `system` is what the speakers play
 * (the interviewer on the other end of the call), `mic` is the user's own voice
 * (the candidate). They are captured and transcribed separately so each line can
 * be attributed to whoever said it.
 */
export type AudioSource = 'system' | 'mic'

export const AUDIO_SOURCES: AudioSource[] = ['system', 'mic']

type Pipeline = {
  mediaStream: MediaStream | null
  audioContext: AudioContext | null
  processor: ScriptProcessorNode | null
}

const pipelines: Partial<Record<AudioSource, Pipeline>> = {}

/**
 * Linear-interpolation resample to 16 kHz, done in JS instead of relying on
 * AudioContext({ sampleRate: 16000 }), which glitches with some input devices
 * on Windows (dropped/duplicated blocks).
 */
function resampleTo16k(input: Float32Array, inputRate: number): Float32Array {
  if (inputRate === TARGET_SAMPLE_RATE) return input
  const ratio = inputRate / TARGET_SAMPLE_RATE
  const outputLength = Math.floor(input.length / ratio)
  const output = new Float32Array(outputLength)
  for (let i = 0; i < outputLength; i++) {
    const pos = i * ratio
    const idx = Math.floor(pos)
    const frac = pos - idx
    const a = input[idx]
    const b = input[Math.min(idx + 1, input.length - 1)]
    output[i] = a + (b - a) * frac
  }
  return output
}

function downsampleAndSend(
  source: AudioSource,
  inputRate: number,
  float32: Float32Array
): void {
  const resampled = resampleTo16k(float32, inputRate)
  const int16 = new Int16Array(resampled.length)
  for (let i = 0; i < resampled.length; i++) {
    const s = Math.max(-1, Math.min(1, resampled[i]))
    int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff
  }
  window.api.sendTranscriptionAudioChunk(int16.buffer, source)
}

/** The candidate's own voice, through the configured input device */
function openMicrophone(): Promise<MediaStream> {
  const { audioInputDeviceId } = useSettingsStore.getState()
  return navigator.mediaDevices.getUserMedia({
    audio: { deviceId: { exact: audioInputDeviceId || 'default' } },
    video: false
  })
}

/**
 * The interviewer's voice, taken from the speakers. `getDisplayMedia` is the only
 * way to get loopback audio; the video track it insists on is stopped right away.
 * Main installs the matching `setDisplayMediaRequestHandler`.
 */
async function openSystemAudio(): Promise<MediaStream> {
  const display = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true })
  display.getVideoTracks().forEach((track) => track.stop())

  const audioTracks = display.getAudioTracks()
  if (audioTracks.length === 0) {
    display.getTracks().forEach((track) => track.stop())
    throw new Error('未获取到系统音频')
  }
  return new MediaStream(audioTracks)
}

function terminate(pipeline: Pipeline): void {
  if (pipeline.processor) {
    pipeline.processor.disconnect()
    pipeline.processor = null
  }
  if (pipeline.audioContext) {
    void pipeline.audioContext.close()
    pipeline.audioContext = null
  }
  if (pipeline.mediaStream) {
    pipeline.mediaStream.getTracks().forEach((track) => track.stop())
    pipeline.mediaStream = null
  }
}

/**
 * Start feeding one track to the main process. A failing capture surfaces to the
 * caller: silently capturing nothing would look like a working transcription that
 * never hears anything.
 */
export async function startAudioCapture(source: AudioSource): Promise<void> {
  if (pipelines[source]) return

  const mediaStream = source === 'system' ? await openSystemAudio() : await openMicrophone()
  const pipeline: Pipeline = { mediaStream, audioContext: null, processor: null }
  pipelines[source] = pipeline

  try {
    pipeline.audioContext = new AudioContext()
    const audioSource = pipeline.audioContext.createMediaStreamSource(
      new MediaStream(mediaStream.getAudioTracks())
    )

    pipeline.processor = pipeline.audioContext.createScriptProcessor(2048, 1, 1)
    pipeline.processor.onaudioprocess = (e) => {
      downsampleAndSend(
        source,
        pipeline.audioContext?.sampleRate ?? TARGET_SAMPLE_RATE,
        e.inputBuffer.getChannelData(0)
      )
    }
    audioSource.connect(pipeline.processor)
    // Mute before routing to the destination: ScriptProcessorNode only runs while it
    // is connected to the context, and loopback audio routed back out would be
    // captured a second time (the microphone hears the speakers).
    const mute = pipeline.audioContext.createGain()
    mute.gain.value = 0
    pipeline.processor.connect(mute)
    mute.connect(pipeline.audioContext.destination)
  } catch (error) {
    stopAudioCapture(source)
    throw error
  }
}

/** Whether this renderer is currently feeding one track */
export function hasAudioCapture(source: AudioSource): boolean {
  return Boolean(pipelines[source])
}

export function stopAudioCapture(source: AudioSource): void {
  const pipeline = pipelines[source]
  if (!pipeline) return
  terminate(pipeline)
  delete pipelines[source]
}
