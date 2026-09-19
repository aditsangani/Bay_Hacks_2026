import React, { useEffect, useRef, useState } from 'react'
import { AlertTriangle, Camera, CheckCircle2, HeartPulse, Loader2, RefreshCw, Wind } from 'lucide-react'
import { Button, Card } from './ui.jsx'
import { estimateVitalSigns } from '../lib/vitalSigns.js'

const PREVIEW_INTERVAL_MS = 300
const STALE_AFTER_MS = 2000
const REQUIRED_GOOD_FRAMES = 3
const VITAL_MEASUREMENT_MS = 30000
const VITAL_SAMPLE_INTERVAL_MS = 50

// MediaPipe's indexed mesh coordinates, returned by the preview endpoint.
const CONTOURS = [
  [33, 160, 158, 133, 153, 144, 33],
  [263, 387, 385, 362, 380, 373, 263],
  [70, 63, 105, 66, 107],
  [300, 293, 334, 296, 336],
  [61, 40, 37, 0, 267, 270, 291, 321, 314, 17, 84, 91, 61],
  [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109, 10],
]
const SYMMETRIC_PAIRS = [[61, 291], [105, 334], [33, 263], [78, 308]]
const MIDLINE = [10, 168, 1, 13, 14, 152]
const DOT_INDICES = [...new Set([...CONTOURS.flat(), ...SYMMETRIC_PAIRS.flat(), ...MIDLINE])]

function foreheadBounds(landmarks) {
  const face = landmarks.slice(0, 468)
  const xs = face.map((point) => point.x)
  const ys = face.map((point) => point.y)
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)
  const faceWidth = maxX - minX
  const faceHeight = maxY - minY
  return {
    x: minX + faceWidth * 0.34,
    y: minY + faceHeight * 0.06,
    width: faceWidth * 0.32,
    height: faceHeight * 0.15,
  }
}

function skinRegions(landmarks) {
  const face = landmarks.slice(0, 468)
  const xs = face.map((point) => point.x)
  const ys = face.map((point) => point.y)
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)
  const faceWidth = maxX - minX
  const faceHeight = maxY - minY
  return [
    foreheadBounds(landmarks),
    { x: minX + faceWidth * 0.18, y: minY + faceHeight * 0.48, width: faceWidth * 0.20, height: faceHeight * 0.18 },
    { x: minX + faceWidth * 0.62, y: minY + faceHeight * 0.48, width: faceWidth * 0.20, height: faceHeight * 0.18 },
  ]
}

function abortedError() {
  return new DOMException('Camera session ended', 'AbortError')
}

function waitForFrameGap(signal) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(abortedError())
    const onAbort = () => {
      clearTimeout(timer)
      reject(abortedError())
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, 160)
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

async function postFrame(session, url, body) {
  if (!session.active) throw abortedError()
  const controller = new AbortController()
  session.requests.add(controller)
  let timedOut = false
  const timeout = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, 8000)
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    const data = await response.json()
    return { response, data }
  } catch (error) {
    if (timedOut) throw new Error('The face tracker took too long to respond.')
    throw error
  } finally {
    clearTimeout(timeout)
    session.requests.delete(controller)
  }
}

