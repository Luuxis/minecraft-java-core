/**
 * @author Luuxis
 * Luuxis License v1.0 (voir fichier LICENSE pour les détails en FR/EN)
 */

import crypto from 'crypto';
import fs from 'fs';
import { Readable } from 'node:stream';
import Unzipper from './unzipper.js';
import type {
	MinecraftLibrary,
	MinecraftVersionJSON,
	LibraryRule,
	ForgeLoaderData,
	NeoForgeLoaderData,
	FabricLoaderData,
	ArchiveEntry,
} from '../types.js';

/**
 * Parses a Gradle/Maven identifier string (like "net.minecraftforge:forge:1.19-41.0.63")
 * into a local file path (group/artifact/version) and final filename (artifact-version.jar).
 * Optionally allows specifying a native string suffix or forcing an extension.
 *
 * @param main         A Gradle-style coordinate (group:artifact:version[:classifier])
 * @param nativeString A suffix for native libraries (e.g., "-natives-linux")
 * @param forceExt     A forced file extension (default is ".jar")
 * @returns An object with `path` and `name`, where `path` is the directory path and `name` is the filename
 */
function getPathLibraries(main: string, nativeString?: string, forceExt?: string) {
	// Example "net.minecraftforge:forge:1.19-41.0.63"
	const libSplit = main.split(':');

	// If there's a fourth element, it's typically a classifier appended to version
	const fileName = libSplit[3] ? `${libSplit[2]}-${libSplit[3]}` : libSplit[2];

	// Replace '@' in versions if present (e.g., "1.0@beta" => "1.0.beta")
	let finalFileName = fileName.includes('@')
		? fileName.replace('@', '.')
		: `${fileName}${nativeString || ''}${forceExt || '.jar'}`;

	// Construct the path: "net.minecraftforge" => "net/minecraftforge"
	// artifact => "forge"
	// version => "1.19-41.0.63"
	const pathLib = `${libSplit[0].replace(/\./g, '/')}/${libSplit[1]}/${libSplit[2].split('@')[0]}`;

	return {
		path: pathLib,
		name: `${libSplit[1]}-${finalFileName}`,
		version: libSplit[2],
	};
}

/**
 * Computes a hash (default SHA-1) of the given file by streaming its contents.
 *
 * @param filePath   Full path to the file on disk
 * @param algorithm  Hashing algorithm (default: "sha1")
 * @returns          A Promise resolving to the hex string of the file's hash
 */
async function getFileHash(filePath: string, algorithm: string = 'sha1'): Promise<string> {
	const shasum = crypto.createHash(algorithm);

	// For small files, avoid the stream overhead entirely
	const stat = fs.statSync(filePath);
	if (stat.size <= 512 * 1024) { // ≤ 512 KB
		shasum.update(fs.readFileSync(filePath));
		return shasum.digest('hex');
	}

	// For larger files, stream to avoid loading everything into memory
	const fileStream = fs.createReadStream(filePath);
	return new Promise((resolve, reject) => {
		fileStream.on('data', (data) => shasum.update(data));
		fileStream.on('end', () => resolve(shasum.digest('hex')));
		fileStream.on('error', reject);
	});
}

/**
 * Determines if a given Minecraft version JSON is considered "old"
 * by checking its assets field (e.g., "legacy" or "pre-1.6").
 *
 * @param json The Minecraft version JSON
 * @returns true if it's an older version, false otherwise
 */
function isold(json: MinecraftVersionJSON): boolean {
	return json.assets === 'legacy' || json.assets === 'pre-1.6';
}

/**
 * Returns metadata necessary to download specific loaders (Forge, Fabric, etc.)
 * based on a loader type string (e.g., "forge", "fabric").
 * If the loader type is unrecognized, returns undefined.
 *
 * @param type A string representing the loader type
 */
function loader(type: string): ForgeLoaderData | NeoForgeLoaderData | FabricLoaderData | undefined {
	if (type === 'forge') {
		return {
			metaData: 'https://files.minecraftforge.net/net/minecraftforge/forge/maven-metadata.json',
			meta: 'https://files.minecraftforge.net/net/minecraftforge/forge/${build}/meta.json',
			promotions: 'https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json',
			install: 'https://maven.minecraftforge.net/net/minecraftforge/forge/${version}/forge-${version}-installer',
			universal: 'https://maven.minecraftforge.net/net/minecraftforge/forge/${version}/forge-${version}-universal',
			client: 'https://maven.minecraftforge.net/net/minecraftforge/forge/${version}/forge-${version}-client'
		};
	} else if (type === 'neoforge') {
		return {
			legacyMetaData: 'https://maven.neoforged.net/api/maven/versions/releases/net/neoforged/forge',
			metaData: 'https://maven.neoforged.net/api/maven/versions/releases/net/neoforged/neoforge',
			legacyInstall: 'https://maven.neoforged.net/releases/net/neoforged/forge/${version}/forge-${version}-installer.jar',
			install: 'https://maven.neoforged.net/releases/net/neoforged/neoforge/${version}/neoforge-${version}-installer.jar'
		};
	} else if (type === 'fabric') {
		return {
			metaData: 'https://meta.fabricmc.net/v2/versions',
			json: 'https://meta.fabricmc.net/v2/versions/loader/${version}/${build}/profile/json'
		};
	} else if (type === 'legacyfabric') {
		return {
			metaData: 'https://meta.legacyfabric.net/v2/versions',
			json: 'https://meta.legacyfabric.net/v2/versions/loader/${version}/${build}/profile/json'
		};
	} else if (type === 'quilt') {
		return {
			metaData: 'https://meta.quiltmc.org/v3/versions',
			json: 'https://meta.quiltmc.org/v3/versions/loader/${version}/${build}/profile/json'
		};
	}
	// If none match, return undefined
}

