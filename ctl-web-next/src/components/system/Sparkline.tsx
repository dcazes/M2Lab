import { useRef, useEffect, useState } from 'react'

interface SparklineProps {
  label: string
  color: string
  dataKey: 'cpu' | 'mem' | 'disk'
}

const MAX_POINTS = 60

export function Sparkline({ label, color, dataKey }: SparklineProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [data, setData] = useState<number[]>([])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const resize = () => {
      const rect = canvas.getBoundingClientRect()
      canvas.width = rect.width * window.devicePixelRatio
      canvas.height = rect.height * window.devicePixelRatio
      ctx.scale(window.devicePixelRatio, window.devicePixelRatio)
    }

    resize()
    window.addEventListener('resize', resize)

    const draw = () => {
      const rect = canvas.getBoundingClientRect()
      const width = rect.width
      const height = rect.height

      ctx.clearRect(0, 0, width, height)

      if (data.length < 2) return

      ctx.beginPath()
      ctx.strokeStyle = color
      ctx.lineWidth = 2
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'

      const stepX = width / (MAX_POINTS - 1)

      data.forEach((value: number, i: number) => {
        const x = i * stepX
        const y = height - (value / 100) * height
        if (i === 0) {
          ctx.moveTo(x, y)
        } else {
          ctx.lineTo(x, y)
        }
      })

      ctx.stroke()

      // Draw latest value dot
      const latest = data[data.length - 1]
      const latestX = (data.length - 1) * stepX
      const latestY = height - (latest / 100) * height

      ctx.beginPath()
      ctx.fillStyle = color
      ctx.arc(latestX, latestY, 4, 0, Math.PI * 2)
      ctx.fill()
    }

    const interval = setInterval(draw, 1000)
    draw()

    return () => {
      clearInterval(interval)
      window.removeEventListener('resize', resize)
    }
  }, [color, data])

  // Listen for data updates from parent
  useEffect(() => {
    const handler = (event: CustomEvent) => {
      if (event.detail.key === dataKey) {
        setData((prev: number[]) => {
          const next = [...prev, event.detail.value]
          if (next.length > MAX_POINTS) next.shift()
          return next
        })
      }
    }

    window.addEventListener('sparkline-update', handler as EventListener)
    return () => window.removeEventListener('sparkline-update', handler as EventListener)
  }, [dataKey])

  return (
    <div className="space-y-2">
      <canvas ref={canvasRef} className="w-full h-32" aria-label={`${label} sparkline`} />
      <p className="text-xs text-unknown">{label}</p>
    </div>
  )
}