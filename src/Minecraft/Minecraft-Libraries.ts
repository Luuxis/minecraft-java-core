/**
 * @author Luuxis
 * Luuxis License v1.0 (voir fichier LICENSE pour les détails en FR/EN)
 */

import os from 'os';
import fs from 'fs';
import { getFileFromArchive } from '../utils/Index.js';
import type {
	MinecraftVersionJSON,
	MinecraftLibrary,
	DownloadFile,
	CustomAssetItem,
	LaunchOptions,
	MOJANG_OS_MAP,
	MOJANG_ARCH_MAP,
	ArchiveEntry
} from '../types.js';

/** Maps Node.js platforms to Mojang's naming scheme */
const MojangLib: Record<string, string> = {
	win32: 'windows',
	darwin: 'osx',
	linux: 'linux'
};

/** Maps Node.js architecture to Mojang's arch replacements */
const Arch: Record<string, string> = {
	x32: '32',
	x64: '64',
	arm: '32',
	arm64: '64'
};

/**
 * This class is responsible for:
 *  - Gathering library download info from the version JSON
 *  - Handling custom asset entries if provided
 *  - Extracting native libraries for the current OS
 */
export default class Libraries {
	private json!: MinecraftVersionJSON;
	private readonly options: LaunchOptions;

	constructor(options: LaunchOptions) {
		this.options = options;
	}

	public async Getlibraries(json: MinecraftVersionJSON): Promise<DownloadFile[]> {
		this.json = json;
		const libraries: DownloadFile[] = [];

		for (const lib of this.json.libraries) {
			let artifact: { sha1: string; size: number; path: string; url: string } | undefined;
			let type = 'Libraries';

		if (lib.natives) {
				const classifiers = lib.downloads?.classifiers;
				let native = lib.natives[MojangLib[os.platform()]] || lib.natives[os.platform()];
				type = 'Native';
				if (native) {
					// Replace "${arch}" if present, e.g. "natives-windows-${arch}"
					const archReplaced = native.replace('${arch}', Arch[os.arch()] || '');
					artifact = classifiers ? classifiers[archReplaced] : undefined;
				} else {
					// No valid native for the current platform
					continue;
				}
			} else {
				if (lib.rules && lib.rules[0]?.os?.name) {
					if (lib.rules[0].os.name !== MojangLib[os.platform()]) {
						continue;
					}
				}
				artifact = lib.downloads?.artifact;
			}

			if (!artifact) continue;

			libraries.push({
				sha1: artifact.sha1,
				size: artifact.size,
				path: `libraries/${artifact.path}`,
				type: type,
				url: artifact.url
			});
		}

		// Add the main Minecraft client JAR to the list
		libraries.push({
			sha1: this.json.downloads.client.sha1,
			size: this.json.downloads.client.size,
			path: `versions/${this.json.id}/${this.json.id}.jar`,
			type: 'Libraries',
			url: this.json.downloads.client.url
		});

		// Add the JSON file for this version as a "CFILE"
		libraries.push({
			path: `versions/${this.json.id}/${this.json.id}.json`,
			type: 'CFILE',
			content: JSON.stringify(this.json)
		});

		return libraries;
	}

	public async GetLogging(): Promise<DownloadFile[]> {
		let libraries: DownloadFile[] = [];
		if (this.json.logging) {
			const logConfig = this.json.logging;
			const artifact = logConfig.client.file;

			libraries.push({
				sha1: artifact.sha1,
				size: artifact.size,
				path: `assets/log_configs/${artifact.id}`,
				type: 'Log_configs',
				url: artifact.url
			});
		}
		return libraries;
	}

	/**
	 * Fetches custom assets or libraries from a remote URL if provided.
	 * This method expects the response to be an array of objects with
	 * "path", "hash", "size", and "url".
	 *
	 * @param url The remote URL that returns a JSON array of CustomAssetItem
	 * @returns   An array of LibraryDownload entries describing each item
	 */
	public async GetAssetsOthers(url: string | null): Promise<DownloadFile[]> {
		if (!url) return [];

		const response = await fetch(url);
		const data: CustomAssetItem[] = await response.json();

		const assets: DownloadFile[] = [];
		for (const asset of data) {
			if (!asset.path) continue;

			// The 'type' is deduced from the first part of the path
			const fileType = asset.path.split('/')[0];
			assets.push({
				sha1: asset.hash,
				size: asset.size,
				type: fileType,
				path: this.options.instance
					? `instances/${this.options.instance}/${asset.path}`
					: asset.path,
				url: asset.url
			});
		}
		return assets;
	}

	/**
	 * Extracts native libraries from the downloaded jars (those marked type="Native")
	 * and places them into the "natives" folder under "versions/<id>/natives".
	 *
	 * @param bundle An array of library entries (some of which may be natives)
	 * @returns The paths of the native files that were extracted
	 */
	public async natives(bundle: DownloadFile[]): Promise<string[]> {
		// Gather only the native library files
		const natives = bundle
			.filter((item) => item.type === 'Native')
			.map((item) => `${item.path}`);

		if (natives.length === 0) {
			return [];
		}

		// Create the natives folder if it doesn't already exist
		const nativesFolder = `${this.options.path}/versions/${this.json.id}/natives`.replace(/\\/g, '/');
		if (!fs.existsSync(nativesFolder)) {
			fs.mkdirSync(nativesFolder, { recursive: true, mode: 0o777 });
		}

		// For each native jar, extract its contents (excluding META-INF)
		for (const native of natives) {
			const entries = await getFileFromArchive(native, null, null, true) as ArchiveEntry[];


			for (const entry of entries) {
				if (entry.name.startsWith('META-INF')) continue;

				if (entry.isDirectory) {
					fs.mkdirSync(`${nativesFolder}/${entry.name}`, { recursive: true, mode: 0o777 });
					continue;
				}

				// Write the file to the natives folder
				fs.writeFileSync(`${nativesFolder}/${entry.name}`, entry.data, { mode: 0o777 });
			}
		}
		return natives;
	}
}
