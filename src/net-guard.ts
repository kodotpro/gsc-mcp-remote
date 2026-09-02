/**
 * SSRF protection for the one tool that fetches caller-supplied URLs.
 *
 * Locally this does not matter: image_page_audit fetches from the user's own
 * machine, and reaching localhost is legitimate when auditing a dev server.
 * Hosted, it matters a lot — the server shares a box with other services on
 * loopback, and a URL is an argument a model can be talked into supplying by
 * content it read elsewhere.
 *
 * Three defences, because the first one alone is not enough:
 *
 *  1. `assertPublicUrl` rejects obviously-private targets up front.
 *  2. `safeFetch` connects through a custom DNS `lookup` that re-checks every
 *     address at connect time. This is the resolution the socket actually
 *     uses, which is what closes the DNS-rebinding window a pre-flight check
 *     leaves open (resolve public -> re-resolve private between check and
 *     connect).
 *  3. `safeFetch` owns the whole request: one deadline covering headers AND
 *     body, a hard byte ceiling enforced while streaming, and manual redirect
 *     handling that re-validates every hop.
 *
 * IPv6 needs care. `new URL("http://[::ffff:127.0.0.1]/")` normalises its
 * hostname to the hex form `::ffff:7f00:1`, so a naive dotted-decimal match
 * never fires and loopback sails through. Everything below works on the
 * expanded 8-group form instead of on text.
 */
import { lookup as dnsLookup } from "node:dns";
import { isIP } from "node:net";
import * as http from "node:http";
import * as https from "node:https";

export class BlockedUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BlockedUrlError";
  }
}

/** RFC1918, loopback, link-local, CGNAT, benchmark, multicast, reserved. */
export function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = parts;

  if (a === 0) return true;                           // 0.0.0.0/8 "this network"
  if (a === 10) return true;                          // 10/8
  if (a === 127) return true;                         // loopback
  if (a === 100 && b >= 64 && b <= 127) return true;  // CGNAT 100.64/10
  if (a === 169 && b === 254) return true;            // link-local + cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true;   // 172.16/12
  if (a === 192 && b === 0) return true;              // 192.0.0/24, 192.0.2/24
  if (a === 192 && b === 168) return true;            // 192.168/16
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  if (a === 198 && b === 51) return true;             // TEST-NET-2
  if (a === 203 && b === 0) return true;              // TEST-NET-3
  if (a >= 224) return true;                          // multicast + reserved + broadcast
  return false;
}

/**
 * Expands any IPv6 textual form to eight 16-bit groups, resolving `::` and
 * any trailing dotted-quad. Returns null when the input is not parseable.
 */
