/**
 * claude-cli.js — a drop-in replacement for the slice of the Anthropic SDK the
 * pipeline uses, but routed through the Claude Code CLI (`claude -p`) so the
 * nightly run bills the owner's Pro/Max subscription via CLAUDE_CODE_OAUTH_TOKEN
 * instead of pay-as-you-go API credits (ANTHROPIC_API_KEY).
 *
 * It implements just enough to swap `new Anthropic({...})` → `new ClaudeCli({...})`:
 *   const r = await claude.messages.create({ model, system, messages, max_tokens });
 *   r.content[0].text     // the generated text
 *   r.usage.{input_tokens,output_tokens,cache_read_input_tokens,cache_creation_input_tokens}
 *
 * Notes / deliberate trade-offs vs the raw SDK:
 *  - Auth: we force OAuth by stripping ANTHROPIC_API_KEY from the child env so the
 *    CLI can't silently prefer the (higher-precedence) API key and bill credits.
 *  - System prompt: passed via --system-prompt (REPLACES the default agent prompt),
 *    so this behaves like a plain single-turn completion, not an agent.
 *  - Tools: disabled (--disallowed-tools) to match the original pure-completion
 *    calls — the model answers from its own knowledge, no web/file access.
 *  - Prompt caching: not available across separate CLI processes, so cache_control
 *    hints are ignored. Usage is reported, cache counts are 0.
 *  - max_tokens: the CLI has no per-call output cap flag; the model's default high
 *    output limit applies (ample for a fact sheet or a section's JSON).
 */
import { spawn } from 'node:child_process';

// Long-standing, universally-valid tool names only — the CLI hard-errors on any
// unknown name (e.g. "MultiEdit" was merged into Edit), so keep this conservative.
const TOOLS_OFF = 'Bash Edit Write Read Glob Grep WebSearch WebFetch Task';

function flattenSystem(system) {
  if (!system) return '';
  if (typeof system === 'string') return system;
  if (Array.isArray(system)) return system.map((s) => (typeof s === 'string' ? s : s.text || '')).join('\n\n');
  return String(system);
}

function flattenMessages(messages) {
  return (messages || [])
    .map((m) => {
      const c = m.content;
      if (typeof c === 'string') return c;
      if (Array.isArray(c)) return c.map((b) => (typeof b === 'string' ? b : b.text || '')).join('\n');
      return '';
    })
    .join('\n\n');
}

export class ClaudeCli {
  constructor(opts = {}) {
    this.maxRetries = opts.maxRetries ?? 3;
    this.bin = process.env.CLAUDE_CLI_BIN || 'claude';
    // Mirror the SDK surface the pipeline calls: claude.messages.create(...)
    this.messages = { create: this.create.bind(this) };
  }

  async create({ model, system, messages } = {}) {
    const sys = flattenSystem(system);
    const prompt = flattenMessages(messages);

    const args = ['-p', '--output-format', 'json', '--disallowed-tools', TOOLS_OFF];
    if (model) args.push('--model', model);
    if (sys) args.push('--system-prompt', sys);

    let lastErr;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        return await this._run(args, prompt);
      } catch (e) {
        lastErr = e;
        if (attempt < this.maxRetries) {
          await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
        }
      }
    }
    throw lastErr;
  }

  _run(args, stdinText) {
    return new Promise((resolve, reject) => {
      // Force subscription auth: never let the child see an API key.
      const env = { ...process.env };
      delete env.ANTHROPIC_API_KEY;
      delete env.ANTHROPIC_AUTH_TOKEN;

      const child = spawn(this.bin, args, { stdio: ['pipe', 'pipe', 'pipe'], env });
      let out = '';
      let err = '';
      child.stdout.on('data', (d) => (out += d));
      child.stderr.on('data', (d) => (err += d));
      child.on('error', reject);
      child.on('close', (code) => {
        if (code !== 0) {
          return reject(new Error(`claude CLI exited ${code}: ${(err || out).slice(0, 600)}`));
        }
        let parsed;
        try {
          parsed = JSON.parse(out);
        } catch {
          return reject(new Error(`claude CLI returned non-JSON output: ${out.slice(0, 600)}`));
        }
        if (parsed.is_error || parsed.type === 'error' || parsed.subtype === 'error_max_turns') {
          return reject(new Error(`claude CLI error (${parsed.subtype || parsed.type}): ${(parsed.result || parsed.error || '').toString().slice(0, 600)}`));
        }
        const text = parsed.result ?? '';
        if (!text || !String(text).trim()) {
          return reject(new Error('claude CLI returned empty result'));
        }
        const u = parsed.usage || {};
        resolve({
          content: [{ type: 'text', text: String(text) }],
          usage: {
            input_tokens: u.input_tokens ?? 0,
            output_tokens: u.output_tokens ?? 0,
            cache_read_input_tokens: u.cache_read_input_tokens ?? 0,
            cache_creation_input_tokens: u.cache_creation_input_tokens ?? 0,
          },
          _cost_usd: parsed.total_cost_usd ?? 0,
        });
      });

      child.stdin.on('error', () => {}); // ignore EPIPE if the child exits early
      child.stdin.write(stdinText);
      child.stdin.end();
    });
  }
}

export default ClaudeCli;
