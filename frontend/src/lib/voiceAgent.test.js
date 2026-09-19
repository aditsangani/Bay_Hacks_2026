import test from 'node:test'
import assert from 'node:assert/strict'
import { buildIntakeContext, buildVoiceAgentPrompt } from './voiceAgent.js'

test('provides reported symptom details as adaptive interview context', () => {
  const answers = { pain: 1, pain_severity: 6, pain_location: 'back', fatigue: 0, concentration: 0 }
  assert.match(buildIntakeContext(answers), /six|6 out of ten/i)
  assert.match(buildIntakeContext(answers), /back/i)
})

test('does not turn skipped answers into reassuring facts', () => {
  const context = buildIntakeContext({ hours_sleep: null, mood: null, pain: null })
  assert.doesNotMatch(context, /zero|no pain|normal/i)
})

test('prompt requires adaptive single-question interviewing and safety escalation', () => {
  const prompt = buildVoiceAgentPrompt({ fatigue: 1, hours_sleep: 5, usual_sleep_hours: 8 })
  assert.match(prompt, /exactly one question at a time/i)
  assert.match(prompt, /do not mechanically repeat/i)
  assert.match(prompt, /call 911/i)
  assert.match(prompt, /unusual fatigue/i)
})
