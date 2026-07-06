"use strict";

const FALLBACK_API_URL = "http://127.0.0.1:6806";

function normalizeApiUrl(value) {
  return typeof value === "string" && value.trim()
    ? value.trim().replace(/\/+$/, "")
    : "";
}

function uniqueApiUrls(values) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    const normalized = normalizeApiUrl(value);
    if (normalized && !seen.has(normalized)) {
      seen.add(normalized);
      result.push(normalized);
    }
  }
  return result;
}

function isLocalHttpAddress(value) {
  return /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?($|\/)/i.test(String(value || ""));
}

function selectLocalServerAddr(serverAddrs = []) {
  const addrs = Array.isArray(serverAddrs) ? serverAddrs.map(normalizeApiUrl).filter(Boolean) : [];
  return addrs.find((addr) => /^http:\/\/127\.0\.0\.1(:\d+)?$/i.test(addr)) ||
    addrs.find((addr) => /^http:\/\/localhost(:\d+)?$/i.test(addr)) ||
    addrs.find(isLocalHttpAddress) ||
    addrs[0] ||
    "";
}

function apiUrlFromLocation(locationLike) {
  if (!locationLike || !locationLike.port) {
    return "";
  }
  const hostname = locationLike.hostname || "";
  if (!/^(127\.0\.0\.1|localhost)$/i.test(hostname)) {
    return "";
  }
  return `http://127.0.0.1:${locationLike.port}`;
}

function getBrowserApiUrlCandidates(config = {}, locationLike) {
  return uniqueApiUrls([
    apiUrlFromLocation(locationLike),
    config.siyuanApiUrl,
    FALLBACK_API_URL
  ]);
}

function readConfFromPayload(payload) {
  return payload && payload.data && payload.data.conf && typeof payload.data.conf === "object"
    ? payload.data.conf
    : null;
}

async function postJson(fetchImpl, apiUrl, path, token) {
  const response = await fetchImpl(`${normalizeApiUrl(apiUrl)}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? {Authorization: `Token ${token}`} : {})
    },
    body: "{}"
  });
  const payload = await response.json();
  if (!response.ok || payload.code !== 0) {
    throw new Error(payload && payload.msg ? payload.msg : `HTTP ${response.status}`);
  }
  return payload;
}

async function detectSiyuanConnection(options = {}) {
  const fetchImpl = options.fetch || (typeof fetch === "function" ? fetch : null);
  if (!fetchImpl) {
    throw new Error("fetch is not available");
  }

  const config = options.config || {};
  const locationLike = options.location || (typeof window !== "undefined" ? window.location : null);
  const candidates = options.candidates || getBrowserApiUrlCandidates(config, locationLike);
  const token = typeof config.siyuanToken === "string" ? config.siyuanToken.trim() : "";
  let lastError = null;

  for (const candidate of candidates) {
    try {
      const payload = await postJson(fetchImpl, candidate, "/api/system/getConf", token);
      const conf = readConfFromPayload(payload);
      if (!conf) {
        throw new Error("missing conf");
      }
      const apiUrl = selectLocalServerAddr(conf.serverAddrs) || normalizeApiUrl(candidate);
      const nextToken = conf.api && typeof conf.api.token === "string" && conf.api.token.trim()
        ? conf.api.token.trim()
        : token;
      return {
        apiUrl,
        token: nextToken,
        serverAddrs: Array.isArray(conf.serverAddrs) ? conf.serverAddrs : [],
        source: normalizeApiUrl(candidate)
      };
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error("Cannot detect SiYuan API address");
}

module.exports = {
  FALLBACK_API_URL,
  apiUrlFromLocation,
  detectSiyuanConnection,
  getBrowserApiUrlCandidates,
  normalizeApiUrl,
  selectLocalServerAddr,
  uniqueApiUrls
};