function drawFrame(video, canvas) {
  if (!video || !canvas || video.readyState < 2 || !video.videoWidth || !video.videoHeight) {
    throw new Error('The camera is still loading. Wait for the live picture, then try again.')
  }
  const scale = Math.min(1, 640 / Math.max(video.videoWidth, video.videoHeight))
  canvas.width = Math.round(video.videoWidth * scale)
  canvas.height = Math.round(video.videoHeight * scale)
  const context = canvas.getContext('2d')
  if (!context) throw new Error('This browser could not read the camera frame.')
  context.drawImage(video, 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL('image/jpeg', 0.8)
}

function sampleSkinRegions(video, canvas, landmarks) {
  if (!video || video.readyState < 2 || !video.videoWidth || !video.videoHeight) {
    throw new Error('The camera picture was interrupted. Please try again.')
  }
  const regions = skinRegions(landmarks)
  const patchWidth = 24
  const patchHeight = 18
  canvas.width = patchWidth * regions.length
  canvas.height = patchHeight
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('This browser could not analyze the camera colors.')
  context.clearRect(0, 0, canvas.width, canvas.height)
  regions.forEach((region, index) => {
    const sourceX = Math.max(0, Math.round(region.x * video.videoWidth))
    const sourceY = Math.max(0, Math.round(region.y * video.videoHeight))
    const sourceWidth = Math.min(video.videoWidth - sourceX, Math.max(8, Math.round(region.width * video.videoWidth)))
    const sourceHeight = Math.min(video.videoHeight - sourceY, Math.max(8, Math.round(region.height * video.videoHeight)))
    context.drawImage(video, sourceX, sourceY, sourceWidth, sourceHeight, index * patchWidth, 0, patchWidth, patchHeight)
  })
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data
  let red = 0
  let green = 0
  let blue = 0
  let pixelCount = 0
  for (let index = 0; index < pixels.length; index += 4) {
    // Discard near-black hair/background pixels and clipped highlights.
    if (Math.min(pixels[index], pixels[index + 1], pixels[index + 2]) < 15 || Math.max(pixels[index], pixels[index + 1], pixels[index + 2]) > 245) continue
    red += pixels[index]
    green += pixels[index + 1]
    blue += pixels[index + 2]
    pixelCount += 1
  }
  if (pixelCount < pixels.length / 16) throw new Error('The tracked skin regions are poorly lit. Face a steady light and try again.')
  return { r: red / pixelCount, g: green / pixelCount, b: blue / pixelCount }
}

function collectVitalSamples(session, video, canvas, landmarks, onProgress) {
  return new Promise((resolve, reject) => {
    const samples = []
    const startedAt = performance.now()
    let lastSampleAt = -Infinity
    let lastProgressSecond = -1
    let animationFrame = null

    const finish = (callback, value) => {
      if (animationFrame !== null) cancelAnimationFrame(animationFrame)
      session.lifetime.signal.removeEventListener('abort', onAbort)
      callback(value)
    }
    const onAbort = () => finish(reject, abortedError())

    const tick = (now) => {
      if (!session.active || !session.cameraLive) return finish(reject, abortedError())
      const elapsed = now - startedAt
      if (elapsed - lastSampleAt >= VITAL_SAMPLE_INTERVAL_MS) {
        lastSampleAt = elapsed
        try {
          samples.push({ t: elapsed, ...sampleSkinRegions(video, canvas, landmarks) })
        } catch (error) {
          return finish(reject, error)
        }
      }
      const elapsedSecond = Math.floor(elapsed / 1000)
      if (elapsedSecond !== lastProgressSecond) {
        lastProgressSecond = elapsedSecond
        onProgress(Math.min(1, elapsed / VITAL_MEASUREMENT_MS))
      }
      if (elapsed >= VITAL_MEASUREMENT_MS) return finish(resolve, samples)
      animationFrame = requestAnimationFrame(tick)
    }

    if (session.lifetime.signal.aborted) return reject(abortedError())
    session.lifetime.signal.addEventListener('abort', onAbort, { once: true })
    animationFrame = requestAnimationFrame(tick)
  })
}

function usablePreview(data) {
  return data?.landmarks_detected === true && data?.quality?.acceptable === true &&
    Array.isArray(data.landmarks) && data.landmarks.length >= 468 &&
    data.landmarks.every((point) => Number.isFinite(point?.x) && Number.isFinite(point?.y))
}

function LandmarkOverlay({ landmarks, dimensions }) {
  const [width, height] = dimensions
  const point = (index) => `${landmarks[index].x * width},${landmarks[index].y * height}`
  const regions = skinRegions(landmarks)
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="pointer-events-none absolute inset-0 h-full w-full scale-x-[-1]"
      aria-hidden="true"
    >
      {CONTOURS.map((indices, index) => (
        <polyline key={index} points={indices.map(point).join(' ')} fill="none" stroke="#67e8f9" strokeOpacity="0.55" strokeWidth="1" vectorEffect="non-scaling-stroke" />
      ))}
      {SYMMETRIC_PAIRS.map(([left, right]) => (
        <polyline key={left} points={`${point(left)} ${point(right)}`} fill="none" stroke="#c4b5fd" strokeOpacity="0.65" strokeWidth="1" strokeDasharray="3 4" vectorEffect="non-scaling-stroke" />
      ))}
      <polyline points={MIDLINE.map(point).join(' ')} fill="none" stroke="#fef08a" strokeOpacity="0.8" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
      {regions.map((region, index) => (
        <rect
          key={`skin-region-${index}`}
          x={region.x * width}
          y={region.y * height}
          width={region.width * width}
          height={region.height * height}
          rx="8"
          fill="#fb7185"
          fillOpacity="0.08"
          stroke="#fb7185"
          strokeOpacity="0.75"
          strokeWidth="1.5"
          strokeDasharray="4 3"
          vectorEffect="non-scaling-stroke"
        />
      ))}
      {DOT_INDICES.map((index) => (
        <circle key={index} cx={landmarks[index].x * width} cy={landmarks[index].y * height} r={Math.max(width, height) * 0.003} fill="#a5f3fc" />
      ))}
      {SYMMETRIC_PAIRS.flat().map((index) => (
        <circle key={index} cx={landmarks[index].x * width} cy={landmarks[index].y * height} r={Math.max(width, height) * 0.005} fill="#ddd6fe" />
      ))}
    </svg>
  )
}

