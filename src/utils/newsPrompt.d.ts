export interface NewsPromptVolumeContext {
  volume?: number | null
  avgVolume?: number | null
  ratio?: number | null
  close?: number | null
  changePct?: string | number | null
}

export interface NewsPromptArticle {
  title: string
  url: string
  source?: string
}

export function buildNewsPrompt(params?: {
  ticker?: string
  date?: string
  volumeContext?: NewsPromptVolumeContext | null
  articles?: NewsPromptArticle[]
}): string
