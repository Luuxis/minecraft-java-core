/**
 * @author Luuxis
 * Luuxis License v1.0 (voir fichier LICENSE pour les détails en FR/EN)
 */

import fs from 'fs';
import os from 'os';
import semver from 'semver';
import { getPathLibraries, isold } from '../utils/Index.js';

/**
 * Maps the Node.js process.platform values to Mojang's library folders.
 */
const MOJANG_LIBRARY_MAP: Record<string, string> = {
	win32: 'windows',
	darwin: 'osx',
	linux: 'linux'
};

/**
 * Represents options for memory usage, screen size, extra args, etc.
 * Adapt or expand as needed for your use case.
 */
export interface LaunchOptions {
	path: string;              // Base path to Minecraft data folder
	instance?: string;         // Instance name (if using multi-instance approach)
	authenticator: any;        // Auth object containing tokens, user info, etc.
	version?: string;         // Minecraft version
	bypassOffline?: boolean;   // Bypass offline mode for multiplayer
	memory: {
		min?: string;             // Minimum memory (e.g. "512M", "1G")
		max?: string;             // Maximum memory (e.g. "4G", "8G")
	};
	screen?: {
		width?: number;
		height?: number;
	};
	GAME_ARGS: Array<string>;  // Additional arguments passed to the game
	JVM_ARGS: Array<string>;   // Additional arguments passed to the JVM
	mcp?: string;              // MCP config path (for modded usage)
}

/**
 * Represents the data structure of a Minecraft version JSON file (simplified).
 * Adapt this interface if your JSON includes more properties.
 */
export interface VersionJSON {
	id: string;
	type: string;
	assetIndex: {
		id: string;
	};
	assets?: string;          // Name of the assets index
	mainClass?: string;
	minecraftArguments?: string; // Legacy format for older MC versions
	arguments?: {
		game?: Array<string>;
		jvm?: Array<string>;
	};
	libraries?: Array<any>;    // List of library dependencies
	nativesList?: Array<string>;
	logging?: any;            // Logging configuration
}

export interface Library {
	name: string;
	loader?: string;
	natives?: Record<string, string>;
	rules?: { os?: { name?: string } }[];
}

/**
 * Represents a loader JSON structure (e.g. Forge or Fabric).
 * Again, adapt as your loader's actual structure requires.
 */
export interface LoaderJSON {
	id?: string;
	mainClass?: string;
	libraries?: Array<any>;
	minecraftArguments?: string;
	isOldForge?: boolean;
	jarPath?: string;
}

/**
 * Data structure returned by the class, detailing arguments
 * for launching Minecraft (game args, JVM args, classpath, etc.).
 */
export interface LaunchArguments {
	game: Array<string>;
	jvm: Array<string>;
	classpath: Array<string>;
	mainClass?: string;
}

/**
 * Builds and organizes JVM and game arguments required to launch Minecraft,
 * including optional loader (e.g., Forge) arguments.
 */
export default class MinecraftArguments {
	private options: LaunchOptions;
	private authenticator: any;

	constructor(options: LaunchOptions) {
		this.options = options;
		this.authenticator = options.authenticator;
	}

	/**
	 * Gathers all arguments (game, JVM, classpath) and returns them for launching.
	 * @param versionJson The Minecraft version JSON.
	 * @param loaderJson  An optional loader JSON (Forge, Fabric, etc.).
	 */
	public async GetArguments(versionJson: VersionJSON, loaderJson?: LoaderJSON): Promise<LaunchArguments> {
		const gameArguments = await this.GetGameArguments(versionJson, loaderJson);
		const jvmArguments = await this.GetJVMArguments(versionJson);
		const classpathData = await this.GetClassPath(versionJson, loaderJson);

		return {
			game: gameArguments,
			jvm: jvmArguments,
			classpath: classpathData.classpath,
			mainClass: classpathData.mainClass
		};
	}