export default function FaceCheckIn({ patientId, onComplete }) {
  const videoRef = useRef(null)
  const canvasRef = useRef(null)
  const vitalCanvasRef = useRef(null)
  const sessionRef = useRef(null)
  const [attempt, setAttempt] = useState(0)
  const [cameraState, setCameraState] = useState('starting')
  const [dimensions, setDimensions] = useState([640, 480])
  const [landmarks, setLandmarks] = useState(null)
  const [goodFrames, setGoodFrames] = useState(0)
  const [message, setMessage] = useState('Allow camera access to begin face tracking.')
  const [error, setError] = useState(null)
  const [trackingError, setTrackingError] = useState(null)
  const [capturing, setCapturing] = useState(false)
  const [measurementProgress, setMeasurementProgress] = useState(0)
  const [vitalSigns, setVitalSigns] = useState(null)

  useEffect(() => {
    const session = {
      active: true,
      stream: null,
      cameraLive: false,
      requests: new Set(),
      lifetime: new AbortController(),
      previewTimer: null,
      previewPromise: null,
      capturing: false,
      goodFrames: 0,
      lastGoodAt: 0,
      landmarks: null,
      stopTracks: () => {},
    }
    sessionRef.current = session
    setCameraState('starting')
    setLandmarks(null)
    setGoodFrames(0)
    setCapturing(false)
    setMeasurementProgress(0)
    setVitalSigns(null)
    setError(null)
    setTrackingError(null)
    setMessage('Allow camera access to begin face tracking.')

    session.resetTracking = (guidance) => {
      session.goodFrames = 0
      session.lastGoodAt = 0
      setGoodFrames(0)
      setLandmarks(null)
      session.landmarks = null
      if (guidance) setMessage(guidance)
    }

    const preview = async () => {
      if (!session.active || !session.cameraLive || session.capturing) return
      const startedAt = Date.now()
      let nextDelay = PREVIEW_INTERVAL_MS
      try {
        const video = videoRef.current
        if (!video || video.readyState < 2 || !video.videoWidth) {
          session.resetTracking('Waiting for the camera picture…')
          return
        }
        setDimensions((previous) => previous[0] === video.videoWidth && previous[1] === video.videoHeight
          ? previous : [video.videoWidth, video.videoHeight])
        const image = drawFrame(video, canvasRef.current)
        const { response, data } = await postFrame(session, '/api/checkin/face/preview', { image_b64: image })
        if (!session.active || !session.cameraLive || session.capturing) return
        if (!response.ok) throw new Error(data.error || 'The face tracker is temporarily unavailable.')
        setTrackingError(null)
        if (Date.now() - startedAt > STALE_AFTER_MS) {
          session.resetTracking('Tracking is catching up. Keep your face still and in view.')
        } else if (!usablePreview(data)) {
          session.resetTracking(data.quality?.message || 'Keep one face in view and look straight at the camera.')
        } else {
          session.lastGoodAt = startedAt
          session.goodFrames = Math.min(REQUIRED_GOOD_FRAMES, session.goodFrames + 1)
          setGoodFrames(session.goodFrames)
          setLandmarks(data.landmarks)
          session.landmarks = data.landmarks
          setMessage(session.goodFrames >= REQUIRED_GOOD_FRAMES ? 'Face tracked. Hold a relaxed expression and capture when ready.' : 'Face found. Hold still while tracking settles…')
        }
      } catch (previewError) {
        if (!session.active || !session.cameraLive || session.capturing) return
        session.resetTracking('Reconnecting to face tracking…')
        setTrackingError('Face tracking is unavailable. Check that the backend is running. Retrying automatically.')
        nextDelay = 1500
      } finally {
        if (session.active && session.cameraLive && !session.capturing) {
          session.previewTimer = setTimeout(session.runPreview, Math.max(0, nextDelay - (Date.now() - startedAt)))
        }
      }
    }
    session.runPreview = () => {
      session.previewPromise = preview()
    }

    const staleTimer = setInterval(() => {
      if (session.active && !session.capturing && session.lastGoodAt && Date.now() - session.lastGoodAt > STALE_AFTER_MS) {
        session.resetTracking('Tracking paused. Keep your face in view while it reconnects.')
      }
    }, 250)

    async function startCamera() {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error('Camera access requires localhost or an HTTPS connection and a supported browser.')
        }
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
        })
        // A permission prompt can resolve after navigating away or restarting.
        if (!session.active) {
          stream.getTracks().forEach((track) => track.stop())
          return
        }
        session.stream = stream
        const onEnded = () => {
          if (!session.active) return
          session.cameraLive = false
          session.lifetime.abort()
          clearTimeout(session.previewTimer)
          session.requests.forEach((controller) => controller.abort())
          session.resetTracking('The camera stopped. Restart it to continue.')
          setCameraState('error')
          setError('Camera disconnected or access was revoked.')
        }
        stream.getVideoTracks().forEach((track) => track.addEventListener('ended', onEnded))
        session.stopTracks = () => {
          stream.getVideoTracks().forEach((track) => track.removeEventListener('ended', onEnded))
          stream.getTracks().forEach((track) => track.stop())
          session.stream = null
          session.cameraLive = false
          if (videoRef.current?.srcObject === stream) videoRef.current.srcObject = null
        }
        if (!videoRef.current) {
          session.stopTracks()
          return
        }
        videoRef.current.srcObject = stream
        await videoRef.current.play()
        if (!session.active) return
        session.cameraLive = true
        setCameraState('streaming')
        setMessage('Look straight ahead in good light. Keep your whole face in view.')
        session.runPreview()
      } catch (cameraError) {
        if (!session.active) return
        session.stopTracks()
        setCameraState('error')
        setError(cameraError.name === 'NotAllowedError' ? 'Camera access was denied. Allow it in your browser, then try again.' : `Camera unavailable: ${cameraError.message}`)
        setMessage('Restart the camera when you are ready.')
      }
    }
    startCamera()

    return () => {
      session.active = false
      session.lifetime.abort()
      clearTimeout(session.previewTimer)
      clearInterval(staleTimer)
      session.requests.forEach((controller) => controller.abort())
      session.stopTracks()
      if (sessionRef.current === session) sessionRef.current = null
    }
  }, [attempt])

  async function capture() {
    const session = sessionRef.current
    if (!session?.active || !session.cameraLive || session.capturing || session.goodFrames < REQUIRED_GOOD_FRAMES || Date.now() - session.lastGoodAt > STALE_AFTER_MS) return
    session.capturing = true
    clearTimeout(session.previewTimer)
    session.requests.forEach((controller) => controller.abort())
    setCapturing(true)
    setError(null)
    setTrackingError(null)
    setMeasurementProgress(0)
    setVitalSigns(null)
    setMessage('Hold still and breathe normally while the camera measures color changes…')
    try {
      // Let the preview settle before sending a capture request.
      await session.previewPromise
      if (!session.active) return
      const trackingLandmarks = session.landmarks
      if (!trackingLandmarks) throw new Error('Face tracking was interrupted. Hold still and try again.')
      const samples = await collectVitalSamples(
        session,
        videoRef.current,
        vitalCanvasRef.current,
        trackingLandmarks,
        setMeasurementProgress,
      )
      const estimates = estimateVitalSigns(samples)
      if (!session.active) return
      setVitalSigns(estimates)
      setMeasurementProgress(1)
      setMessage('Wellness estimates captured. Checking facial symmetry across three frames…')
      const frames = []
      for (let index = 0; index < 3; index += 1) {
        if (index > 0) await waitForFrameGap(session.lifetime.signal)
        if (!session.cameraLive) throw new Error('The camera stopped. Restart it to continue.')
        frames.push(drawFrame(videoRef.current, canvasRef.current))
      }
      setMessage('Checking the three-frame measurement…')
      const { response, data } = await postFrame(session, '/api/checkin/face', {
        patient_id: patientId,
        images_b64: frames,
        vital_signs: estimates,
      })
      if (!session.active) return
      if (!response.ok) throw new Error(data.quality?.message || data.error || 'The face check could not be saved. Please try again.')
      if (data.quality?.acceptable !== true || data.landmarks_detected !== true || !Number.isFinite(data.asymmetry_score)) {
        throw new Error(data.quality?.message || 'The face measurement was incomplete. Please try again.')
      }
      session.active = false
      session.stopTracks()
      onComplete(data)
    } catch (captureError) {
      if (!session.active) return
      session.resetTracking('Hold still while tracking settles, then capture again.')
      setVitalSigns(null)
      setMeasurementProgress(0)
      setError(!session.cameraLive ? 'The camera stopped. Restart it to continue.' : captureError.message || 'The face check failed. Please try again.')
    } finally {
      if (session.active) {
        session.capturing = false
        setCapturing(false)
        if (session.cameraLive) session.previewTimer = setTimeout(session.runPreview, PREVIEW_INTERVAL_MS)
      }
    }
  }

  const ready = cameraState === 'streaming' && goodFrames >= REQUIRED_GOOD_FRAMES && !capturing
  const secondsRemaining = Math.max(0, Math.ceil((1 - measurementProgress) * VITAL_MEASUREMENT_MS / 1000))
  const displayedError = error || trackingError
  return (
    <Card className="p-6 sm:p-8">
      <div className="mb-5 flex items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-black/5 ring-1 ring-black/10 dark:bg-white/10 dark:ring-white/15">
          <Camera className="text-black dark:text-white" size={18} />
        </div>
        <div>
          <h2 className="text-xl font-semibold tracking-tight text-black dark:text-white">Face the camera</h2>
          <p className="mt-1 text-xs text-black/50 dark:text-white/50">Look straight ahead, relax your face, and find good light.</p>
        </div>
      </div>

      <div className="relative overflow-hidden rounded-2xl border border-black/10 bg-black dark:border-white/10">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          aria-label="Mirrored live camera preview with tracked facial landmarks"
          className="block w-full scale-x-[-1]"
          style={{ aspectRatio: `${dimensions[0]} / ${dimensions[1]}` }}
          onLoadedMetadata={(event) => {
            const video = event.currentTarget
            if (video.videoWidth && video.videoHeight) setDimensions([video.videoWidth, video.videoHeight])
          }}
        />
        {landmarks && <LandmarkOverlay landmarks={landmarks} dimensions={dimensions} />}
        {cameraState === 'starting' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/50 px-6 text-center text-sm text-white/70">
            <Loader2 className="animate-spin" size={24} />
            Waiting for camera access…
          </div>
        )}
        <span className="absolute left-3 top-3 rounded-full bg-black/70 px-3 py-1.5 text-xs text-white/80">
          {capturing ? 'Measuring…' : landmarks ? 'Live landmarks' : 'Waiting for tracking'}
        </span>
      </div>
      <canvas ref={canvasRef} className="hidden" aria-hidden="true" />
      <canvas ref={vitalCanvasRef} className="hidden" aria-hidden="true" />

      <div role="status" aria-live="polite" className="mt-4 flex items-start gap-2 text-sm text-black/70 dark:text-white/70">
        {ready ? <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-cyan-500 dark:text-cyan-300" /> : <Camera size={16} className="mt-0.5 shrink-0 text-black/40 dark:text-white/40" />}
        <span>{message}</span>
      </div>
      <p className="mt-2 text-xs leading-relaxed text-black/45 dark:text-white/40">
        Dots track facial landmarks. The pink forehead and cheek regions are sampled locally for subtle rPPG color changes; images are not saved.
      </p>
      {capturing && (
        <div className="mt-4" role="status" aria-live="polite">
          <div className="mb-2 flex justify-between text-xs text-black/55 dark:text-white/55"><span>Camera wellness measurement</span><span>{secondsRemaining}s</span></div>
          <div className="h-2 overflow-hidden rounded-full bg-black/10 dark:bg-white/10"><div className="h-full rounded-full bg-rose-400 transition-[width] duration-300" style={{ width: `${measurementProgress * 100}%` }} /></div>
          <p className="mt-2 text-xs text-black/45 dark:text-white/45">Keep still, look at the camera, and breathe normally.</p>
        </div>
      )}
      {vitalSigns && (
        <div className="mt-4 grid grid-cols-2 gap-3">
          <div className="rounded-xl border border-black/10 bg-black/[0.02] p-3 dark:border-white/10 dark:bg-white/[0.03]"><p className="flex items-center gap-1.5 text-xs text-black/45 dark:text-white/45"><HeartPulse size={14} />Estimated pulse</p><p className="tabular mt-1 text-lg font-semibold text-black dark:text-white">{vitalSigns.heart_rate_bpm} BPM</p></div>
          <div className="rounded-xl border border-black/10 bg-black/[0.02] p-3 dark:border-white/10 dark:bg-white/[0.03]"><p className="flex items-center gap-1.5 text-xs text-black/45 dark:text-white/45"><Wind size={14} />Estimated breathing</p><p className="tabular mt-1 text-lg font-semibold text-black dark:text-white">{vitalSigns.breathing_rate_bpm} / min</p></div>
        </div>
      )}
      {displayedError && (
        <div role="alert" className="mt-4 rounded-xl border border-amber-400/20 bg-amber-400/10 p-3 text-sm text-amber-200">
          <div className="flex items-start gap-2"><AlertTriangle size={16} className="mt-0.5 shrink-0" /><span>{displayedError}</span></div>
          {!capturing && <Button type="button" variant="ghost" onClick={() => setAttempt((value) => value + 1)} className="mt-3 px-4 py-2"><RefreshCw size={14} />Restart camera & tracking</Button>}
        </div>
      )}
      <Button type="button" onClick={capture} disabled={!ready} aria-busy={capturing} className="mt-6 w-full">
        {capturing ? <><Loader2 size={16} className="animate-spin" />Measuring pulse & breathing…</> : ready ? 'Measure camera signals (30 seconds)' : `Waiting for steady tracking (${goodFrames}/${REQUIRED_GOOD_FRAMES})`}
      </Button>
      <p className="mt-3 text-center text-xs text-black/45 dark:text-white/40">Experimental wellness estimates only. Camera frames are processed briefly and are not saved.</p>
    </Card>
  )
}