export function expandIPv6(input: string): number[] | null {
  let s = input.toLowerCase().split("%")[0];
  if (s.startsWith("[") && s.endsWith("]")) s = s.slice(1, -1);

  // A trailing dotted-quad (::ffff:127.0.0.1) becomes two hex groups.
  const dotted = s.match(/^(.*:)(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (dotted) {
    const q = [dotted[2], dotted[3], dotted[4], dotted[5]].map(Number);
    if (q.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
    s = dotted[1] + (((q[0] << 8) | q[1]).toString(16)) + ":" + (((q[2] << 8) | q[3]).toString(16));
  }

  const halves = s.split("::");
  if (halves.length > 2) return null;

  const parseGroups = (part: string): number[] | null => {
    if (!part) return [];
    const out: number[] = [];
    for (const g of part.split(":")) {
      if (g === "") return null;
      if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
      out.push(parseInt(g, 16));
    }
    return out;
  };

  const head = parseGroups(halves[0]);
  const tail = halves.length === 2 ? parseGroups(halves[1]) : [];
  if (head === null || tail === null) return null;

  if (halves.length === 2) {
    const fill = 8 - head.length - tail.length;
    if (fill < 0) return null;
    return [...head, ...new Array(fill).fill(0), ...tail];
  }
  return head.length === 8 ? head : null;
}

export function isPrivateIPv6(input: string): boolean {
  const g = expandIPv6(input);
  if (!g) return true; // unparseable: refuse

  const allZeroTop = g[0] === 0 && g[1] === 0 && g[2] === 0 && g[3] === 0 && g[4] === 0;

  // ::  (unspecified) and ::1 (loopback)
  if (allZeroTop && g[5] === 0 && g[6] === 0 && (g[7] === 0 || g[7] === 1)) return true;

  // IPv4-mapped ::ffff:a.b.c.d  — the case URL normalisation hides in hex.
  // Also IPv4-compatible ::a.b.c.d (deprecated) and IPv4-translated ::ffff:0:a.b.c.d.
  const embedded = (hi: number, lo: number) =>
    `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
  if (allZeroTop && g[5] === 0xffff) return isPrivateIPv4(embedded(g[6], g[7]));
  if (allZeroTop && g[5] === 0) return isPrivateIPv4(embedded(g[6], g[7]));
  if (g[0] === 0 && g[1] === 0 && g[2] === 0 && g[3] === 0 && g[4] === 0xffff && g[5] === 0) {
    return isPrivateIPv4(embedded(g[6], g[7]));
  }

  // NAT64 well-known prefix 64:ff9b::/96 — reaches IPv4 space through a gateway.
  if (g[0] === 0x0064 && g[1] === 0xff9b && g[2] === 0 && g[3] === 0 && g[4] === 0 && g[5] === 0) {
    return isPrivateIPv4(embedded(g[6], g[7]));
  }

  if ((g[0] & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((g[0] & 0xfe00) === 0xfc00) return true; // fc00::/7  unique-local
  if ((g[0] & 0xff00) === 0xff00) return true; // ff00::/8  multicast
  if ((g[0] & 0xffff) === 0x2001 && g[1] === 0x0db8) return true; // doc prefix
  return false;
}

export function isPrivateAddress(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) return isPrivateIPv4(ip);
  if (family === 6) return isPrivateIPv6(ip);
  // Not a bare literal — try IPv6 text that isIP rejects, else refuse.
  return expandIPv6(ip) ? isPrivateIPv6(ip) : true;
}

/** Rejects a URL whose scheme is wrong or whose host is already known-private. */
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
  if (isIP(hostname) || expandIPv6(hostname)) {
    if (isPrivateAddress(hostname)) {
      throw new BlockedUrlError(
        `Refusing to fetch ${url.hostname}: private, loopback or reserved addresses are not reachable in remote mode.`
      );
    }
    return;
  }

  // Names are checked again at connect time by guardedLookup; this pass just
  // fails fast with a clearer message.
  await new Promise<void>((resolve, reject) => {
    dnsLookup(hostname, { all: true }, (err, addresses) => {
      if (err) return reject(new BlockedUrlError(`Could not resolve ${hostname}`));
      if (!addresses.length) return reject(new BlockedUrlError(`${hostname} resolved to no addresses`));
      for (const { address } of addresses) {
        if (isPrivateAddress(address)) {
          return reject(new BlockedUrlError(
            `Refusing to fetch ${hostname}: it resolves to the private address ${address}, which is not reachable in remote mode.`
          ));
        }
      }
      resolve();
    });
  });
}

/**
 * DNS lookup that refuses private results. Passed to http.request so the
 * address the socket connects to is the address that was validated — a
 * pre-flight check alone leaves a rebinding window between check and connect.
 */
function guardedLookup(
  hostname: string,
  options: unknown,
  callback: (err: NodeJS.ErrnoException | null, address?: any, family?: number) => void
): void {
  dnsLookup(hostname, { all: true }, (err, addresses) => {
    if (err) return callback(err);
    const safe = addresses.filter((a) => !isPrivateAddress(a.address));
    if (safe.length === 0) {
      const blocked = addresses.map((a) => a.address).join(", ") || "none";
      return callback(
        Object.assign(new BlockedUrlError(
          `Refusing to connect to ${hostname}: resolved only to non-public addresses (${blocked}).`
        ), { code: "EBLOCKED" })
      );
    }
    const all = (options as { all?: boolean } | undefined)?.all;
    if (all) return callback(null, safe as any);
    callback(null, safe[0].address as any, safe[0].family);
  });
}

export interface SafeFetchResult {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
  url: string;
  truncated: boolean;
}

export interface SafeFetchOptions {
  /** Total deadline covering connect, headers AND body. */
  timeoutMs: number;
  /** Hard ceiling on bytes buffered; the socket is destroyed past it. */
  maxBytes: number;
  userAgent: string;
  maxRedirects?: number;
  /** Skip the private-address checks (local stdio mode, where they are wrong). */
  allowPrivate?: boolean;
}

/**
 * One request with every limit enforced: address validation at connect time,
 * a single deadline that also covers reading the body, and a byte ceiling
 * applied while streaming rather than after the fact.
 */
export function safeFetch(rawUrl: string, opts: SafeFetchOptions): Promise<SafeFetchResult> {
  const maxRedirects = opts.maxRedirects ?? 4;

  return new Promise<SafeFetchResult>((resolve, reject) => {
    const deadline = setTimeout(() => {
      failed = true;
      current?.destroy();
      reject(new BlockedUrlError(`Timed out after ${opts.timeoutMs}ms fetching ${rawUrl}`));
    }, opts.timeoutMs);

    let current: http.ClientRequest | undefined;
    let failed = false;

    const finish = (fn: () => void) => {
      clearTimeout(deadline);
      if (!failed) fn();
    };

    const go = (target: string, hop: number): void => {
      let url: URL;
      try {
        url = new URL(target);
      } catch {
        return finish(() => reject(new BlockedUrlError(`Not a valid URL: ${target}`)));
      }
      if (url.protocol !== "http:" && url.protocol !== "https:") {
        return finish(() => reject(new BlockedUrlError(`Only http and https URLs can be fetched, got ${url.protocol}`)));
      }
      const host = url.hostname.replace(/^\[|\]$/g, "");
      if (!opts.allowPrivate && (isIP(host) || expandIPv6(host)) && isPrivateAddress(host)) {
        return finish(() => reject(new BlockedUrlError(
          `Refusing to fetch ${url.hostname}: private, loopback or reserved addresses are not reachable in remote mode.`
        )));
      }

      const mod = url.protocol === "https:" ? https : http;
      const req = mod.request(
        url,
        {
          method: "GET",
          headers: { "User-Agent": opts.userAgent, Accept: "*/*" },
          ...(opts.allowPrivate ? {} : { lookup: guardedLookup as never }),
        },
        (res) => {
          const status = res.statusCode ?? 0;
          const location = res.headers.location;

          if (status >= 300 && status < 400 && location) {
            res.resume(); // discard the redirect body
            if (hop >= maxRedirects) {
              return finish(() => reject(new BlockedUrlError(`Too many redirects starting from ${rawUrl}`)));
            }
            let next: string;
            try {
              next = new URL(location, target).toString();
            } catch {
              return finish(() => reject(new BlockedUrlError(`Invalid redirect target from ${target}`)));
            }
            return go(next, hop + 1); // every hop re-validated
          }

          const chunks: Buffer[] = [];
          let size = 0;
          let truncated = false;

          res.on("data", (chunk: Buffer) => {
            size += chunk.length;
            if (size > opts.maxBytes) {
              truncated = true;
              res.destroy();
              return;
            }
            chunks.push(chunk);
          });
          res.on("aborted", () => {
            if (truncated) {
              finish(() => resolve({ status, headers: res.headers, body: Buffer.concat(chunks), url: target, truncated: true }));
            }
          });
          res.on("close", () => {
            if (truncated) {
              finish(() => resolve({ status, headers: res.headers, body: Buffer.concat(chunks), url: target, truncated: true }));
            }
          });
          res.on("end", () => {
            finish(() => resolve({ status, headers: res.headers, body: Buffer.concat(chunks), url: target, truncated }));
          });
          res.on("error", (err) => finish(() => reject(err)));
        }
      );

      current = req;
      req.on("error", (err) => finish(() => reject(err)));
      req.end();
    };

    go(rawUrl, 0);
  });
}