	/**
	 * Builds the Minecraft game arguments, injecting authentication tokens,
	 * user info, and any loader arguments if present.
	 * @param versionJson The Minecraft version JSON.
	 * @param loaderJson  The loader JSON (e.g., Forge) if applicable.
	 */
	public async GetGameArguments(versionJson: VersionJSON, loaderJson?: LoaderJSON): Promise<Array<string>> {
		// For older MC versions, arguments may be in `minecraftArguments` instead of `arguments.game`
		let gameArgs = versionJson.minecraftArguments
			? versionJson.minecraftArguments.split(' ')
			: versionJson.arguments?.game ?? [];

		// Merge loader's Minecraft arguments if provided
		if (loaderJson) {
			const loaderGameArgs = loaderJson.minecraftArguments ? loaderJson.minecraftArguments.split(' ') : [];
			gameArgs = gameArgs.concat(loaderGameArgs);
			// Remove duplicate arguments
			gameArgs = gameArgs.filter(
				(item, index, self) => index === self.findIndex(arg => arg === item)
			);
		}

		// Determine user type (e.g. 'msa' or 'Xbox') depending on version and authenticator
		let userType = 'msa';
		if (versionJson.id.startsWith('1.16')) {
			userType = 'Xbox';
		} else {
			userType = this.authenticator.meta.type === 'Xbox' ? 'msa' : this.authenticator.meta.type;
		}

		// Map of placeholders to actual values
		const placeholderMap: Record<string, string> = {
			'${auth_access_token}': this.authenticator.access_token,
			'${auth_session}': this.authenticator.access_token,
			'${auth_player_name}': this.authenticator.selected_profile ? this.authenticator.selected_profile.name : this.authenticator.name,
			'${auth_uuid}': this.authenticator.selected_profile ? this.authenticator.selected_profile.id : this.authenticator.uuid,
			'${auth_xuid}': this.authenticator?.xboxAccount?.xuid || this.authenticator.access_token,
			'${user_properties}': this.authenticator.user_properties,
			'${user_type}': userType,
			'${version_name}': loaderJson ? loaderJson.id || versionJson.id : versionJson.id,
			'${assets_index_name}': versionJson.assetIndex.id,
			'${game_directory}': this.options.instance
				? `${this.options.path}/instances/${this.options.instance}`
				: this.options.path,
			'${assets_root}': isold(versionJson)
				? `${this.options.path}/resources`
				: `${this.options.path}/assets`,
			'${game_assets}': isold(versionJson)
				? `${this.options.path}/resources`
				: `${this.options.path}/assets`,
			'${version_type}': versionJson.type,
			'${clientid}': this.authenticator.clientId
				|| this.authenticator.client_token
				|| this.authenticator.access_token
		};

		// Replace placeholders in the game arguments
		for (let i = 0; i < gameArgs.length; i++) {
			if (typeof gameArgs[i] === 'object') {
				// If it's an unexpected object, remove it
				gameArgs.splice(i, 1);
				i--;
				continue;
			}
			if (placeholderMap[gameArgs[i]]) {
				gameArgs[i] = placeholderMap[gameArgs[i]];
			}
		}

		// If screen options are provided, add them
		if (this.options.screen) {
			const { width, height } = this.options.screen;
			if (width && height) {
				gameArgs.push('--width', String(width), '--height', String(height));
			}
		}

		// Add any extra game arguments from user config
		gameArgs.push(...this.options.GAME_ARGS);

		// Filter out any remaining unexpected objects
		return gameArgs.filter(item => typeof item === 'string');
	}

	/**
	 * Builds the JVM arguments needed by Minecraft. This includes memory settings,
	 * OS-specific options, and any additional arguments supplied by the user.
	 * @param versionJson The Minecraft version JSON.
	 */
	public async GetJVMArguments(versionJson: VersionJSON): Promise<Array<string>> {
		// Some OS-specific defaults
		const osSpecificOpts: Record<string, string> = {
			win32: '-XX:HeapDumpPath=MojangTricksIntelDriversForPerformance_javaw.exe_minecraft.exe.heapdump',
			darwin: '-XstartOnFirstThread',
			linux: '-Xss1M'
		};

		// Core JVM arguments
		const jvmArgs: Array<string> = [
			`-Xms${this.options.memory.min}`,
			`-Xmx${this.options.memory.max}`,
			'-XX:+UnlockExperimentalVMOptions',
			'-XX:G1NewSizePercent=20',
			'-XX:G1ReservePercent=20',
			'-XX:MaxGCPauseMillis=50',
			'-XX:G1HeapRegionSize=32M',
			'-Dfml.ignoreInvalidMinecraftCertificates=true',
			`-Djna.tmpdir=${this.options.path}/versions/${versionJson.id}/natives`,
			`-Dorg.lwjgl.system.SharedLibraryExtractPath=${this.options.path}/versions/${versionJson.id}/natives`,
			`-Dio.netty.native.workdir=${this.options.path}/versions/${versionJson.id}/natives`
		];

		// For newer MC versions that use "arguments.game" instead of "minecraftArguments",
		// we add OS-specific arguments (e.g., Mac uses -XstartOnFirstThread).
		if (!versionJson.minecraftArguments) {
			const opt = osSpecificOpts[process.platform];
			if (opt) {
				jvmArgs.push(opt);
			}
		}

		// bypass offline mode multiplayer
		if (this.options?.bypassOffline) {
			jvmArgs.push('-Dminecraft.api.auth.host=https://nope.invalid/');
			jvmArgs.push('-Dminecraft.api.account.host=https://nope.invalid/');
			jvmArgs.push('-Dminecraft.api.session.host=https://nope.invalid/');
			jvmArgs.push('-Dminecraft.api.services.host=https://nope.invalid/');
		}

		// If natives are specified, add the native library path
		if (versionJson.nativesList) {
			jvmArgs.push(`-Djava.library.path=${this.options.path}/versions/${versionJson.id}/natives`);
		}

		// Special handling for macOS (setting dock icon)
		if (os.platform() === 'darwin') {
			const assetsPath = `${this.options.path}/assets/indexes/${versionJson.assets}.json`;
			const assetsContent = fs.readFileSync(assetsPath, 'utf-8');
			const assetsJson = JSON.parse(assetsContent);

			// Retrieve the hash of the minecraft.icns file
			const iconHash = assetsJson.objects['icons/minecraft.icns']?.hash;
			if (iconHash) {
				jvmArgs.push('-Xdock:name=Minecraft');
				jvmArgs.push(`-Xdock:icon=${this.options.path}/assets/objects/${iconHash.substring(0, 2)}/${iconHash}`);
			}
		}

		if (versionJson.logging && versionJson.logging.client) {
			const logConfig = versionJson.logging.client;
			const logConfigPath = `${this.options.path}/assets/log_configs/${logConfig.file.id}`;
			jvmArgs.push(logConfig.argument.replace('${path}', logConfigPath));
		}

		// Append any user-supplied JVM arguments
		jvmArgs.push(...this.options.JVM_ARGS);

		return jvmArgs;
	}

