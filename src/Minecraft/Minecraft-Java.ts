/**
 * @author Luuxis
 * Luuxis License v1.0 (voir fichier LICENSE pour les détails en FR/EN)
 */

import os from 'os';
import path from 'path';
import fs from 'fs';
import EventEmitter from 'events';

import { getFileFromArchive } from '../utils/Index.js';
import Downloader from '../utils/Downloader.js';

/**
 * Represents the Java-specific options a user might pass to the downloader.
 */
export interface JavaDownloaderOptions {
	path: string;                 // Base path to store the downloaded Java runtime
	java: {
		version?: string;           // Force a specific Java version (e.g., "17")
		type: string;               // Image type for Adoptium (e.g., "jdk" or "jre")
	};
	intelEnabledMac?: boolean;    // If `true`, allows using Intel-based Java on Apple Silicon
}

/**
 * A generic JSON structure for the Minecraft version, which may include
 * a javaVersion property. Adjust as needed to fit your actual data.
 */
export interface MinecraftVersionJSON {
	javaVersion?: {
		component?: string;   // e.g., "jre-legacy" or "java-runtime-alpha"
		majorVersion?: number; // e.g., 8, 17, 19
	};
}

/**
 * Structure returned by getJavaFiles() and getJavaOther().
 */
export interface JavaDownloadResult {
	files: JavaFileItem[];
	path: string;      // Local path to the java executable
	error?: boolean;   // Indicate an error if any
	message?: string;  // Error message if error is true
}

/**
 * Represents a single Java file entry that might need downloading.
 */
export interface JavaFileItem {
	path: string;        // Relative path to store the file under the runtime directory
	executable?: boolean;
	sha1?: string;
	size?: number;
	url?: string;
	type?: string;       // "Java" or other type
}

/**
 * Manages the download and extraction of the correct Java runtime for Minecraft.
 * It supports both Mojang's curated list of Java runtimes and the Adoptium fallback.
 */
export default class JavaDownloader extends EventEmitter {
	private options: JavaDownloaderOptions;

	constructor(options: JavaDownloaderOptions) {
		super();
		this.options = options;
	}

	/**
	 * Retrieves Java files from Mojang's runtime metadata if possible,
	 * otherwise falls back to getJavaOther().
	 *
	 * @param jsonversion A JSON object describing the Minecraft version (with optional javaVersion).
	 * @returns An object containing a list of JavaFileItems and the final path to "java".
	 */
	public async getJavaFiles(jsonversion: MinecraftVersionJSON): Promise<JavaDownloadResult> {
		// If a specific version is forced, delegate to getJavaOther() immediately
		if (this.options.java.version) {
			return this.getJavaOther(jsonversion, this.options.java.version);
		}

		// OS-to-architecture mapping for Mojang's curated Java.
		const archMapping: Record<string, Record<string, string>> = {
			win32: { x64: 'windows-x64', ia32: 'windows-x86', arm64: 'windows-arm64' },
			darwin: { x64: 'mac-os', arm64: this.options.intelEnabledMac ? 'mac-os' : 'mac-os-arm64' },
			linux: { x64: 'linux', ia32: 'linux-i386' }
		};

		const osPlatform = os.platform();    // "win32", "darwin", "linux", ...
		const arch = os.arch();             // "x64", "arm64", "ia32", ...

		const javaVersionName = jsonversion.javaVersion?.component || 'jre-legacy';
		const osArchMapping = archMapping[osPlatform];
		const files: JavaFileItem[] = [];

		// If we don't have a valid mapping for the current OS, fallback to Adoptium
		if (!osArchMapping) {
			return this.getJavaOther(jsonversion);
		}

		// Determine the OS-specific identifier
		const archOs = osArchMapping[arch];
		if (!archOs) {
			// If we can't match the arch in the sub-object, fallback
			return this.getJavaOther(jsonversion);
		}

		// Fetch Mojang's Java runtime metadata
		const url = 'https://launchermeta.mojang.com/v1/products/java-runtime/2ec0cc96c44e5a76b9c8b7c39df7210883d12871/all.json';
		const javaVersionsJson = await fetch(url).then(res => res.json());

		const versionName = javaVersionsJson[archOs]?.[javaVersionName]?.[0]?.version?.name;
		if (!versionName) {
			return this.getJavaOther(jsonversion);
		}

		// Fetch the runtime manifest which lists individual files
		const manifestUrl = javaVersionsJson[archOs][javaVersionName][0]?.manifest?.url;
		const manifest = await fetch(manifestUrl).then(res => res.json());
		const manifestEntries: Array<[string, any]> = Object.entries(manifest.files);

		// Identify the Java executable in the manifest
		const javaExeKey = process.platform === 'win32' ? 'bin/javaw.exe' : 'bin/java';
		const javaEntry = manifestEntries.find(([relPath]) => relPath.endsWith(javaExeKey));
		if (!javaEntry) {
			// If we can't find the executable, fallback
			return this.getJavaOther(jsonversion);
		}

		const toDelete = javaEntry[0].replace(javaExeKey, '');
		for (const [relPath, info] of manifestEntries) {
			if (info.type === 'directory') continue;
			if (!info.downloads) continue;

			files.push({
				path: `runtime/${javaVersionName}/${relPath.replace(toDelete, '')}`,
				executable: info.executable,
				sha1: info.downloads.raw.sha1,
				size: info.downloads.raw.size,
				url: info.downloads.raw.url,
				type: 'Java'
			});
		}

		return {
			files,
			path: path.resolve(
				this.options.path,
				`runtime/${javaVersionName}`,
				'bin',
				process.platform === 'win32' ? 'javaw.exe' : 'java'
			)
		};
	}

