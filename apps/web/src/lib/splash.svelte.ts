const seen = (() => {
  try {
    return sessionStorage.getItem('sd-splash') === '1';
  } catch {
    return false;
  }
})();

/** The opening screen, once a session: what it covers waits for it to go before playing its own entrance. */
export const splash = $state({ open: !seen });

export function splashSeen() {
  try {
    sessionStorage.setItem('sd-splash', '1');
  } catch {
    // a private window opens it again on the next load
  }
}
