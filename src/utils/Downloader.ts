/**
 * @author Luuxis
 * Luuxis License v1.0 (voir fichier LICENSE pour les détails en FR/EN)
 */

import fs from 'fs';
import { EventEmitter } from 'events';
import { fromAnyReadable } from './Index.js';
import type { DownloadFile } from '../types.js';

export type { DownloadFile as DownloadOptions };

/**
 * Files smaller than this threshold are downloaded as a single buffer
 * instead of streaming, avoiding stream/event overhead for tiny files.
 */
const SMALL_FILE_THRESHOLD = 1 * 1024 * 1024; // 1 MB

/**
 * Minimum interval (ms) between progress event emissions.
 * Prevents flooding the event loop when downloading thousands of files.
 */
const PROGRESS_THROTTLE_MS = 50;

/**
 * A class responsible for downloading single or multiple files,
 * emitting events for progress, speed, estimated time, and errors.
 */
export default class Downloader extends EventEmitter {
	/**
	 * Downloads a single file from the given URL to the specified local path.
	 * Emits "progress" events with the number of bytes downloaded and total size.
	 *
	 * @param url - The remote URL to download from
	 * @param dirPath - Local folder path where the file is saved
	 * @param fileName - Name of the file (e.g., "mod.jar")
	 */
	public async downloadFile(url: string, dirPath: string, fileName: string): Promise<void> {
		if (!fs.existsSync(dirPath)) {
			fs.mkdirSync(dirPath, { recursive: true });
		}

		const filePath = `${dirPath}/${fileName}`;
		const writer = fs.createWriteStream(filePath);
		const response = await fetch(url);

		const contentLength = response.headers.get('content-length');
		const totalSize = contentLength ? parseInt(contentLength, 10) : 0;

		let downloaded = 0;

		return new Promise<void>((resolve, reject) => {
			const body = fromAnyReadable(response.body as ReadableStream<Uint8Array>);

			body.on('data', (chunk: Buffer) => {
				downloaded += chunk.length;
				this.emit('progress', downloaded, totalSize);
				writer.write(chunk);
			});

			body.on('end', () => {
				writer.end(() => resolve());
			});

			body.on('error', (err: Error) => {
				writer.destroy();
				try { fs.unlinkSync(filePath); } catch { /* ignore */ }
				this.emit('error', err);
				reject(err);
			});
		});
	}

