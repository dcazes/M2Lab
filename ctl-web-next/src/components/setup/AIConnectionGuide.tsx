import { ArrowRight, ExternalLink, KeyRound, Route } from 'lucide-react'
import type { Service } from '../../lib/types'
import { getServiceUrl } from '../../lib/api'

const providers = [
  { name: 'NVIDIA', note: 'Strong free serverless development APIs', href: 'https://build.nvidia.com/settings/api-key', rank: '01' },
  { name: 'Google AI Studio', note: 'Gemini models and generous developer access', href: 'https://aistudio.google.com/apikey', rank: '02' },
  { name: 'Hugging Face', note: 'Use a dedicated fine-grained token', href: 'https://huggingface.co/settings/tokens', rank: '03' },
  { name: 'Mistral', note: 'Developer platform and model API access', href: 'https://console.mistral.ai/api-keys', rank: '04' },
]

export function AIConnectionGuide({ freeLlmApi }: { freeLlmApi?: Service }) {
  return (
    <section className="card overflow-hidden mb-6">
      <div className="grid lg:grid-cols-[.75fr_1.25fr]">
        <div className="p-6 border-b lg:border-b-0 lg:border-r border-border bg-[radial-gradient(circle_at_20%_0%,rgba(97,231,200,.12),transparent_50%)]">
          <p className="eyebrow"><Route className="h-3.5 w-3.5" /> Connect AI while apps install</p>
          <h2 className="mt-3 text-xl font-semibold tracking-tight">One encrypted provider vault, one model gateway.</h2>
          <p className="mt-3 text-sm leading-6 text-unknown">Create provider keys in their official consoles, then paste them into FreeLLMAPI’s authenticated Keys page. OmniLab never handles or echoes those upstream keys.</p>
          {freeLlmApi ? (
            <a href={getServiceUrl(freeLlmApi)} target="_blank" rel="noreferrer" className="button-primary mt-5">
              Open FreeLLMAPI Keys <ArrowRight className="h-4 w-4" />
            </a>
          ) : <span className="meta-pill mt-5 text-xs text-warn">Install FreeLLMAPI to connect providers</span>}
        </div>
        <div className="grid sm:grid-cols-2 gap-px bg-border">
          {providers.map(provider => (
            <a key={provider.name} href={provider.href} target="_blank" rel="noreferrer" className="group bg-surface-1 p-5 hover:bg-surface-2 transition-fast">
              <div className="flex items-center justify-between"><span className="font-mono-tabular text-xs text-accent">{provider.rank}</span><ExternalLink className="h-3.5 w-3.5 text-unknown group-hover:text-white" /></div>
              <strong className="block mt-4 text-sm"><KeyRound className="inline h-4 w-4 mr-2 text-unknown" />{provider.name}</strong>
              <small className="block mt-2 text-xs leading-5 text-unknown">{provider.note}</small>
            </a>
          ))}
        </div>
      </div>
    </section>
  )
}
