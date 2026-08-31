/**
 * How this process is being served.
 *
 * A few tools behave differently when the server is remote rather than a local
 * stdio process on the caller's own machine: writing files would write to the
 * server's disk instead of the user's, and fetching caller-supplied URLs
 * happens from inside the server's network rather than the user's.
 *
 * Set once at startup by the HTTP entry point; stdio mode leaves it false so
 * local behaviour is byte-for-byte what upstream does.
 */
let remoteMode = false;

export function setRemoteMode(enabled: boolean): void {
  remoteMode = enabled;
}

export function isRemoteMode(): boolean {
  return remoteMode;
}
