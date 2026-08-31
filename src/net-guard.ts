/**
 * SSRF guard for the one tool that fetches caller-supplied URLs.
 *
 * Locally this does not matter: image_page_audit fetches from the user's own
 * machine, and reaching localhost is a legitimate thing to want when auditing a
 * dev server. Hosted, it matters a lot — the server sits on a box that also
 * runs other services on loopback (an automation tool, two databases), and a
 * URL is an argument a model can be talked into supplying by content it read
 * elsewhere. So in remote mode every target is resolved and rejected unless it
 * lands on a public address.
 *
 * Known remaining gap: redirects are followed by fetch() after this check, so a
 * public URL that 302s to a private one is not covered here. image_page_audit
 * passes redirect: "manual" for that reason.
 */
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export class BlockedUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BlockedUrlError";
  }
}

/** RFC1918, loopback, link-local, CGNAT, and friends. */
function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return true;
  const [a, b] = parts;

  if (a === 10) return true;                          // 10.0.0.0/8
  if (a === 127) return true;                         // loopback
  if (a === 0) return true;                           // "this network"
  if (a === 172 && b >= 16 && b <= 31) return true;   // 172.16.0.0/12
  if (a === 192 && b === 168) return true;            // 192.168.0.0/16
  if (a === 169 && b === 254) return true;            // link-local + cloud metadata
  if (a === 100 && b >= 64 && b <= 127) return true;  // CGNAT 100.64.0.0/10
  if (a === 192 && b === 0) return true;              // 192.0.0.0/24, 192.0.2.0/24
  if (a >= 224) return true;                          // multicast + reserved
  return false;
}

function isPrivateIPv6(ip: string): boolean {
  const addr = ip.toLowerCase().split("%")[0];
  if (addr === "::" || addr === "::1") return true;             // unspecified, loopback
  if (addr.startsWith("fe8") || addr.startsWith("fe9")) return true;
  if (addr.startsWith("fea") || addr.startsWith("feb")) return true; // link-local
  if (addr.startsWith("fc") || addr.startsWith("fd")) return true;   // unique-local
  if (addr.startsWith("ff")) return true;                       // multicast
  // IPv4-mapped (::ffff:127.0.0.1) — judge the embedded v4 address.
  const mapped = addr.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateIPv4(mapped[1]);
  return false;
}

function isPrivateAddress(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) return isPrivateIPv4(ip);
  if (family === 6) return isPrivateIPv6(ip);
  return true; // unparseable: refuse
}

/**
 * Throws BlockedUrlError unless the URL is http(s) and every address its
 * hostname resolves to is public.
 */
export async function assertPublicUrl(rawUrl: string): Promise<void> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new BlockedUrlError(`Not a valid URL: ${rawUrl}`);
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new BlockedUrlError(`Only http and https URLs can be fetched, got ${url.protocol}`);
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, "");

  // A literal IP needs no DNS round-trip.
  if (isIP(hostname)) {
    if (isPrivateAddress(hostname)) {
      throw new BlockedUrlError(
        `Refusing to fetch ${url.hostname}: private, loopback or reserved addresses are not reachable in remote mode.`
      );
    }
    return;
  }

  let addresses: Array<{ address: string }>;
  try {
    addresses = await lookup(hostname, { all: true });
  } catch {
    throw new BlockedUrlError(`Could not resolve ${hostname}`);
  }

  if (addresses.length === 0) {
    throw new BlockedUrlError(`${hostname} resolved to no addresses`);
  }

  // Every resolved address must be public — one private answer is enough to
  // make the host untrustworthy (DNS can return a mix).
  for (const { address } of addresses) {
    if (isPrivateAddress(address)) {
      throw new BlockedUrlError(
        `Refusing to fetch ${hostname}: it resolves to the private address ${address}, ` +
        `which is not reachable in remote mode.`
      );
    }
  }
}