	/**
	 * Downloads multiple files concurrently using a worker-pool pattern.
	 * Small files (< 1 MB) are fetched as a single buffer and written at once,
	 * avoiding per-file stream/event overhead. Large files are streamed to disk.
	 *
	 * Progress events are throttled to avoid flooding the event loop.
	 * Directories are pre-created in a single pass before downloading begins.
	 *
	 * @param files   - Array of DownloadFile describing each file
	 * @param size    - Total size (bytes) of all files to download
	 * @param limit   - Maximum number of simultaneous downloads
	 * @param timeout - Timeout in ms for each fetch request
	 */
	public async downloadFileMultiple(
		files: DownloadFile[],
		size: number,
		limit: number = 1,
		timeout: number = 10000
	): Promise<void> {
		if (files.length === 0) return;
		if (limit > files.length) limit = files.length;

		let downloaded = 0;
		let queued = 0;

		// ── Pre-create all unique directories in one pass ──────────────
		const dirs = new Set<string>();
		for (const f of files) {
			if (f.folder) dirs.add(f.folder);
		}
		for (const dir of dirs) {
			if (!fs.existsSync(dir)) {
				fs.mkdirSync(dir, { recursive: true, mode: 0o777 });
			}
		}

		// ── Speed & ETA tracking ──────────────────────────────────────
		let speedStart = Date.now();
		let speedBefore = 0;
		const speeds: number[] = [];

		const speedInterval = setInterval(() => {
			const elapsed = (Date.now() - speedStart) / 1000;
			const chunk = downloaded - speedBefore;
			if (speeds.length >= 5) speeds.shift();
			speeds.push(chunk / elapsed);

			const avg = speeds.reduce((a, b) => a + b, 0) / speeds.length;
			this.emit('speed', avg);
			this.emit('estimated', (size - downloaded) / avg);

			speedStart = Date.now();
			speedBefore = downloaded;
		}, 500);

		// ── Throttled progress emission ───────────────────────────────
		let lastEmit = 0;
		const emitProgress = (type?: string, force = false) => {
			const now = Date.now();
			if (force || now - lastEmit >= PROGRESS_THROTTLE_MS) {
				lastEmit = now;
				this.emit('progress', downloaded, size, type);
			}
		};

		// ── Worker: loops picking files from queue until exhausted ────
		const worker = async (): Promise<void> => {
			while (queued < files.length) {
				const file = files[queued++];

				const controller = new AbortController();
				const tid = setTimeout(() => controller.abort(), timeout);

				try {
					const response = await fetch(file.url!, { signal: controller.signal });
					clearTimeout(tid);

					if (!file.size || file.size < SMALL_FILE_THRESHOLD) {
						// ── Small file: single buffer write (no stream overhead) ──
						const buffer = Buffer.from(await response.arrayBuffer());
						fs.writeFileSync(file.path, buffer, { mode: 0o777 });
						downloaded += buffer.length;
						emitProgress(file.type);
					} else {
						// ── Large file: stream to disk ────────────────────────────
						await new Promise<void>((resolve, reject) => {
							const writer = fs.createWriteStream(file.path, { flags: 'w', mode: 0o777 });
							const stream = fromAnyReadable(response.body as ReadableStream<Uint8Array>);

							stream.on('data', (chunk: Buffer) => {
								downloaded += chunk.length;
								emitProgress(file.type);
								writer.write(chunk);
							});

							stream.on('end', () => writer.end(() => resolve()));

							stream.on('error', (err) => {
								writer.destroy();
								try { fs.unlinkSync(file.path); } catch { /* ignore */ }
								reject(err);
							});
						});
					}
				} catch (e) {
					clearTimeout(tid);
					try { fs.unlinkSync(file.path); } catch { /* ignore */ }
					this.emit('error', e);
				}
			}
		};

		// ── Launch worker pool & wait for all to finish ───────────────
		const workers: Promise<void>[] = [];
		for (let i = 0; i < limit; i++) {
			workers.push(worker());
		}
		await Promise.all(workers);

		clearInterval(speedInterval);
		emitProgress(undefined, true); // final progress update
	}

	/**
	 * Performs a HEAD request on the given URL to check if it is valid (status=200)
	 * and retrieves the "content-length" if available.
	 *
	 * @param url The URL to check
	 * @param timeout Time in ms before the request times out
	 * @returns An object containing { size, status } or rejects with false
	 */
	public async checkURL(
		url: string,
		timeout: number = 10000
	): Promise<{ size: number; status: number } | false> {
		const controller = new AbortController();
		const timeoutId = setTimeout(() => controller.abort(), timeout);

		try {
			const res = await fetch(url, {
				method: 'HEAD',
				signal: controller.signal
			});

			clearTimeout(timeoutId);

			if (res.status === 200) {
				const contentLength = res.headers.get('content-length');
				const size = contentLength ? parseInt(contentLength, 10) : 0;
				return { size, status: 200 };
			}
			return false;
		} catch (e: unknown) {
			clearTimeout(timeoutId);
			return false;
		}
	}



	/**
	 * Tries each mirror in turn, constructing an URL (mirror + baseURL). If a valid
	 * response is found (status=200), it returns the final URL and size. Otherwise, returns false.
	 *
	 * @param baseURL The relative path (e.g. "group/id/artifact.jar")
	 * @param mirrors An array of possible mirror base URLs
	 * @returns An object { url, size, status } if found, or false if all mirrors fail
	 */
	public async checkMirror(
		baseURL: string,
		mirrors: string[]
	): Promise<{ url: string; size: number; status: number } | false> {

		for (const mirror of mirrors) {
			const testURL = `${mirror}/${baseURL}`;
			const res = await this.checkURL(testURL);

			if (res !== false && res.status === 200) {
				return {
					url: testURL,
					size: res.size,
					status: 200
				};
			}
		}
		return false;
	}
}
