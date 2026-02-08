/**
 * Slash Command Resolver
 * Discovers and expands Claude Code slash commands from user + project directories.
 */

import { readFileSync, readdirSync, existsSync } from 'fs';
import { join, basename } from 'path';
import { homedir } from 'os';

const USER_COMMANDS_DIR = join(homedir(), '.claude', 'commands');

class SlashCommands {
  /**
   * Discover all available slash commands for a given project CWD.
   * Searches: ~/.claude/commands/ and <cwd>/.claude/commands/
   * @param {string} [cwd] - Project working directory
   * @returns {object[]} Array of {name, description, source}
   */
  list(cwd) {
    const commands = new Map();

    // User-level commands
    this._scanDir(USER_COMMANDS_DIR, 'user', commands);

    // Project-level commands (override user-level if same name)
    if (cwd) {
      const projectDir = join(cwd, '.claude', 'commands');
      this._scanDir(projectDir, 'project', commands);
    }

    return Array.from(commands.values());
  }

  /**
   * Resolve a slash command to its expanded prompt text.
   * @param {string} name - Command name (without /)
   * @param {string} [args] - Additional arguments after the command
   * @param {string} [cwd] - Project working directory
   * @returns {{prompt: string, description: string, source: string}|null}
   */
  resolve(name, args, cwd) {
    // Check project-level first (takes priority)
    if (cwd) {
      const projectFile = join(cwd, '.claude', 'commands', `${name}.md`);
      const result = this._readCommand(projectFile, 'project');
      if (result) return { ...result, prompt: this._buildPrompt(result.body, args) };
    }

    // Then user-level
    const userFile = join(USER_COMMANDS_DIR, `${name}.md`);
    const result = this._readCommand(userFile, 'user');
    if (result) return { ...result, prompt: this._buildPrompt(result.body, args) };

    return null;
  }

  /**
   * Check if a prompt string is a slash command.
   * @param {string} prompt
   * @returns {{name: string, args: string}|null}
   */
  parse(prompt) {
    const trimmed = prompt.trim();
    if (!trimmed.startsWith('/')) return null;

    const match = trimmed.match(/^\/([a-zA-Z0-9_-]+)(.*)$/);
    if (!match) return null;

    return { name: match[1], args: match[2].trim() };
  }

  // ─── Internal ─────────────────────────────────────────────────

  _scanDir(dir, source, map) {
    if (!existsSync(dir)) return;
    try {
      for (const file of readdirSync(dir)) {
        if (!file.endsWith('.md')) continue;
        const name = basename(file, '.md');
        const result = this._readCommand(join(dir, file), source);
        if (result) {
          map.set(name, { name, description: result.description, source });
        }
      }
    } catch {}
  }

  _readCommand(filePath, source) {
    if (!existsSync(filePath)) return null;
    try {
      const content = readFileSync(filePath, 'utf-8');
      const { frontmatter, body } = this._parseFrontmatter(content);
      return {
        description: frontmatter.description || '',
        body,
        source
      };
    } catch {
      return null;
    }
  }

  _parseFrontmatter(content) {
    // Normalize line endings
    const normalized = content.replace(/\r\n/g, '\n');
    const match = normalized.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    if (!match) return { frontmatter: {}, body: normalized };

    const frontmatter = {};
    for (const line of match[1].split('\n')) {
      // Match key: value (value can contain colons, dashes, etc.)
      const kv = line.match(/^(\w+):\s*(.+)$/);
      if (kv) frontmatter[kv[1]] = kv[2].trim();
    }
    return { frontmatter, body: match[2].trim() };
  }

  _buildPrompt(body, args) {
    // If the command body has $ARGUMENTS placeholder, substitute
    if (body.includes('$ARGUMENTS')) {
      return body.replace(/\$ARGUMENTS/g, args || '');
    }
    // Otherwise append args
    if (args) {
      return `${body}\n\n${args}`;
    }
    return body;
  }
}

export default new SlashCommands();
