import { mkdirSync, copyFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const skillSource = join(__dirname, '..', 'skill', 'SKILL.md')
const claudeDir = join(homedir(), '.claude')
const claudeSkillsDir = join(claudeDir, 'skills', 'brain')

// Skip silently if ~/.claude doesn't exist (user doesn't use Claude Code)
if (!existsSync(claudeDir)) {
  process.exit(0)
}

try {
  mkdirSync(claudeSkillsDir, { recursive: true })
  copyFileSync(skillSource, join(claudeSkillsDir, 'SKILL.md'))
  console.log(`brain: installed Claude Code skill to ${claudeSkillsDir}`)
} catch {
  // Don't fail npm install if skill copy fails
}
