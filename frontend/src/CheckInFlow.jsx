import React, { useRef, useState, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import {
  ShieldCheck,
  Camera,
  Mic,
  ClipboardList,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  ChevronRight,
} from 'lucide-react'
import { Card, Button, ProgressSteps, RiskBadge } from './components/ui.jsx'
import WellnessQuestion from './components/WellnessQuestion.jsx'
import { useAuth } from './context/AuthContext.jsx'

/**
 * Daily 60-second check-in flow.
 *
 * Steps:
 *  1. Consent screen (required before anything records — HIPAA-principles slide)
 *  2. Webcam capture -> live guidance via /api/checkin/face/preview (transient,
 *     nothing persisted), then a 3-frame burst -> POST /api/checkin/face
 *     (median-based facial asymmetry, only derived measurements cached)
 *  3. ElevenLabs Conversational AI widget -> spoken fluency prompts, then
 *     POST /api/checkin/voice with latency/jitter data
 *  4. Adaptive wellness questionnaire -> POST /api/checkin/wellness/plan on
 *     every answer to get pruned follow-up questions and completeness
 *  5. POST /api/checkin/submit -> combined risk score + wellness + FHIR-shaped
 *     payload
 *
 * The patient is whoever is currently authenticated (see AuthContext) --
 * every request below carries their Supabase access token, and the
 * backend derives patient_id from it rather than trusting the client.
 *
 * ElevenLabs widget docs: https://elevenlabs.io/docs/conversational-ai/guides/quickstart
 * (confirm the exact web component tag/attributes against their current docs —
 *  this is written against their standard <elevenlabs-convai> embed pattern.)
 */

const ELEVENLABS_AGENT_ID = 'agent_1201m2wz6ap4e3yrmdy4cfbgn5pm'

const STEPS = {
  CONSENT: 'consent',
  FACE: 'face',
  VOICE: 'voice',
  WELLNESS: 'wellness',
  RESULT: 'result',
}

const STEP_LIST = [
  { key: STEPS.CONSENT, label: 'Consent' },
  { key: STEPS.FACE, label: 'Face' },
  { key: STEPS.VOICE, label: 'Voice' },
  { key: STEPS.WELLNESS, label: 'Wellness' },
  { key: STEPS.RESULT, label: 'Result' },
]

const fade = {
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -12 },
  transition: { duration: 0.25, ease: 'easeOut' },
}

async function postJSON(url, body, token) {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(data.error || `Request to ${url} failed (${res.status})`)
  }
  return data
}

