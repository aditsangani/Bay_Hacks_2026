import test from 'node:test'
import assert from 'node:assert/strict'
import { estimateVitalSigns } from './vitalSigns.js'

function syntheticSamples({ seconds = 30, sampleRate = 20, heartBpm = 72, breathingRate = 15 } = {}) {
  const samples = []
  for (let index = 0; index <= seconds * sampleRate; index += 1) {
    const secondsElapsed = index / sampleRate
    const pulse = Math.sin(2 * Math.PI * (heartBpm / 60) * secondsElapsed)
    const breath = Math.sin(2 * Math.PI * (breathingRate / 60) * secondsElapsed)
    samples.push({
      t: secondsElapsed * 1000,
      r: 145 + 0.2 * pulse + 1.4 * breath,
      g: 118 + 1.1 * pulse + 1.2 * breath,
      b: 92 - 0.25 * pulse + 0.7 * breath,
    })
  }
  return samples
}

test('recovers pulse and breathing frequencies from a clean color trace', () => {
  const result = estimateVitalSigns(syntheticSamples())
  assert.ok(Math.abs(result.heart_rate_bpm - 72) <= 2)
  assert.ok(Math.abs(result.breathing_rate_bpm - 15) <= 1)
  assert.equal(result.quality.acceptable, true)
  assert.equal(result.method, 'camera_rppg_pos_v2')
})

test('handles irregular frame timing using sample timestamps', () => {
  const samples = syntheticSamples({ heartBpm: 84, breathingRate: 18 })
    .map((sample, index) => ({ ...sample, t: sample.t + Math.sin(index * 0.7) * 8 }))
  const result = estimateVitalSigns(samples)
  assert.ok(Math.abs(result.heart_rate_bpm - 84) <= 2)
  assert.ok(Math.abs(result.breathing_rate_bpm - 18) <= 1)
})

test('keeps pulse stable through slow automatic-exposure drift', () => {
  const samples = syntheticSamples({ heartBpm: 78 }).map((sample) => {
    const seconds = sample.t / 1000
    const exposure = 0.92 + seconds * 0.004 + 0.025 * Math.sin(2 * Math.PI * 0.04 * seconds)
    return { ...sample, r: sample.r * exposure, g: sample.g * exposure, b: sample.b * exposure }
  })
  const result = estimateVitalSigns(samples)
  assert.ok(Math.abs(result.heart_rate_bpm - 78) <= 3)
})

test('rejects a recording with severe frame-to-frame lighting changes', () => {
  const unstable = syntheticSamples().map((sample, index) => {
    const exposure = index % 2 ? 1.25 : 0.75
    return { ...sample, r: sample.r * exposure, g: sample.g * exposure, b: sample.b * exposure }
  })
  assert.throws(() => estimateVitalSigns(unstable), /too noisy/i)
})

test('rejects short and badly lit recordings', () => {
  assert.throws(() => estimateVitalSigns(syntheticSamples({ seconds: 8 })), /too short/i)
  const dark = syntheticSamples().map((sample) => ({ ...sample, r: 5, g: 5, b: 5 }))
  assert.throws(() => estimateVitalSigns(dark), /too dark/i)
})
