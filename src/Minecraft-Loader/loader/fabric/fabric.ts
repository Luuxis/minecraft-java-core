/**
 * @author Luuxis
 * Luuxis License v1.0 (voir fichier LICENSE pour les détails en FR/EN)
 */

import { EventEmitter } from 'events';
import fs from 'fs';
import path from 'path';

import { getPathLibraries } from '../../../utils/Index.js';
import Downloader from '../../../utils/Downloader.js';
import type { FabricLoaderData, FabricJSON } from '../../../types.js';

interface FabricOptions {
	path: string;
	downloadFileMultiple?: number;
	loader: {
		version: string;
		build: string;
	};
}

interface FabricLibrary {
	name: string;
	url: string;
	rules?: Array<Record<string, unknown>>;
}

/**
 * This class handles downloading Fabric loader JSON metadata,
 * resolving the correct build, and downloading the required libraries.
 */
export default class FabricMC extends EventEmitter {
	private readonly options: FabricOptions;

	constructor(options: FabricOptions) {
		super();
		this.options = options;
	}

	/**
	 * Fetches the Fabric loader metadata to find the correct build for the given
	 * Minecraft version. If the specified build is "latest" or "recommended",
	 * it uses the first (most recent) entry. Otherwise, it looks up a specific build.
	 * 
	 * @param Loader A LoaderObject describing metadata and json URL templates.
	 * @returns A JSON object representing the Fabric loader profile, or an error object.
	 */
	public async downloadJson(Loader: FabricLoaderData): Promise<FabricJSON | { error: string }> {
		let buildInfo: { version: string; stable: boolean } | undefined;

		let response = await fetch(Loader.metaData);
		let metaData: { game: Array<{ version: string; stable: boolean }>; loader: Array<{ version: string; stable: boolean }> } = await response.json();

		// Check if the Minecraft version is supported
		const version = metaData.game.find(v => v.version === this.options.loader.version);
		if (!version) {
			return { error: `FabricMC doesn't support Minecraft ${this.options.loader.version}` };
		}

		// Determine the loader build
		const availableBuilds = metaData.loader.map(b => b.version);
		if (this.options.loader.build === 'latest' || this.options.loader.build === 'recommended') {
			buildInfo = metaData.loader[0]; // The first entry is presumably the latest
		} else {
			buildInfo = metaData.loader.find(l => l.version === this.options.loader.build);
		}

		if (!buildInfo) {
			return {
				error: `Fabric Loader ${this.options.loader.build} not found, Available builds: ${availableBuilds.join(', ')}`
			};
		}

		// Build the URL for the Fabric JSON using placeholders
		const url = Loader.json
			.replace('${build}', buildInfo.version)
			.replace('${version}', this.options.loader.version);

		// Fetch the Fabric loader JSON
		try {
			const result = await fetch(url);
			const fabricJson: FabricJSON = await result.json();
			return fabricJson;
		} catch (err: unknown) {
			return { error: err instanceof Error ? err.message : 'An error occurred while fetching Fabric JSON' };
		}
	}

	/**
	 * Downloads any missing libraries defined in the Fabric JSON manifest,
	 * skipping those that already exist locally (or that have rules preventing download).
	 * 
	 * @param fabricJson The Fabric JSON object with a `libraries` array.
	 * @returns The same `libraries` array after downloading as needed.
	 */
	public async downloadLibraries(fabricJson: FabricJSON): Promise<FabricLibrary[]> {
		const { libraries } = fabricJson;
		const downloader = new Downloader();
		const downloadQueue: Array<{
			url: string;
			folder: string;
			path: string;
			name: string;
			size: number;
		}> = [];

		let checkedLibraries = 0;
		let totalSize = 0;

		// Identify which libraries need downloading
		for (const lib of libraries) {
			// Skip if there are any rules that prevent downloading
			if (lib.rules) {
				this.emit('check', checkedLibraries++, libraries.length, 'libraries');
				continue;
			}

			// Parse out the library path
			const libInfo = getPathLibraries(lib.name);
			const libFolderPath = path.resolve(this.options.path, 'libraries', libInfo.path);
			const libFilePath = path.resolve(libFolderPath, libInfo.name);

			// If the file doesn't exist locally, we prepare a download item
			if (!fs.existsSync(libFilePath)) {
				const libUrl = `${lib.url}${libInfo.path}/${libInfo.name}`;

				let sizeFile = 0;
				// Check if the file is accessible and retrieve its size
				const res = await downloader.checkURL(libUrl);
				if (res && typeof res === 'object' && 'status' in res && res.status === 200) {
					sizeFile = res.size;
					totalSize += res.size;
				}

				downloadQueue.push({
					url: libUrl,
					folder: libFolderPath,
					path: libFilePath,
					name: libInfo.name,
					size: sizeFile
				});
			}

			// Emit a "check" event for progress tracking
			this.emit('check', checkedLibraries++, libraries.length, 'libraries');
		}

		// If there are files to download, do so now
		if (downloadQueue.length > 0) {
			downloader.on('progress', (downloaded: number, total: number) => {
				this.emit('progress', downloaded, total, 'libraries');
			});

			await downloader.downloadFileMultiple(downloadQueue, totalSize, this.options.downloadFileMultiple);
		}

		return libraries;
	}
}