export default function CheckInFlow() {
  const { getAccessToken } = useAuth()
  const [step, setStep] = useState(STEPS.CONSENT)
  const [consented, setConsented] = useState(false)
  const [voiceStartTime, setVoiceStartTime] = useState(null)
  const [finalResult, setFinalResult] = useState(null)
  const [error, setError] = useState(null)
  const [capturing, setCapturing] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [preview, setPreview] = useState(null) // { acceptable, message } from /face/preview

  const [wellnessPlan, setWellnessPlan] = useState(null)
  const [wellnessAnswers, setWellnessAnswers] = useState({})
  const [wellnessLoading, setWellnessLoading] = useState(false)

  const videoRef = useRef(null)
  const canvasRef = useRef(null)
  const streamRef = useRef(null)
  const mountedRef = useRef(true)
  const previewInFlightRef = useRef(false)

  // --- Load ElevenLabs widget script once ---
  useEffect(() => {
    if (document.getElementById('elevenlabs-convai-script')) return
    const script = document.createElement('script')
    script.id = 'elevenlabs-convai-script'
    script.src = 'https://unpkg.com/@elevenlabs/convai-widget-embed'
    script.async = true
    document.body.appendChild(script)
  }, [])

  const startCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true })
      if (!mountedRef.current) {
        stream.getTracks().forEach((track) => track.stop())
        return
      }
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
      }
    } catch (err) {
      setError('Camera access denied or unavailable: ' + err.message)
    }
  }, [])

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop())
      streamRef.current = null
    }
  }, [])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      stopCamera()
    }
  }, [stopCamera])

  const captureFrameDataUrl = useCallback(() => {
    const video = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas || !video.videoWidth) return null
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    canvas.getContext('2d').drawImage(video, 0, 0)
    return canvas.toDataURL('image/jpeg', 0.8)
  }, [])

  // --- Live positioning guidance while on the face step (transient, never persisted) ---
  useEffect(() => {
    if (step !== STEPS.FACE) {
      setPreview(null)
      return
    }
    const id = setInterval(async () => {
      if (previewInFlightRef.current) return
      const frame = captureFrameDataUrl()
      if (!frame) return
      previewInFlightRef.current = true
      try {
        const result = await postJSON('/api/checkin/face/preview', { image_b64: frame }, getAccessToken())
        if (mountedRef.current) setPreview(result.quality)
      } catch {
        // transient preview hiccups aren't worth surfacing to the user
      } finally {
        previewInFlightRef.current = false
      }
    }, 700)
    return () => clearInterval(id)
  }, [step, captureFrameDataUrl, getAccessToken])

  const handleConsent = async () => {
    setConsented(true)
    setStep(STEPS.FACE)
    await startCamera()
  }

  const handleCapture = async () => {
    setCapturing(true)
    setError(null)
    try {
      const frames = []
      for (let i = 0; i < 3; i++) {
        const frame = captureFrameDataUrl()
        if (!frame) throw new Error('Camera not ready yet — wait a moment and try again.')
        frames.push(frame)
        if (i < 2) await new Promise((resolve) => setTimeout(resolve, 200))
      }
      await postJSON('/api/checkin/face', { images_b64: frames }, getAccessToken())
      stopCamera()
      setStep(STEPS.VOICE)
      setVoiceStartTime(Date.now())
    } catch (err) {
      setError(err.message)
    } finally {
      setCapturing(false)
    }
  }

  // Placeholder for capturing voice metrics. In the real build, wire this
  // to ElevenLabs' post-call webhook or client-side conversation events to
  // get actual response latency / audio for jitter analysis. For the demo,
  // this button simulates "conversation finished."
  const handleVoiceDone = async () => {
    setSubmitting(true)
    setError(null)
    try {
      await postJSON('/api/checkin/voice', {
        response_latency_ms: voiceStartTime ? Date.now() - voiceStartTime : null,
        // voice_jitter is a stub here — either wire in a Parselmouth
        // analysis step server-side on the recorded audio, or be
        // upfront in the demo that this is simulated for now.
        voice_jitter: 0.01 + Math.random() * 0.02,
      }, getAccessToken())
      setStep(STEPS.WELLNESS)
    } catch (err) {
      setError('Voice check-in failed: ' + err.message)
    } finally {
      setSubmitting(false)
    }
  }

  // --- Wellness questionnaire: every answer round-trips to /wellness/plan,
  // which prunes stale follow-ups and returns the authoritative answer set. ---
  const refreshWellnessPlan = async (nextAnswers) => {
    setWellnessLoading(true)
    setError(null)
    try {
      const plan = await postJSON('/api/checkin/wellness/plan', { answers: nextAnswers }, getAccessToken())
      setWellnessPlan(plan)
      setWellnessAnswers(plan.answers)
    } catch (err) {
      setError(err.message)
    } finally {
      setWellnessLoading(false)
    }
  }

  useEffect(() => {
    if (step === STEPS.WELLNESS) refreshWellnessPlan({})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step])

  const handleWellnessAnswer = (questionId, value) => {
    refreshWellnessPlan({ ...wellnessAnswers, [questionId]: value })
  }

  const handleFinishCheckin = async () => {
    setSubmitting(true)
    setError(null)
    try {
      const data = await postJSON('/api/checkin/submit', {
        wellness: wellnessAnswers,
      }, getAccessToken())
      setFinalResult(data)
      setStep(STEPS.RESULT)
    } catch (err) {
      setError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="mx-auto max-w-xl">
      <div className="mb-10 text-center">
        <h1 className="text-4xl font-bold tracking-tight text-black dark:text-white">Daily Check-In</h1>
        <p className="mt-2 text-base text-black/50 dark:text-white/50">
          A 60-second face + voice check-in to track your trend over time.
        </p>
      </div>

      <div className="mb-8 px-2">
        <ProgressSteps steps={STEP_LIST} current={step} />
      </div>

      {error && (
        <div className="mb-5 flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-600 dark:text-red-300">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          {error}
        </div>
      )}

      <AnimatePresence mode="wait">
        {step === STEPS.CONSENT && (
          <motion.div key="consent" {...fade}>
            <Card className="p-8">
              <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-full bg-black/5 ring-1 ring-black/10 dark:bg-white/10 dark:ring-white/15">
                <ShieldCheck className="text-black dark:text-white" size={22} />
              </div>
              <h2 className="text-xl font-semibold tracking-tight text-black dark:text-white">Before we start</h2>
              <p className="mt-3 text-sm leading-relaxed text-black/50 dark:text-white/50">
                This check-in uses your camera and microphone briefly. Video is
                processed on this session only and never stored — we save only
                numeric measurements, not the video or audio itself. Your care
                team will see your trend over time, not raw recordings.
              </p>
              <label className="mt-6 flex cursor-pointer items-start gap-3 rounded-2xl border border-black/10 bg-black/[0.02] p-4 text-sm text-black/70 transition-colors hover:bg-black/[0.05] dark:border-white/10 dark:bg-white/[0.03] dark:text-white/70 dark:hover:bg-white/[0.06]">
                <input
                  type="checkbox"
                  checked={consented}
                  onChange={(e) => setConsented(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-black/20 bg-transparent text-black focus:ring-black/40 dark:border-white/20 dark:text-white dark:focus:ring-white/50"
                />
                I understand and consent to this check-in
              </label>
              <Button
                disabled={!consented}
                onClick={handleConsent}
                className="mt-6 w-full"
              >
                Start check-in
                <ChevronRight size={16} />
              </Button>
            </Card>
          </motion.div>
        )}

        {step === STEPS.FACE && (
          <motion.div key="face" {...fade}>
            <Card className="p-8">
              <div className="mb-5 flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-black/5 ring-1 ring-black/10 dark:bg-white/10 dark:ring-white/15">
                  <Camera className="text-black dark:text-white" size={18} />
                </div>
                <div>
                  <h2 className="text-xl font-semibold tracking-tight text-black dark:text-white">Face the camera</h2>
                  <p className="text-xs text-black/40 dark:text-white/40">Find a well-lit spot and look straight ahead.</p>
                </div>
              </div>

              <div className="relative overflow-hidden rounded-2xl border border-black/10 bg-black dark:border-white/10">
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  className="aspect-video w-full scale-x-[-1] object-cover"
                />
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                  <div
                    className={`h-40 w-40 rounded-full border-2 transition-colors ${
                      preview == null
                        ? 'border-white/30'
                        : preview.acceptable
                        ? 'border-emerald-400/80'
                        : 'border-amber-400/80'
                    }`}
                  />
                </div>
              </div>
              <canvas ref={canvasRef} className="hidden" />

              <p
                className={`mt-3 text-center text-xs transition-colors ${
                  preview == null
                    ? 'text-black/40 dark:text-white/40'
                    : preview.acceptable
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : 'text-amber-600 dark:text-amber-400'
                }`}
              >
                {preview?.message ?? 'Positioning yourself…'}
              </p>

              <Button
                onClick={handleCapture}
                disabled={capturing}
                className="mt-6 w-full"
              >
                {capturing ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    Capturing 3 frames…
                  </>
                ) : (
                  <>Capture</>
                )}
              </Button>
            </Card>
          </motion.div>
        )}

        {step === STEPS.VOICE && (
          <motion.div key="voice" {...fade}>
            <Card className="p-8">
              <div className="mb-5 flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-black/5 ring-1 ring-black/10 dark:bg-white/10 dark:ring-white/15">
                  <Mic className="text-black dark:text-white" size={18} />
                </div>
                <div>
                  <h2 className="text-xl font-semibold tracking-tight text-black dark:text-white">Answer the voice prompts</h2>
                  <p className="text-xs text-black/40 dark:text-white/40">Speak naturally — this measures fluency and response latency.</p>
                </div>
              </div>

              <p className="rounded-2xl border border-black/10 bg-black/[0.02] p-4 text-xs text-black/40 dark:border-white/10 dark:bg-white/[0.02] dark:text-white/40">
                Use the voice assistant bubble in the bottom-right corner to start the conversation.
              </p>

              {/* Portalled to <body> — a `position: fixed` custom element docks relative to
                  the nearest transformed ancestor, and framer-motion's animation transform
                  on this step's wrapper would otherwise trap it away from the viewport corner. */}
              {createPortal(
                // eslint-disable-next-line react/no-unknown-property
                <elevenlabs-convai agent-id={ELEVENLABS_AGENT_ID}></elevenlabs-convai>,
                document.body
              )}

              <Button
                onClick={handleVoiceDone}
                disabled={submitting}
                className="mt-6 w-full"
              >
                {submitting ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    Saving…
                  </>
                ) : (
                  "I've finished the conversation"
                )}
              </Button>
            </Card>
          </motion.div>
        )}

        {step === STEPS.WELLNESS && (
          <motion.div key="wellness" {...fade}>
            <Card className="p-8">
              <div className="mb-5 flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-black/5 ring-1 ring-black/10 dark:bg-white/10 dark:ring-white/15">
                  <ClipboardList className="text-black dark:text-white" size={18} />
                </div>
                <div>
                  <h2 className="text-xl font-semibold tracking-tight text-black dark:text-white">A few quick questions</h2>
                  <p className="text-xs text-black/40 dark:text-white/40">Sleep, mood, and how you're feeling today.</p>
                </div>
              </div>

              {wellnessPlan?.urgent ? (
                <div className="flex items-start gap-2 rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-600 dark:text-red-300">
                  <AlertTriangle size={16} className="mt-0.5 shrink-0" />
                  {wellnessPlan.summary}
                </div>
              ) : (
                <div className="space-y-3">
                  {[...(wellnessPlan?.base_questions ?? []), ...(wellnessPlan?.questions ?? [])].map((q) => (
                    <WellnessQuestion
                      key={q.id}
                      question={q}
                      value={wellnessAnswers[q.id]}
                      onChange={(value) => handleWellnessAnswer(q.id, value)}
                      onSkip={() => handleWellnessAnswer(q.id, null)}
                    />
                  ))}
                </div>
              )}

              <Button
                onClick={handleFinishCheckin}
                disabled={submitting || wellnessLoading || !wellnessPlan?.complete}
                className="mt-6 w-full"
              >
                {submitting ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    Finishing check-in…
                  </>
                ) : (
                  'Finish check-in'
                )}
              </Button>
            </Card>
          </motion.div>
        )}

        {step === STEPS.RESULT && finalResult && (
          <motion.div key="result" {...fade}>
            <Card className="p-8">
              <div className="flex flex-col items-center text-center">
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-black text-white dark:bg-white dark:text-black">
                  <CheckCircle2 size={26} />
                </div>
                <h2 className="mt-4 text-xl font-semibold tracking-tight text-black dark:text-white">Check-in complete</h2>
                <div className="mt-3">
                  <RiskBadge level={finalResult.risk.risk_level} />
                </div>
                <p className="mt-2 text-sm text-black/40 dark:text-white/40">
                  score <span className="tabular">{finalResult.risk.risk_score}</span>
                </p>

                {finalResult.risk.flags.length > 0 && (
                  <div className="mt-4 flex flex-wrap justify-center gap-2">
                    {finalResult.risk.flags.map((f) => (
                      <span
                        key={f}
                        className="rounded-full bg-black/[0.03] px-3 py-1 text-xs text-black/50 ring-1 ring-black/10 dark:bg-white/[0.04] dark:text-white/50 dark:ring-white/10"
                      >
                        {f.replaceAll('_', ' ')}
                      </span>
                    ))}
                  </div>
                )}

                {finalResult.wellness && (
                  <p className="mt-4 max-w-sm text-xs text-black/50 dark:text-white/50">
                    {finalResult.wellness.summary}
                  </p>
                )}
              </div>

              <div className="mt-8 space-y-3">
                <details className="group rounded-2xl border border-black/10 bg-black/[0.015] p-4 open:pb-4 dark:border-white/10 dark:bg-white/[0.02]">
                  <summary className="cursor-pointer list-none text-sm font-medium text-black/70 marker:content-none dark:text-white/70">
                    De-identified telemetry payload
                  </summary>
                  <pre className="tabular mt-3 overflow-x-auto text-xs text-black/40 dark:text-white/40">
                    {JSON.stringify(finalResult.telemetry_payload, null, 2)}
                  </pre>
                </details>
                <details className="group rounded-2xl border border-black/10 bg-black/[0.015] p-4 open:pb-4 dark:border-white/10 dark:bg-white/[0.02]">
                  <summary className="cursor-pointer list-none text-sm font-medium text-black/70 marker:content-none dark:text-white/70">
                    FHIR-shaped observation (demo only)
                  </summary>
                  <pre className="tabular mt-3 overflow-x-auto text-xs text-black/40 dark:text-white/40">
                    {JSON.stringify(finalResult.fhir_shaped_observation, null, 2)}
                  </pre>
                </details>
              </div>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
