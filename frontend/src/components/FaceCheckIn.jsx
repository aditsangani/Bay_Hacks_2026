import React, { useEffect, useRef, useState } from 'react'
import { Camera, Loader2 } from 'lucide-react'
import { Button, Card } from './ui.jsx'

export default function FaceCheckIn({ patientId, onComplete }) {
  const videoRef = useRef(null)
  const canvasRef = useRef(null)
  const streamRef = useRef(null)
  const [error, setError] = useState(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    let active = true
    navigator.mediaDevices.getUserMedia({ video: true })
      .then((stream) => {
        if (!active) return stream.getTracks().forEach((track) => track.stop())
        streamRef.current = stream
        videoRef.current.srcObject = stream
      })
      .catch((err) => setError(`Camera access denied or unavailable: ${err.message}`))
    return () => {
      active = false
      streamRef.current?.getTracks().forEach((track) => track.stop())
    }
  }, [])

  async function capture() {
    const video = videoRef.current
    const canvas = canvasRef.current
    if (!video?.videoWidth || !canvas) {
      setError('Camera is still starting. Please try again.')
      return
    }
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    canvas.getContext('2d').drawImage(video, 0, 0)
    const image = canvas.toDataURL('image/jpeg', 0.8)
    setSubmitting(true)
    setError(null)
    try {
      const response = await fetch('/api/checkin/face', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ patient_id: patientId, images_b64: [image, image, image] }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Face check-in failed.')
      streamRef.current?.getTracks().forEach((track) => track.stop())
      onComplete(result)
    } catch (err) {
      setError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Card className="p-8">
      <div className="mb-5 flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-black/5 ring-1 ring-black/10 dark:bg-white/10 dark:ring-white/15">
          <Camera size={18} />
        </div>
        <div>
          <h2 className="text-xl font-semibold tracking-tight text-black dark:text-white">Face the camera</h2>
          <p className="text-xs text-black/45 dark:text-white/45">Keep your face centered and well lit.</p>
        </div>
      </div>
      {error && <p role="alert" className="mb-4 text-sm text-red-600 dark:text-red-300">{error}</p>}
      <video ref={videoRef} autoPlay playsInline muted className="w-full rounded-2xl bg-black" />
      <canvas ref={canvasRef} className="hidden" />
      <Button onClick={capture} disabled={submitting} className="mt-6 w-full">
        {submitting ? <><Loader2 size={16} className="animate-spin" />Analyzing…</> : 'Capture face'}
      </Button>
    </Card>
  )
}
