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

interface QuiltOptions {
	path: string;
	loader: {
		version: string;
		build: string;
	};
	downloadFileMultiple?: number;
}

interface QuiltLibrary {
	name: string;
	url: string;
	rules?: Array<unknown>;
}

interface QuiltJSON {
	libraries: QuiltLibrary[];
	[key: string]: unknown;
}

/**
 * This class handles fetching the Quilt loader metadata,
 * identifying the appropriate build for a given Minecraft version,
 * and downloading required libraries.
 */
export default class Quilt extends EventEmitter {
	private readonly options: QuiltOptions;
	private versionMinecraft: string | undefined;

	constructor(options: QuiltOptions = { path: '', loader: { version: '', build: '' } }) {
		super();
		this.options = options;
	}

	/**
	 * Fetches the Quilt loader metadata to identify the correct build for the specified
	 * Minecraft version. If "latest" or "recommended" is requested, picks the most
	 * recent or stable build accordingly.
	 *
	 * @param Loader An object describing where to fetch Quilt metadata and JSON.
	 * @returns      A QuiltJSON object on success, or an error object if something fails.
	 */
	public async downloadJson(Loader: FabricLoaderData): Promise<QuiltJSON | { error: string }> {
		let selectedBuild: { version: string } | undefined;

		const metaResponse = await fetch(Loader.metaData);
		const metaData: { game: Array<{ version: string }>; loader: Array<{ version: string }> } = await metaResponse.json();

		const mcVersionExists = metaData.game.find((ver) => ver.version === this.options.loader.version);
		if (!mcVersionExists) {
			return { error: `QuiltMC doesn't support Minecraft ${this.options.loader.version}` };
		}

		// Gather all available builds for this version
		const availableBuilds = metaData.loader.map((b) => b.version);

		if (this.options.loader.build === 'latest') {
			selectedBuild = metaData.loader[0];
		} else if (this.options.loader.build === 'recommended') {
			selectedBuild = metaData.loader.find((b) => !b.version.includes('beta'));
		} else {
			selectedBuild = metaData.loader.find(
				(loaderItem) => loaderItem.version === this.options.loader.build
			);
		}

		if (!selectedBuild) {
			return {
				error: `QuiltMC Loader ${this.options.loader.build} not found, Available builds: ${availableBuilds.join(', ')}`
			};
		}

		// Build the URL for the Quilt loader profile JSON
		const url = Loader.json
			.replace('${build}', selectedBuild.version)
			.replace('${version}', this.options.loader.version);

		// Fetch the JSON profile
		try {
			const response = await fetch(url);
			const quiltJson: QuiltJSON = await response.json();
			return quiltJson;
		} catch (err: unknown) {
			return { error: err instanceof Error ? err.message : 'Failed to fetch or parse Quilt loader JSON' };
		}
	}

	/**
	 * Parses the Quilt JSON to determine which libraries need downloading, skipping
	 * any that already exist or that are disqualified by "rules". Downloads them
	 * in bulk using the Downloader utility.
	 *
	 * @param quiltJson A QuiltJSON object containing a list of libraries.
	 * @returns         The final list of libraries, or an error if something fails.
	 */
	public async downloadLibraries(quiltJson: QuiltJSON): Promise<QuiltLibrary[]> {
		const { libraries } = quiltJson;
		const downloader = new Downloader();

		let filesToDownload: Array<{
			url: string;
			folder: string;
			path: string;
			name: string;
			size: number;
		}> = [];

		let checkedLibraries = 0;
		let totalSize = 0;

		for (const lib of libraries) {
			// If rules exist, skip it (likely platform-specific logic)
			if (lib.rules) {
				this.emit('check', checkedLibraries++, libraries.length, 'libraries');
				continue;
			}

			// Construct the local path where this library should reside
			const libInfo = getPathLibraries(lib.name);
			const libFolder = path.resolve(this.options.path, 'libraries', libInfo.path);
			const libFilePath = path.resolve(libFolder, libInfo.name);

			// If the library doesn't exist locally, prepare to download
			if (!fs.existsSync(libFilePath)) {
				const libUrl = `${lib.url}${libInfo.path}/${libInfo.name}`;

				let fileSize = 0;
				const checkResult = await downloader.checkURL(libUrl);

				if (checkResult && checkResult.status === 200) {
					fileSize = checkResult.size;
					totalSize += fileSize;
				}

				filesToDownload.push({
					url: libUrl,
					folder: libFolder,
					path: libFilePath,
					name: libInfo.name,
					size: fileSize
				});
			}


			// Emit a "check" event for each library
			this.emit('check', checkedLibraries++, libraries.length, 'libraries');
		}

		// If there are libraries to download, proceed with the bulk download
		if (filesToDownload.length > 0) {
			downloader.on('progress', (downloaded: number, total: number) => {
				this.emit('progress', downloaded, total, 'libraries');
			});

			await downloader.downloadFileMultiple(filesToDownload, totalSize, this.options.downloadFileMultiple);
		}

		return libraries;
	}
}