/**
 * A list of potential Maven mirrors for downloading libraries.
 */
const mirrors = [
	'https://maven.minecraftforge.net',
	'https://maven.neoforged.net/releases',
	'https://maven.creeperhost.net',
	'https://libraries.minecraft.net',
	'https://repo1.maven.org/maven2'
];

/**
 * Reads a .jar or .zip file, returning specific entries or listing file entries in the archive.
 *
 * @param jar    Full path to the jar/zip file
 * @param file   The file entry to extract data from (e.g., "install_profile.json"). If null, returns all entries or partial lists.
 * @param prefix A path prefix filter (e.g., "maven/org/lwjgl/") if you want a list of matching files instead of direct extraction
 * @returns      A buffer or an array of { name, data }, or a list of filenames if prefix is given
 */
async function getFileFromArchive(jar: string, file: string | null = null, prefix: string | null = null, includeDirs: boolean = false): Promise<Buffer | string[] | ArchiveEntry[] | undefined> {
	const result: Array<string | ArchiveEntry> = [];
	const zip = new Unzipper(jar);
	const entries = zip.getEntries();

	return new Promise((resolve) => {
		for (const entry of entries) {
			if (includeDirs ? !prefix : (!entry.isDirectory && !prefix)) {
				if (entry.entryName === file) {
					return resolve(entry.getData());
				} else if (!file) {
					result.push({ name: entry.entryName, data: entry.getData(), isDirectory: entry.isDirectory });
				}
			}

			if (!entry.isDirectory && entry.entryName.includes(prefix as string)) {
				result.push(entry.entryName);
			}
		}

		if (file && !prefix) {
			return resolve(undefined);
		}

		// If prefix was used, result contains only strings; otherwise only ArchiveEntries
		resolve(result as string[] | ArchiveEntry[]);
	});
}

/**
 * Determines if a library should be skipped based on its 'rules' property.
 * For example, it might skip libraries if action='disallow' for the current OS,
 * or if there are specific conditions not met.
 *
 * @param lib A library object (with optional 'rules' array)
 * @returns true if the library should be skipped, false otherwise
 */
function skipLibrary(lib: MinecraftLibrary): boolean {
	// Map Node.js platform strings to Mojang's naming
	const LibMap: Record<string, string> = {
		win32: 'windows',
		darwin: 'osx',
		linux: 'linux'
	};

	// If no rules, it's not skipped
	if (!lib.rules) {
		return false;
	}

	let shouldSkip = true;

	for (const rule of lib.rules) {
		// If features exist, your logic can handle them here
		if (rule.features) {
			// Implementation is up to your usage
			continue;
		}

		// "allow" means it can be used if OS matches (or no OS specified)
		// "disallow" means skip if OS matches (or no OS specified)
		if (
			rule.action === 'allow' &&
			((rule.os && rule.os.name === LibMap[process.platform]) || !rule.os)
		) {
			shouldSkip = false;
		} else if (
			rule.action === 'disallow' &&
			((rule.os && rule.os.name === LibMap[process.platform]) || !rule.os)
		) {
			shouldSkip = true;
		}
	}

	return shouldSkip;
}

function fromAnyReadable(webStream: ReadableStream<Uint8Array>): import('node:stream').Readable {
	// Try Readable.fromWeb() first (Node.js 18+), works for both Node.js and Electron
	if (typeof (Readable as unknown as { fromWeb: Function }).fromWeb === 'function') {
		try {
			return (Readable as unknown as { fromWeb: (stream: ReadableStream) => Readable }).fromWeb(webStream);
		} catch {
			// If fromWeb fails (e.g. wrong stream type in Electron), fall through to manual pump
		}
	}

	// Manual pump fallback for environments where Readable.fromWeb() is unavailable or fails
	const nodeStream = new Readable({ read() { } });
	const reader = webStream.getReader();

	(function pump() {
		reader.read().then(({ done, value }) => {
			if (done) return nodeStream.push(null);
			nodeStream.push(Buffer.from(value));
			pump();
		}).catch(err => nodeStream.destroy(err));
	})();

	return nodeStream;
}

// Export all utility functions and constants
export {
	getPathLibraries,
	getFileHash,
	isold,
	loader,
	mirrors,
	getFileFromArchive,
	skipLibrary,
	fromAnyReadable
};