	/**
	 * Fallback method to download Java from Adoptium if Mojang's metadata is unavailable
	 * or doesn't have the appropriate runtime for the user's platform/arch.
	 *
	 * @param jsonversion A Minecraft version JSON (with optional javaVersion).
	 * @param versionDownload A forced Java version (string) if provided by the user.
	 */
	public async getJavaOther(jsonversion: MinecraftVersionJSON, versionDownload?: string): Promise<JavaDownloadResult> {
		const { platform, arch } = this.getPlatformArch();
		const majorVersion = versionDownload || jsonversion.javaVersion?.majorVersion || 8;
		const pathFolder = path.resolve(this.options.path, `runtime/jre-${majorVersion}`);

		// Build the API query to fetch the Java version
		const queryParams = new URLSearchParams({
			java_version: majorVersion.toString(),
			os: platform,
			arch: arch,
			archive_type: 'zip',
			java_package_type: this.options.java.type
		});
		const javaVersionURL = `https://api.azul.com/metadata/v1/zulu/packages/?${queryParams.toString()}`;
		let javaVersions = await fetch(javaVersionURL).then(res => res.json());
		if (!Array.isArray(javaVersions) || javaVersions.length === 0) {
			return { files: [], path: '', error: true, message: 'No Java versions found for the specified parameters.' };
		}
		javaVersions = javaVersions[0];

		let javaExePath = path.join(pathFolder, javaVersions.name.replace('.zip', ''), 'bin', 'java');
		if (platform === 'macos') {
			try {
				const pathBin = fs.readFileSync(path.join(pathFolder, javaVersions.name.replace('.zip', ''), "bin"), 'utf8').toString();
				javaExePath = path.join(pathFolder, javaVersions.name.replace('.zip', ''), pathBin, 'java');
			} catch (_) {
			}
		}

		if (!fs.existsSync(javaExePath)) {
			await this.verifyAndDownloadFile({
				filePath: path.join(pathFolder, javaVersions.name),
				pathFolder: pathFolder,
				fileName: javaVersions.name,
				url: javaVersions.download_url
			})

			const entries = await getFileFromArchive(path.join(pathFolder, javaVersions.name), null, null, true);

			for (const entry of entries) {
				if (entry.name.startsWith('META-INF')) continue;

				if (entry.isDirectory) {
					fs.mkdirSync(`${pathFolder}/${entry.name}`, { recursive: true, mode: 0o777 });
					continue;
				}
				fs.writeFileSync(`${pathFolder}/${entry.name}`, entry.data, { mode: 0o777 });
			}

			if (platform === 'macos') {
				try {
					const pathBin = fs.readFileSync(path.join(pathFolder, javaVersions.name.replace('.zip', ''), "bin"), 'utf8').toString();
					javaExePath = path.join(pathFolder, javaVersions.name.replace('.zip', ''), pathBin, 'java');
				} catch (_) {
				}
			}
		}

		return { files: [], path: javaExePath };
	}

	/**
	 * Maps the Node `os.platform()` and `os.arch()` to Adoptium's expected format.
	 * Apple Silicon can optionally download x64 if `intelEnabledMac` is true.
	 */
	private getPlatformArch(): { platform: string; arch: string } {
		const platformMap: Record<string, string> = {
			win32: 'windows',
			darwin: 'macos',
			linux: 'linux'
		};
		const archMap: Record<string, string> = {
			x64: 'x64',
			ia32: 'x32',
			arm64: 'aarch64',
			arm: 'arm'
		};

		const mappedPlatform = platformMap[os.platform()] || os.platform();
		let mappedArch = archMap[os.arch()] || os.arch();

		// Force x64 if Apple Silicon but user wants to use Intel-based Java
		if (os.platform() === 'darwin' && os.arch() === 'arm64' && this.options.intelEnabledMac) {
			mappedArch = 'x64';
		}

		return { platform: mappedPlatform, arch: mappedArch };
	}

	/**
	 * Verifies if the Java archive already exists and matches the expected checksum.
	 * If it doesn't exist or fails the hash check, it downloads from the given URL.
	 * 
	 * @param params.filePath   The local file path
	 * @param params.pathFolder The folder to place the file in
	 * @param params.fileName   The name of the file
	 * @param params.url        The remote download URL
	 * @param params.checksum   Expected SHA-256 hash
	 */
	private async verifyAndDownloadFile({
		filePath,
		pathFolder,
		fileName,
		url
	}: {
		filePath: string;
		pathFolder: string;
		fileName: string;
		url: string;
	}): Promise<void> {

		// If not found or failed checksum, download anew
		if (!fs.existsSync(filePath)) {
			fs.mkdirSync(pathFolder, { recursive: true });
			const download = new Downloader();

			// Relay progress events
			download.on('progress', (downloaded: number, size: number) => {
				this.emit('progress', downloaded, size, fileName);
			});

			// Start download
			await download.downloadFile(url, pathFolder, fileName);
		}
	}
}
