/**
 * @author Luuxis
 * Luuxis License v1.0 (voir fichier LICENSE pour les détails en FR/EN)
 */

import fs from 'fs';
import path from 'path';
import { EventEmitter } from 'events';
import { getFileHash } from '../utils/Index.js';
import type { BundleItem, LaunchOptions } from '../types.js';

export type { BundleItem };

/** Number of files to hash in parallel during bundle checking */
const CHECK_CONCURRENCY = 64;

/**
 * This class manages checking, downloading, and cleaning up Minecraft files.
 */
export default class MinecraftBundle extends EventEmitter {
	private options: LaunchOptions;

	constructor(options: LaunchOptions) {
		super();
		this.options = options;
	}

	/**
	 * Checks each item in the provided bundle to see if it needs to be
	 * downloaded or updated (e.g., if hashes don't match).
	 *
	 * Phase 1 (sync, fast): resolve paths, write CFILE files, quick existence
	 * and size checks to immediately classify files as "missing" or "need hash".
	 *
	 * Phase 2 (parallel): hash files that passed the size check in batches
	 * of CHECK_CONCURRENCY to saturate disk I/O without exhausting memory.
	 *
	 * @param bundle Array of file items describing what needs to be on disk.
	 * @returns Array of BundleItem objects that require downloading.
	 */
	public async checkBundle(bundle: BundleItem[]): Promise<BundleItem[]> {
		const toDownload: BundleItem[] = [];
		const toHash: BundleItem[] = [];          // files that exist & need hash verification

		// Always normalise paths to forward slashes so that comparisons work
		// on Windows where `this.options.path` may contain backslashes while
		// `file.path` is normalised below via path.resolve().replace(/\\/g, '/').
		const basePath = this.options.path.replace(/\\/g, '/').replace(/\/+$/, '');
		let replaceName = `${basePath}/`;
		if (this.options.instance) {
			replaceName = `${basePath}/instances/${this.options.instance}/`;
		}
		// Normalise ignored entries too: users may provide them with either
		// '/' or '\' separators, with or without a leading slash.
		const ignoredSet = new Set(
			this.options.ignored.map(p => p.replace(/\\/g, '/').replace(/^\/+/, ''))
		);

		// ── Phase 1: synchronous fast-pass ─────────────────────────────
		for (const file of bundle) {
			if (!file.path) continue;

			file.path = path.resolve(this.options.path, file.path).replace(/\\/g, '/');
			file.folder = file.path.split('/').slice(0, -1).join('/');

			if (file.type === 'CFILE') {
				if (!fs.existsSync(file.folder)) {
					fs.mkdirSync(file.folder, { recursive: true, mode: 0o777 });
				}
				fs.writeFileSync(file.path, file.content ?? '', { encoding: 'utf8', mode: 0o755 });
				continue;
			}

			let stat: fs.Stats | null = null;
			try { stat = fs.statSync(file.path); } catch { /* does not exist */ }

			if (!stat) {
				toDownload.push(file);
				continue;
			}

			// Skip ignored files
			const relativePath = file.path.replace(replaceName, '');
			if (ignoredSet.has(relativePath)) continue;

			if (file.sha1) {
				// Quick size check: if size is known and doesn't match → skip hash, redownload
				if (file.size && stat.size !== file.size) {
					toDownload.push(file);
				} else {
					toHash.push(file);
				}
			}
		}

		// ── Phase 2: parallel hash verification ────────────────────────
		if (toHash.length > 0) {
			let checked = 0;
			const total = toHash.length;
			let idx = 0;

			const worker = async () => {
				while (idx < total) {
					const file = toHash[idx++];
					try {
						const localHash = await getFileHash(file.path);
						if (localHash !== file.sha1) {
							toDownload.push(file);
						}
					} catch {
						toDownload.push(file);
					}
					checked++;
					this.emit('check', checked, total, 'Checking files');
				}
			};

			const workers: Promise<void>[] = [];
			const concurrency = Math.min(CHECK_CONCURRENCY, toHash.length);
			for (let i = 0; i < concurrency; i++) {
				workers.push(worker());
			}
			await Promise.all(workers);
		}

		return toDownload;
	}

	/**
	 * Calculates the total download size of all files in the bundle.
	 *
	 * @param bundle Array of items in the bundle (with a 'size' field).
	 * @returns Sum of all file sizes in bytes.
	 */
	public async getTotalSize(bundle: BundleItem[]): Promise<number> {
		let totalSize = 0;
		for (const file of bundle) {
			if (file.size) {
				totalSize += file.size;
			}
		}
		return totalSize;
	}

