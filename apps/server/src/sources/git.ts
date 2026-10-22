export class GitError extends Error {}

/** At most `size` tasks at a time: git processes are CPU-bound and share the machine's cores. */
export class Slots {
  private busy = 0;
  private readonly waiting: (() => void)[] = [];

  constructor(private readonly size: number) {}

  async acquire() {
    if (this.busy < this.size) this.busy++;
    else await new Promise<void>((resolve) => this.waiting.push(resolve));
    return () => {
      const next = this.waiting.shift();
      if (next) next();
      else this.busy--;
    };
  }

  async run<T>(task: () => Promise<T>) {
    const release = await this.acquire();
    try {
      return await task();
    } finally {
      release();
    }
  }
}

/** A clone, read with git itself; outputs are decoded as the V1 read them, invalid UTF-8 replaced. */
export class Git {
  constructor(
    readonly path: string,
    private readonly slots: Slots,
  ) {}

  private spawn(args: string[], input?: string, env?: Record<string, string>) {
    return Bun.spawn(['git', '-C', this.path, ...args], {
      stdin: input === undefined ? 'ignore' : new Blob([input]),
      stdout: 'pipe',
      stderr: 'pipe',
      env: env ? { ...process.env, ...env } : undefined,
    });
  }

  run(args: string[], { input, check = true, env }: { input?: string; check?: boolean; env?: Record<string, string> } = {}) {
    return this.slots.run(async () => {
      const proc = this.spawn(args, input, env);
      const [out, errors, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
      if (check && code) throw new GitError(`git ${args.slice(0, 3).join(' ')}: ${errors.trim()}`);
      return out;
    });
  }

  ok(args: string[]) {
    return this.slots.run(async () => (await this.spawn(args).exited) === 0);
  }

  exists(rev: string) {
    return this.ok(['cat-file', '-e', `${rev}^{commit}`]);
  }

  /** The output cut at each `separator` as it streams: a whole history never sits in memory at once. */
  async *records(args: string[], separator = '\x1e'): AsyncGenerator<string> {
    const release = await this.slots.acquire();
    const proc = this.spawn(args);
    try {
      const errors = new Response(proc.stderr).text();
      let rest = '';
      for await (const chunk of proc.stdout.pipeThrough(new TextDecoderStream())) {
        const parts = (rest + chunk).split(separator);
        rest = parts.pop() as string;
        yield* parts;
      }
      if (rest) yield rest;
      if (await proc.exited) throw new GitError(`git ${args.slice(0, 3).join(' ')}: ${(await errors).trim()}`);
    } finally {
      proc.kill();
      release();
    }
  }
}
