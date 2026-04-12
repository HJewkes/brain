import { spawn, execSync } from 'node:child_process';

const claudePath = execSync('which claude', { encoding: 'utf-8' }).trim();
console.log('claude path:', claudePath);
console.log('cwd:', process.cwd());

const proc = spawn(claudePath, ['--version'], {
  cwd: process.cwd(),
  stdio: ['pipe', 'pipe', 'pipe'],
});

proc.stdout.on('data', (d: Buffer) => console.log('stdout:', d.toString()));
proc.stderr.on('data', (d: Buffer) => console.log('stderr:', d.toString()));
proc.on('error', (err: Error) => console.log('ERROR:', err.message));
proc.on('close', (code: number | null) => console.log('exit:', code));