	/**
	 * Removes files or directories that should not be present, i.e., those
	 * not listed in the bundle and not in the "ignored" list.
	 * If the file is a directory, it's removed recursively.
	 *
	 * @param bundle Array of BundleItems representing valid files.
	 */
	public async checkFiles(bundle: BundleItem[]): Promise<void> {
		// Normalise the base path so comparisons work consistently on Windows,
		// where `this.options.path` may contain backslashes while bundle file
		// paths have been normalised to forward slashes in checkBundle().
		const basePath = this.options.path.replace(/\\/g, '/').replace(/\/+$/, '');

		// If using instances, ensure the 'instances' directory exists
		let instancePath = '';
		if (this.options.instance) {
			if (!fs.existsSync(`${basePath}/instances`)) {
				fs.mkdirSync(`${basePath}/instances`, { recursive: true });
			}
			instancePath = `/instances/${this.options.instance}`;
		}

		// Gather all existing files in the relevant directory
		const allFiles = this.options.instance
			? this.getFiles(`${basePath}${instancePath}`)
			: this.getFiles(basePath);

		// Also gather files from "loader" and "runtime" directories to ignore
		const ignoredFiles = [
			...this.getFiles(`${basePath}/loader`),
			...this.getFiles(`${basePath}/runtime`)
		];

		// Convert custom ignored paths to actual file paths
		for (let ignoredPath of this.options.ignored) {
			// Normalise user-provided ignored entries (accept '/' or '\')
			ignoredPath = `${basePath}${instancePath}/${ignoredPath.replace(/\\/g, '/').replace(/^\/+/, '')}`;
			if (fs.existsSync(ignoredPath)) {
				if (fs.statSync(ignoredPath).isDirectory()) {
					// If it's a directory, add all files within it
					ignoredFiles.push(...this.getFiles(ignoredPath));
				} else {
					// If it's a single file, just add that file
					ignoredFiles.push(ignoredPath);
				}
			}
		}

		// Mark bundle paths as ignored (so we don't delete them)
		bundle.forEach(file => {
			ignoredFiles.push(file.path);
		});

		// Use a Set with normalised separators for O(1), separator-agnostic lookup
		const ignoredSet = new Set(ignoredFiles.map(p => p.replace(/\\/g, '/')));

		// Filter out all ignored files from the main file list
		const filesToDelete = allFiles.filter(file => !ignoredSet.has(file.replace(/\\/g, '/')));

		// Remove each file or directory
		for (const filePath of filesToDelete) {
			try {
				const stats = fs.statSync(filePath);
				if (stats.isDirectory()) {
					fs.rmSync(filePath, { recursive: true });
				} else {
					fs.unlinkSync(filePath);

					// Clean up empty folders going upward until we hit the main path
					let currentDir = path.dirname(filePath);
					while (true) {
						const normalisedCurrent = currentDir.replace(/\\/g, '/').replace(/\/+$/, '');
						if (normalisedCurrent === basePath) break;
						const dirContents = fs.readdirSync(currentDir);
						if (dirContents.length === 0) {
							fs.rmSync(currentDir);
						}
						const parent = path.dirname(currentDir);
						if (parent === currentDir) break; // safety: hit filesystem root
						currentDir = parent;
					}
				}
			} catch {
				// If an error occurs (e.g. file locked or non-existent), skip it
				continue;
			}
		}
	}

	/**
	 * Recursively gathers all files in a given directory path.
	 * If a directory is empty, it is also added to the returned array.
	 *
	 * @param dirPath The starting directory path to walk.
	 * @param collectedFiles Used internally to store file paths.
	 * @returns The array of all file paths (and empty directories) under dirPath.
	 */
	private getFiles(dirPath: string, collectedFiles: string[] = []): string[] {
		if (fs.existsSync(dirPath)) {
			const entries = fs.readdirSync(dirPath);
			// If the directory is empty, store it as a "file" so it can be processed
			if (entries.length === 0) {
				collectedFiles.push(dirPath);
			}
			// Explore each child entry
			for (const entry of entries) {
				const fullPath = `${dirPath}/${entry}`;
				const stats = fs.statSync(fullPath);
				if (stats.isDirectory()) {
					this.getFiles(fullPath, collectedFiles);
				} else {
					collectedFiles.push(fullPath);
				}
			}
		}
		return collectedFiles;
	}
}
