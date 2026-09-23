import { useSettingsStore } from '@/lib/store/settings'

const TARGET_SAMPLE_RATE = 16000

let mediaStream: MediaStream | null = null
let audioContext: AudioContext | null = null
let processor: ScriptProcessorNode | null = null

/**
 * Linear-interpolation resample to 16 kHz, done in JS instead of relying on
 * AudioContext({ sampleRate: 16000 }), which glitches with loopback sources
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

function downsampleAndSend(float32: Float32Array): void {
  const resampled = resampleTo16k(
    float32,
    audioContext?.sampleRate ?? TARGET_SAMPLE_RATE
  )
  const int16 = new Int16Array(resampled.length)
  for (let i = 0; i < resampled.length; i++) {
    const s = Math.max(-1, Math.min(1, resampled[i]))
    int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff
  }
  window.api.sendTranscriptionAudioChunk(int16.buffer)
}

async function openMicrophoneStream(deviceId: string): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    audio: { deviceId: { exact: deviceId } },
    video: false
  })
}

async function openSystemAudioStream(): Promise<MediaStream> {
  const stream = await navigator.mediaDevices.getDisplayMedia({
    audio: true,
    video: true
  })
  // The video track is discarded, but only after the AudioContext consumes
  // the stream: stopping it too early can terminate the whole share on some
  // Chromium versions and take the loopback audio track down with it.
  stream.getVideoTracks().forEach((t) => t.stop())
  return stream
}

export async function startAudioCapture(): Promise<void> {
  const { audioInputDeviceId } = useSettingsStore.getState()

  let stream: MediaStream
  if (audioInputDeviceId) {
    try {
      stream = await openMicrophoneStream(audioInputDeviceId)
    } catch (err) {
      console.warn('Failed to open selected microphone, falling back to system audio:', err)
      stream = await openSystemAudioStream()
    }
  } else {
    stream = await openSystemAudioStream()
  }

  mediaStream = stream

  audioContext = new AudioContext()

  const source = audioContext.createMediaStreamSource(new MediaStream(stream.getAudioTracks()))

  processor = audioContext.createScriptProcessor(2048, 1, 1)
  processor.onaudioprocess = (e) => {
    downsampleAndSend(e.inputBuffer.getChannelData(0))
  }
  source.connect(processor)
  // Mute before routing to the destination: ScriptProcessorNode only runs
  // while it is connected to the context, but re-playing captured system
  // audio out of the loopbacked speaker creates echo ghosts in the capture.
  const mute = audioContext.createGain()
  mute.gain.value = 0
  processor.connect(mute)
  mute.connect(audioContext.destination)
}

export function stopAudioCapture(): void {
  if (processor) {
    processor.disconnect()
    processor = null
  }
  if (audioContext) {
    audioContext.close()
    audioContext = null
  }
  if (mediaStream) {
    mediaStream.getTracks().forEach((t) => t.stop())
    mediaStream = null
  }
}
