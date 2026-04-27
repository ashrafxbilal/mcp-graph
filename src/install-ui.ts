import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { doctorMcpKingdom, type DoctorReport } from './doctor.js';
import { installMcpKingdom, type InstallOptions, type InstallSummary } from './install.js';

export function shouldUseInteractiveInstall(args: string[]): boolean {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return false;
  }
  if (args.includes('--yes') || args.includes('--no-interactive') || args.includes('--dry-run')) {
    return false;
  }
  return true;
}

export async function runInteractiveInstall(options: InstallOptions): Promise<void> {
  const preview = await doctorMcpKingdom(options);
  output.write(`${renderInstallPreview(preview)}\n`);

  const rl = createInterface({ input, output });
  try {
    const answer = (await rl.question('Proceed with installation? [Y/n] ')).trim().toLowerCase();
    if (answer === 'n' || answer === 'no') {
      output.write('Installation cancelled.\n');
      return;
    }
  } finally {
    rl.close();
  }

  output.write('\nInstalling mcp-kingdom...\n');
  const result = await installMcpKingdom(options);
  output.write(`${renderInstallSummary(result)}\n`);
}

export function renderInstallPreview(report: DoctorReport): string {
  const lines = [
    renderBanner(),
    '',
    'Progressive-disclosure install preview',
    '',
    'This setup will:',
    '- discover your MCPs from local Claude/Codex/OpenCode configs',
    '- preserve them behind mcp-kingdom in ~/.mcp-kingdom',
    '- verify backend inventories and build a policy snapshot',
    '- rewrite supported clients so they load only mcp-kingdom',
  ];

  if (report.shortcutCommands.length > 0) {
    lines.push('- install global helper commands so common checks can run from any directory');
  }

  lines.push(
    '',
    `Targets: ${report.targets.length > 0 ? report.targets.join(', ') : 'none detected'}`,
    `Backend servers preserved: ${report.backendServerCount}`,
    `Policy summary: ${report.policySummary.allowListedServers} allow-listed, ${report.policySummary.passthroughServers} passthrough, ${report.policySummary.failedServers} failed`,
  );

  if (report.shortcutCommands.length > 0) {
    lines.push(
      `Helper commands: ${report.shortcutCommands.join(', ')}`,
      `Shortcut install dir: ${report.shortcutBinDir ?? '(auto)'}`,
    );
  }

  lines.push('', 'File plan:');
  for (const file of report.filePlan) {
    lines.push(`- ${file.action}: ${file.path}`);
  }

  if (report.notes.length > 0) {
    lines.push('', 'Notes:');
    for (const note of report.notes) {
      lines.push(`- ${note}`);
    }
  }

  return `${lines.join('\n')}\n`;
}

export function renderInstallSummary(summary: InstallSummary): string {
  const lines = [
    '',
    'Installation complete.',
    `Targets updated: ${summary.targets.join(', ')}`,
    `Backend servers preserved: ${summary.backendServerCount}`,
    `Policy summary: ${summary.policySummary.allowListedServers} allow-listed, ${summary.policySummary.passthroughServers} passthrough, ${summary.policySummary.failedServers} failed`,
  ];

  if (summary.shortcutCommands.length > 0) {
    lines.push(
      `Helper commands installed: ${summary.shortcutCommands.join(', ')}`,
      `Shortcut install dir: ${summary.shortcutBinDir ?? '(auto)'}`,
    );
  }

  if (summary.changedFiles.length > 0) {
    lines.push('', 'Changed files:');
    for (const file of summary.changedFiles) {
      lines.push(`- ${file}`);
    }
  }

  if (summary.backups.length > 0) {
    lines.push('', 'Backups:');
    for (const backup of summary.backups) {
      lines.push(`- ${backup}`);
    }
  }

  if (summary.notes.length > 0) {
    lines.push('', 'Notes:');
    for (const note of summary.notes) {
      lines.push(`- ${note}`);
    }
  }

  lines.push('', 'Next steps:', '- restart Claude/Codex/OpenCode if they are already running', '- run `mcp-kingdom-inspect --tool-counts` or `npm run verify` to confirm the backend inventory');

  return `${lines.join('\n')}\n`;
}

function renderBanner(): string {
  return [
    ' __  __  ____ ____        _  ___ _                 _                 ',
    '|  \\/  |/ ___|  _ \\      | |/ (_|_) ___   __ _  __| | ___  _ __ ___ ',
    '| |\\/| | |   | |_) |_____| \' /| | |/ _ \\ / _` |/ _` |/ _ \\| `_ ` _ \\',
    '| |  | | |___|  __/_____| . \\| | | (_) | (_| | (_| | (_) | | | | | |',
    '|_|  |_|\\____|_|        |_|\\_\\_|_|\\___/ \\__,_|\\__,_|\\___/|_| |_| |_|',
  ].join('\n');
}
