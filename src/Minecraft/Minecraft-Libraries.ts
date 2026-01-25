/**
 * @author Luuxis
 * Luuxis License v1.0 (voir fichier LICENSE pour les détails en FR/EN)
 */

import os from 'os';
import fs from 'fs';
import { getFileFromArchive } from '../utils/Index.js';

/**
 * Maps Node.js platforms to Mojang's naming scheme for OS in library natives.
 */
const MojangLib: Record<string, string> = {
	win32: 'windows',
	darwin: 'osx',
	linux: 'linux'
};

/**
 * Maps Node.js architecture strings to Mojang's arch replacements (e.g., "${arch}" => 64).
 */
const Arch: Record<string, string> = {
	x32: '32',
	x64: '64',
	arm: '32',
	arm64: '64'
};

/**
 * Represents a single library entry in the version JSON.
 * Adjust or extend this interface based on your actual JSON structure.
 */
interface MinecraftLibrary {
	name?: string;
	rules?: Array<{
		os?: { name: string };
		action?: string;
	}>;
	natives?: Record<string, string>;
	downloads: {
		artifact?: {
			sha1: string;
			size: number;
			path: string;
			url: string;
		};
		classifiers?: Record<
			string,
			{
				sha1: string;
				size: number;
				path: string;
				url: string;
			}
		>;
	};
}

/**
 * Represents a Minecraft version JSON structure.
 * Extend this interface to reflect any additional fields you use.
 */
interface MinecraftVersionJSON {
	id: string;
	libraries: MinecraftLibrary[];
	downloads: {
		client: {
			sha1: string;
			size: number;
			url: string;
		};
	};
	[key: string]: any;
}

/**
 * Represents an item in the optional "asset" array fetched from a custom URL.
 */
interface CustomAssetItem {
	path: string;
	hash: string;
	size: number;
	url: string;
}

/**
 * Represents the user-provided options for the Libraries class.
 * Adjust as needed for your codebase.
 */
interface LibrariesOptions {
	path: string;        // Base path to the Minecraft folder
	instance?: string;   // Instance name if using multi-instances
	[key: string]: any;  // Other fields your code might need
}

/**
 * Represents a file or library entry that needs to be downloaded and stored.
 */
interface LibraryDownload {
	sha1?: string;
	size?: number;
	path: string;
	type: string;
	url?: string;
	content?: string; // For CFILE entries (JSON content)
}

/**
 * This class is responsible for:
 *  - Gathering library download info from the version JSON
 *  - Handling custom asset entries if provided
 *  - Extracting native libraries for the current OS into the appropriate folder
 */
export default class Libraries {
	private json!: MinecraftVersionJSON;
	private readonly options: LibrariesOptions;

	constructor(options: LibrariesOptions) {
		this.options = options;
	}

	/**
	 * Processes the provided Minecraft version JSON to build a list of libraries
	 * that need to be downloaded (including the main client jar and the version JSON itself).
	 *
	 * @param json A MinecraftVersionJSON object (containing libraries, downloads, etc.)
	 * @returns An array of LibraryDownload items describing each file.
	 */
	public async Getlibraries(json: MinecraftVersionJSON): Promise<LibraryDownload[]> {
		this.json = json;
		const libraries: LibraryDownload[] = [];

		for (const lib of this.json.libraries) {
			let artifact: { sha1: string; size: number; path: string; url: string } | undefined;
			let type = 'Libraries';

			if (lib.natives) {
				// If this library has OS natives, pick the correct classifier
				const classifiers = lib.downloads.classifiers;
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
				// If there are rules restricting OS, skip if not matching
				if (lib.rules && lib.rules[0]?.os?.name) {
					if (lib.rules[0].os.name !== MojangLib[os.platform()]) {
						continue;
					}
				}
				artifact = lib.downloads.artifact;
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

	public async GetLogging(): Promise<LibraryDownload[]> {
		let libraries: LibraryDownload[] = [];
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
	public async GetAssetsOthers(url: string | null): Promise<LibraryDownload[]> {
		if (!url) return [];

		const response = await fetch(url);
		const data: CustomAssetItem[] = await response.json();

		const assets: LibraryDownload[] = [];
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
	public async natives(bundle: LibraryDownload[]): Promise<string[]> {
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
			const entries = await getFileFromArchive(native, null, null, true);


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
