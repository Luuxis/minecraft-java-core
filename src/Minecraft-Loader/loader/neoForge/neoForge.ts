/**
 * @author Luuxis
 * Luuxis License v1.0 (voir fichier LICENSE pour les détails en FR/EN)
 */

import fs from 'fs';
import path from 'path';
import { EventEmitter } from 'events';

import { getPathLibraries, mirrors, getFileFromArchive } from '../../../utils/Index.js';
import Downloader from '../../../utils/Downloader.js';
import NeoForgePatcher from '../../patcher.js';
import type {
	PatcherProfile,
	ForgeInstallProfile,
	MinecraftLibrary,
	NeoForgeLoaderData,
	PatcherProcessor,
} from '../../../types.js';

interface NeoForgeOptions {
	path: string;
	loader: {
		version: string;
		build: string;
		config: {
			javaPath: string;
			minecraftJar: string;
			minecraftJson: string;
		};
		type: string;
	};
	downloadFileMultiple?: number;
}

interface DownloadInstallerResult {
	filePath?: string;
	oldAPI?: boolean;
	error?: string;
}

interface NeoForgeProfile {
	install?: ForgeInstallProfile;
	version?: Record<string, unknown> & { id?: string; libraries?: MinecraftLibrary[] };
	data?: Record<string, { client: string }>;
	filePath?: string;
	path?: string;
	processors?: PatcherProcessor[];
	libraries?: MinecraftLibrary[];
	error?: { message: string };
}

/**
 * This class handles downloading and installing NeoForge (formerly Forge) for Minecraft,
 * including picking the correct build, extracting libraries, and running patchers if needed.
 */
export default class NeoForgeMC extends EventEmitter {
	private readonly options: NeoForgeOptions;

	constructor(options: NeoForgeOptions) {
		super();
		this.options = options;
	}

	/**
	 * Converts a NeoForge version string to its corresponding Minecraft version.
	 * Handles all NeoForge versioning formats:
	 *
	 * - Snapshot special: "0.25w14craftmine.3-beta" → "25w14craftmine"
	 * - 4-parts + suffix: "26.1.0.0-alpha.1+snapshot-1" → "26.1-snapshot-1"
	 * - 4-parts + suffix: "26.1.0.0-alpha.15+pre-3" → "26.1-pre-3"
	 * - 4-parts no suffix: "26.1.0.1-beta" → "26.1"
	 * - 3-parts classic: "21.4.121" → "1.21.4"
	 * - 3-parts minor=0: "21.0.143" → "1.21"
	 *
	 * @param version The NeoForge version string
	 * @returns The corresponding Minecraft version, or null if unrecognized
	 */
	private neoforgeVersionToMinecraft(version: string): string | null {
		// 1. Snapshot special: starts with "0." → e.g., "0.25w14craftmine.3-beta"
		const snapshotMatch = version.match(/^0\.([^.]+)\./);
		if (snapshotMatch) {
			return snapshotMatch[1];
		}

		// 2. Strip suffix (everything after first "-" or "+") and split numeric part
		const numericPart = version.split(/[-+]/)[0];
		const parts = numericPart.split('.');

		// 3. 4+ parts → 2026+ format (e.g., "26.1.0.1" → MC "26.1")
		if (parts.length >= 4) {
			let mc = `${parts[0]}.${parts[1]}`;
			// Check for "+snapshot-N" or "+pre-N" suffix
			const suffixMatch = version.match(/\+(snapshot-\d+|pre-\d+)/);
			if (suffixMatch) {
				mc += `-${suffixMatch[1]}`;
			}
			return mc;
		}

		// 4. 3 parts → classic format (e.g., "21.4.121" → MC "1.21.4")
		if (parts.length === 3) {
			if (parts[1] === '0') {
				return `1.${parts[0]}`;
			}
			return `1.${parts[0]}.${parts[1]}`;
		}

		return null;
	}

