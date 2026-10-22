export function unreadable(path: string, error: unknown) {
  const code = (error as NodeJS.ErrnoException).code;
  if (code === 'ENOENT') return `${path} introuvable`;
  if (code === 'EACCES') return `${path} illisible : permission refusée (sous SELinux, monter le fichier avec l’option z)`;
  return `${path} illisible : ${code ?? String(error)}`;
}
