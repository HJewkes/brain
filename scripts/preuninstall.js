import { rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

const claudeSkillsDir = join(homedir(), '.claude', 'skills', 'brain')

if (existsSync(claudeSkillsDir)) {
  try {
    rmSync(claudeSkillsDir, { recursive: true })
    console.log(`brain: removed Claude Code skill from ${claudeSkillsDir}`)
  } catch {
    // Don't fail npm uninstall if cleanup fails
  }
}