	/**
	 * Downloads the NeoForge installer jar for the specified version and build,
	 * either using a legacy API or the newer metaData approach. If "latest" or "recommended"
	 * is specified, it picks the newest build from the filtered list.
	 *
	 * Uses neoforgeVersionToMinecraft() to map each NeoForge version to its
	 * Minecraft version, supporting all formats (releases, snapshots, pre-releases,
	 * 4-part 2026+ versions, etc.).
	 *
	 * @param Loader An object containing URLs and patterns for legacy and new metadata/installers.
	 * @returns      An object with filePath and oldAPI fields, or an error.
	 */
	public async downloadInstaller(Loader: NeoForgeLoaderData): Promise<DownloadInstallerResult> {
		let build: string | undefined;
		let neoForgeURL: string;
		let oldAPI = true;

		const minecraftVersion = this.options.loader.version;

		// Fetch versions from both APIs
		const legacyMetaData = await fetch(Loader.legacyMetaData).then(res => res.json());
		const metaData = await fetch(Loader.metaData).then(res => res.json());

		// Try legacy API first (old Forge-era versions like "1.20.1-47.1.0")
		let versions: string[] = legacyMetaData.versions.filter((v: string) =>
			v.includes(`${minecraftVersion}-`)
		);

		// If none found in legacy, use modern API with neoforgeVersionToMinecraft
		if (!versions.length) {
			versions = metaData.versions.filter((v: string) => {
				const mc = this.neoforgeVersionToMinecraft(v);
				return mc === minecraftVersion;
			});
			oldAPI = false;
		}

		// If still no versions found, return an error
		if (!versions.length) {
			return { error: `NeoForge doesn't support Minecraft ${minecraftVersion}` };
		}

		// Determine which build to use
		if (this.options.loader.build === 'latest' || this.options.loader.build === 'recommended') {
			build = versions[versions.length - 1]; // The most recent build
		} else {
			build = versions.find(v => v === this.options.loader.build);
		}

		if (!build) {
			return {
				error: `NeoForge Loader ${this.options.loader.build} not found, Available builds: ${versions.join(', ')}`
			};
		}

		// Build the installer URL, depending on whether we use the legacy or new API
		if (oldAPI) {
			neoForgeURL = Loader.legacyInstall.replaceAll(/\${version}/g, build);
		} else {
			neoForgeURL = Loader.install.replaceAll(/\${version}/g, build);
		}

		// Create a local folder for "neoForge" if it doesn't exist
		const neoForgeFolder = path.resolve(this.options.path, 'libraries/net/neoforged/installer');
		const installerFilePath = path.resolve(neoForgeFolder, `neoForge-${build}-installer.jar`);

		if (!fs.existsSync(installerFilePath)) {
			if (!fs.existsSync(neoForgeFolder)) {
				fs.mkdirSync(neoForgeFolder, { recursive: true });
			}
			const downloader = new Downloader();
			downloader.on('progress', (downloaded: number, size: number) => {
				this.emit('progress', downloaded, size, `neoForge-${build}-installer.jar`);
			});

			await downloader.downloadFile(neoForgeURL, neoForgeFolder, `neoForge-${build}-installer.jar`);
		}

		return { filePath: installerFilePath, oldAPI };
	}

	/**
	 * Extracts the main JSON profile (install_profile.json) from the NeoForge installer.
	 * If the JSON references an additional file, it also extracts and parses that, returning
	 * a unified object with `install` and `version` keys.
	 *
	 * @param pathInstaller Full path to the downloaded NeoForge installer jar.
	 * @returns A NeoForgeProfile object, or an error if invalid.
	 */
	public async extractProfile(pathInstaller: string): Promise<NeoForgeProfile | { error: { message: string } }> {
		const fileContent = await getFileFromArchive(pathInstaller, 'install_profile.json');
		if (!fileContent) {
			return { error: { message: 'Invalid neoForge installer' } };
		}

		const neoForgeJsonOrigin = JSON.parse(fileContent.toString());
		if (!neoForgeJsonOrigin) {
			return { error: { message: 'Invalid neoForge installer' } };
		}

		const result: NeoForgeProfile = { data: {} };
		if (neoForgeJsonOrigin.install) {
			result.install = neoForgeJsonOrigin.install;
			result.version = neoForgeJsonOrigin.versionInfo;
		} else {
			result.install = neoForgeJsonOrigin;
			const extraFile = await getFileFromArchive(pathInstaller, path.basename(result.install.json));
			if (extraFile) {
				result.version = JSON.parse(extraFile.toString());
			} else {
				return { error: { message: 'Unable to read additional JSON from neoForge installer' } };
			}
		}

		return result;
	}

