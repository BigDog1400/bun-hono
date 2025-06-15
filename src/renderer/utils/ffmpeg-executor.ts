import { spawn } from 'child_process';
import type { RendererOptions } from '../core/VideoRenderer'; // Assuming RendererOptions is exported there or move it

// If RendererOptions is not easily importable, define a relevant subset here
interface FFmpegExecutorOptions {
  ffmpegPath?: string;
  enableVerboseLogging?: boolean;
  // Potentially other options like timeout, specific environment variables for ffmpeg
}

export interface FFmpegExecuteResult {
  success: boolean;
  errorLog?: string; // Captured stderr content
  details?: string;  // General error messages or stack
}

/**
 * Executes an FFmpeg command.
 * @param commandArgs Array of arguments for FFmpeg (e.g., ['-i', 'input.mp4', ... , 'output.mp4']).
 * @param options Configuration options, including path to FFmpeg.
 * @returns A promise resolving to an object indicating success or failure, with error logs if any.
 */
export async function executeFFmpegCommand(
  commandArgs: string[],
  options: FFmpegExecutorOptions
): Promise<FFmpegExecuteResult> {
  const ffmpegPath = options.ffmpegPath || 'ffmpeg';

  if (options.enableVerboseLogging) {
    console.log(`FFmpegExecutor: Executing FFmpeg command: ${ffmpegPath} ${commandArgs.join(' ')}`);
  }

  return new Promise((resolve) => {
    const ffmpegProcess = spawn(ffmpegPath, commandArgs);
    let stderrData = '';

    if (options.enableVerboseLogging && ffmpegProcess.stdout) {
      ffmpegProcess.stdout.on('data', (data) => {
        console.log(`FFmpeg stdout: ${data}`);
      });
    }

    if (ffmpegProcess.stderr) {
      ffmpegProcess.stderr.on('data', (data) => {
        stderrData += data.toString();
        if (options.enableVerboseLogging) {
          // Real-time stderr logging can be very noisy for progress indicators
          // console.error(`FFmpeg stderr: ${data}`);
        }
      });
    } else {
        // This case should ideally not happen if spawn is successful
        console.warn("FFmpegExecutor: ffmpegProcess.stderr is not available.");
    }


    ffmpegProcess.on('error', (error) => {
      if (options.enableVerboseLogging) {
        console.error(`FFmpegExecutor: Failed to start FFmpeg process. Error: ${error.message}`);
      }
      resolve({ success: false, errorLog: stderrData, details: `Failed to start FFmpeg: ${error.message}` });
    });

    ffmpegProcess.on('close', (code) => {
      if (options.enableVerboseLogging) {
        console.log(`FFmpegExecutor: FFmpeg process exited with code ${code}.`);
        if (stderrData && code !== 0) { // Log full stderr only on error if not verbosely logging it above
            console.error(`FFmpeg Full Stderr:\n${stderrData}`);
        }
      }
      if (code === 0) {
        resolve({ success: true });
      } else {
        resolve({ success: false, errorLog: stderrData, details: `FFmpeg exited with code ${code}` });
      }
    });
  });
}
