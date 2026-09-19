import React, { useRef, useState, useEffect, useCallback } from 'react'

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
 *  - ELEVENLABS_AGENT_ID below with your real agent ID from the ElevenLabs dashboard
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

export default function CheckInFlow() {
  const [step, setStep] = useState(STEPS.CONSENT)
  const [consented, setConsented] = useState(false)
  const [faceResult, setFaceResult] = useState(null)
  const [voiceStartTime, setVoiceStartTime] = useState(null)
  const [finalResult, setFinalResult] = useState(null)
  const [error, setError] = useState(null)

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
    }
  }

  // Placeholder for capturing voice metrics. In the real build, wire this
  // to ElevenLabs' post-call webhook or client-side conversation events to
  // get actual response latency / audio for jitter analysis. For the demo,
  // this button simulates "conversation finished."
  const finishVoiceStep = async () => {
    const latencyMs = voiceStartTime ? Date.now() - voiceStartTime : null

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
    }
  }

  return (
    <div style={{ maxWidth: 480, margin: '40px auto', fontFamily: 'sans-serif' }}>
      <h2>NeuroTriage-Home — Daily Check-In</h2>

      {error && <p style={{ color: 'red' }}>{error}</p>}

      {step === STEPS.CONSENT && (
        <div>
          <h3>Before we start</h3>
          <p>
            This check-in uses your camera and microphone briefly. Video is
            processed on this session only and never stored — we save only
            numeric measurements (not the video or audio itself). Your care
            team will see your trend over time, not raw recordings.
          </p>
          <label>
            <input
              type="checkbox"
              checked={consented}
              onChange={(e) => setConsented(e.target.checked)}
            />{' '}
            I understand and consent to this check-in
          </label>
          <br />
          <button disabled={!consented} onClick={handleConsent}>
            Start check-in
          </button>
        </div>
      )}

      {step === STEPS.FACE && (
        <div>
          <h3>Step 1: Face a well-lit camera</h3>
          <video ref={videoRef} autoPlay playsInline style={{ width: '100%' }} />
          <canvas ref={canvasRef} style={{ display: 'none' }} />
          <br />
          <button onClick={captureFrame}>Capture</button>
        </div>
      )}

      {step === STEPS.VOICE && (
        <div>
          <h3>Step 2: Answer the voice prompts</h3>
          {ELEVENLABS_AGENT_ID === 'REPLACE_WITH_YOUR_AGENT_ID' ? (
            <p style={{ color: 'darkorange' }}>
              Set ELEVENLABS_AGENT_ID in CheckInFlow.jsx to your real agent ID
              from the ElevenLabs dashboard to see the widget here.
            </p>
          ) : (
            // eslint-disable-next-line react/no-unknown-property
            <elevenlabs-convai agent-id={ELEVENLABS_AGENT_ID}></elevenlabs-convai>
          )}
          <br />
          <button onClick={finishVoiceStep}>I've finished the conversation</button>
        </div>
      )}

      {step === STEPS.RESULT && finalResult && (
        <div>
          <h3>Check-in complete</h3>
          <p>
            Risk level: <strong>{finalResult.risk.risk_level}</strong> (score:{' '}
            {finalResult.risk.risk_score})
          </p>
          {finalResult.risk.flags.length > 0 && (
            <p>Flags: {finalResult.risk.flags.join(', ')}</p>
          )}
          <details>
            <summary>De-identified telemetry payload (what actually gets sent)</summary>
            <pre style={{ fontSize: 12, background: '#f4f4f4', padding: 8 }}>
              {JSON.stringify(finalResult.telemetry_payload, null, 2)}
            </pre>
          </details>
          <details>
            <summary>FHIR-shaped observation (architecture demo only, not real FHIR)</summary>
            <pre style={{ fontSize: 12, background: '#f4f4f4', padding: 8 }}>
              {JSON.stringify(finalResult.fhir_shaped_observation, null, 2)}
            </pre>
          </details>
        </div>
      )}
    </div>
  )
}