	/**
	 * Extracts the universal jar or associated files for NeoForge into the local "libraries" directory.
	 * Also handles client.lzma if processors are present. Returns a boolean indicating whether we skip
	 * certain neoforge libraries in subsequent steps.
	 *
	 * @param profile    The extracted NeoForge profile with file path references
	 * @param pathInstaller Path to the NeoForge installer
	 * @param oldAPI     Whether we are dealing with the old or new NeoForge API (affects library naming)
	 * @returns          A boolean indicating if we should filter out certain libraries afterwards
	 */
	public async extractUniversalJar(profile: NeoForgeProfile, pathInstaller: string, oldAPI: boolean): Promise<boolean> {
		let skipNeoForgeFilter = true;

		if (profile.filePath) {
			const fileInfo = getPathLibraries(profile.path!);
			this.emit('extract', `Extracting ${fileInfo.name}...`);

			const destFolder = path.resolve(this.options.path, 'libraries', fileInfo.path);
			if (!fs.existsSync(destFolder)) {
				fs.mkdirSync(destFolder, { recursive: true });
			}

			const archiveContent = await getFileFromArchive(pathInstaller, profile.filePath) as Buffer | undefined;
			if (archiveContent) {
				fs.writeFileSync(path.join(destFolder, fileInfo.name), archiveContent, { mode: 0o777 });
			}
		} else if (profile.path) {
			const fileInfo = getPathLibraries(profile.path);
			const filesInArchive = await getFileFromArchive(pathInstaller, null, `maven/${fileInfo.path}`) as string[];
			if (filesInArchive && Array.isArray(filesInArchive)) {
				for (const file of filesInArchive) {
					const fileName = path.basename(file);
					this.emit('extract', `Extracting ${fileName}...`);

					const content = await getFileFromArchive(pathInstaller, file) as Buffer | undefined;
					if (!content) continue;

					const destFolder = path.resolve(this.options.path, 'libraries', fileInfo.path);
					if (!fs.existsSync(destFolder)) {
						fs.mkdirSync(destFolder, { recursive: true });
					}
					fs.writeFileSync(path.join(destFolder, fileName), content, { mode: 0o777 });
				}
			}
		} else {
			skipNeoForgeFilter = false;
		}

		if (profile.processors?.length) {
			const universalPath = profile.libraries?.find(lib =>
				(lib.name || '').startsWith(oldAPI ? 'net.neoforged:forge' : 'net.neoforged:neoforge')
			);

			const clientData = await getFileFromArchive(pathInstaller, 'data/client.lzma') as Buffer | undefined;
			if (clientData) {
				const fileInfo = getPathLibraries(profile.path || universalPath?.name || '', '-clientdata', '.lzma');
				const destFolder = path.resolve(this.options.path, 'libraries', fileInfo.path);

				if (!fs.existsSync(destFolder)) {
					fs.mkdirSync(destFolder, { recursive: true });
				}
				fs.writeFileSync(path.join(destFolder, fileInfo.name), clientData, { mode: 0o777 });
				this.emit('extract', `Extracting ${fileInfo.name}...`);
			}
		}

		return skipNeoForgeFilter;
	}

