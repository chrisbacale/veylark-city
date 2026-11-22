import { readFile, writeFile } from 'node:fs/promises';

const input = process.argv[2];
if (!input) throw new Error('Provide the JSON file returned by OpenClaw.');

const response = JSON.parse(await readFile(input, 'utf8'));
const result = response.result ?? response;
const agent = result.meta?.agentMeta;
if (agent?.provider !== 'cerebras' || agent?.model !== 'moonshotai-kimi-k3.1-pro-trial') {
  throw new Error('The response must identify Kimi K3.1 Pro Trial on Cerebras.');
}

const payload = result.payloads?.find(part => part.text?.trim());
if (!payload) throw new Error('OpenClaw returned an empty response.');
const raw = payload.text.trim().replace(/^```(?:json)?\s*([\s\S]+?)\s*```$/i, '$1');
const { title, briefing, timeLimit, altitudeOffsets } = JSON.parse(raw);
const sized = (text, min, max) => typeof text === 'string' && text.trim().length >= min && text.trim().length <= max;
const intIn = (value, min, max) => Number.isInteger(value) && value >= min && value <= max;
if (!sized(title, 8, 36) || !sized(briefing, 25, 120) || !intIn(timeLimit, 90, 160) ||
    !Array.isArray(altitudeOffsets) || altitudeOffsets.length !== 5 ||
    !altitudeOffsets.every(value => intIn(value, -4, 6)) || new Set(altitudeOffsets).size < 3) {
  throw new Error('The mission includes values outside the allowed range.');
}

const dispatch = { title: title.trim(), briefing: briefing.trim(), timeLimit, altitudeOffsets };
const output = new URL('../juego/mision.js', import.meta.url);
await writeFile(output, `globalThis.ViceCityDispatch = ${JSON.stringify(dispatch, null, 2)};\n`, 'utf8');
console.log(JSON.stringify({ ...dispatch, provider: agent.provider, model: agent.model, durationMs: result.meta.durationMs }));
