import React, { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { AlertTriangle, CheckCircle2, ChevronRight, HeartPulse, Loader2, Mic, RefreshCw, ShieldCheck, Wind } from 'lucide-react'
import { Button, Card, ProgressSteps, RiskBadge } from './components/ui.jsx'
import FaceCheckIn from './components/FaceCheckIn.jsx'
import WellnessCheckIn from './components/WellnessCheckIn.jsx'
import WellnessSummary from './components/WellnessSummary.jsx'
import { useAuth } from './context/AuthContext.jsx'

/**
 * Daily check-in flow: consent -> wellbeing questionnaire -> camera
 * (facial symmetry + rPPG pulse/breathing estimate) -> voice prompts
 * -> result. The patient is whoever is currently authenticated (see
 * AuthContext) -- every request carries their Supabase access token,
 * and the backend derives patient_id from it rather than trusting
 * the client.
 *
 * ElevenLabs widget docs: https://elevenlabs.io/docs/conversational-ai/guides/quickstart
 */

const ELEVENLABS_AGENT_ID = 'agent_1201m2wz6ap4e3yrmdy4cfbgn5pm'

const STEPS = {
  CONSENT: 'consent',
  WELLNESS: 'wellness',
  FACE: 'face',
  CAMERA_RESULT: 'camera-result',
  VOICE: 'voice',
  RESULT: 'result',
}

const STEP_LIST = [
  { key: STEPS.CONSENT, label: 'Consent' },
  { key: STEPS.WELLNESS, label: 'Wellbeing' },
  { key: STEPS.FACE, label: 'Camera' },
  { key: STEPS.CAMERA_RESULT, label: 'Review' },
  { key: STEPS.VOICE, label: 'Voice' },
  { key: STEPS.RESULT, label: 'Result' },
]

const fade = {
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -12 },
  transition: { duration: 0.25, ease: 'easeOut' },
}

async function readResponse(response) {
  const text = await response.text()
  if (!text) return {}
  try {
    return JSON.parse(text)
  } catch {
    return { error: response.ok ? 'The server returned an unreadable response.' : `The backend returned ${response.status} ${response.statusText}. Check the backend terminal for details.` }
  }
}

