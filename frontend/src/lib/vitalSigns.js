const MIN_DURATION_SECONDS = 25
const MIN_SAMPLE_RATE = 10

function mean(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function standardDeviation(values) {
  const average = mean(values)
  return Math.sqrt(mean(values.map((value) => (value - average) ** 2)))
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

function detrend(values, times) {
  const averageTime = mean(times)
  const averageValue = mean(values)
  let numerator = 0
  let denominator = 0
  for (let index = 0; index < values.length; index += 1) {
    numerator += (times[index] - averageTime) * (values[index] - averageValue)
    denominator += (times[index] - averageTime) ** 2
  }
  const slope = denominator ? numerator / denominator : 0
  return values.map((value, index) => value - averageValue - slope * (times[index] - averageTime))
}

function movingAverage(values, radius) {
  const result = new Array(values.length)
  let running = 0
  let left = 0
  let right = -1
  for (let index = 0; index < values.length; index += 1) {
    const wantedLeft = Math.max(0, index - radius)
    const wantedRight = Math.min(values.length - 1, index + radius)
    while (right < wantedRight) running += values[++right]
    while (left < wantedLeft) running -= values[left++]
    result[index] = running / (right - left + 1)
  }
  return result
}

function resampleUniform(samples) {
  const sourceTimes = samples.map((sample) => (sample.t - samples[0].t) / 1000)
  const intervals = sourceTimes.slice(1).map((time, index) => time - sourceTimes[index])
  if (intervals.some((interval) => interval <= 0)) throw new Error('Camera sample timing was invalid. Please try again.')
  const sampleRate = Math.min(30, Math.max(MIN_SAMPLE_RATE, 1 / median(intervals)))
  const duration = sourceTimes[sourceTimes.length - 1]
  const sampleCount = Math.floor(duration * sampleRate) + 1
  const times = Array.from({ length: sampleCount }, (_, index) => index / sampleRate)
  const channels = ['r', 'g', 'b'].map((channel) => {
    let right = 1
    return times.map((time) => {
      while (right < sourceTimes.length - 1 && sourceTimes[right] < time) right += 1
      const left = Math.max(0, right - 1)
      const span = sourceTimes[right] - sourceTimes[left]
      const amount = span > 0 ? (time - sourceTimes[left]) / span : 0
      return samples[left][channel] + amount * (samples[right][channel] - samples[left][channel])
    })
  })
  return { times, red: channels[0], green: channels[1], blue: channels[2], sampleRate }
}

// POS is calculated in short overlapping windows so automatic exposure and
// slow lighting drift cannot dominate an entire measurement.
function posProjection(red, green, blue, times, sampleRate) {
  const output = new Array(red.length).fill(0)
  const weights = new Array(red.length).fill(0)
  const windowSize = Math.max(16, Math.round(sampleRate * 1.6))
  const step = Math.max(1, Math.floor(windowSize / 2))
  const starts = []
  for (let start = 0; start + windowSize <= red.length; start += step) starts.push(start)
  const lastStart = Math.max(0, red.length - windowSize)
  if (starts[starts.length - 1] !== lastStart) starts.push(lastStart)

  for (const start of starts) {
    const end = start + windowSize
    const rWindow = red.slice(start, end)
    const gWindow = green.slice(start, end)
    const bWindow = blue.slice(start, end)
    const rMean = mean(rWindow)
    const gMean = mean(gWindow)
    const bMean = mean(bWindow)
    const x = gWindow.map((value, index) => value / gMean - bWindow[index] / bMean)
    const y = gWindow.map((value, index) => value / gMean + bWindow[index] / bMean - 2 * rWindow[index] / rMean)
    const ySpread = standardDeviation(y)
    if (ySpread < Number.EPSILON) continue
    const alpha = standardDeviation(x) / ySpread
    const projected = detrend(x.map((value, index) => value + alpha * y[index]), times.slice(start, end))
    const scale = Math.max(standardDeviation(projected), Number.EPSILON)
    for (let offset = 0; offset < windowSize; offset += 1) {
      const windowWeight = 0.5 - 0.5 * Math.cos((2 * Math.PI * (offset + 1)) / (windowSize + 1))
      output[start + offset] += (projected[offset] / scale) * windowWeight
      weights[start + offset] += windowWeight
    }
  }

  if (!weights.some((weight) => weight > 0)) throw new Error('The camera could not find enough color variation for an estimate.')
  return output.map((value, index) => weights[index] ? value / weights[index] : 0)
}

function spectralPeak(values, times, minimumHz, maximumHz) {
  const signal = detrend(values, times)
  const duration = times[times.length - 1] - times[0]
  const frequencyStep = Math.max(0.002, 1 / (duration * 8))
  const powers = []

  for (let frequency = minimumHz; frequency <= maximumHz + 1e-9; frequency += frequencyStep) {
    let real = 0
    let imaginary = 0
    for (let index = 0; index < signal.length; index += 1) {
      const window = signal.length === 1 ? 1 : 0.5 - 0.5 * Math.cos((2 * Math.PI * index) / (signal.length - 1))
      const phase = 2 * Math.PI * frequency * times[index]
      real += signal[index] * window * Math.cos(phase)
      imaginary -= signal[index] * window * Math.sin(phase)
    }
    powers.push({ frequency, power: real ** 2 + imaginary ** 2 })
  }

  const peakIndex = powers.reduce((best, item, index) => item.power > powers[best].power ? index : best, 0)
  const peak = powers[peakIndex]
  let frequency = peak.frequency
  if (peakIndex > 0 && peakIndex < powers.length - 1) {
    const left = powers[peakIndex - 1].power
    const center = peak.power
    const right = powers[peakIndex + 1].power
    const denominator = left - 2 * center + right
    if (Math.abs(denominator) > Number.EPSILON) {
      frequency += Math.max(-0.5, Math.min(0.5, 0.5 * (left - right) / denominator)) * frequencyStep
    }
  }
  const background = powers
    .filter((item) => Math.abs(item.frequency - peak.frequency) > Math.max(0.05, frequencyStep * 4))
    .map((item) => item.power)
  const noiseFloor = Math.max(median(background), Number.EPSILON)
  return { frequency, ratio: peak.power / noiseFloor }
}

function segmentSpread(values, times, minimumHz, maximumHz, parts) {
  const rates = []
  for (let part = 0; part < parts; part += 1) {
    const start = Math.floor(values.length * part / parts)
    const end = Math.floor(values.length * (part + 1) / parts)
    const localTimes = times.slice(start, end).map((time) => time - times[start])
    const peak = spectralPeak(values.slice(start, end), localTimes, minimumHz, maximumHz)
    if (peak.ratio >= 2) rates.push(peak.frequency * 60)
  }
  return rates.length >= 2 ? Math.max(...rates) - Math.min(...rates) : Infinity
}

/**
 * Estimate pulse and breathing frequency from average RGB samples collected
 * over multiple skin regions. Pulse uses windowed POS color projection;
 * respiration chooses the cleaner of intensity modulation and pulse-amplitude
 * modulation. Both are experimental webcam estimates.
 */
export function estimateVitalSigns(samples) {
  if (!Array.isArray(samples) || samples.length < 2) throw new Error('Not enough camera samples were collected.')
  if (!samples.every((sample) => [sample.t, sample.r, sample.g, sample.b].every(Number.isFinite))) {
    throw new Error('The camera produced an invalid color sample.')
  }

  const duration = (samples[samples.length - 1].t - samples[0].t) / 1000
  const observedSampleRate = (samples.length - 1) / duration
  if (duration < MIN_DURATION_SECONDS || observedSampleRate < MIN_SAMPLE_RATE) {
    throw new Error('The camera measurement was too short or missed too many frames. Please try again.')
  }

  const averageRed = mean(samples.map((sample) => sample.r))
  const averageGreen = mean(samples.map((sample) => sample.g))
  const averageBlue = mean(samples.map((sample) => sample.b))
  if (Math.min(averageRed, averageGreen, averageBlue) < 25 || Math.max(averageRed, averageGreen, averageBlue) > 245) {
    throw new Error('The face is too dark or overexposed. Adjust the lighting and try again.')
  }

  const { times, red, green, blue, sampleRate } = resampleUniform(samples)
  const pulseSignal = posProjection(red, green, blue, times, sampleRate)
  const heartPeak = spectralPeak(pulseSignal, times, 0.75, 3.0)
  const heartSpread = segmentSpread(pulseSignal, times, 0.75, 3.0, 3)

  const normalizedIntensity = red.map((value, index) => (
    value / averageRed + green[index] / averageGreen + blue[index] / averageBlue
  ) / 3)
  const pulseEnvelope = movingAverage(pulseSignal.map(Math.abs), Math.max(1, Math.round(sampleRate * 0.5)))
  const intensityBreath = spectralPeak(normalizedIntensity, times, 0.1, 0.5)
  const envelopeBreath = spectralPeak(pulseEnvelope, times, 0.1, 0.5)
  const useEnvelope = envelopeBreath.ratio > intensityBreath.ratio
  const breathingPeak = useEnvelope ? envelopeBreath : intensityBreath

  const intervals = samples.slice(1).map((sample, index) => (sample.t - samples[index].t) / 1000)
  const cadenceVariation = standardDeviation(intervals) / mean(intervals)
  const brightness = samples.map((sample) => (sample.r + sample.g + sample.b) / 3)
  const frameChange = median(brightness.slice(1).map((value, index) => Math.abs(value - brightness[index]) / Math.max(brightness[index], 1)))
  if (heartPeak.ratio < 2 || heartSpread > 28 || cadenceVariation > 0.5 || frameChange > 0.08) {
    throw new Error('The signal was too noisy for a dependable pulse estimate. Hold still, use steady front lighting, and try again.')
  }

  return {
    heart_rate_bpm: Math.round(heartPeak.frequency * 60),
    breathing_rate_bpm: Math.round(breathingPeak.frequency * 60),
    duration_seconds: Math.round(duration * 10) / 10,
    sample_count: samples.length,
    method: 'camera_rppg_pos_v2',
    quality: {
      acceptable: true,
      message: 'Camera pulse and breathing estimates captured.',
    },
  }
}
