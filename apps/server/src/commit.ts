/** The commit of the code this server runs, with a `+` for changes not committed; the image's build argument in Docker. */
export function runningCommit(root: string) {
  const git = (...args: string[]) => Bun.spawnSync(['git', '-C', root, ...args], { stdout: 'pipe', stderr: 'ignore' });
  try {
    const head = git('rev-parse', '--short', 'HEAD');
    if (head.exitCode !== 0) return process.env.COMMIT || null;
    const changed = git('status', '--porcelain', '--untracked-files=no').stdout.toString().trim();
    return `${head.stdout.toString().trim()}${changed ? '+' : ''}`;
  } catch {
    // No git on this machine.
    return process.env.COMMIT || null;
  }
}