export default function CheckInFlow() {
  const { getAccessToken } = useAuth()
  const [step, setStep] = useState(STEPS.CONSENT)
  const [consented, setConsented] = useState(false)
  const [wellnessAnswers, setWellnessAnswers] = useState(null)
  const [cameraResult, setCameraResult] = useState(null)
  const [voiceStartTime, setVoiceStartTime] = useState(null)
  const [finalResult, setFinalResult] = useState(null)
  const [error, setError] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const mountedRef = useRef(true)
  const submitControllerRef = useRef(null)

  useEffect(() => {
    if (document.getElementById('elevenlabs-convai-script')) return
    const script = document.createElement('script')
    script.id = 'elevenlabs-convai-script'
    script.src = 'https://unpkg.com/@elevenlabs/convai-widget-embed'
    script.async = true
    document.body.appendChild(script)
  }, [])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      submitControllerRef.current?.abort()
    }
  }, [])

  function handleConsent() {
    setError(null)
    setStep(STEPS.WELLNESS)
  }

  function handleWellnessComplete(answers) {
    setWellnessAnswers(answers)
    setError(null)
    setStep(STEPS.FACE)
  }

  function handleCameraComplete(result) {
    setCameraResult(result)
    setError(null)
    setStep(STEPS.CAMERA_RESULT)
  }

  function continueToVoice() {
    setError(null)
    setVoiceStartTime(Date.now())
    setStep(STEPS.VOICE)
  }

  function retakeCameraMeasurement() {
    setCameraResult(null)
    setError(null)
    setStep(STEPS.FACE)
  }

  async function finishVoiceStep() {
    if (submitControllerRef.current) return
    const controller = new AbortController()
    submitControllerRef.current = controller
    setSubmitting(true)
    setError(null)

    try {
      const token = getAccessToken()
      const voiceResponse = await fetch('/api/checkin/voice', {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          response_latency_ms: voiceStartTime ? Date.now() - voiceStartTime : null,
          // Voice jitter remains a demo placeholder until recorded audio is analyzed.
          voice_jitter: 0.01 + Math.random() * 0.02,
        }),
      })
      const voiceData = await readResponse(voiceResponse)
      if (!voiceResponse.ok) throw new Error(voiceData.error || 'Could not save the voice step.')

      const response = await fetch('/api/checkin/submit', {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ wellness: wellnessAnswers }),
      })
      const result = await readResponse(response)
      if (!response.ok) throw new Error(result.error || 'Could not finish the check-in.')
      if (!mountedRef.current) return
      setFinalResult(result)
      setStep(STEPS.RESULT)
    } catch (requestError) {
      if (requestError.name !== 'AbortError' && mountedRef.current) {
        setError(requestError.message || 'The check-in could not be completed. Please try again.')
      }
    } finally {
      submitControllerRef.current = null
      if (mountedRef.current) setSubmitting(false)
    }
  }

  return (
    <div className="mx-auto max-w-xl">
      <header className="mb-10 text-center">
        <h1 className="text-4xl font-bold tracking-tight text-black dark:text-white">Daily Check-In</h1>
        <p className="mt-2 text-base text-black/50 dark:text-white/50">
          Share how you feel, then check facial movement, pulse, breathing, and voice.
        </p>
      </header>

      <div className="mb-8 px-2"><ProgressSteps steps={STEP_LIST} current={step} /></div>

      {error && (
        <div role="alert" className="mb-5 flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-600 dark:text-red-300">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />{error}
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
              <p className="mt-3 text-sm leading-relaxed text-black/55 dark:text-white/55">
                This check-in asks about sleep, symptoms, and mood, then briefly uses your camera and microphone.
                Camera frames are processed for facial landmarks and color changes, then discarded. The app saves
                derived measurements and your selected answers, not camera images.
              </p>
              <p className="mt-3 text-xs leading-relaxed text-black/45 dark:text-white/45">
                Camera pulse and breathing values are experimental wellness estimates, not medical measurements or a diagnosis.
              </p>
              <label className="mt-6 flex cursor-pointer items-start gap-3 rounded-2xl border border-black/10 bg-black/[0.02] p-4 text-sm text-black/70 transition-colors hover:bg-black/[0.05] dark:border-white/10 dark:bg-white/[0.03] dark:text-white/70 dark:hover:bg-white/[0.06]">
                <input type="checkbox" checked={consented} onChange={(event) => setConsented(event.target.checked)} className="mt-0.5 h-4 w-4 rounded border-black/20 bg-transparent text-black focus:ring-black/40 dark:border-white/20 dark:text-white dark:focus:ring-white/50" />
                I understand and consent to this check-in
              </label>
              <Button disabled={!consented} onClick={handleConsent} className="mt-6 w-full">Start check-in <ChevronRight size={16} /></Button>
            </Card>
          </motion.div>
        )}

        {step === STEPS.WELLNESS && (
          <motion.div key="wellness" {...fade}><WellnessCheckIn token={getAccessToken()} onComplete={handleWellnessComplete} /></motion.div>
        )}

        {step === STEPS.FACE && (
          <motion.div key="face" {...fade}><FaceCheckIn token={getAccessToken()} onComplete={handleCameraComplete} /></motion.div>
        )}

        {step === STEPS.CAMERA_RESULT && cameraResult?.vital_signs && (
          <motion.div key="camera-result" {...fade}>
            <Card className="p-8">
              <div className="flex flex-col items-center text-center">
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600 ring-1 ring-emerald-500/20 dark:text-emerald-300">
                  <CheckCircle2 size={26} />
                </div>
                <h2 className="mt-4 text-xl font-semibold tracking-tight text-black dark:text-white">Camera measurement complete</h2>
                <p className="mt-2 text-sm text-black/50 dark:text-white/50">Review your estimates for as long as you need, then continue.</p>
              </div>

              <section aria-label="Camera wellness estimates" className="mt-7 grid grid-cols-2 gap-3">
                <div className="rounded-2xl border border-rose-500/20 bg-rose-500/[0.06] p-5 text-center">
                  <HeartPulse className="mx-auto text-rose-500" size={22} />
                  <p className="mt-2 text-xs text-black/45 dark:text-white/45">Estimated pulse</p>
                  <p className="tabular mt-1 text-3xl font-semibold text-black dark:text-white">{cameraResult.vital_signs.heart_rate_bpm}</p>
                  <p className="text-xs text-black/45 dark:text-white/45">beats per minute</p>
                </div>
                <div className="rounded-2xl border border-cyan-500/20 bg-cyan-500/[0.06] p-5 text-center">
                  <Wind className="mx-auto text-cyan-500" size={22} />
                  <p className="mt-2 text-xs text-black/45 dark:text-white/45">Estimated breathing</p>
                  <p className="tabular mt-1 text-3xl font-semibold text-black dark:text-white">{cameraResult.vital_signs.breathing_rate_bpm}</p>
                  <p className="text-xs text-black/45 dark:text-white/45">breaths per minute</p>
                </div>
              </section>

              <div className="mt-4 rounded-2xl border border-black/10 bg-black/[0.02] p-4 text-sm dark:border-white/10 dark:bg-white/[0.03]">
                <div className="flex items-center justify-between gap-4">
                  <span className="text-black/50 dark:text-white/50">Facial symmetry score</span>
                  <span className="tabular font-semibold text-black dark:text-white">{cameraResult.asymmetry_score?.toFixed(3) ?? '—'}</span>
                </div>
                <p className="mt-3 text-xs leading-relaxed text-black/45 dark:text-white/45">
                  These are experimental camera estimates, not medical measurements. If either value looks implausible, retake it in bright, steady light.
                </p>
              </div>

              <Button type="button" onClick={continueToVoice} className="mt-6 w-full">Continue to voice check <ChevronRight size={16} /></Button>
              <Button type="button" variant="ghost" onClick={retakeCameraMeasurement} className="mt-3 w-full"><RefreshCw size={15} />Retake camera measurement</Button>
            </Card>
          </motion.div>
        )}

        {step === STEPS.VOICE && (
          <motion.div key="voice" {...fade}>
            <Card className="p-8">
              <div className="mb-5 flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-black/5 ring-1 ring-black/10 dark:bg-white/10 dark:ring-white/15"><Mic className="text-black dark:text-white" size={18} /></div>
                <div>
                  <h2 className="text-xl font-semibold tracking-tight text-black dark:text-white">Talk with your check-in assistant</h2>
                  <p className="text-xs text-black/45 dark:text-white/45">The conversation adapts to what you have shared and what you say next.</p>
                </div>
              </div>
              <p className="rounded-2xl border border-black/10 bg-black/[0.02] p-4 text-xs text-black/50 dark:border-white/10 dark:bg-white/[0.02] dark:text-white/50">
                Use the voice assistant bubble in the bottom-right corner. It will ask one question at a time and follow the concerns that matter to you.
              </p>
              {createPortal(
                // eslint-disable-next-line react/no-unknown-property
                <elevenlabs-convai
                  agent-id={ELEVENLABS_AGENT_ID}
                ></elevenlabs-convai>,
                document.body
              )}
              <Button onClick={finishVoiceStep} disabled={submitting} className="mt-6 w-full">
                {submitting ? <><Loader2 size={16} className="animate-spin" />Finishing check-in…</> : "I've finished the conversation"}
              </Button>
            </Card>
          </motion.div>
        )}

        {step === STEPS.RESULT && finalResult && (
          <motion.div key="result" {...fade}>
            <Card className="p-8">
              <div className="flex flex-col items-center text-center">
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-black text-white dark:bg-white dark:text-black"><CheckCircle2 size={26} /></div>
                <h2 className="mt-4 text-xl font-semibold tracking-tight text-black dark:text-white">Check-in complete</h2>
                <div className="mt-3"><RiskBadge level={finalResult.risk.risk_level} /></div>
                <p className="mt-2 text-sm text-black/45 dark:text-white/45">Signal score <span className="tabular">{finalResult.risk.risk_score}</span></p>
                <p className="mt-2 text-xs text-black/45 dark:text-white/45">Prototype trend signal, not a diagnosis.</p>
              </div>

              {cameraResult?.vital_signs && (
                <section aria-label="Camera wellness estimates" className="mt-6 grid grid-cols-2 gap-3">
                  <div className="rounded-2xl border border-black/10 bg-black/[0.02] p-4 dark:border-white/10 dark:bg-white/[0.03]">
                    <p className="text-xs text-black/45 dark:text-white/45">Estimated pulse</p>
                    <p className="tabular mt-1 text-2xl font-semibold text-black dark:text-white">{cameraResult.vital_signs.heart_rate_bpm} <span className="text-sm font-normal">BPM</span></p>
                  </div>
                  <div className="rounded-2xl border border-black/10 bg-black/[0.02] p-4 dark:border-white/10 dark:bg-white/[0.03]">
                    <p className="text-xs text-black/45 dark:text-white/45">Estimated breathing</p>
                    <p className="tabular mt-1 text-2xl font-semibold text-black dark:text-white">{cameraResult.vital_signs.breathing_rate_bpm} <span className="text-sm font-normal">/ min</span></p>
                  </div>
                </section>
              )}

              {finalResult.risk.flags.length > 0 && (
                <div className="mt-5 flex flex-wrap justify-center gap-2">
                  {finalResult.risk.flags.map((flag) => <span key={flag} className="rounded-full bg-black/[0.03] px-3 py-1 text-xs text-black/50 ring-1 ring-black/10 dark:bg-white/[0.04] dark:text-white/50 dark:ring-white/10">{flag.replaceAll('_', ' ')}</span>)}
                </div>
              )}

              {finalResult.wellness && <div className="mt-6"><WellnessSummary wellness={finalResult.wellness} /></div>}
            </Card>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
