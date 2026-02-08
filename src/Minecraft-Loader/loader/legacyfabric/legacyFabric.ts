/**
 * @author Luuxis
 * Luuxis License v1.0 (voir fichier LICENSE pour les détails en FR/EN)
 */

import fs from 'fs';
import path from 'path';
import { EventEmitter } from 'events';

import { getPathLibraries } from '../../../utils/Index.js';
import Downloader from '../../../utils/Downloader.js';
import type { FabricLoaderData, FabricJSON } from '../../../types.js';

interface FabricOptions {
	path: string;
	loader: {
		version: string;
		build: string;
	};
	downloadFileMultiple?: number;
}

interface FabricLibrary {
	name: string;
	url: string;
	rules?: Array<Record<string, unknown>>;
}

/**
 * A class that handles downloading the Fabric loader JSON metadata
 * and the libraries needed to launch Fabric.
 */
export default class FabricMC extends EventEmitter {
	private readonly options: FabricOptions;

	constructor(options: FabricOptions = { path: '', loader: { version: '', build: '' } }) {
		super();
		this.options = options;
	}

	/**
	 * Fetches metadata from the Fabric API to identify the correct build for the given version.
	 * If the build is "latest" or "recommended", it picks the first entry from the loader array.
	 * Otherwise, it tries to match the specific build requested by the user.
	 *
	 * @param Loader A LoaderObject with metaData and json URLs for Fabric.
	 * @returns      A FabricJSON object on success, or an error object.
	 */
	public async downloadJson(Loader: FabricLoaderData): Promise<FabricJSON | { error: string }> {
		let selectedBuild: { version: string } | undefined;

		const metaResponse = await fetch(Loader.metaData);
		const metaData: { game: Array<{ version: string }>; loader: Array<{ version: string }> } = await metaResponse.json();

		const versionExists = metaData.game.find((ver) => ver.version === this.options.loader.version);
		if (!versionExists) {
			return { error: `FabricMC doesn't support Minecraft ${this.options.loader.version}` };
		}

		// Extract all possible loader builds
		const availableBuilds = metaData.loader.map((b) => b.version);

		if (this.options.loader.build === 'latest' || this.options.loader.build === 'recommended') {
			selectedBuild = metaData.loader[0];
		} else {
			selectedBuild = metaData.loader.find((loaderBuild) => loaderBuild.version === this.options.loader.build);
		}

		if (!selectedBuild) {
			return {
				error: `Fabric Loader ${this.options.loader.build} not found, Available builds: ${availableBuilds.join(', ')}`
			};
		}

		// Construct the final URL for fetching the Fabric JSON
		const url = Loader.json
			.replace('${build}', selectedBuild.version)
			.replace('${version}', this.options.loader.version);

		// Fetch and parse the JSON
		try {
			const response = await fetch(url);
			const fabricJson: FabricJSON = await response.json();
			return fabricJson;
		} catch (err: unknown) {
			return { error: err instanceof Error ? err.message : 'Failed to fetch or parse Fabric loader JSON' };
		}
	}

	/**
	 * Iterates over the libraries in the Fabric JSON, checks if they exist locally,
	 * and if not, downloads them. Skips libraries that have "rules" (usually platform-specific).
	 *
	 * @param json The Fabric loader JSON object with a "libraries" array.
	 * @returns    The same libraries array after downloads, or an error object if something fails.
	 */
	public async downloadLibraries(json: FabricJSON): Promise<FabricLibrary[]> {
		const { libraries } = json;
		const downloader = new Downloader();
		let pendingDownloads: Array<{
			url: string;
			folder: string;
			path: string;
			name: string;
			size: number;
		}> = [];

		let checkedCount = 0;
		let totalSize = 0;

		// Evaluate each library for possible download
		for (const lib of libraries) {
			// Skip if library has rules that might disqualify it for this platform
			if (lib.rules) {
				this.emit('check', checkedCount++, libraries.length, 'libraries');
				continue;
			}

			// Build the local file path
			const libInfo = getPathLibraries(lib.name);
			const libFolder = path.resolve(this.options.path, 'libraries', libInfo.path);
			const libFilePath = path.resolve(libFolder, libInfo.name);

			// If it doesn't exist, prepare to download
			if (!fs.existsSync(libFilePath)) {
				const libUrl = `${lib.url}${libInfo.path}/${libInfo.name}`;

				let fileSize = 0;
				// Check if the file is available and get its size
				const checkRes = await downloader.checkURL(libUrl);
				if (checkRes && typeof checkRes === 'object' && 'status' in checkRes && checkRes.status === 200) {
					fileSize = checkRes.size;
					totalSize += fileSize;
				}

				pendingDownloads.push({
					url: libUrl,
					folder: libFolder,
					path: libFilePath,
					name: libInfo.name,
					size: fileSize
				});
			}

			this.emit('check', checkedCount++, libraries.length, 'libraries');
		}

		// Download all missing libraries in bulk
		if (pendingDownloads.length > 0) {
			downloader.on('progress', (downloaded: number, total: number) => {
				this.emit('progress', downloaded, total, 'libraries');
			});

			await downloader.downloadFileMultiple(pendingDownloads, totalSize, this.options.downloadFileMultiple);
		}

		return libraries;
	}
}
