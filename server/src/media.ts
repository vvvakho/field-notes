import { existsSync, mkdirSync, readdirSync, renameSync, unlinkSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export type CompressResult = {
  output_path: string;
  input_bytes: number;
  output_bytes: number;
};

/** Field-friendly encode: ~480p, 15fps, mono AAC. */
export async function compressVideo(
  inputPath: string,
  outputPath: string,
  opts?: { crf?: string; scale?: string; fps?: string },
): Promise<CompressResult> {
  const input_bytes = statSync(inputPath).size;
  const scale = opts?.scale ?? '854:-2';
  const fps = opts?.fps ?? '15';
  const crf = opts?.crf ?? '30';

  await execFileAsync(
    'ffmpeg',
    [
      '-y',
      '-i',
      inputPath,
      '-vf',
      `scale=${scale}`,
      '-r',
      fps,
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      crf,
      '-c:a',
      'aac',
      '-b:a',
      '64k',
      '-ac',
      '1',
      '-movflags',
      '+faststart',
      outputPath,
    ],
    { maxBuffer: 32 * 1024 * 1024 },
  );

  return {
    output_path: outputPath,
    input_bytes,
    output_bytes: statSync(outputPath).size,
  };
}

export async function extractSparseFrames(opts: {
  videoPath: string;
  outDir: string;
  everySeconds?: number;
  maxFrames?: number;
}): Promise<{ t: number; path: string }[]> {
  const every = opts.everySeconds ?? 10;
  const maxFrames = opts.maxFrames ?? 24;
  if (!existsSync(opts.outDir)) mkdirSync(opts.outDir, { recursive: true });

  for (const f of readdirSync(opts.outDir)) {
    if (f.endsWith('.jpg')) unlinkSync(join(opts.outDir, f));
  }

  await execFileAsync(
    'ffmpeg',
    [
      '-y',
      '-i',
      opts.videoPath,
      '-vf',
      `fps=1/${every},scale=640:-2`,
      '-q:v',
      '5',
      join(opts.outDir, 'frame_%03d.jpg'),
    ],
    { maxBuffer: 32 * 1024 * 1024 },
  );

  const files = readdirSync(opts.outDir)
    .filter((f) => f.startsWith('frame_') && f.endsWith('.jpg'))
    .sort();

  const frames: { t: number; path: string }[] = [];
  for (let i = 0; i < Math.min(files.length, maxFrames); i++) {
    const t = i * every;
    const dest = join(opts.outDir, `t${String(t).padStart(4, '0')}.jpg`);
    renameSync(join(opts.outDir, files[i]), dest);
    frames.push({ t, path: dest });
  }

  for (const f of readdirSync(opts.outDir)) {
    if (f.startsWith('frame_')) unlinkSync(join(opts.outDir, f));
  }

  return frames;
}
