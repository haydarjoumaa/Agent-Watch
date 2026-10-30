import { execFile, spawn } from 'child_process';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as https from 'https';
import * as os from 'os';
import * as path from 'path';

// Optional natural-sounding speech using Piper (https://github.com/rhasspy/piper), an offline
// neural text-to-speech engine. Downloaded once on request into the extension's storage folder.

const PIPER_RELEASE = 'https://github.com/rhasspy/piper/releases/download/2023.11.14-2';
const VOICE_BASE = 'https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/ryan/medium';
const VOICE = 'en_US-ryan-medium';

/** How a character bends the natural voice. */
export interface NaturalVoiceStyle {
  /** >1 raises the pitch (and speeds it up, which `speed` compensates for). */
  pitch: number;
  /** >1 talks faster. */
  speed: number;
  /** Metallic ring-modulation effect. */
  robot?: boolean;
}

function piperArchive(): string | undefined {
  const arch = process.arch === 'arm64' ? 'aarch64' : process.arch === 'x64' ? 'x86_64' : undefined;
  if (!arch) return undefined;
  if (process.platform === 'linux') return `piper_linux_${arch}.tar.gz`;
  if (process.platform === 'darwin') return `piper_macos_${arch === 'x86_64' ? 'x64' : 'aarch64'}.tar.gz`;
  if (process.platform === 'win32' && arch === 'x86_64') return 'piper_windows_amd64.zip';
  return undefined;
}

export function isSupported(): boolean {
  return piperArchive() !== undefined;
}

const binary = (dir: string) => path.join(dir, 'piper', process.platform === 'win32' ? 'piper.exe' : 'piper');
const model = (dir: string) => path.join(dir, `${VOICE}.onnx`);

export function isInstalled(dir: string): boolean {
  return [binary(dir), model(dir), `${model(dir)}.json`].every((f) => fs.existsSync(f));
}

/** Download a URL to a file, following redirects. `onBytes` reports progress. */
function download(url: string, dest: string, onBytes?: (received: number, total: number) => void, hops = 0): Promise<void> {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { 'User-Agent': 'agent-watch' } }, (res) => {
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400 && res.headers.location && hops < 10) {
          res.resume();
          const next = new URL(res.headers.location, url).toString();
          download(next, dest, onBytes, hops + 1).then(resolve, reject);
          return;
        }
        if (status !== 200) {
          res.resume();
          reject(new Error(`Download failed (${status}): ${url}`));
          return;
        }
        const total = Number(res.headers['content-length'] ?? 0);
        let received = 0;
        const tmp = `${dest}.part`;
        const out = fs.createWriteStream(tmp);
        res.on('data', (chunk: Buffer) => {
          received += chunk.length;
          onBytes?.(received, total);
        });
        res.pipe(out);
        out.on('finish', () => out.close(() => fs.rename(tmp, dest, (e) => (e ? reject(e) : resolve()))));
        out.on('error', reject);
        res.on('error', reject);
      })
      .on('error', reject);
  });
}

/** Download Piper and the voice into `dir`. `report` gets a short progress message. */
export async function install(dir: string, report: (message: string) => void = () => {}): Promise<void> {
  const archive = piperArchive();
  if (!archive) throw new Error('The natural voice is not available for this operating system.');
  fs.mkdirSync(dir, { recursive: true });
  const mb = (n: number) => `${Math.round(n / 1e6)} MB`;
  const progress = (what: string) => (got: number, total: number) =>
    report(total ? `${what}: ${mb(got)} of ${mb(total)}` : `${what}: ${mb(got)}`);

  if (!fs.existsSync(binary(dir))) {
    const file = path.join(dir, archive);
    await download(`${PIPER_RELEASE}/${archive}`, file, progress('Speech engine'));
    report('Unpacking…');
    // tar handles .tar.gz everywhere and .zip on Windows 10+.
    await new Promise<void>((resolve, reject) =>
      execFile('tar', ['-xf', file, '-C', dir], (err) => (err ? reject(err) : resolve())),
    );
    fs.rmSync(file, { force: true });
  }
  if (!fs.existsSync(model(dir))) await download(`${VOICE_BASE}/${VOICE}.onnx`, model(dir), progress('Voice'));
  if (!fs.existsSync(`${model(dir)}.json`)) await download(`${VOICE_BASE}/${VOICE}.onnx.json`, `${model(dir)}.json`);
  if (!isInstalled(dir)) throw new Error('The download finished but some files are missing.');
}

/** Find the PCM data of a 16-bit WAV and its sample rate. */
function readWav(buf: Buffer): { rate: number; pcm: Buffer } {
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') throw new Error('not a WAV');
  let rate = 22050;
  for (let off = 12; off + 8 <= buf.length; ) {
    const id = buf.toString('ascii', off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    if (id === 'fmt ') rate = buf.readUInt32LE(off + 12);
    if (id === 'data') return { rate, pcm: buf.subarray(off + 8, Math.min(buf.length, off + 8 + size)) };
    off += 8 + size + (size % 2);
  }
  throw new Error('no audio data');
}

/** Apply volume and the robot effect, and change the playback rate to shift the pitch. */
export function styleWav(input: Buffer, style: NaturalVoiceStyle, volume: number): Buffer {
  const { rate, pcm } = readWav(input);
  const n = Math.floor(pcm.length / 2);
  const data = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) {
    let v = pcm.readInt16LE(i * 2) / 32768;
    if (style.robot) v *= 0.6 + 0.4 * Math.sin((2 * Math.PI * 55 * i) / rate);
    data.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(v * volume * 32767))), i * 2);
  }
  const outRate = Math.round(rate * style.pitch);
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(outRate, 24);
  header.writeUInt32LE(outRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

/** Speak `text` into a WAV file (cached by content), ready to play. */
export function synthesize(dir: string, text: string, style: NaturalVoiceStyle, volume: number): Promise<string> {
  const key = crypto
    .createHash('sha1')
    .update(JSON.stringify([VOICE, text, style, Math.round(volume * 100)]))
    .digest('hex')
    .slice(0, 16);
  const cacheDir = path.join(os.tmpdir(), 'agent-watch-speech');
  const out = path.join(cacheDir, `${key}.wav`);
  if (fs.existsSync(out)) return Promise.resolve(out);
  fs.mkdirSync(cacheDir, { recursive: true });
  const raw = path.join(cacheDir, `${key}.raw.wav`);

  return new Promise((resolve, reject) => {
    // Pitch shifting by playback rate also speeds speech up, so ask Piper to talk slower to match.
    const lengthScale = (style.pitch / style.speed).toFixed(2);
    const child = spawn(binary(dir), ['--model', model(dir), '--output_file', raw, '--length_scale', lengthScale, '--quiet'], {
      cwd: path.dirname(binary(dir)),
      stdio: ['pipe', 'ignore', 'ignore'],
    });
    const timer = setTimeout(() => child.kill(), 20_000);
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      try {
        if (code !== 0) throw new Error(`piper exited with ${code}`);
        fs.writeFileSync(out, styleWav(fs.readFileSync(raw), style, volume));
        resolve(out);
      } catch (e) {
        reject(e);
      } finally {
        fs.rmSync(raw, { force: true });
      }
    });
    child.stdin.end(text);
  });
}