	/**
	 * Constructs the classpath (including libraries) that Minecraft requires
	 * to launch, and identifies the main class. Optionally merges loader libraries.
	 * @param versionJson The Minecraft version JSON.
	 * @param loaderJson  The loader JSON (e.g., Forge, Fabric) if applicable.
	 */
	public async GetClassPath(versionJson: VersionJSON, loaderJson?: LoaderJSON): Promise<{
		classpath: Array<string>;
		mainClass: string | undefined;
	}> {
		let combinedLibraries = versionJson.libraries ?? [];

		// If a loader JSON is provided, merge its libraries with the base MC version
		if (loaderJson?.libraries) {
			combinedLibraries = loaderJson.libraries.concat(combinedLibraries);
		}

		const map = new Map();

		for (const dep of combinedLibraries) {
			const parts = getPathLibraries(dep.name);
			const version = semver.valid(semver.coerce(parts.version));
			if (!version) continue;

			const pathParts = parts.path.split('/');
			const basePath = pathParts.slice(0, -1).join('/');

			const key = `${basePath}/${parts.name.replace(`-${parts.version}`, '')}`;
			const current = map.get(key);

			const isSupportedVersion = semver.satisfies(semver.valid(semver.coerce(this.options.version)), '1.14.4 - 1.18.2');
			const isWindows = process.platform === 'win32';

			if (!current || semver.gt(version, current.version) && (isSupportedVersion && isWindows)) {
				map.set(key, { ...dep, version });
			}
		}

		const latest: Record<string, Library> = Object.fromEntries(
			Array.from(map.entries()).map(([key, value]) => [key, value as Library])
		);

		// Prepare to accumulate all library paths
		const librariesList: string[] = [];
		for (const lib of Object.values(latest)) {
			// Skip certain logging libraries if flagged (e.g., in Forge's "loader" property)
			if (lib.loader && lib.name.startsWith('org.apache.logging.log4j:log4j-slf4j2-impl')) continue;


			// Check if the library has native bindings
			if (lib.natives) {
				const nativeName = lib.natives[MOJANG_LIBRARY_MAP[process.platform]] || lib.natives[process.platform];
				if (!nativeName) continue;
			} else if (lib.rules && lib.rules[0].os) {
				// Some libraries only apply to specific OS platforms
				if (lib.rules[0].os.name !== MOJANG_LIBRARY_MAP[process.platform]) continue;
			}

			// Build the path for this library
			const libPath = getPathLibraries(lib.name);
			if (lib.loader) {
				// If the loader uses a specific library path
				librariesList.push(`${lib.loader}/libraries/${libPath.path}/${libPath.name}`);
			} else {
				librariesList.push(`${this.options.path}/libraries/${libPath.path}/${libPath.name}`);
			}
		}

		// Add the main Minecraft JAR (or special jar if using old Forge or MCP)
		if (loaderJson?.isOldForge && loaderJson.jarPath) {
			librariesList.push(loaderJson.jarPath);
		} else if (this.options.mcp) {
			librariesList.push(this.options.mcp);
		} else {
			librariesList.push(`${this.options.path}/versions/${versionJson.id}/${versionJson.id}.jar`);
		}

		// Filter out duplicates in the final library paths
		const uniquePaths: string[] = [];
		for (const libPath of librariesList) {
			// We only check if we've already used the exact file name
			const fileName = libPath.split('/').pop();
			if (fileName && !uniquePaths.includes(fileName)) {
				uniquePaths.push(libPath);
			}
		}

		// The final classpath argument is OS-dependent (':' on Unix, ';' on Windows)
		const cpSeparator = process.platform === 'win32' ? ';' : ':';
		const cpArgument = uniquePaths.length > 0 ? uniquePaths.join(cpSeparator) : '';

		return {
			classpath: ['-cp', cpArgument],
			mainClass: loaderJson ? loaderJson.mainClass : versionJson.mainClass
		};
	}
}
