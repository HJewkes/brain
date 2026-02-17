export interface CorpusNote {
  id: string
  filename: string
  frontmatter: {
    title: string
    type: string
    tier: string
    tags?: string[]
    confidence?: string
    status?: string
    related?: string[]
    supersedes?: string
    'review-interval'?: string
    created?: string
    expires?: string
  }
  body: string
}

export interface CorpusQuery {
  id: string
  text: string
  type: 'factual' | 'semantic' | 'multi-hop'
  relevantNoteIds: string[]
}

export interface EvalCorpus {
  notes: CorpusNote[]
  queries: CorpusQuery[]
  offTopicQueries: string[]
}