	/**
	 * Downloads all libraries referenced in the NeoForge profile. If skipNeoForgeFilter is true,
	 * certain core libraries are excluded. Checks for duplicates and local existence before downloading.
	 *
	 * @param profile           The NeoForge profile containing version/install libraries
	 * @param skipNeoForgeFilter Whether we skip specific "net.minecraftforge:neoforged" libs
	 * @returns An array of library objects after download, or an error object if something fails
	 */
	public async downloadLibraries(profile: NeoForgeProfile, skipNeoForgeFilter: boolean): Promise<MinecraftLibrary[] | { error: string }> {
		let libraries = profile.version?.libraries || [];
		const dl = new Downloader();
		let checkCount = 0;
		const pendingFiles: Array<{
			url: string;
			folder: string;
			path: string;
			name: string;
			size: number;
		}> = [];
		let totalSize = 0;

		// Combine install.libraries with version.libraries
		if (profile.install?.libraries) {
			libraries = libraries.concat(profile.install.libraries);
		}

		// Remove duplicates by 'name'
		libraries = libraries.filter(
			(lib, index, self) => index === self.findIndex(item => item.name === lib.name)
		);

		// If skipping certain neoforge libs
		const skipNeoForge = ['net.minecraftforge:neoforged:', 'net.minecraftforge:minecraftforge:'];

		// Evaluate each library
		for (const lib of libraries) {
			if (skipNeoForgeFilter && skipNeoForge.some(str => lib.name.includes(str))) {
				// If there's no valid artifact URL, skip it
				if (!lib.downloads?.artifact?.url) {
					this.emit('check', checkCount++, libraries.length, 'libraries');
					continue;
				}
			}

			// If the library has rules, skip automatically
			if (lib.rules) {
				this.emit('check', checkCount++, libraries.length, 'libraries');
				continue;
			}

			// Construct the local path to the library
			const libInfo = getPathLibraries(lib.name);
			const libFolder = path.resolve(this.options.path, 'libraries', libInfo.path);
			const libFilePath = path.resolve(libFolder, libInfo.name);

			// If it doesn't exist locally, schedule for download
			if (!fs.existsSync(libFilePath)) {
				let finalURL: string | null = null;
				let fileSize = 0;

				// Attempt to resolve via mirror first
				const baseURL = `${libInfo.path}/${libInfo.name}`;
				const mirrorCheck = await dl.checkMirror(baseURL, mirrors);
				if (mirrorCheck && typeof mirrorCheck === 'object' && 'status' in mirrorCheck && mirrorCheck.status === 200) {
					finalURL = mirrorCheck.url;
					fileSize = mirrorCheck.size;
					totalSize += fileSize;
				} else if (lib.downloads?.artifact) {
					finalURL = lib.downloads.artifact.url;
					fileSize = lib.downloads.artifact.size;
					totalSize += fileSize;
				}

				if (!finalURL) {
					return { error: `Impossible to download ${libInfo.name}` };
				}

				pendingFiles.push({
					url: finalURL,
					folder: libFolder,
					path: libFilePath,
					name: libInfo.name,
					size: fileSize
				});
			}

			this.emit('check', checkCount++, libraries.length, 'libraries');
		}

		// Download all pending files
		if (pendingFiles.length > 0) {
			dl.on('progress', (downloaded: number, totDL: number) => {
				this.emit('progress', downloaded, totDL, 'libraries');
			});

			await dl.downloadFileMultiple(pendingFiles, totalSize, this.options.downloadFileMultiple);
		}

		return libraries;
	}

	/**
	 * Runs the NeoForge patch process, if any processors exist. Checks if patching is needed,
	 * then uses the `NeoForgePatcher` class. If the patch is already applied, it skips.
	 *
	 * @param profile The NeoForge profile, which may include processors.
	 * @param oldAPI  Whether we are dealing with the old or new API (passed to the patcher).
	 * @returns       True on success or if no patch was needed.
	 */
	public async patchneoForge(profile: NeoForgeProfile, oldAPI: boolean): Promise<boolean> {
		if (profile?.processors?.length) {
			const patcher = new NeoForgePatcher(this.options);

			// Relay events
			patcher.on('patch', (data: string) => {
				this.emit('patch', data);
			});
			patcher.on('error', (error: string) => {
				this.emit('error', error);
			});

			// If not already patched, run the patcher
			if (!patcher.check(profile)) {
				const config = {
					java: this.options.loader.config.javaPath,
					minecraft: this.options.loader.config.minecraftJar,
					minecraftJson: this.options.loader.config.minecraftJson
				};

				await patcher.patcher(profile, config, oldAPI);
			}
		}
		return true;
	}
}
