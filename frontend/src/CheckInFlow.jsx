import React, { useRef, useState, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import {
  ShieldCheck,
  Camera,
  Mic,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  ChevronRight,
} from 'lucide-react'
import { Card, Button, ProgressSteps, RiskBadge } from './components/ui.jsx'

/**
 * Daily 60-second check-in flow.
 *
 * Steps:
 *  1. Consent screen (required before anything records — HIPAA-principles slide)
 *  2. Webcam capture -> POST /api/checkin/face (frame processed + discarded server-side)
 *  3. ElevenLabs Conversational AI widget -> spoken fluency prompts
 *  4. POST /api/checkin/voice with whatever latency/jitter data you capture
 *  5. POST /api/checkin/submit -> combined risk score + FHIR-shaped payload
 *
 * SWAP BEFORE DEMO:
 *  - PATIENT_ID with real/mock patient selection UI if you have time
 *
 * ElevenLabs widget docs: https://elevenlabs.io/docs/conversational-ai/guides/quickstart
 * (confirm the exact web component tag/attributes against their current docs —
 *  this is written against their standard <elevenlabs-convai> embed pattern.)
 */

const ELEVENLABS_AGENT_ID = 'agent_1201m2wz6ap4e3yrmdy4cfbgn5pm'
const PATIENT_ID = 'demo-patient-001' // swap for real patient selection if you build it

const STEPS = {
  CONSENT: 'consent',
  FACE: 'face',
  VOICE: 'voice',
  RESULT: 'result',
}

const STEP_LIST = [
  { key: STEPS.CONSENT, label: 'Consent' },
  { key: STEPS.FACE, label: 'Face' },
  { key: STEPS.VOICE, label: 'Voice' },
  { key: STEPS.RESULT, label: 'Result' },
]

const fade = {
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -12 },
  transition: { duration: 0.25, ease: 'easeOut' },
}

export default function CheckInFlow() {
  const [step, setStep] = useState(STEPS.CONSENT)
  const [consented, setConsented] = useState(false)
  const [faceResult, setFaceResult] = useState(null)
  const [voiceStartTime, setVoiceStartTime] = useState(null)
  const [finalResult, setFinalResult] = useState(null)
  const [error, setError] = useState(null)
  const [capturing, setCapturing] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const videoRef = useRef(null)
  const canvasRef = useRef(null)
  const streamRef = useRef(null)
  const mountedRef = useRef(true)

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

  const handleConsent = async () => {
    setConsented(true)
    setStep(STEPS.FACE)
    await startCamera()
  }

  const captureFrame = async () => {
    const video = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas) return
    setCapturing(true)

    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const ctx = canvas.getContext('2d')
    ctx.drawImage(video, 0, 0)
    const imageB64 = canvas.toDataURL('image/jpeg', 0.8)

    try {
      const res = await fetch('/api/checkin/face', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ patient_id: PATIENT_ID, image_b64: imageB64 }),
      })
      const data = await res.json()
      setFaceResult(data)
      stopCamera()
      setStep(STEPS.VOICE)
      setVoiceStartTime(Date.now())
    } catch (err) {
      setError('Face check-in failed: ' + err.message)
    } finally {
      setCapturing(false)
    }
  }

  // Placeholder for capturing voice metrics. In the real build, wire this
  // to ElevenLabs' post-call webhook or client-side conversation events to
  // get actual response latency / audio for jitter analysis. For the demo,
  // this button simulates "conversation finished."
  const finishVoiceStep = async () => {
    const latencyMs = voiceStartTime ? Date.now() - voiceStartTime : null
    setSubmitting(true)

    try {
      await fetch('/api/checkin/voice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          patient_id: PATIENT_ID,
          response_latency_ms: latencyMs,
          // voice_jitter is a stub here — either wire in a Parselmouth
          // analysis step server-side on the recorded audio, or be
          // upfront in the demo that this is simulated for now.
          voice_jitter: 0.01 + Math.random() * 0.02,
        }),
      })

      const res = await fetch('/api/checkin/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ patient_id: PATIENT_ID }),
      })
      const data = await res.json()
      setFinalResult(data)
      setStep(STEPS.RESULT)
    } catch (err) {
      setError('Voice check-in failed: ' + err.message)
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
                  <div className="h-40 w-40 rounded-full border-2 border-white/30" />
                </div>
              </div>
              <canvas ref={canvasRef} className="hidden" />

              <Button
                onClick={captureFrame}
                disabled={capturing}
                className="mt-6 w-full"
              >
                {capturing ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    Analyzing frame…
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
                onClick={finishVoiceStep}
                disabled={submitting}
                className="mt-6 w-full"
              >
                {submitting ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    Scoring check-in…
                  </>
                ) : (
                  "I've finished the conversation"
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
