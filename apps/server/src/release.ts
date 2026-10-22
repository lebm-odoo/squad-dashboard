/** Whether version `a` comes after `b`: x.y.z compared part by part, a pre-release before its release. */
export function newer(a: string, b: string) {
  const parse = (version: string) => {
    const [core = '', pre = ''] = version.replace(/^v/, '').split('-', 2);
    return { parts: core.split('.').map(Number), pre };
  };
  const [x, y] = [parse(a), parse(b)];
  for (let i = 0; i < 3; i++) if ((x.parts[i] ?? 0) !== (y.parts[i] ?? 0)) return (x.parts[i] ?? 0) > (y.parts[i] ?? 0);
  return !x.pre && !!y.pre;
}

export type Release = { version: string; url: string; notes: string; published_at: string | null };

/** The latest release published on GitHub, read with the token when there is one: the repository may be private. */
export async function latestRelease(repo: string, token: string | null, fetcher: typeof fetch = fetch): Promise<Release> {
  const response = await fetcher(`https://api.github.com/repos/${repo}/releases/latest`, {
    headers: {
      accept: 'application/vnd.github+json',
      'user-agent': 'squad-dashboard',
      ...(token ? { authorization: `bearer ${token}` } : {}),
    },
    signal: AbortSignal.timeout(10_000),
  });
  if (response.status === 404) throw new Error(`aucune release publiée sur ${repo}, ou dépôt privé sans jeton GitHub`);
  if (!response.ok) throw new Error(`GitHub : HTTP ${response.status}`);
  const body = (await response.json()) as { tag_name: string; html_url: string; body?: string | null; published_at?: string | null };
  return { version: body.tag_name.replace(/^v/, ''), url: body.html_url, notes: body.body ?? '', published_at: body.published_at ?? null };
}
