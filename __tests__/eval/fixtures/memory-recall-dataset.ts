export interface RecallFixture {
  id: string;
  category: 'temporal' | 'preference' | 'relationship' | 'quantitative' | 'conditional';
  sourceText: string;
  expectedFacts: string[];
  recallQueries: string[];
}

export const memoryRecallDataset: RecallFixture[] = [
  {
    id: 'temporal-project-start',
    category: 'temporal',
    sourceText: [
      'The Brain project kicked off in March 2024 after months of planning.',
      'The initial prototype was built in two weeks using TypeScript and SQLite.',
      'By June 2024 the team had shipped the first public release with hybrid search.',
    ].join(' '),
    expectedFacts: ['March 2024', 'two weeks', 'June 2024'],
    recallQueries: ['When did the Brain project start?', 'Brain project timeline'],
  },
  {
    id: 'temporal-migration-date',
    category: 'temporal',
    sourceText: [
      'On September 15th 2025 the database was migrated from PostgreSQL to SQLite.',
      'The migration took approximately four hours and required zero downtime.',
      'All 1.2 million rows were transferred without data loss.',
    ].join(' '),
    expectedFacts: ['September 15th 2025', 'four hours', '1.2 million rows'],
    recallQueries: ['When was the database migration?', 'PostgreSQL to SQLite migration'],
  },
  {
    id: 'preference-language',
    category: 'preference',
    sourceText: [
      'After evaluating several options the team chose TypeScript over JavaScript for the codebase.',
      'The primary reasons were stronger type safety and better IDE support.',
      'Python was also considered but rejected due to packaging complexity.',
    ].join(' '),
    expectedFacts: ['TypeScript over JavaScript', 'type safety', 'Python was rejected'],
    recallQueries: [
      'What programming language does the team prefer?',
      'Why was TypeScript chosen?',
    ],
  },
  {
    id: 'preference-editor',
    category: 'preference',
    sourceText: [
      'For day-to-day development the team standardized on VS Code with the ESLint extension.',
      'Vim keybindings are used by most developers on the team.',
      'JetBrains WebStorm is the approved alternative for those who prefer it.',
    ].join(' '),
    expectedFacts: ['VS Code', 'Vim keybindings', 'WebStorm'],
    recallQueries: ['What editor does the team use?', 'development environment setup'],
  },
  {
    id: 'relationship-team-structure',
    category: 'relationship',
    sourceText: [
      'Alice manages the infrastructure team which handles deployments and monitoring.',
      'Bob leads the search quality squad and reports directly to Alice.',
      'Carol joined as the new ML engineer focusing on embedding models.',
    ].join(' '),
    expectedFacts: [
      'Alice manages the infrastructure',
      'Bob leads the search quality',
      'Carol joined as the new ML engineer',
    ],
    recallQueries: [
      'Alice infrastructure team deployments',
      'Bob search quality squad reports to Alice',
    ],
  },
  {
    id: 'relationship-mentorship',
    category: 'relationship',
    sourceText: [
      'David mentors three junior engineers: Emily, Frank, and Grace.',
      'Emily specializes in frontend components while Frank focuses on backend APIs.',
      "Grace is working on the CLI tooling under David's guidance.",
    ].join(' '),
    expectedFacts: ['David mentors', 'Emily frontend', 'Frank backend', 'Grace CLI'],
    recallQueries: ['Who does David mentor?', 'junior engineers and their specializations'],
  },
  {
    id: 'quantitative-performance',
    category: 'quantitative',
    sourceText: [
      'The search system handles 10,000 requests per second at peak load.',
      'Average query latency is 45 milliseconds with a p99 of 120 milliseconds.',
      'The index contains approximately 500,000 document chunks across 12,000 notes.',
    ].join(' '),
    expectedFacts: ['10,000 requests per second', '45 milliseconds', '500,000 chunks'],
    recallQueries: [
      'How many requests can the search system handle?',
      'search system performance metrics',
    ],
  },
  {
    id: 'quantitative-storage',
    category: 'quantitative',
    sourceText: [
      'The SQLite database file is currently 2.3 gigabytes on disk.',
      'Vector embeddings account for 68 percent of the total storage.',
      'The FTS5 index adds roughly 340 megabytes of overhead.',
    ].join(' '),
    expectedFacts: ['2.3 gigabytes', '68 percent', '340 megabytes'],
    recallQueries: ['How large is the database?', 'storage breakdown'],
  },
  {
    id: 'conditional-deployment',
    category: 'conditional',
    sourceText: [
      'Use Ollama for local development since it runs without network access.',
      'For production deployments switch to the remote embedder service on port 8443.',
      'If GPU memory is limited fall back to the CPU-only quantized model.',
    ].join(' '),
    expectedFacts: ['Ollama for local', 'remote embedder for production', 'CPU-only quantized'],
    recallQueries: [
      'Which embedder should I use for local development?',
      'deployment configuration for embeddings',
    ],
  },
  {
    id: 'conditional-branching',
    category: 'conditional',
    sourceText: [
      'Feature branches must be prefixed with feat/ for new features and fix/ for bug fixes.',
      'Hotfix branches bypass the normal review process and merge directly to main.',
      'Release branches require approval from at least two senior engineers.',
    ].join(' '),
    expectedFacts: ['feat/ prefix', 'hotfix bypass review', 'two senior engineers'],
    recallQueries: [
      'What is the branch naming convention?',
      'git branching strategy and review process',
    ],
  },
];
