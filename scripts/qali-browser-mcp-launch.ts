#!/usr/bin/env node
/**
 * Loads the host-owned browser env file, then starts the restricted Qali browser MCP.
 * Cursor CLI does not honor mcp.json `envFile`, so the harness points at this launcher.
 */
import { existsSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

function loadEnvFile(path: string): void {
  if (!existsSync(path)) throw new Error(`Browser MCP env file is missing: ${path}`);
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator <= 0) continue;
    const name = line.slice(0, separator);
    const value = line.slice(separator + 1);
    if (process.env[name] === undefined) process.env[name] = value;
  }
}

const envFile = process.argv[2];
const serviceScript = process.argv[3];
if (!envFile || !serviceScript) {
  throw new Error('Usage: qali-browser-mcp-launch.ts <envFile> <serviceScript>');
}
loadEnvFile(envFile);
await import(pathToFileURL(serviceScript).href);
