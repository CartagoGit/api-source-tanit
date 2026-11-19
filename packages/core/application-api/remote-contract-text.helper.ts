import { lookup } from "node:dns/promises";
import { get as httpGet, type IncomingMessage } from "node:http";
import { get as httpsGet } from "node:https";
import { BlockList, isIP } from "node:net";

import { CONTRACT_PREVIEW_MAX_BYTES, CONTRACT_PREVIEW_MAX_URL_LENGTH } from "../../contracts/constants/core/application-api.constant.js";

const TIMEOUT_MS = 5000;
const MAX_REDIRECTS = 3;
const REDIRECT_STATUS = new Set([301, 302, 303, 307, 308]);

// Special-use, multicast and reserved networks are unsuitable for a public
// documentation preview. IPv6 is restricted to ordinary global unicast.
const blocked = new BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
  ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24],
  ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24],
  ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) blocked.addSubnet(address, prefix, "ipv4");
for (const [address, prefix] of [
  ["2001::", 23], ["2001:db8::", 32], ["2002::", 16], ["3fff::", 20],
] as const) blocked.addSubnet(address, prefix, "ipv6");
const globalIPv6 = new BlockList();
globalIPv6.addSubnet("2000::", 3, "ipv6");

function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return !blocked.check(address, "ipv4");
  return family === 6 && globalIPv6.check(address, "ipv6") && !blocked.check(address, "ipv6");
}

async function resolvePublicAddress(hostname: string): Promise<string> {
  const addresses = isIP(hostname) ? [{ address: hostname }] : await lookup(hostname, { all: true });
  const first = addresses[0];
  if (!first || addresses.some(({ address }) => !isPublicAddress(address))) {
    throw new Error("Documentation must resolve exclusively to public addresses");
  }
  return first.address;
}

async function connect(url: InstanceType<typeof URL>, signal: IRuntimeAbortSignal): Promise<IncomingMessage> {
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const address = await resolvePublicAddress(hostname);
  if (signal.aborted) throw new Error("Documentation request timed out");
  const secure = url.protocol === "https:";
  const get = secure ? httpsGet : httpGet;
  // Use the validated literal as the connection destination. Host and SNI
  // preserve HTTP routing and certificate verification for the declared name.
  return new Promise((resolve, reject) => {
    get({
      hostname: address,
      port: secure ? 443 : 80,
      path: url.pathname + url.search,
      headers: { host: url.host, "accept-encoding": "identity" },
      agent: false,
      signal,
      ...(secure && !isIP(hostname) ? { servername: hostname } : {}),
      rejectUnauthorized: true,
    }, resolve).once("error", reject);
  });
}

async function readBody(response: IncomingMessage): Promise<string> {
  const encoding = response.headers["content-encoding"];
  if (encoding && encoding !== "identity") throw new Error("Unsupported documentation encoding");
  if (Number(response.headers["content-length"]) > CONTRACT_PREVIEW_MAX_BYTES) {
    throw new Error("Documentation exceeds the preview size limit");
  }
  const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
  let bytes = 0;
  let text = "";
  for await (const chunk of response) {
    bytes += chunk.length;
    if (bytes > CONTRACT_PREVIEW_MAX_BYTES) throw new Error("Documentation exceeds the preview size limit");
    text += decoder.decode(chunk, { stream: true });
  }
  return text + decoder.decode();
}

async function follow(url: InstanceType<typeof URL>, signal: IRuntimeAbortSignal): Promise<string> {
  const allowedOrigin = url.origin;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const response = await connect(url, signal);
    try {
      const status = response.statusCode ?? 0;
      if (status === 200) return await readBody(response);
      const location = response.headers.location;
      if (!REDIRECT_STATUS.has(status) || typeof location !== "string" || hop === MAX_REDIRECTS) {
        throw new Error("Documentation request did not return a readable document");
      }
      const next = new URL(location, url.href);
      if (next.origin !== allowedOrigin || next.username || next.password || next.href.length > CONTRACT_PREVIEW_MAX_URL_LENGTH) {
        throw new Error("Documentation redirected outside the authorized origin");
      }
      url = next;
    } finally {
      response.destroy();
    }
  }
  throw new Error("Documentation redirect limit exceeded");
}

/** Fetches bounded text only when called by the explicit preview handler. */
export async function readRemoteContractText(address: string): Promise<string> {
  const url = new URL(address);
  if (!["http:", "https:"].includes(url.protocol) || url.port || url.username || url.password) {
    throw new Error("Documentation requires credential-free HTTP(S) on a default port");
  }
  const controller = new AbortController();
  const timeout = new Promise<never>((_, reject) => {
    controller.signal.addEventListener("abort", () => reject(new Error("Documentation request timed out")), { once: true });
  });
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await Promise.race([follow(url, controller.signal), timeout]);
  } finally {
    clearTimeout(timer);
  }
}
